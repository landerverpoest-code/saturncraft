// Multiplayer sessions. The host's game is authoritative: it owns the world
// (block edits are validated and rebroadcast), simulates every mob, and sends
// time and weather. Clients generate terrain from the same seed, apply the
// host's edits, simulate their own player and render everyone else.
//
// Interface used by the game (game.net is null in single-player):
//   hostSession(game, name)            -> HostSession   (from the pause menu)
//   joinSession(code, name, onStatus)  -> ClientSession (before the Game exists)
//   session.attach(game)    once the world exists (Game.start for clients)
//   session.tick()          after every game tick
//   session.render(sec)     every frame
//   session.sendChat(text), session.close(), session.isHost / isClient,
//   session.applyingRemote, session.localRandomTicks, session.tickMob(mob),
//   session.redirectSpawn(...), session.remoteTargets(proj), session.playerNames()
import {
  PROTOCOL_VERSION, MAX_PLAYERS, encodeMessage, Reassembler, makeRoomCode, cleanName,
  packPlayerState, unpackPlayerState, packMob, encodePackedChunk, decodePackedChunk,
} from './protocol.js';
import { EditSync } from './editSync.js';
import { createTransport } from './transport.js';
import { RemotePlayer } from './remotePlayer.js';
import { MobMirror } from './mobMirror.js';
import { packChunk, unpackChunk, playerSaveData, applyPlayerSave } from '../world/save.js';
import { chunkKey } from '../world/world.js';

const STATE_EVERY = 2;      // ticks between player / mob updates (10 Hz)
const ENV_EVERY = 20;       // time + weather once a second (also the heartbeat)
const PSAVE_EVERY = 100;    // clients send their inventory etc. every 5 s
const TIMEOUT_MS = 30000;
const MOB_RANGE = 80;       // mobs further than this from a client are not sent to it
const REACH = 12;           // blocks: how far from a player its edits may be (reach + latency slack)
const FAR_FROM_HOST = 8;    // chunks: beyond this a client runs random ticks (crop growth...) itself

/** Message channel over a transport conn: JSON objects in, JSON objects out. */
class Channel {
  constructor(conn, onMessage, onClose) {
    this.conn = conn;
    const re = new Reassembler();
    conn.onData = (d) => { const m = re.push(d); if (m) { try { onMessage(m); } catch (e) { console.warn('net message failed', m.t, e); } } };
    conn.onClose = onClose;
  }
  send(msg) { for (const s of encodeMessage(msg)) this.conn.send(s); }
  close() { this.conn.close(); }
}

function joinLink(code) {
  const keep = new URLSearchParams();
  const cur = new URLSearchParams(location.search);
  for (const k of ['net', 'peerhost', 'peerport', 'peerpath', 'peersecure']) if (cur.has(k)) keep.set(k, cur.get(k));
  keep.set('join', code);
  return `${location.origin}${location.pathname}?${keep}`;
}

class Session {
  constructor(role, name) {
    this.isHost = role === 'host';
    this.isClient = !this.isHost;
    this.name = name;
    this.game = null;
    this.edits = null;
    this.remotes = new Map();   // player id -> RemotePlayer
    this.ticks = 0;
    this.swingSeq = 0; this.lastSwing = 0;
    this.closed = false;
    this._applyingOther = false;
  }

  get applyingRemote() { return this._applyingOther || !!(this.edits && this.edits.applying); }

  /** Own player state for the wire. */
  ownState() {
    const g = this.game, p = g.player, sw = g.interaction.swing;
    if (sw > this.lastSwing) this.swingSeq++;
    this.lastSwing = sw;
    const st = p.inventory.selectedStack;
    return packPlayerState(p, st ? st.id : null, this.swingSeq);
  }

  startBackground() {
    // keep simulating (and talking) while the tab is in the background, where frames stop
    if (this.bgTimer) return;
    this.bgTimer = setInterval(() => {
      if (this.isClient && !this.closed && performance.now() - (this.lastKeepAlive || 0) > 4000) { this.lastKeepAlive = performance.now(); this.send({ t: 'ka' }); }
      const g = this.game;
      if (g && g.running && performance.now() - g.lastTime > 400) g.backgroundTick(performance.now());
    }, 250);
  }

  render(sec) {
    const now = performance.now();
    for (const rp of this.remotes.values()) rp.update(this.game, sec, now);
  }

  /** True when this page itself stalled for a while (a long frame, a sleeping laptop): don't blame the peers. */
  stalled() {
    const now = performance.now(), gap = now - (this.lastTickAt || now);
    this.lastTickAt = now;
    return gap > 3000;
  }

  playerNames() { return [this.name, ...[...this.remotes.values()].map((r) => r.name)]; }

  disposeRemotes() { for (const rp of this.remotes.values()) rp.dispose(); this.remotes.clear(); }
}

// ================================================================================
export class HostSession extends Session {
  constructor(name, transport, code) {
    super('host', name);
    this.transport = transport;
    this.code = code;
    this.clients = new Map(); // id -> { id, name, ch, rp, joined, lastSeen }
    this.nextId = 1;
  }

  get link() { return joinLink(this.code); }

  async open(game) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { this.handle = await this.transport.host(this.code); break; } catch (e) { lastErr = e; this.code = makeRoomCode(); }
    }
    if (!this.handle) throw lastErr;
    this.handle.onConnection = (conn) => this.onConnection(conn);
    this.attach(game);
    return this;
  }

  attach(game) {
    this.game = game;
    game.netPlayers = game.netPlayers || {};
    this.edits = new EditSync(game.world, { host: true });
    // lightning strikes are shown (and burn / hurt) on every client too
    const strike = game.strikeLightning.bind(game);
    game.strikeLightning = (x, y, z) => { strike(x, y, z); if (!this.closed) this.broadcast({ t: 'bolt', x, y, z }); };
    this.startBackground();
  }

  get localRandomTicks() { return true; }

  joined() { return [...this.clients.values()].filter((c) => c.joined); }

  broadcast(msg, except = null) {
    let parts = null;
    for (const c of this.clients.values()) {
      if (!c.joined || c === except) continue;
      parts = parts || encodeMessage(msg);
      for (const s of parts) c.ch.conn.send(s);
    }
  }

  onConnection(conn) {
    // the signalling server can hand us the same peer's offer twice (after a reconnect): keep the first
    for (const o of this.clients.values()) if (o.ch.conn.peer === conn.peer && !o.ch.conn.closed) { conn.onData = null; conn.onClose = null; return; }
    if (this.closed) { conn.close(); return; }
    const c ={ id: this.nextId++, name: null, joined: false, lastSeen: performance.now() };
    c.ch = new Channel(conn, (m) => this.onMessage(c, m), () => this.drop(c, 'left the game'));
    this.clients.set(c.id, c);
  }

  onMessage(c, m) {
    c.lastSeen = performance.now();
    if (!c.joined) { if (m.t === 'hello') this.welcome(c, m); return; }
    const g = this.game;
    switch (m.t) {
      case 'st': { const st = unpackPlayerState(m.s); if (st) { c.raw = m.s.slice(0, 8); c.rp.setState(st); } break; }
      case 'ed': {
        const bad = this.edits.apply(m.e, (x, y, z) => this.canReach(c, x, y, z));
        if (bad.length) {
          // put the client's world back the way it is here
          const fix = [];
          for (const [x, y, z] of bad) if (g.world.isLoaded(x, z)) fix.push(x, y, z, g.world.getBlock(x, y, z), g.world.getMeta(x, y, z));
          if (fix.length) c.ch.send({ t: 'ed', e: fix });
        }
        break;
      }
      case 'chat': {
        const text = String(m.m || '').slice(0, 256);
        if (!text) break;
        g.chat.add(`<${c.name}> ${text}`);
        this.broadcast({ t: 'chat', from: c.name, m: text }, c);
        break;
      }
      case 'hit': this.remoteHit(c, m); break;
      case 'ps': if (m.p && Array.isArray(m.p.slots)) g.netPlayers[c.name] = m.p; break;
      case 'bye': this.drop(c, 'left the game'); break;
      default: break;
    }
  }

  canReach(c, x, y, z) {
    const s = c.rp && c.rp.state;
    if (!s) return false;
    return Math.hypot(x + 0.5 - s.x, y + 0.5 - (s.y + 1.6), z + 0.5 - s.z) <= REACH;
  }

  welcome(c, m) {
    const g = this.game;
    if (m.v !== PROTOCOL_VERSION) { c.ch.send({ t: 'reject', reason: 'The host runs a different version of Saturncraft' }); setTimeout(() => this.drop(c), 500); return; }
    if (this.joined().length >= MAX_PLAYERS - 1) { c.ch.send({ t: 'reject', reason: `This world is full (${MAX_PLAYERS} players)` }); setTimeout(() => this.drop(c), 500); return; }
    let name = cleanName(m.name);
    const taken = new Set(this.playerNames());
    for (let n = 2; taken.has(name); n++) name = cleanName(m.name).slice(0, 13) + '-' + n;
    c.name = name;
    const p = g.player;
    const chunks = [];
    for (const [k, d] of g.world.saved) chunks.push([k, d]);
    for (const ch of g.world.chunks.values()) if (ch.modified) chunks.push([chunkKey(ch.cx, ch.cz), ch]);
    c.ch.send({
      t: 'welcome', v: PROTOCOL_VERSION, id: c.id, name, hostName: this.name,
      seed: g.seed, time: g.time, weather: g.weather.save(), gamemode: p.gamemode,
      worldSpawn: g.worldSpawn, pos: { x: p.x, y: p.y, z: p.z, yaw: p.yaw },
      player: g.netPlayers[name] || null,
      players: [{ id: 0, name: this.name }, ...this.joined().map((o) => ({ id: o.id, name: o.name }))],
      chunks: chunks.length,
    });
    for (const [k, d] of chunks) c.ch.send({ t: 'ck', k, c: encodePackedChunk(packChunk(d)) });
    c.ch.send({ t: 'ready' });
    c.joined = true;
    c.rp = new RemotePlayer(g.scene, c.id, name, this);
    this.remotes.set(c.id, c.rp);
    this.broadcast({ t: 'join', id: c.id, name }, c);
    g.chat.add(`${name} joined the game`);
  }

  drop(c, why = null) {
    if (!this.clients.has(c.id)) return;
    this.clients.delete(c.id);
    c.ch.close();
    if (!c.joined) return;
    c.rp.dispose();
    this.remotes.delete(c.id);
    this.broadcast({ t: 'leave', id: c.id, name: c.name });
    if (why && this.game) this.game.chat.add(`${c.name} ${why}`);
  }

  /** A client hit one of our mobs (melee or its arrow). Drops and experience go to that client. */
  remoteHit(c, m) {
    const g = this.game, s = c.rp.state;
    const mob = g.entities.list.find((e) => e.kind === 'mob' && e.id === m.id);
    if (!mob || mob.deathTime > 0 || mob.removed || !s) return;
    const dist = Math.hypot(mob.x - s.x, mob.y - s.y, mob.z - s.z);
    if (dist > (m.p ? 120 : 8)) return;
    const dmg = Math.max(0, Math.min(40, +m.d || 0)), knock = Math.max(0, Math.min(1.5, +m.k || 0));
    const ents = g.entities, prev = ents.redirect;
    ents.redirect = c.id;
    mob.netKiller = c.id;
    try { mob.hurt(dmg, m.p ? 'arrow' : 'player', c.rp.target, knock, m.p ? { remote: true } : null); } finally { ents.redirect = prev; }
  }

  /** Items / experience that would appear on the host go to a client instead. */
  redirectSpawn(id, kind, x, y, z, data) {
    const c = this.clients.get(id);
    if (!c || !c.joined) return false;
    c.ch.send({ t: 'give', k: kind, x, y, z, d: data });
    return true;
  }

  /** Mob AI looks at the nearest player: swap game.player for that tick. */
  tickMob(e) {
    const g = this.game, real = g.player;
    let best = real, bd = real.dead ? Infinity : (real.x - e.x) ** 2 + (real.y - e.y) ** 2 + (real.z - e.z) ** 2;
    for (const c of this.clients.values()) {
      if (!c.joined) continue;
      const t = c.rp.target;
      if (t.dead) continue;
      const d = (t.x - e.x) ** 2 + (t.y - e.y) ** 2 + (t.z - e.z) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    const ents = g.entities, prev = ents.redirect;
    if (e.netKiller && e.deathTime > 0) ents.redirect = e.netKiller;
    g.player = best;
    try { e.tick(g); } finally { g.player = real; ents.redirect = prev; }
  }

  /** Remote players that projectiles can hit (mob arrows; no PvP). */
  remoteTargets(proj) {
    if (proj && proj.shooter && proj.shooter.isPlayer) return [];
    return this.joined().map((c) => c.rp.target).filter((t) => !t.dead);
  }

  sendHurt(rp, amount, source, attacker) {
    const c = this.clients.get(rp.id);
    if (c) c.ch.send({ t: 'hurt', a: amount, s: source, x: attacker ? attacker.x : null, z: attacker ? attacker.z : null });
  }

  sendChat(text) { this.broadcast({ t: 'chat', from: this.name, m: text }); }

  tick() {
    if (this.closed) return;
    const g = this.game;
    this.ticks++;
    if (this.stalled()) for (const c of this.clients.values()) c.lastSeen = performance.now();
    const e = this.edits.take();
    if (e.length) this.broadcast({ t: 'ed', e });
    if (this.ticks % STATE_EVERY === 0) {
      const list = [[0, ...this.ownState()]];
      for (const c of this.joined()) if (c.raw) list.push([c.id, ...c.raw]);
      this.broadcast({ t: 'pl', p: list });
      const mobs = g.entities.list.filter((m) => m.kind === 'mob' && !m.removed && !m.dead);
      for (const c of this.joined()) {
        const s = c.rp.state;
        if (!s) continue;
        const near = mobs.filter((m) => Math.abs(m.x - s.x) < MOB_RANGE && Math.abs(m.z - s.z) < MOB_RANGE).map(packMob);
        c.ch.send({ t: 'mobs', m: near });
      }
    }
    if (this.ticks % ENV_EVERY === 0) {
      this.broadcast({ t: 'env', time: g.time, w: g.weather.save() });
      const now = performance.now();
      for (const c of [...this.clients.values()]) if (now - c.lastSeen > TIMEOUT_MS) this.drop(c, 'timed out');
    }
  }

  close() {
    if (this.closed) return;
    this.broadcast({ t: 'bye', reason: 'The host closed the world' });
    this.closed = true;
    for (const c of [...this.clients.values()]) { this.clients.delete(c.id); setTimeout(() => c.ch.close(), 300); }
    setTimeout(() => { if (this.handle) this.handle.close(); }, 400);
    if (this.edits) this.edits.detach();
    clearInterval(this.bgTimer);
    this.disposeRemotes();
  }
}

/** Open the running single-player world to friends. */
export async function hostSession(game, name, transport = createTransport()) {
  const s = new HostSession(cleanName(name), transport, makeRoomCode());
  return s.open(game);
}

// ================================================================================
export class ClientSession extends Session {
  constructor(name) {
    super('client', name);
    this.welcome = null;
    this.chunks = [];
    this.queue = [];
    this.id = -1;
    this.lastSeen = performance.now();
  }

  async connect(transport, code, onStatus = () => {}) {
    onStatus('Connecting…');
    const conn = await transport.join(code);
    this.ch = new Channel(conn, (m) => this.onMessage(m), () => this.lost('Lost connection to the host'));
    this.ch.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name });
    this.startBackground(); // keep-alives while the world downloads and the terrain loads
    onStatus('Downloading the world…');
    this.onStatus = onStatus;
    await new Promise((resolve, reject) => {
      this._ready = resolve; this._fail = reject;
      this._joinTimer = setTimeout(() => this.lost('The host did not answer'), 60000);
    });
    clearTimeout(this._joinTimer);
    return this;
  }

  send(msg) { if (!this.closed) this.ch.send(msg); }

  onMessage(m) {
    this.lastSeen = performance.now();
    if (!this.game) {
      if (m.t === 'welcome') { this.welcome = m; this.id = m.id; this.name = m.name; }
      else if (m.t === 'ck') { this.chunks.push(m); if (this.welcome && this.onStatus) this.onStatus(`Downloading the world… ${this.chunks.length}/${this.welcome.chunks} chunks`); }
      else if (m.t === 'ready') this._ready();
      else if (m.t === 'reject') this.lost(m.reason || 'The host refused the connection');
      else if (m.t === 'bye') this.lost(m.reason || 'The host closed the world');
      else this.queue.push(m);
      return;
    }
    this.handle(m);
  }

  get worldSpawn() { return this.welcome.worldSpawn; }

  /** Called by Game.start once the world exists, before terrain loads around the player. */
  attach(game) {
    this.game = game;
    const w = this.welcome;
    for (const ck of this.chunks) game.world.saved.set(+ck.k, unpackChunk(decodePackedChunk(ck.c)));
    this.chunks = null;
    game.time = w.time;
    game.weather.load(w.weather);
    game.spawner.enabled = false;
    game.worldSpawn = { ...w.worldSpawn };
    const p = game.player;
    if (w.player) applyPlayerSave(game, w.player);
    else {
      p.setGamemode(w.gamemode);
      p.spawn = { ...w.worldSpawn };
      p.setPosition(w.pos.x, w.pos.y, w.pos.z);
      p.yaw = w.pos.yaw;
    }
    this.edits = new EditSync(game.world, { host: false });
    // no mob generation here: mobs come from the host
    game.chunks.onChunkLoaded = (cx, cz) => this.edits.onChunkLoaded(cx, cz);
    this.mobs = new MobMirror(game, this);
    for (const o of w.players) this.addRemote(o.id, o.name);
    for (const m of this.queue) this.handle(m);
    this.queue = [];
    this.startBackground();
  }

  addRemote(id, name) {
    if (id === this.id || this.remotes.has(id)) return this.remotes.get(id);
    const rp = new RemotePlayer(this.game.scene, id, name, this);
    this.remotes.set(id, rp);
    return rp;
  }

  get localRandomTicks() {
    const h = this.remotes.get(0), p = this.game.player;
    if (!h || !h.state) return true;
    return Math.max(Math.abs(h.state.x - p.x), Math.abs(h.state.z - p.z)) > FAR_FROM_HOST * 16;
  }

  handle(m) {
    const g = this.game;
    switch (m.t) {
      case 'ed': this.edits.apply(m.e); break;
      case 'pl': for (const a of m.p || []) { if (a[0] === this.id) continue; const rp = this.remotes.get(a[0]); if (rp) rp.setState(unpackPlayerState(a.slice(1))); } break;
      case 'join': this.addRemote(m.id, m.name); g.chat.add(`${m.name} joined the game`); break;
      case 'leave': { const rp = this.remotes.get(m.id); if (rp) { rp.dispose(); this.remotes.delete(m.id); } g.chat.add(`${m.name} left the game`); break; }
      case 'chat': g.chat.add(`<${m.from}> ${m.m}`); break;
      case 'env': if (Math.abs(g.time - m.time) > 2) g.time = m.time; g.weather.load(m.w); break;
      case 'mobs': this.mobs.apply(m.m); break;
      case 'hurt': g.player.hurt(m.a, m.s, m.x != null ? { x: m.x, z: m.z } : null); break;
      case 'give':
        if (m.k === 'item') g.entities.spawnItem(m.x, m.y, m.z, m.d);
        else if (m.k === 'xp') g.entities.spawnXp(m.x, m.y, m.z, m.d);
        break;
      case 'bolt': this._applyingOther = true; try { g.strikeLightning(m.x, m.y, m.z); } finally { this._applyingOther = false; } break;
      case 'bye': this.lost(m.reason || 'The host closed the world'); break;
      default: break;
    }
  }

  // clients never simulate mobs or hand out drops for others
  tickMob(e) { e.tick(this.game); }
  redirectSpawn() { return false; }
  remoteTargets() { return []; }

  sendChat(text) { this.send({ t: 'chat', m: text }); }

  tick() {
    if (this.closed) return;
    this.ticks++;
    if (this.stalled()) this.lastSeen = performance.now();
    const e = this.edits.take();
    if (e.length) this.send({ t: 'ed', e });
    if (this.ticks % STATE_EVERY === 0) this.send({ t: 'st', s: this.ownState() });
    if (this.ticks % PSAVE_EVERY === 0) this.send({ t: 'ps', p: playerSaveData(this.game.player) });
    if (this.ticks % ENV_EVERY === 0 && performance.now() - this.lastSeen > TIMEOUT_MS) this.lost('Lost connection to the host (timed out)');
  }

  /** Connection gone: back to the title screen. */
  lost(msg) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.bgTimer);
    try { this.ch && this.ch.close(); } catch { /* gone */ }
    if (!this.game) { if (this._fail) this._fail(new Error(msg)); return; }
    const g = this.game;
    g.running = false;
    g.input.unlock();
    g.ui.clear();
    g.ui.open = 'netlost';
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = '<h2>Disconnected</h2><p class="sub"></p><button class="btn">Back to Title Screen</button>';
    s.querySelector('p').textContent = msg;
    s.querySelector('button').onclick = () => { if (g.hooks.quit) g.hooks.quit(); };
    g.ui.layer.appendChild(s);
  }

  close() {
    if (this.closed) return;
    try { this.send({ t: 'ps', p: playerSaveData(this.game.player) }); this.send({ t: 'bye' }); } catch { /* gone */ }
    this.closed = true;
    clearInterval(this.bgTimer);
    if (this.edits) this.edits.detach();
    if (this.mobs) this.mobs.clear();
    this.disposeRemotes();
    setTimeout(() => this.ch.close(), 300);
  }
}

/** Connect to a friend's world; resolves once the world data has arrived. */
export async function joinSession(code, name, onStatus, transport = createTransport()) {
  const s = new ClientSession(cleanName(name));
  return s.connect(transport, code, onStatus);
}

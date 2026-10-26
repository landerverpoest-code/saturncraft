// Multiplayer sessions. The host's game is authoritative: it owns the world
// (block edits are validated and rebroadcast), simulates every entity (mobs,
// dropped items, orbs, arrows, boats, falling blocks) around every player,
// owns chests and furnaces, and sends time and weather. Clients generate
// terrain from the same seed, apply the host's edits, simulate their own
// player and ask the host for everything that touches shared state.
//
// Interface used by the game (game.net is null in single-player):
//   hostSession(game, name)            -> HostSession   (from the pause menu)
//   joinSession(code, name, onStatus)  -> ClientSession (before the Game exists)
//   session.attach(game)    once the world exists (Game.start for clients)
//   session.tick()          after every game tick
//   session.render(sec)     every frame
//   session.isHost / isClient, applyingRemote, pvp, sendChat(text), close(),
//   tickNear(entity), remoteTargets(proj), raycastPlayers(...), playerNames(),
//   requestSpawn(kind, data), interactMob(mob), hitBoat(boat), ride(boat, on),
//   openContainer / closeContainer / uiBefore / uiAfter, requestTrade(...),
//   sendCommand(text), requestTravel(dim, arrival), requestExplosion(...),
//   onSwitchDimension(dim, pos), onArrived(x, y, z), respawnNearHost(), useFence(x, y, z)
import { doubleChestHalves, doubleChestView } from '../world/chests.js';
import { igniteTNT, PrimedTNT } from '../entities/tnt.js';
import { useStand, punchStand } from '../entities/armorStand.js';
import {
  PROTOCOL_VERSION, MAX_PLAYERS, encodeMessage, Reassembler, makeRoomCode, cleanName,
  packPlayerState, unpackPlayerState, packEntity, encodePackedChunk, decodePackedChunk,
  containerSlots, diffSlots, applySlotChanges, containerState, loadContainerState, copyStack, commandName, StandRequests,
} from './protocol.js';
import { heldBy, unleash, tieToFence, untieFromFence, isFencePost } from '../entities/leash.js';
import { raidBarFor, championDiscount } from '../mobs/raids.js';
import { offerPrice } from '../mobs/trades.js';
import { EditSync } from './editSync.js';
import { createTransport } from './transport.js';
import { RemotePlayer } from './remotePlayer.js';
import { EntityMirror } from './entityMirror.js';
import { packChunk, unpackChunk, playerSaveData, applyPlayerSave } from '../world/save.js';
import { chunkKey } from '../world/world.js';
import { B, isFurnace } from '../world/blocks.js';
import { I, ITEMS } from '../world/items.js';
import { withExtras } from '../world/enchantments.js';
import { rayAABB } from '../entities/entities.js';
import { canPickUpSpear } from '../entities/tidespear.js';
import { runRandomTicks } from '../world/randomTicks.js';
import { addXp } from '../player/experience.js';
import { MAX_USES } from '../mobs/trades.js';
import { claimSeat } from '../mobs/duneStrider.js';
import { EFFECTS } from '../player/effects.js';
import { runCommand } from '../ui/commands.js';
import { DIMENSIONS } from '../world/dimensions/dims.js';
import { POTIONS } from '../world/potions.js';

const STATE_EVERY = 2;      // ticks between player / entity updates (10 Hz)
const ENV_EVERY = 20;       // time + weather once a second (also the heartbeat)
const PSAVE_EVERY = 100;    // clients send their inventory etc. every 5 s
const CONTAINER_EVERY = 4;  // open chests / furnaces are re-sent when they change
const TIMEOUT_MS = 30000;
const ENTITY_RANGE = 80;    // entities further than this from a client are not sent to it
const BACKLOG_LIMIT = 128 * 1024; // bytes queued for a guest before its snapshots are skipped
const FULL_EVERY = 20;      // every 20th entity snapshot (2 s) is a full list, the others only what changed
const REACH = 12;           // blocks: how far from a player its edits / actions may be (reach + latency slack)
const GUEST_SIM_RADIUS = 4; // chunks the host keeps loaded (and simulates) around each guest
const GUEST_TICK_RADIUS = 2; // chunks around each guest that get random ticks (crops, leaves, fire, ice...); the costliest part per guest
const SLEEP_MS = 4500;      // a guest has to lie in bed this long before the night can be skipped

/** Message channel over a transport conn: JSON objects in, JSON objects out. */
class Channel {
  constructor(conn, onMessage, onClose) {
    this.conn = conn;
    const re = new Reassembler();
    conn.onData = (d) => { const m = re.push(d); if (m) { try { onMessage(m); } catch (e) { console.warn('net message failed', m.t, e); } } };
    conn.onClose = onClose;
  }
  send(msg) { for (const s of encodeMessage(msg)) this.conn.send(s); }
  /** Bytes queued but not yet sent on this connection (0 if the transport can't tell). */
  backlog() { return this.conn.backlog ? this.conn.backlog() : 0; }
  close() { this.conn.close(); }
}

function joinLink(code) {
  const keep = new URLSearchParams();
  const cur = new URLSearchParams(location.search);
  for (const k of ['net', 'peerhost', 'peerport', 'peerpath', 'peersecure']) if (cur.has(k)) keep.set(k, cur.get(k));
  keep.set('join', code);
  return `${location.origin}${location.pathname}?${keep}`;
}

const CONTAINER_BLOCKS = new Set([B.CHEST, B.BARREL, B.FURNACE, B.FURNACE_LIT, B.SMOKER, B.SMOKER_LIT, B.BLAST_FURNACE, B.BLAST_FURNACE_LIT, B.BREWING_STAND, B.GLOOMSHELL_BOX, B.HOPPER, B.DISPENSER, B.DROPPER]);
const contKey = (k, x, y, z) => `${k}:${x},${y},${z}`;
const finite = (...v) => v.every(Number.isFinite);
/** Stand-in for a player whose pet is waiting for them while they are offline. */
const OFFLINE = { isPlayer: true, dead: true, creative: false, x: 0, y: -1e4, z: 0, eyeHeight: 1.62, body: { height: 1.8 }, inventory: { selectedStack: null }, stats: { kills: 0 }, eyePos: () => [0, -1e4, 0], lookDir: () => [0, 0, -1], hurt: () => false };

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
    this.pvp = true;            // host options (sent to guests)
    this.guestCommands = true;
  }

  /** Random ticks (crops, grass, leaves) around our own player: the host runs them, also around guests. */
  get localRandomTicks() { return this.isHost; }

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
    if (this.bgTimer) return;
    // keep simulating (and talking) while the tab is in the background, where frames stop
    const beat = () => {
      if (this.isClient && !this.closed && performance.now() - (this.lastKeepAlive || 0) > 4000) { this.lastKeepAlive = performance.now(); this.send({ t: 'ka' }); }
      const g = this.game;
      if (g && g.running && performance.now() - g.lastTime > 200) g.backgroundTick(performance.now());
    };
    // Browsers slow timers in background tabs down to once a second, and after a few minutes to once a
    // minute: a host in another window would then serve its guests a minute late. A worker's timer keeps
    // its pace, so the beat comes from a tiny worker (with a plain timer as the fallback).
    try {
      const src = 'setInterval(function () { postMessage(0); }, 100);';
      this.bgWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.bgWorker.onmessage = beat;
      this.bgTimer = -1;
    } catch {
      this.bgTimer = setInterval(beat, 250);
    }
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

  /** Another player under the crosshair (PvP): { target, dist } or null. */
  raycastPlayers(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null;
    for (const rp of this.remotes.values()) {
      const s = rp.state;
      if (!s || s.dead) continue;
      const t = rayAABB(ox, oy, oz, dx, dy, dz, s.x - 0.3, s.y, s.z - 0.3, s.x + 0.3, s.y + 1.8, s.z + 0.3);
      if (t !== null && t <= maxDist && (!best || t < best.dist)) best = { target: rp.target, dist: t };
    }
    return best;
  }

  setOptions(m) {
    if (typeof m.pvp === 'boolean') this.pvp = m.pvp;
    if (typeof m.gc === 'boolean') this.guestCommands = m.gc;
  }
}

// ================================================================================
export class HostSession extends Session {
  constructor(name, transport, code) {
    super('host', name);
    this.transport = transport;
    this.code = code;
    this.clients = new Map(); // id -> { id, name, ch, rp, joined, lastSeen, raw, sleepSince, minEp }
    this.nextId = 1;
    this.viewers = new Map(); // container key -> { kind, x, y, z, ids: Set, sig }
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
    game.player.netName = this.name;
    this.edits = new EditSync(game.world, { host: true });
    // lightning strikes are shown (and burn / hurt) on every client too
    const strike = game.strikeLightning.bind(game);
    game.strikeLightning = (x, y, z) => { strike(x, y, z); if (!this.closed) this.broadcast({ t: 'bolt', x, y, z }); };
    this.startBackground();
  }

  joined() { return [...this.clients.values()].filter((c) => c.joined); }

  /** Every player: the host and the guests (with their stand-in objects). */
  players() {
    const out = [{ id: 0, name: this.name, obj: this.game.player }];
    for (const c of this.joined()) if (c.rp.state) out.push({ id: c.id, name: c.name, obj: c.rp.target, c });
    return out;
  }

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
    const c = { id: this.nextId++, name: null, joined: false, lastSeen: performance.now(), minEp: 0 };
    c.ch = new Channel(conn, (m) => this.onMessage(c, m), () => this.drop(c, 'left the game'));
    this.clients.set(c.id, c);
  }

  near(c, x, y, z, r = REACH) {
    const s = c.rp && c.rp.state;
    return !!s && finite(x, y, z) && Math.hypot(x - s.x, y - (s.y + 1), z - s.z) <= r;
  }

  entity(id) { return this.game.entities.list.find((e) => e.id === id && !e.dead && !e.removed); }

  onMessage(c, m) {
    c.lastSeen = performance.now();
    if (!c.joined) { if (m.t === 'hello') this.welcome(c, m); return; }
    const g = this.game;
    switch (m.t) {
      case 'st': {
        const st = unpackPlayerState(m.s);
        if (!st) break;
        c.raw = m.s.slice(0, 8);
        c.rp.setState(st);
        if (st.sleeping) c.sleepSince = c.sleepSince || performance.now(); else c.sleepSince = 0;
        break;
      }
      case 'ed': if (m.d === g.world.dimension) this.applyGuestEdits(c, m.e); break;
      case 'frame': {
        if (!finite(m.x, m.y, m.z) || !this.near(c, m.x, m.y, m.z, 12)) break;
        const st = m.st && ITEMS[m.st.id] ? m.st : null;
        g.setFrameItem(m.x | 0, m.y | 0, m.z | 0, st, true);
        this.broadcast({ t: 'frame', x: m.x | 0, y: m.y | 0, z: m.z | 0, st }, c);
        break;
      }
      case 'pot': {
        if (!finite(m.x, m.y, m.z) || !this.near(c, m.x, m.y, m.z, 12)) break;
        g.setPot(m.x | 0, m.y | 0, m.z | 0, m.f, true);
        this.broadcast({ t: 'pot', x: m.x | 0, y: m.y | 0, z: m.z | 0, f: g.pots.get(`${m.x | 0},${m.y | 0},${m.z | 0}`) || null }, c);
        break;
      }
      case 'sign': {
        if (!finite(m.x, m.y, m.z) || !this.near(c, m.x, m.y, m.z, 12) || !Array.isArray(m.l)) break;
        g.setSignText(m.x | 0, m.y | 0, m.z | 0, m.l, true);
        this.broadcast({ t: 'sign', x: m.x | 0, y: m.y | 0, z: m.z | 0, l: g.signs.get(`${m.x | 0},${m.y | 0},${m.z | 0}`) }, c);
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
      case 'pvp': this.remotePvp(c, m); break;
      case 'ps': if (m.p && Array.isArray(m.p.slots)) g.netPlayers[c.name] = { ...m.p, dim: g.world.dimension }; break;
      case 'spawn': this.remoteSpawn(c, m); break;
      case 'take': this.remoteTake(c, m); break;
      case 'mi': this.remoteInteract(c, m); break;
      case 'trade': this.remoteTrade(c, m); break;
      case 'open': this.openFor(c, m); break;
      case 'close': { const v = this.viewers.get(contKey(m.k, m.x, m.y, m.z)); if (v) v.ids.delete(c.id); break; }
      case 'cset': this.containerSet(c, m); break;
      case 'boxput': if (this.near(c, m.x + 0.5, m.y + 0.5, m.z + 0.5, 8)) g.onBoxPlaced(m.x | 0, m.y | 0, m.z | 0, { contents: m.s }, true); break;
      case 'ride': {
        const b = this.entity(m.id);
        // the back seat of a Dune Strider (mobs/duneStrider.js)
        if (b && b.kind === 'mob' && (!m.on || this.near(c, b.x, b.y, b.z, 8))) { claimSeat(b, c.id, !!m.on); break; }
        if (!b || b.kind !== 'boat') break;
        if (m.on && !b.rider && !b.remoteRider) b.remoteRider = c.id;
        else if (!m.on && b.remoteRider === c.id) b.remoteRider = null;
        break;
      }
      case 'boat': {
        const b = this.entity(m.id);
        if (!b || b.kind !== 'boat' || b.remoteRider !== c.id || !finite(m.x, m.y, m.z, m.yaw) || !this.near(c, m.x, m.y, m.z, 6)) break;
        b.prev = [b.x, b.y, b.z]; b.prevYaw = b.yaw;
        b.body.setPos(m.x, m.y, m.z); b.yaw = m.yaw;
        break;
      }
      case 'bhit': this.remoteBoatHit(c, m); break;
      case 'sthit': this.remoteStandHit(c, m); break;
      case 'stuse': this.remoteStandUse(c, m); break;
      case 'fence': this.remoteFence(c, m); break;
      case 'cmd': this.remoteCommand(c, m); break;
      case 'travel': {
        const s = c.rp.state;
        if (!s || !DIMENSIONS[m.dim] || m.dim === g.world.dimension || g.dims.pending) break;
        const a = m.arrival || {};
        if (a.src) a.src = { dim: g.world.dimension, x: +a.src.x, y: +a.src.y, z: +a.src.z };
        g.chat.add(`${c.name} opened the way to ${DIMENSIONS[m.dim].name}`);
        g.dims.switchTo(m.dim, { ...a, mode: ['rift', 'safe', 'spawn', 'hollowArrival'].includes(a.mode) ? a.mode : 'safe', x: +a.x || s.x, y: +a.y || s.y, z: +a.z || s.z });
        break;
      }
      case 'boom': if (this.near(c, m.x, m.y, m.z, 8) && m.power > 0 && m.power <= 6) g.explode(m.x, m.y, m.z, m.power, null); break;
      case 'bye': this.drop(c, 'left the game'); break;
      default: break;
    }
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
    const chunks = this.editedChunks();
    c.ch.send({
      t: 'welcome', v: PROTOCOL_VERSION, id: c.id, name, hostName: this.name,
      seed: g.seed, time: g.time, weather: g.weather.save(), gamemode: p.gamemode, dim: g.world.dimension,
      dl: g.daylightCycle, df: g.difficulty, pvp: this.pvp, gc: this.guestCommands,
      worldSpawn: g.worldSpawn, pos: { x: p.x, y: p.y, z: p.z, yaw: p.yaw },
      player: g.netPlayers[name] || null,
      signs: [...g.signs], frames: [...g.frames], pots: [...g.pots],
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

  /** Every edited chunk of the current dimension (stored and loaded ones). */
  editedChunks() {
    const w = this.game.world, out = [];
    for (const [k, d] of w.saved) out.push([k, d]);
    for (const ch of w.chunks.values()) if (ch.modified) out.push([chunkKey(ch.cx, ch.cz), ch]);
    return out;
  }

  drop(c, why = null) {
    if (!this.clients.has(c.id)) return;
    this.clients.delete(c.id);
    c.ch.close();
    if (!c.joined) return;
    for (const v of this.viewers.values()) v.ids.delete(c.id);
    for (const e of this.game.entities.list) { if (e.remoteRider === c.id) e.remoteRider = null; if (e.passengerId === c.id) e.passengerId = null; }
    for (const mob of heldBy(this.game, c.rp.target)) unleash(this.game, mob, true); // the leads they held fall
    c.rp.dispose();
    this.remotes.delete(c.id);
    this.broadcast({ t: 'leave', id: c.id, name: c.name });
    if (why && this.game) this.game.chat.add(`${c.name} ${why}`);
  }

  // ---- blocks ---------------------------------------------------------------------
  applyGuestEdits(c, flat) {
    const g = this.game, w = g.world, broken = [], shaken = [];
    const bad = this.edits.apply(flat, (x, y, z, nid) => {
      if (!this.near(c, x + 0.5, y + 0.5, z + 0.5)) return false;
      const id = w.getBlock(x, y, z);
      if (CONTAINER_BLOCKS.has(id)) broken.push([x, y, z, id, w.getMeta(x, y, z)]);
      if (!id !== !nid) shaken.push([x, y, z, nid ? 'place' : 'break']); // placing or breaking shakes the Deep Hush
      return true;
    });
    if (g.hush) for (const [x, y, z, kind] of shaken) g.hush.blockEvent(x, y, z, kind, c.rp.target);
    // a chest or furnace a guest broke spills its (host-side) contents
    for (const [x, y, z, id, meta] of broken) if (!CONTAINER_BLOCKS.has(w.getBlock(x, y, z))) g.onBlockBroken(x, y, z, id, meta);
    if (bad.length) {
      // put the client's world back the way it is here
      const fix = [];
      for (const [x, y, z] of bad) if (w.isLoaded(x, z)) fix.push(x, y, z, w.getBlock(x, y, z), w.getMeta(x, y, z));
      if (fix.length) c.ch.send({ t: 'ed', e: fix, d: w.dimension });
    }
  }

  // ---- entities ---------------------------------------------------------------------
  /** A guest hit one of our mobs (melee or its arrow). */
  remoteHit(c, m) {
    const s = c.rp.state, mob = this.entity(m.id);
    if (!mob || mob.kind !== 'mob' || mob.deathTime > 0 || !s) return;
    if (Math.hypot(mob.x - s.x, mob.y - s.y, mob.z - s.z) > (m.p ? 120 : 8)) return;
    const dmg = Math.max(0, Math.min(40, +m.d || 0)), knock = Math.max(0, Math.min(1.5, +m.k || 0));
    c.rp.target.lastAttacked = mob; // the guest's tamed Howlers join in
    mob.hurt(dmg, m.p ? 'arrow' : 'player', c.rp.target, knock, m.p ? { remote: true } : null);
  }

  /** A guest hit another player. */
  remotePvp(c, m) {
    const s = c.rp.state, g = this.game;
    if (!this.pvp || !s || s.dead) return;
    const dmg = Math.max(0, Math.min(40, +m.d || 0));
    const victim = m.id === 0 ? g.player : (this.clients.get(m.id) || {}).rp;
    if (!victim) return;
    const vx = victim.x, vy = victim.y, vz = victim.z;
    if (Math.hypot(vx - s.x, vy - s.y, vz - s.z) > 7) return;
    const src = 'player:' + c.name;
    if (m.id === 0) g.player.hurt(dmg, src, { x: s.x, z: s.z });
    else this.clients.get(m.id).ch.send({ t: 'hurt', a: dmg, s: src, x: s.x, z: s.z });
  }

  /** Something hurts a guest's stand-in here (a mob, an explosion, an arrow, the host in PvP). */
  targetHurt(rp, amount, source, attacker) {
    const t = rp.target, c = this.clients.get(rp.id);
    if (!c || t.dead || amount <= 0 || (t.creative && source !== 'void')) return false;
    if (attacker && attacker.isPlayer && !this.pvp) return false;
    if (attacker && attacker.kind === 'mob') t.lastHurtBy = attacker;
    const src = attacker && attacker.isPlayer && source === 'player' ? 'player:' + (attacker.netName || 'Player') : source;
    c.ch.send({ t: 'hurt', a: amount, s: src, x: attacker ? attacker.x : null, z: attacker ? attacker.z : null });
    return true;
  }

  /** A lasting effect for a guest (Levitation from a Drift Spark...): their own game applies it. */
  effectRemote(rp, type, ticks, amp = 0) {
    const c = this.clients.get(rp.id);
    if (!c) return false;
    c.ch.send({ t: 'eff', e: type, d: ticks | 0, a: amp | 0 });
    return true;
  }

  /** A splash elixir broke near a guest: their own game applies the effects (strength f). */
  splashRemote(t, potionId, f) {
    const c = this.clients.get(t.remote ? t.remote.id : -1);
    if (c) c.ch.send({ t: 'fx', p: potionId, f: Math.round(f * 1000) / 1000 });
  }

  /** A mob gave a guest an effect (Dune Shambler hit, Rime Rattler arrow): their own game applies it. */
  targetEffect(rp, type, ticks, amp, f = 1) {
    const c = this.clients.get(rp.id);
    if (c && !rp.target.dead && EFFECTS[type]) c.ch.send({ t: 'eff', e: type, d: ticks | 0, a: amp | 0, f: Math.round(f * 1000) / 1000 });
  }

  /** A guest dropped / threw / shot something: it becomes a shared entity here. */
  remoteSpawn(c, m) {
    const g = this.game, ents = g.entities;
    if (!this.near(c, m.x, m.y, m.z, 16)) return;
    const v = Array.isArray(m.v) && m.v.length === 3 && finite(...m.v) ? m.v.map((a) => Math.max(-4, Math.min(4, a))) : null;
    if (m.k === 'item') {
      const st = m.st;
      if (!st || !ITEMS[st.id] || !Number.isInteger(st.count) || st.count <= 0 || st.count > 64) return;
      const e = ents.spawnItem(m.x, m.y, m.z, copyStack(st), v);
      if (e && m.pd) e.pickupDelay = Math.min(80, m.pd | 0);
    } else if (m.k === 'xp') {
      if (m.n > 0) ents.spawnXp(m.x, m.y, m.z, Math.min(100000, m.n | 0));
    } else if (m.k === 'arrow' && v) {
      const pot = m.thrown === 'potion' && ITEMS[m.potion | 0] && ITEMS[m.potion | 0].potion && ITEMS[m.potion | 0].potion.splash ? m.potion | 0 : 0;
      if (m.thrown === 'potion' && !pot) return;
      // a guest's thrown Tidespear carries its stack (with wear and enchantments)
      const spear = m.thrown === 'spear' && m.item && m.item.id === I.TIDESPEAR ? withExtras({ id: I.TIDESPEAR, count: 1, damage: Math.max(0, m.item.damage | 0) }, m.item) : null;
      if (m.thrown === 'spear' && !spear) return;
      const tip = !m.thrown && m.item && ITEMS[m.item.id] && ITEMS[m.item.id].tipped ? { id: m.item.id, count: 1 } : null;
      ents.spawnArrow(m.x, m.y, m.z, v[0], v[1], v[2], c.rp.target, !!m.crit, m.thrown === 'egg' || m.thrown === 'snowball' || pot || spear ? m.thrown : null, Math.max(0, Math.min(5, m.power | 0)), pot, spear || tip);
    } else if (m.k === 'boat') {
      ents.spawnBoat(m.x, m.y, m.z, +m.yaw || 0, !!m.cart);
    } else if (m.k === 'stand') {
      ents.spawnStand(m.x, m.y, m.z, +m.yaw || 0);
    } else if (m.k === 'tnt') {
      // a guest lit TNT: it burns (and blows up) here, so the blast reaches everyone
      const x = Math.floor(m.x), y = Math.floor(m.y), z = Math.floor(m.z);
      if (g.world.getBlock(x, y, z) === B.TNT) igniteTNT(g, x, y, z);
      else ents.add(new PrimedTNT(x + 0.5, y, z + 0.5));
    }
  }

  /** A guest right-clicked a fence post: tie the animals they lead to it, or take the ones tied there. */
  remoteFence(c, m) {
    const g = this.game, s = c.rp.state, x = m.x | 0, y = m.y | 0, z = m.z | 0;
    if (!s || s.dead || !this.near(c, x + 0.5, y + 0.5, z + 0.5, 8) || !isFencePost(g.world.getBlock(x, y, z))) return;
    if (tieToFence(g, x, y, z, c.rp.target) || untieFromFence(g, x, y, z, c.rp.target)) g.audio.play('hit_wood', [x + 0.5, y + 0.5, z + 0.5]);
  }

  /** A guest touches an item / orb / arrow: hand over what is there (once). */
  remoteTake(c, m) {
    const e = this.entity(m.id), s = c.rp.state;
    if (!e || !s || s.dead) return;
    if (Math.hypot(e.x - s.x, e.y - (s.y + 0.9), e.z - s.z) > 6) return; // (slack for a guest position that lags a little)
    if (e.kind === 'item') {
      if (e.pickupDelay > 0) return;
      const n = Math.max(0, Math.min(e.stack.count, m.n | 0));
      if (!n) return;
      e.stack.count -= n;
      if (e.stack.count <= 0) e.dead = true;
      c.ch.send({ t: 'got', st: { ...copyStack(e.stack), count: n } });
    } else if (e.kind === 'xp') {
      e.dead = true;
      c.ch.send({ t: 'gotxp', v: e.value });
    } else if (e.kind === 'arrow' && e.thrown === 'spear') {
      // a stuck Tidespear: only its thrower can pull it out (with its wear and enchantments)
      if (!e.stuck || !canPickUpSpear(e, c.rp.target)) return;
      e.dead = true;
      if (!e.creativeThrow) c.ch.send({ t: 'got', st: copyStack(e.item) });
    } else if (e.kind === 'arrow' && e.stuck && e.pickup) {
      e.dead = true;
      c.ch.send({ t: 'got', st: { id: e.pickupId || I.ARROW, count: 1, damage: 0 } });
    }
  }

  /** Right-click on a mob by a guest: run the normal interaction with the guest standing in for us. */
  remoteInteract(c, m) {
    const g = this.game, mob = this.entity(m.id), s = c.rp.state;
    if (!mob || mob.kind !== 'mob' || !s || s.dead || Math.hypot(mob.x - s.x, mob.y - s.y, mob.z - s.z) > 8) return;
    const held = m.st && ITEMS[m.st.id] ? withExtras({ id: m.st.id, count: Math.max(1, Math.min(64, m.st.count | 0)), damage: m.st.damage | 0 }, m.st) : null; // (a Name Tag keeps its label)
    const d = held && ITEMS[held.id];
    if (mob.def.villager && mob.deathTime === 0 && mob.trades.length && !(d && d.food && mob.def.food)) {
      c.ch.send({ t: 'trades', id: mob.id, prof: mob.profession, trades: mob.trades });
      return;
    }
    const ops = { consume: 0, damage: 0 };
    const inv = {
      selected: 0, slots: [held], armor: [],
      get selectedStack() { return this.slots[0]; },
      removeFromSlot(i, n = 1) { const st = this.slots[0]; if (!st) return null; const k = Math.min(n, st.count); ops.consume += k; st.count -= k; if (st.count <= 0) this.slots[0] = null; return { ...st, count: k }; },
      damageSelected(n = 1) { ops.damage += n; },
      add() { return 0; }, count(id) { return this.slots[0] && this.slots[0].id === id ? this.slots[0].count : 0; }, changed() {},
    };
    const actor = Object.create(c.rp.target, { inventory: { value: inv }, sneaking: { value: !!s.sneaking } });
    const real = g.player, swing = g.interaction.swing;
    let ok = false;
    g.player = actor;
    try { ok = g.interaction.interactMob(mob); } finally { g.player = real; g.interaction.swing = swing; }
    if (mob.leashHolder === actor) mob.leashHolder = c.rp.target; // the guest holds the lead (its stand-in, not this one-off actor)
    c.ch.send({ t: 'used', ok, item: held ? held.id : -1, consume: ops.consume, damage: ops.damage });
  }

  remoteTrade(c, m) {
    const mob = this.entity(m.id), s = c.rp.state;
    if (!mob || !mob.trades || !s || Math.hypot(mob.x - s.x, mob.z - s.z) > 8) return;
    const o = mob.trades[m.i | 0];
    if (!o) return;
    const n = Math.max(0, Math.min(m.n | 0, MAX_USES - o.uses));
    o.uses += n;
    c.ch.send({ t: 'traded', id: mob.id, i: m.i | 0, n, trades: mob.trades });
  }

  remoteBoatHit(c, m) {
    const g = this.game, b = this.entity(m.id), s = c.rp.state;
    if (!b || b.kind !== 'boat' || !s || Math.hypot(b.x - s.x, b.z - s.z) > 6) return;
    b.hits++; b.hitTime = 10;
    g.audio.play('hit_wood', [b.x, b.y, b.z]);
    if (b.hits >= 3 || s.creative) {
      b.dead = true;
      if (b.rider) g.dismount();
      if (!s.creative) g.entities.spawnItem(b.x, b.y + 0.5, b.z, { id: b.dropId || I.OAK_BOAT, count: 1 });
    }
  }

  /** A guest punched an armour stand. */
  remoteStandHit(c, m) {
    const e = this.entity(m.id), s = c.rp.state;
    if (!e || e.kind !== 'stand' || !s || Math.hypot(e.x - s.x, e.z - s.z) > 6) return;
    punchStand(this.game, e, !!s.creative);
  }

  /**
   * A guest right-clicked an armour stand holding `st` (already taken out of their hand): swap, and
   * always answer request `rid`: ok with what came off the stand, or refused (they get `st` back).
   */
  remoteStandUse(c, m) {
    const e = this.entity(m.id), s = c.rp.state, st = m.st;
    const reply = (ok, give = null) => c.ch.send({ t: 'stgot', rid: m.rid, ok: ok ? 1 : 0, give: copyStack(give) });
    if (!e || e.kind !== 'stand' || !s || s.dead || Math.hypot(e.x - s.x, e.z - s.z) > 6) { reply(false); return; }
    if (st && (!ITEMS[st.id] || !Number.isInteger(st.count) || st.count <= 0 || st.count > 64)) { reply(false); return; }
    const r = useStand(e, st ? copyStack(st) : null, +m.y || 0);
    if (!r.ok) { reply(false); return; }
    this.game.audio.play('equip', [e.x, e.y + 1, e.z]);
    reply(true, r.give);
  }

  /** Remote players that projectiles can hit (mob arrows always, player arrows with PvP). */
  remoteTargets(proj) {
    if (proj && proj.shooter && proj.shooter.isPlayer && !this.pvp) return [];
    return this.joined().map((c) => c.rp.target).filter((t) => !t.dead && t !== (proj && proj.shooter));
  }

  /** Mobs and orbs look at the nearest player (tamed Howlers at their owner): swap game.player for that tick. */
  tickNear(e) {
    const g = this.game, real = g.player;
    let best = null;
    const players = this.players();
    if (e.kind === 'mob' && (e.tamed || e.giverName)) {
      // tamed pets follow their owner, a Hoverling works for whoever gave it its item
      const name = e.tamed ? e.ownerName : e.giverName;
      const owner = name ? players.find((p) => p.name === name) : players[0];
      best = owner ? owner.obj : OFFLINE;
    }
    if (!best) {
      let bd = Infinity;
      for (const pl of players) {
        if (pl.obj.dead) continue;
        const d = (pl.obj.x - e.x) ** 2 + (pl.obj.y - e.y) ** 2 + (pl.obj.z - e.z) ** 2;
        if (d < bd) { bd = d; best = pl.obj; }
      }
    }
    if (!best || best === real) { e.tick(g); return; }
    g.player = best;
    try { e.tick(g); } finally { g.player = real; }
  }

  // ---- containers -----------------------------------------------------------------
  container(kind, x, y, z) {
    const g = this.game, id = g.world.getBlock(x, y, z);
    if (kind === 'chest') return id === B.CHEST || id === B.BARREL || id === B.GLOOMSHELL_BOX ? g.getChest(x, y, z) : id === B.HOPPER ? g.getHopper(x, y, z) : id === B.DISPENSER || id === B.DROPPER ? g.getDispenser(x, y, z) : null;
    if (kind === 'chest2') {
      const h = id === B.CHEST ? doubleChestHalves(g.world, x, y, z) : null;
      return h && h[0].x === x && h[0].z === z ? doubleChestView(g.getChest(h[0].x, y, h[0].z), g.getChest(h[1].x, y, h[1].z)) : null;
    }
    if (kind === 'furnace') return isFurnace(id) ? g.getFurnace(x, y, z) : null;
    if (kind === 'brewing') return id === B.BREWING_STAND ? g.getBrewingStand(x, y, z) : null;
    return null;
  }

  openFor(c, m) {
    if (!this.near(c, m.x + 0.5, m.y + 0.5, m.z + 0.5, 10)) return;
    const obj = this.container(m.k, m.x, m.y, m.z);
    if (!obj) { c.ch.send({ t: 'cclose', k: m.k, x: m.x, y: m.y, z: m.z }); return; }
    const key = contKey(m.k, m.x, m.y, m.z);
    let v = this.viewers.get(key);
    if (!v) { v = { kind: m.k, x: m.x, y: m.y, z: m.z, ids: new Set(), sig: '' }; this.viewers.set(key, v); }
    v.ids.add(c.id);
    c.ch.send({ t: 'cont', k: m.k, x: m.x, y: m.y, z: m.z, s: containerState(m.k, obj) });
  }

  containerSet(c, m) {
    const obj = this.container(m.k, m.x, m.y, m.z);
    const reply = (ok) => c.ch.send({ t: ok ? 'cack' : 'cnak', seq: m.seq, ep: m.ep, k: m.k, x: m.x, y: m.y, z: m.z, s: obj ? containerState(m.k, obj) : null });
    if ((m.ep | 0) < c.minEp) return; // the guest already rolled this back
    if (!obj || !this.near(c, m.x + 0.5, m.y + 0.5, m.z + 0.5, 10) || !applySlotChanges(m.k, obj, m.ch)) { c.minEp = (m.ep | 0) + 1; reply(false); return; }
    reply(true);
  }

  /** Re-send open containers that changed (other players, smelting progress, the host's own clicks). */
  syncContainers() {
    for (const [key, v] of this.viewers) {
      if (!v.ids.size) { this.viewers.delete(key); continue; }
      const obj = this.container(v.kind, v.x, v.y, v.z);
      if (!obj) {
        for (const id of v.ids) { const c = this.clients.get(id); if (c) c.ch.send({ t: 'cclose', k: v.kind, x: v.x, y: v.y, z: v.z }); }
        this.viewers.delete(key);
        continue;
      }
      const s = containerState(v.kind, obj), sig = JSON.stringify(s);
      if (sig === v.sig) continue;
      v.sig = sig;
      for (const id of v.ids) { const c = this.clients.get(id); if (c) c.ch.send({ t: 'cont', k: v.kind, x: v.x, y: v.y, z: v.z, s }); }
    }
  }

  // ---- commands, options, sleeping, dimensions ------------------------------------------
  remoteCommand(c, m) {
    const g = this.game, text = String(m.text || '').slice(0, 256);
    if (!this.guestCommands) { c.ch.send({ t: 'cmdout', lines: ['The host has turned off commands for guests'] }); return; }
    const real = g.player;
    if (commandName(text) === 'summon') g.player = c.rp.target; // "~" and the look direction are the guest's
    let out;
    try { out = runCommand(g, text); } catch (e) { out = 'Command failed: ' + e.message; } finally { g.player = real; }
    c.ch.send({ t: 'cmdout', lines: [].concat(out || []) });
    g.chat.add(`[${c.name}: ${text}]`);
    this.sendEnv();
  }

  setOptions(m) { super.setOptions(m); this.sendEnv(); }

  sendEnv() {
    const g = this.game;
    // rb: the raid under way (mobs/raids.js raidStatus): guests near the village show its bar
    this.broadcast({ t: 'env', time: g.time, w: g.weather.save(), dl: g.daylightCycle, df: g.difficulty, pvp: this.pvp, gc: this.guestCommands, rb: g.raids && g.raids.status ? g.raids.status() : null });
  }

  /** Night is skipped once everybody has been asleep for a while (the host in bed for 5 s). */
  tickSleep() {
    const g = this.game, p = g.player, now = performance.now();
    if (!p.sleeping || p.sleeping.ticks < 100) return;
    const guests = this.joined();
    const awake = guests.filter((c) => !(c.rp.state && c.rp.state.sleeping && c.sleepSince && now - c.sleepSince >= SLEEP_MS));
    if (awake.length) {
      if (p.sleeping.ticks % 100 === 0) g.hud.toast(`Sleeping… waiting for ${awake.map((c) => c.name).join(', ')}`);
      return;
    }
    g.wakeUp(true);
    this.broadcast({ t: 'wake' });
    this.sendEnv();
  }

  /** Keep the world loaded and alive around every guest: chunks, random ticks, mob spawning. */
  simulateGuests() {
    const g = this.game, real = g.player;
    const centers = [];
    for (const c of this.joined()) {
      const s = c.rp.state;
      if (!s) continue;
      centers.push([Math.floor(s.x / 16), Math.floor(s.z / 16), Math.min(GUEST_SIM_RADIUS, g.chunks.renderDistance)]);
    }
    if (this.ticks % 20 === 0) g.chunks.extraCenters = centers;
    const r = Math.min(g.chunks.renderDistance, 6);
    const done = [[Math.floor(real.x / 16), Math.floor(real.z / 16)]];
    for (const pl of this.players().slice(1)) {
      if (pl.obj.dead) continue;
      const cx = Math.floor(pl.obj.x / 16), cz = Math.floor(pl.obj.z / 16);
      if (!done.some(([x, z]) => Math.max(Math.abs(x - cx), Math.abs(z - cz)) <= 2 * r)) {
        runRandomTicks(g.world, cx, cz, Math.min(r, GUEST_TICK_RADIUS));
        done.push([cx, cz]);
      }
      g.player = pl.obj;
      try { g.spawner.tick(); g.spawnerBlocks.tick(); } finally { g.player = real; }
    }
  }

  /** The host changed dimension: everyone comes along. */
  onSwitchDimension(dim, pos, oldDim) {
    const e = this.edits.take();
    if (e.length) this.broadcast({ t: 'ed', e, d: oldDim });
    this.viewers.clear();
    this.game.chunks.extraCenters = [];
    const chunks = this.editedChunks().map(([k, d]) => [k, encodePackedChunk(packChunk(d))]);
    this.broadcast({ t: 'dim', dim, x: pos.x, y: pos.y, z: pos.z, chunks });
  }

  onArrived(x, y, z) { this.broadcast({ t: 'arrived', x, y, z, d: this.game.world.dimension }); }

  sendChat(text) { this.broadcast({ t: 'chat', from: this.name, m: text }); }
  sendSign(x, y, z, l) { this.broadcast({ t: 'sign', x, y, z, l }); }
  sendFrame(x, y, z, st) { this.broadcast({ t: 'frame', x, y, z, st }); }
  sendPot(x, y, z, f) { this.broadcast({ t: 'pot', x, y, z, f }); }

  tick() {
    if (this.closed) return;
    const g = this.game;
    this.ticks++;
    if (this.stalled()) for (const c of this.clients.values()) c.lastSeen = performance.now();
    const e = this.edits.take();
    if (e.length) this.broadcast({ t: 'ed', e, d: g.world.dimension });
    this.simulateGuests();
    this.tickSleep();
    if (this.ticks % STATE_EVERY === 0) {
      const list = [[0, ...this.ownState()]];
      for (const c of this.joined()) if (c.raw) list.push([c.id, ...c.raw]);
      const riderOf = (b) => (b.rider === g.player ? 0 : b.remoteRider || -1);
      const playerIdOf = (h) => (h === (g.localPlayer || g.player) ? 0 : h.remote ? h.remote.id : -1); // who holds a lead
      // an entity is packed at most once per tick, however many clients have it in range
      const ents = g.entities.list.filter((x) => !x.removed && (!x.dead || x.kind === 'mob') && x.kind !== 'eye');
      const packed = new Map(); // entity -> its snapshot and key, made once however many guests can see it
      for (const c of this.joined()) {
        // a guest whose connection can't keep up skips snapshots (newer ones replace them anyway), so the
        // queue never grows into seconds or minutes of delay; edits, chat and the like still go through
        if (c.ch.backlog() > BACKLOG_LIMIT) { c.skipped = (c.skipped || 0) + 1; continue; }
        c.ch.send({ t: 'pl', p: list });
        const s = c.rp.state;
        if (!s) continue;
        // only entities that changed since the last snapshot this guest got, plus the ids of all that are there;
        // a full list every FULL_EVERY snapshots (and after a dimension change)
        const full = !c.entCache || c.entDim !== g.world.dimension || ++c.entCount % FULL_EVERY === 0;
        if (full) { c.entCache = new Map(); c.entDim = g.world.dimension; }
        const changed = [], ids = [], cache = new Map();
        for (const x of ents) {
          if (Math.abs(x.x - s.x) > ENTITY_RANGE || Math.abs(x.z - s.z) > ENTITY_RANGE) continue;
          let p = packed.get(x);
          if (p === undefined) {
            const a = packEntity(x, riderOf, playerIdOf);
            p = a ? { a, key: JSON.stringify(a) } : null;
            packed.set(x, p);
          }
          if (!p) continue;
          cache.set(p.a[1], p.key);
          ids.push(p.a[1]);
          if (c.entCache.get(p.a[1]) !== p.key) changed.push(p.a);
        }
        c.entCache = cache;
        c.ch.send(full ? { t: 'ents', m: changed, d: g.world.dimension } : { t: 'ents', m: changed, ids, d: g.world.dimension });
      }
    }
    if (this.ticks % CONTAINER_EVERY === 0) this.syncContainers();
    if (this.ticks % ENV_EVERY === 0) {
      this.sendEnv();
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
    clearInterval(this.bgTimer); if (this.bgWorker) { this.bgWorker.terminate(); this.bgWorker = null; }
    if (this.game) this.game.chunks.extraCenters = [];
    this.disposeRemotes();
  }
}

/** Open the running world to friends. */
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
    this.cont = null; // the container screen we have open: { kind, x, y, z, obj, ep, seq, pending, snap }
    this.stands = new StandRequests(); // armour stand swaps waiting for the host's answer
    this.raidSeen = null; // the last raid status from the host (for the victory / defeat toasts)
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
      if (m.t === 'welcome') { this.welcome = m; this.id = m.id; this.name = m.name; this.setOptions(m); }
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
  /** The dimension to start in (read by Game before the world is created). */
  get dimension() { return this.welcome ? this.welcome.dim || 'overworld' : 'overworld'; }

  /** Called by Game.start once the world exists, before terrain loads around the player. */
  attach(game) {
    this.game = game;
    const w = this.welcome;
    for (const ck of this.chunks) game.world.saved.set(+ck.k, unpackChunk(decodePackedChunk(ck.c)));
    this.chunks = null;
    game.time = w.time;
    game.weather.load(w.weather);
    for (const [k, l] of w.signs || []) game.signs.set(k, l);
    for (const [k, st] of w.frames || []) game.frames.set(k, st);
    for (const [k, f] of w.pots || []) { const [x, y, z] = String(k).split(',').map(Number); if (finite(x, y, z)) game.setPot(x, y, z, f, true); }
    if (typeof w.dl === 'boolean') game.settings.daylightCycle = w.dl;
    if (typeof w.df === 'string') game.settings.difficulty = w.df;
    game.spawner.enabled = false;
    game.worldSpawn = { ...w.worldSpawn };
    const p = game.player;
    p.netName = this.name;
    if (w.player) applyPlayerSave(game, w.player);
    if (!w.player || (w.player.dim || 'overworld') !== game.world.dimension) {
      if (!w.player) { p.setGamemode(w.gamemode); p.spawn = { ...w.worldSpawn }; }
      p.setPosition(w.pos.x, w.pos.y, w.pos.z);
      p.yaw = w.pos.yaw;
    }
    this.edits = new EditSync(game.world, { host: false });
    // no mob generation here: every entity comes from the host
    game.chunks.onChunkLoaded = (cx, cz) => this.edits.onChunkLoaded(cx, cz);
    this.ents = new EntityMirror(game, this);
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

  handle(m) {
    const g = this.game, p = g.player;
    switch (m.t) {
      case 'ed': if (m.d === undefined || m.d === g.world.dimension) this.edits.apply(m.e); break;
      case 'pl': for (const a of m.p || []) { if (a[0] === this.id) continue; const rp = this.remotes.get(a[0]); if (rp) rp.setState(unpackPlayerState(a.slice(1))); } break;
      case 'join': this.addRemote(m.id, m.name); g.chat.add(`${m.name} joined the game`); break;
      case 'leave': { const rp = this.remotes.get(m.id); if (rp) { rp.dispose(); this.remotes.delete(m.id); } g.chat.add(`${m.name} left the game`); break; }
      case 'chat': g.chat.add(`<${m.from}> ${m.m}`); break;
      case 'sign': if (Array.isArray(m.l)) g.setSignText(m.x | 0, m.y | 0, m.z | 0, m.l, true); break;
      case 'frame': g.setFrameItem(m.x | 0, m.y | 0, m.z | 0, m.st || null, true); break;
      case 'pot': g.setPot(m.x | 0, m.y | 0, m.z | 0, m.f || null, true); break;
      case 'cmdout': for (const l of m.lines || []) g.chat.add(String(l)); break;
      case 'env':
        if (Math.abs(g.time - m.time) > 2) g.time = m.time;
        g.weather.load(m.w);
        if (typeof m.dl === 'boolean') g.settings.daylightCycle = m.dl;
        if (typeof m.df === 'string') g.settings.difficulty = m.df;
        this.setOptions(m);
        this.onRaidStatus(m.rb || null);
        break;
      case 'ents': if (m.d === g.world.dimension && !g.dims.pending) this.ents.apply(m.m, m.ids); break;
      case 'hurt': p.hurt(m.a, m.s, m.x != null ? { x: m.x, z: m.z } : null); break;
      case 'fx': {
        // a splash elixir reached us on the host
        const d = ITEMS[m.p | 0], f = Math.max(0, Math.min(1, +m.f || 0));
        if (d && d.potion && f > 0) {
          if (d.potion.kind === 'water') p.fireTicks = 0;
          for (const [type, ticks, amp] of POTIONS[d.potion.kind].effects) p.applyEffect(type, ticks, amp, f);
        }
        break;
      }
      case 'eff': // an effect laid on us on the host (a mob's hit or arrow, a splash, Levitation, Mining Fatigue)
        if (typeof m.e !== 'string' || !EFFECTS[m.e]) break;
        if (m.f !== undefined) p.applyEffect(m.e, Math.max(0, Math.min(1e6, m.d | 0)), Math.max(0, Math.min(255, m.a | 0)), Math.max(0, Math.min(1, +m.f || 0)));
        else if (!EFFECTS[m.e].instant) p.addEffect(m.e, Math.max(0, Math.min(72000, m.d | 0)), Math.max(0, Math.min(10, m.a | 0)));
        break;
      case 'got': {
        const got = copyStack(m.st);
        if (!got || !ITEMS[got.id]) break;
        const left = p.inventory.add(got);
        g.audio.play('pop');
        if (left) this.requestSpawn('item', { x: p.x, y: p.y + 1, z: p.z, st: { ...got, count: left }, pd: 40 });
        break;
      }
      case 'gotxp': { const lv = addXp(p.xp, m.v); g.audio.play(lv && p.xp.level % 5 === 0 ? 'levelup' : 'orb'); break; }
      case 'stgot': {
        // the host answered an armour stand swap: what came off it (or our own item, refused) goes back in our hands
        const inv = p.inventory;
        if (m.give && !ITEMS[m.give.id]) m.give = null;
        const left = this.stands.finish(inv, m, (iv, st) => iv.add(st));
        for (const st of left) this.requestSpawn('item', { x: p.x, y: p.y + 1, z: p.z, st, pd: 40 });
        inv.changed();
        if (m.ok) g.audio.play('equip');
        break;
      }
      case 'used': {
        const st = p.inventory.selectedStack;
        if (st && st.id === m.item) {
          if (m.consume && !p.creative) p.inventory.removeFromSlot(p.inventory.selected, m.consume);
          if (m.damage) p.inventory.damageSelected(m.damage);
        }
        break;
      }
      case 'trades': {
        const mob = this.ents.byNetId(m.id);
        if (!mob) break;
        mob.trades = m.trades; mob.profession = m.prof;
        if (!g.ui.blocking) { g.ui.openTrade(mob); g.audio.play('hmm', [mob.x, mob.y + 1.5, mob.z]); }
        break;
      }
      case 'traded': this.onTraded(m); break;
      case 'cont': this.onContainerState(m, false); break;
      case 'cack': case 'cnak': this.onContainerReply(m); break;
      case 'cclose': if (this.cont && this.cont.kind === m.k && this.cont.x === m.x && this.cont.y === m.y && this.cont.z === m.z && g.ui.open === (m.k === 'chest2' ? 'chest' : m.k)) g.ui.close(); break;
      case 'bolt': this._applyingOther = true; this.edits.applying = true; try { g.strikeLightning(m.x, m.y, m.z); } finally { this._applyingOther = false; this.edits.applying = false; } break;
      case 'wake': if (p.sleeping) { g.wakeUp(false); g.milestones.event('sleep'); } break;
      case 'dim': this.followDimension(m); break;
      case 'arrived': {
        if (m.d !== g.world.dimension) break;
        const pd = g.dims.pending;
        const x = m.x + 1, z = m.z;
        if (pd) { pd.x = x; pd.y = m.y; pd.z = z; pd.mode = 'exact'; } else p.setPosition(x, m.y, z);
        break;
      }
      case 'bye': this.lost(m.reason || 'The host closed the world'); break;
      default: break;
    }
  }

  // ---- requests to the host ----------------------------------------------------------
  /** Items, orbs, arrows and boats we create become shared entities on the host. */
  /** A guest placed a Gloomshell Box that carried items: the host's copy of it gets them. */
  sendBoxContents(x, y, z, contents) { this.send({ t: 'boxput', x, y, z, s: contents }); }

  requestSpawn(kind, d) {
    if (kind === 'falling') return; // the host's own world simulation makes those
    const r2 = (v) => Math.round(v * 100) / 100;
    this.send({ t: 'spawn', k: kind, x: r2(d.x), y: r2(d.y), z: r2(d.z), st: d.st ? copyStack(d.st) : undefined, v: d.v ? d.v.map(r2) : undefined, n: d.n, pd: d.pd, crit: d.crit, yaw: d.yaw, power: d.power });
  }

  /** Right-click on a mob or player. */
  interactMob(mob) {
    if (mob.isRemotePlayer || !mob.netProxy || mob.deathTime > 0) return false;
    const st = this.game.player.inventory.selectedStack;
    this.send({ t: 'mi', id: mob.netId, st: st ? copyStack(st) : null });
    this.game.interaction.swing = 6;
    return true;
  }

  hitBoat(boat) { this.send({ t: 'bhit', id: boat.netId }); }
  hitStand(stand) { this.send({ t: 'sthit', id: stand.netId }); }
  /** Right-click on a shared stand: the held stack leaves our hand now; the host's answer brings back what came off. */
  useStand(stand, st, relY) {
    const inv = this.game.player.inventory;
    const { rid, st: taken } = this.stands.begin(inv, inv.selected, performance.now());
    if (taken) inv.changed();
    this.send({ t: 'stuse', id: stand.netId, st: taken, y: Math.round(relY * 100) / 100, rid });
  }

  /** Right-click on a fence post: ask the host to tie our animals to it / untie the ones there. False if neither applies. */
  useFence(x, y, z) {
    const g = this.game, p = g.player;
    let ask = false;
    for (const e of g.entities.list) {
      if (e.kind !== 'mob' || !e.netProxy || e.dead || !e.leashHolder) continue;
      const h = e.leashHolder;
      if (h === p || (h.kind === 'knot' && h.bx === x && h.by === y && h.bz === z)) { ask = true; break; }
    }
    if (!ask) return false;
    this.send({ t: 'fence', x, y, z });
    g.audio.play('hit_wood', [x + 0.5, y + 0.5, z + 0.5]);
    return true;
  }

  /** The host's raid status (once a second): the raid bar while we are near the village, toasts when it ends. */
  onRaidStatus(rb) {
    const g = this.game, p = g.player;
    const bar = raidBarFor(rb, p.x, p.z);
    if (g.hud && g.hud.raidBar) g.hud.raidBar(bar);
    const prev = this.raidSeen;
    this.raidSeen = rb;
    if (!bar || !g.hud || (prev && prev.id === rb.id && prev.state === rb.state)) return;
    if (rb.state === 'won') g.hud.toast('Victory! The village is saved', 4000);
    else if (rb.state === 'lost') g.hud.toast('The village has fallen - raid lost', 4000);
    else if (!prev || prev.id !== rb.id) g.hud.toast('A raid is coming! Defend the village');
  }
  ride(boat, on) { this.send({ t: 'ride', id: boat.netId, on: on ? 1 : 0 }); }

  /** Another player hit by us (PvP). */
  targetHurt(rp, amount, source, attacker) {
    if (!this.pvp || attacker !== this.game.player || rp.target.dead) return false;
    this.send({ t: 'pvp', id: rp.id, d: Math.round(amount * 100) / 100 });
    return true;
  }

  requestTrade(mob, i, times) { this.send({ t: 'trade', id: mob.netId, i, n: times }); }

  onTraded(m) {
    const g = this.game, inv = g.player.inventory, mob = this.ents.byNetId(m.id);
    if (mob && mob.trades) (m.trades || []).forEach((t, i) => { if (mob.trades[i]) mob.trades[i].uses = t.uses; }); // keep the open screen's offers
    const o = m.trades && m.trades[m.i];
    if (!o) return;
    let done = 0;
    const price = offerPrice(o, championDiscount(g.player.effects)); // a Village Champion pays less
    for (let k = 0; k < m.n; k++) {
      if (inv.count(o.give) < price) break;
      let left = price;
      for (let i = 0; i < inv.slots.length && left; i++) {
        const s = inv.slots[i];
        if (!s || s.id !== o.give) continue;
        const n = Math.min(left, s.count);
        s.count -= n; left -= n;
        if (s.count <= 0) inv.slots[i] = null;
      }
      const lo = inv.add({ id: o.get, count: o.getCount, damage: 0 });
      if (lo) g.entities.spawnItem(g.player.x, g.player.y + 1, g.player.z, { id: o.get, count: lo, damage: 0 });
      done++;
    }
    inv.changed();
    if (done) { g.milestones.event('trade'); if (mob) g.audio.play('hmm', [mob.x, mob.y + 1.5, mob.z]); g.entities.spawnXp(g.player.x, g.player.y + 1, g.player.z, 3 * done); }
    if (g.ui.open === 'trade') g.ui.refreshAll();
  }

  // ---- shared chests and furnaces ----------------------------------------------------
  openContainer(kind, x, y, z, obj) {
    this.cont = { kind, x, y, z, obj, ep: 0, seq: 0, pending: [], snap: null, latest: null };
    this.send({ t: 'open', k: kind, x, y, z });
  }

  closeContainer() {
    const c = this.cont;
    if (!c) return;
    this.send({ t: 'close', k: c.kind, x: c.x, y: c.y, z: c.z });
    this.cont = null;
  }

  /** Before a click in a container screen: remember everything the click can change. */
  uiBefore() {
    const c = this.cont, g = this.game;
    if (!c) return;
    c.snap = { cont: containerSlots(c.kind, c.obj).map(copyStack), inv: g.player.inventory.slots.map(copyStack), cursor: copyStack(g.ui.cursor) };
  }

  /** After the click: send the container slots that changed (applied here at once, confirmed by the host). */
  uiAfter() {
    const c = this.cont;
    if (!c || !c.snap) return;
    const snap = c.snap;
    c.snap = null;
    const ch = diffSlots(snap.cont, containerSlots(c.kind, c.obj));
    if (!ch.length) return;
    const seq = ++c.seq;
    c.pending.push({ seq, snap });
    this.send({ t: 'cset', k: c.kind, x: c.x, y: c.y, z: c.z, ch, ep: c.ep, seq });
  }

  onContainerState(m) {
    const c = this.cont;
    if (!c || c.kind !== m.k || c.x !== m.x || c.y !== m.y || c.z !== m.z) return;
    if (c.pending.length) { c.latest = m.s; return; } // ours are in flight; the replies carry the newer state
    loadContainerState(c.kind, c.obj, m.s);
    if (this.game.ui.open === c.kind) this.game.ui.refreshAll(true);
  }

  onContainerReply(m) {
    const c = this.cont, g = this.game;
    if (!c || c.kind !== m.k || c.x !== m.x || c.y !== m.y || c.z !== m.z) return;
    if (m.t === 'cack') {
      c.pending = c.pending.filter((p) => p.seq > m.seq);
      if (!c.pending.length && m.s) { loadContainerState(c.kind, c.obj, m.s); if (g.ui.open === c.kind) g.ui.refreshAll(true); }
      return;
    }
    if (m.ep !== c.ep) return; // already rolled back
    // someone else changed the container first: undo our click and show the host's state
    const p = c.pending.find((x) => x.seq === m.seq);
    if (p) {
      const inv = g.player.inventory;
      p.snap.inv.forEach((s, i) => { inv.slots[i] = copyStack(s); });
      g.ui.cursor = copyStack(p.snap.cursor);
    }
    c.ep++;
    c.pending = [];
    if (m.s) loadContainerState(c.kind, c.obj, m.s);
    if (g.ui.open === c.kind) g.ui.refreshAll(true);
  }

  // ---- commands, dimensions, misc ---------------------------------------------------------
  sendCommand(text) { this.send({ t: 'cmd', text }); }

  sendChat(text) { this.send({ t: 'chat', m: text }); }
  sendSign(x, y, z, l) { this.send({ t: 'sign', x, y, z, l }); }
  sendFrame(x, y, z, st) { this.send({ t: 'frame', x, y, z, st }); }
  sendPot(x, y, z, f) { this.send({ t: 'pot', x, y, z, f }); }

  /** We stepped through a portal: the host takes the whole group there. */
  requestTravel(dim, arrival) {
    const a = { ...arrival };
    if (a.src) a.src = { x: a.src.x, y: a.src.y, z: a.src.z };
    this.send({ t: 'travel', dim, arrival: a });
  }

  followDimension(m) {
    const g = this.game;
    if (!DIMENSIONS[m.dim]) return;
    const e = this.edits.take();
    if (e.length) this.send({ t: 'ed', e, d: g.world.dimension });
    this.ents.clear();
    this.edits.pending.clear();
    if (this.cont && g.ui.open) g.ui.close();
    if (m.dim !== g.world.dimension) {
      g.dims.netFollow = true;
      try { g.dims.switchTo(m.dim, { mode: 'exact', x: m.x + 1, y: m.y, z: m.z }); } finally { g.dims.netFollow = false; }
    }
    for (const [k, c] of m.chunks || []) g.world.saved.set(+k, unpackChunk(decodePackedChunk(c)));
  }

  requestExplosion(x, y, z, power) { this.send({ t: 'boom', x, y, z, power }); }

  /** Respawning away from the overworld: back next to the host (the group stays together). */
  respawnNearHost() {
    const h = this.remotes.get(0), p = this.game.player;
    if (h && h.state) p.setPosition(h.state.x + 1, h.state.y, h.state.z);
  }

  tickNear(e) { e.tick(this.game); }
  remoteTargets() { return []; }

  tick() {
    if (this.closed) return;
    this.ticks++;
    if (this.stalled()) this.lastSeen = performance.now();
    const e = this.edits.take();
    if (e.length) this.send({ t: 'ed', e, d: this.game.world.dimension });
    if (this.ticks % STATE_EVERY === 0 && this.ch.backlog() < BACKLOG_LIMIT) this.send({ t: 'st', s: this.ownState() }); // skip while our upload is behind
    if (this.ticks % PSAVE_EVERY === 0) { this.send({ t: 'ps', p: playerSaveData(this.game.player) }); this.stands.expire(performance.now()); }
    if (this.ticks % ENV_EVERY === 0 && performance.now() - this.lastSeen > TIMEOUT_MS) this.lost('Lost connection to the host (timed out)');
  }

  /** Connection gone: back to the title screen. */
  lost(msg) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.bgTimer); if (this.bgWorker) { this.bgWorker.terminate(); this.bgWorker = null; }
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
    clearInterval(this.bgTimer); if (this.bgWorker) { this.bgWorker.terminate(); this.bgWorker = null; }
    if (this.edits) this.edits.detach();
    if (this.ents) this.ents.clear();
    this.disposeRemotes();
    setTimeout(() => this.ch.close(), 300);
  }
}

/** Connect to a friend's world; resolves once the world data has arrived. */
export async function joinSession(code, name, onStatus, transport = createTransport()) {
  const s = new ClientSession(cleanName(name));
  return s.connect(transport, code, onStatus);
}


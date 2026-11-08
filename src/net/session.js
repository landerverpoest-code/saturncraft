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
//   socialCommand(text), pingAtCrosshair(), emote(kind), playerRows(), startSpectate(name), stopSpectate(), blocksPvp(attacker, victim)  (net/social.js)
//   sendCommand(text), requestTravel(dim, arrival), requestExplosion(...), sendVibration(k, x, y, z), sendNote(x, y, z),
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
import { offerPrice, recordTrades, giftValue, GIFT_COOLDOWN } from '../mobs/trades.js';
import { getRep, setRep, cleanReputation, refusesTrade, REP } from '../mobs/reputation.js';
import { tradeMarket } from '../world/events.js';
import { repEvent } from '../mobs/villageRep.js';
import { EditSync } from './editSync.js';
import { createTransport } from './transport.js';
import { RemotePlayer } from './remotePlayer.js';
import { EntityMirror } from './entityMirror.js';
import { packChunk, unpackChunk, playerSaveData, applyPlayerSave, saveGuestCopy } from '../world/save.js';
import { loadGuestGuide, saveGuestGuide, guideOf } from '../player/fieldGuide.js';
import { chunkKey } from '../world/world.js';
import { B, isFurnace, isBox, BOX_COLORS } from '../world/blocks.js';
import { I, ITEMS } from '../world/items.js';
import { withExtras, cleanContents } from '../world/enchantments.js';
import { GUEST_KINDS } from '../world/vibrations.js';
import { rayAABB } from '../entities/entities.js';
import { canPickUpSpear } from '../entities/tidespear.js';
import { runRandomTicks } from '../world/randomTicks.js';
import { addXp } from '../player/experience.js';
import { MAX_USES } from '../mobs/trades.js';
import { claimSeat } from '../mobs/duneStrider.js';
import { FURNACE_CART, driverRefusal, cleanSteer, cartFuelTicks, fatigueState, tiredText } from '../mobs/mounts.js';
import { releaseTarnling } from '../mobs/fauna.js';
import { EFFECTS } from '../player/effects.js';
import { FATIGUE_AMP, FATIGUE_TICKS, needsFatigue } from '../mobs/oceanMobs.js';
import { runCommand } from '../ui/commands.js';
import { DIMENSIONS } from '../world/dimensions/dims.js';
import { POTIONS } from '../world/potions.js';
import {
  SocialState, PingBoard, routePing, runSocial, nameKey, cleanToken, loadClientToken, cleanEmote, emoteByName, EMOTE_COOLDOWN_MS,
  PM_FROM, PM_TO, PM_COLOR, TEAM_CHAT, PING_REACH, PING_FALLBACK, playerRows, cleanRoster, cleanPing, canSpectate, nextSpectateTarget,
  makeResume, pickGuestRecord, reconnectDelay, GAMEMODE_LABEL, teamColor, cleanHostSettings, pickDeathCamTarget, killerOf,
} from './social.js';
import { PingBeacons } from '../render/pingBeacons.js';
import { GuestMeter, allowedEdits, updateEvery, sendsNow, Rate, rateText } from './guard.js';
import { GuestLedger, plausibleStack, countIn, ALLOW_PER_KIND, ALLOW_SMALL } from './ledger.js';
import { cleanCamp, mergeCamp, sameCampLayout } from '../world/campfireCooking.js';
import { PositionHistory, rewindMs, meleeHitOk } from './lagcomp.js';
import { GhostBook, GHOST_TTL_MS } from './ghosts.js';
import { reachOf } from '../player/weapons.js';

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
const WARN_QUIET_MS = 2500; // a guest shows the connection warning after this long without a word from the host
const LAG_WARN_MS = 6000;   // a guest silent this long is shown as having an unstable connection
const TICK_FAILS_MAX = 20;  // an entity that throws this many ticks in a row is removed
const SLEEP_MS = 4500;      // a guest has to lie in bed this long before the night can be skipped

/** Message channel over a transport conn: JSON objects in, JSON objects out. */
class Channel {
  constructor(conn, onMessage, onClose) {
    this.conn = conn;
    this.rate = new Rate();   // characters sent (bandwidth readout, F3)
    this.rateIn = new Rate(); // characters received
    const re = new Reassembler();
    conn.onData = (d) => { if (typeof d === 'string') this.rateIn.add(d.length); const m = re.push(d); if (m) { try { onMessage(m); } catch (e) { console.warn('net message failed', m.t, e); } } };
    conn.onClose = onClose;
  }
  send(msg) { for (const s of encodeMessage(msg)) { this.rate.add(s.length); this.conn.send(s); } }
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

const CONTAINER_BLOCKS = new Set([B.CHEST, B.BARREL, B.FURNACE, B.FURNACE_LIT, B.SMOKER, B.SMOKER_LIT, B.BLAST_FURNACE, B.BLAST_FURNACE_LIT, B.BREWING_STAND, B.GLOOMSHELL_BOX, ...BOX_COLORS, B.HOPPER, B.DISPENSER, B.DROPPER, B.CAMPFIRE]);
const contKey = (k, x, y, z) => `${k}:${x},${y},${z}`;
const finite = (...v) => v.every(Number.isFinite);
/** A guest's drop ledger (made on first use, so a hand-built client record works too). */
const ledgerOf = (c) => c.ledger || (c.ledger = new GuestLedger());
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
    this.friendlyFireAll = false; // host option: team mates can hurt each other whatever their team says
    this.social = new SocialState(); // teams, ops, bans (the host's copy is part of the save; guests mirror the teams)
    this.pings = new PingBoard();    // short-lived beacons
    this.beacons = null;             // their 3D markers (render/pingBeacons.js), made on first use
    this.roster = [];                // [[id, name, gamemode, ping]] from the host, for the Tab list
    this.spectate = null;            // { target, switched, prevMode } while following a friend
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
    const act = this.activePings(now).concat(this.waypointList().map((w) => ({ from: 'wp:' + w.name, x: w.x, y: w.y, z: w.z, color: '#7fe2ff', life: 1 })));
    if (act.length || this.beacons) {
      if (!this.beacons) this.beacons = new PingBeacons(this.game.scene);
      this.beacons.set(act, now, sec);
    }
  }

  // ---- social: names, colours, friendly fire -------------------------------------------------------
  /** A player object (ours, or a guest's stand-in) -> its name. */
  nameOf(o) { return o ? o.netName || (o.isPlayer ? this.name : null) : null; }
  /** True when the attacker may not hurt the victim: same team, friendly fire off (net/social.js). */
  blocksPvp(attacker, victim) { return !this.friendlyFireAll && this.social.blocksDamage(this.nameOf(attacker), this.nameOf(victim)); }
  colorOf(name) { return this.social.colorOf(name); }

  /** Shared waypoints to show here (this dimension): [{ name, x, y, z, by }]. */
  waypointList() { return []; }

  /** Beacons to show now (this dimension). */
  activePings(now = performance.now()) { return this.game ? this.pings.active(now, this.game.world.dimension) : []; }

  /** Ping the block under the crosshair: a beacon for the team (or everybody, without a team). */
  pingAtCrosshair() {
    const g = this.game, p = g.player, now = performance.now();
    if (!p || p.dead) return false;
    const [ex, ey, ez] = p.eyePos(), [dx, dy, dz] = p.lookDir();
    const hit = g.world.raycast(ex, ey, ez, dx, dy, dz, PING_REACH, true);
    if (!hit) { if (g.hud) g.hud.toast('Nothing there to ping', 1500); return false; }
    if (!this.pings.ready(this.name, now)) return false;
    const at = { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 };
    if (this.isHost) this.handlePing(this.name, at, null);
    else { this.send({ t: 'ping', x: at.x, y: at.y, z: at.z }); this.showPing({ from: this.name, ...at, dim: g.world.dimension, color: this.social.colorOf(this.name) }, now); }
    return true;
  }

  showPing(ping, now = performance.now()) {
    this.pings.add(ping, now);
    if (this.game && this.game.audio) this.game.audio.play('orb');
  }

  // ---- social: emotes --------------------------------------------------------------------------------
  /** Play an emote (wave, point, sit) for everybody. `kind` may be abbreviated. */
  emote(kind) {
    const e = cleanEmote(kind) || emoteByName(kind), now = performance.now();
    if (!e || now - (this.lastEmote || -1e9) < EMOTE_COOLDOWN_MS) return false;
    this.lastEmote = now;
    const p = this.game.player;
    this.game.ownEmote = { k: e, at: now, x: p.x, z: p.z }; // our own body in the third-person views
    if (this.isHost) this.broadcast({ t: 'emote', id: 0, e }); else this.send({ t: 'emote', e });
    return true;
  }

  // ---- social: the player list -------------------------------------------------------------------------
  /** Rows for the Tab list: { name, gamemode, ping, team, color, host, op, you }. */
  playerRows() {
    return playerRows(this.currentRoster(), this.social, this.name, this.hostName());
  }

  // ---- social: following a friend ----------------------------------------------------------------------
  spectateCandidates() { return [...this.remotes.values()].filter((rp) => rp.state && !rp.state.dead).map((rp) => rp.name); }

  /** Follow `name` (or the first friend). Returns an error text, or null when it worked. */
  startSpectate(name = null, restoreTo = null) {
    const g = this.game, p = g.player;
    if (!canSpectate(p)) return 'You can only follow a friend when you are dead or in creative mode';
    const names = this.spectateCandidates();
    const target = name ? names.find((n) => nameKey(n) === nameKey(name)) : nextSpectateTarget(names, null, 1);
    if (!target) return name ? `No player called ${name} to follow` : 'There is nobody to follow';
    if (!this.spectate) {
      const switched = !!restoreTo || p.gamemode !== 'spectator'; // restoreTo: the mode to go back to (a dead player returns to survival)
      this.spectate = { target, switched, prevMode: restoreTo || (switched ? p.gamemode : 'creative') };
      if (p.gamemode !== 'spectator') p.setGamemode('spectator'); // flies free of everything; the camera is fixed to the friend
    } else this.spectate.target = target;
    if (g.hud) g.hud.toast(`Following ${target} - scroll for the next player, Shift to stop`, 3000);
    return null;
  }

  /** Next (+1) or previous (-1) friend. */
  cycleSpectate(dir) {
    if (!this.spectate) return;
    const t = nextSpectateTarget(this.spectateCandidates(), this.spectate.target, dir < 0 ? -1 : 1);
    if (t) { this.spectate.target = t; if (this.game.hud) this.game.hud.toast(`Following ${t}`, 1500); }
  }

  stopSpectate() {
    const s = this.spectate;
    if (!s) return false;
    this.spectate = null;
    const p = this.game.player;
    if (s.switched && p.gamemode === 'spectator') p.setGamemode(s.prevMode || 'survival');
    return true;
  }

  // ---- social: the camera of a dead player (follows a friend while they wait to respawn) ---------------------------------
  /** A death: the camera goes to whoever killed us, else a team mate, else the first friend. Returns the name or null. */
  beginDeathCam(cause) {
    const names = this.spectateCandidates(), mates = this.social.teamOf(this.name);
    const target = pickDeathCamTarget(names, killerOf(cause), mates ? mates.members.filter((n) => nameKey(n) !== nameKey(this.name)) : null);
    this.deathCam = target ? { target } : null;
    return target;
  }
  endDeathCam() { this.deathCam = null; }
  cycleDeathCam(dir) {
    if (!this.deathCam) return null;
    const t = nextSpectateTarget(this.spectateCandidates(), this.deathCam.target, dir < 0 ? -1 : 1);
    if (t) this.deathCam.target = t;
    return t;
  }
  /** What the dead player's camera shows now: { name, x, y, z, yaw, pitch } or null. */
  deathCamView() {
    const d = this.deathCam;
    if (!d || !this.game.player.dead) return null;
    const rp = [...this.remotes.values()].find((r) => nameKey(r.name) === nameKey(d.target));
    if (!rp || !rp.state || rp.state.dead) return null;
    const at = rp.shown || rp.state;
    return { name: rp.name, x: at.x, y: at.y, z: at.z, yaw: rp.state.yaw, pitch: rp.state.pitch };
  }
  tickDeathCam() {
    const d = this.deathCam;
    if (!d) return;
    if (!this.game.player.dead) { this.deathCam = null; return; }
    if (this.deathCamView()) return;
    const t = this.cycleDeathCam(1); // the one we watched left or died too
    if (!t) this.deathCam = null;
  }

  /** Every tick: stay on the followed friend (their position and view). */
  tickSpectate() {
    if (this.deathCam) this.tickDeathCam();
    const s = this.spectate, p = this.game.player;
    if (!s) return;
    if (p.gamemode !== 'spectator') { this.spectate = null; return; } // the player changed mode themselves
    let rp = [...this.remotes.values()].find((r) => nameKey(r.name) === nameKey(s.target));
    if (!rp || !rp.state || rp.state.dead) {
      const t = nextSpectateTarget(this.spectateCandidates(), s.target, 1);
      if (!t) { this.stopSpectate(); if (this.game.hud) this.game.hud.toast('Nobody left to follow', 2500); return; }
      s.target = t;
      rp = [...this.remotes.values()].find((r) => r.name === t);
    }
    const at = rp.shown || rp.state;
    p.setPosition(at.x, at.y, at.z);
    p.yaw = rp.state.yaw; p.pitch = rp.state.pitch;
  }

  /** True when this page itself stalled for a while (a long frame, a sleeping laptop): don't blame the peers. */
  stalled() {
    const now = performance.now(), gap = now - (this.lastTickAt || now);
    this.lastTickAt = now;
    return gap > 3000;
  }

  playerNames() { return [this.name, ...[...this.remotes.values()].map((r) => r.name)]; }

  disposeRemotes() {
    for (const rp of this.remotes.values()) rp.dispose();
    this.remotes.clear();
    if (this.beacons) { this.beacons.dispose(); this.beacons = null; }
  }

  /** `/team chat [on|off]`: plain chat lines go to the team (kept on this machine). Returns the lines, or null for any other command. */
  teamChatToggle(text) {
    const a = String(text).trim().replace(/^\//, '').toLowerCase().split(/\s+/);
    if (a[0] !== 'team' || a[1] !== 'chat') return null;
    if (!this.social.teamOf(this.name)) return ['You are not in a team'];
    this.teamChatOn = a[2] === 'on' ? true : a[2] === 'off' ? false : !this.teamChatOn;
    return [this.teamChatOn ? 'Chat now goes to your team (/team chat off to go back)' : 'Chat goes to everybody again'];
  }

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
    if (typeof m.ffa === 'boolean') this.friendlyFireAll = m.ffa;
    if (this.isHost && Number.isInteger(m.mp)) this.maxPlayers = Math.max(2, Math.min(MAX_PLAYERS, m.mp));
    if (this.isHost && this.game) this.game.hostSettings = this.settingsSave(); // the world remembers them (world/save.js)
  }

  /** The host's options as they are saved with the world: PvP, guest commands, team friendly fire and the player limit. */
  settingsSave() { return { pvp: this.pvp, gc: this.guestCommands, ffa: this.friendlyFireAll, mp: this.maxPlayers || MAX_PLAYERS }; }

  /** Take the options a world was saved with (anything unusual falls back to the defaults). */
  loadSettings(d) {
    const o = cleanHostSettings(d);
    this.pvp = o.pvp; this.guestCommands = o.gc; this.friendlyFireAll = o.ffa; this.maxPlayers = o.mp;
  }

  /** Lag compensation (host only): where a mob was for this attacker. */
  rewoundPos() { return null; }

  /** Lines for the F3 overlay: who we talk to and how much it costs. */
  debugLines() { return []; }
}

// ================================================================================
export class HostSession extends Session {
  constructor(name, transport, code) {
    super('host', name);
    this.transport = transport;
    this.code = code;
    this.clients = new Map(); // id -> { id, name, ch, rp, joined, lastSeen, raw, sleepSince, minEp }
    this.nextId = 1;
    this.maxPlayers = MAX_PLAYERS; // the host can lower it (pause menu)
    this.viewers = new Map(); // container key -> { kind, x, y, z, ids: Set, sig }
    this.ghosts = new GhostBook(); // guests whose link dropped, kept for 60 s (net/ghosts.js)
    this.history = new PositionHistory(); // recent mob positions, rewound for a guest's blows and arrows (net/lagcomp.js)
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
    game.social = game.social || new SocialState(); // teams, ops and bans live in the save (world/save.js)
    this.social = game.social;
    this.edits = new EditSync(game.world, { host: true });
    // the options this world was last opened with (PvP, guest commands, friendly fire, player limit)
    if (game.hostSettings) this.loadSettings(game.hostSettings);
    game.hostSettings = this.settingsSave();
    // lightning strikes are shown (and burn / hurt) on every client too
    const strike = game.strikeLightning.bind(game);
    game.strikeLightning = (x, y, z) => { strike(x, y, z); if (!this.closed) this.broadcast({ t: 'bolt', x, y, z }); };
    // closing the tab: tell the guests before the links go (they then show the "host left" screen, not a reconnect loop)
    this._pagehide = () => { if (!this.closed) this.broadcast({ t: 'bye', reason: 'The host closed the world' }); };
    globalThis.addEventListener?.('pagehide', this._pagehide, true);
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
      for (const s of parts) { if (c.ch.rate) c.ch.rate.add(s.length); c.ch.conn.send(s); }
    }
  }

  onConnection(conn) {
    // the signalling server can hand us the same peer's offer twice (after a reconnect): keep the first
    for (const o of this.clients.values()) if (o.ch.conn.peer === conn.peer && !o.ch.conn.closed) { conn.onData = null; conn.onClose = null; return; }
    if (this.closed) { conn.close(); return; }
    const c = { id: this.nextId++, name: null, joined: false, lastSeen: performance.now(), minEp: 0, meter: new GuestMeter(performance.now()), ledger: new GuestLedger() };
    c.ch = new Channel(conn, (m) => this.onMessage(c, m), () => this.drop(c, 'left the game'));
    this.clients.set(c.id, c);
  }

  near(c, x, y, z, r = REACH) {
    const s = c.rp && c.rp.state;
    return !!s && finite(x, y, z) && Math.hypot(x - s.x, y - (s.y + 1), z - s.z) <= r;
  }

  entity(id) { return this.game.entities.list.find((e) => e.id === id && !e.dead && !e.removed); }

  onMessage(c, m) {
    const now = c.lastSeen = performance.now();
    if (!c.joined) { if (m.t === 'hello') this.welcome(c, m); return; }
    const g = this.game;
    if (!this.meter(c, m, now)) return; // a flood: dropped (net/guard.js)
    switch (m.t) {
      case 'st': {
        const st = unpackPlayerState(m.s);
        if (!st) break;
        c.raw = m.s.slice(0, 13); // position, flags, swing, armour and the effect colour
        c.rp.setState(st);
        if (st.sleeping) c.sleepSince = c.sleepSince || performance.now(); else c.sleepSince = 0;
        break;
      }
      case 'ed': if (m.d === g.world.dimension) this.applyGuestEdits(c, m.e); break;
      case 'frame': {
        if (!finite(m.x, m.y, m.z) || !this.near(c, m.x, m.y, m.z, 12)) break;
        const st = m.st && ITEMS[m.st.id] ? m.st : null;
        const had = g.frames.get(`${m.x | 0},${m.y | 0},${m.z | 0}`);
        if (st && !(had && had.id === st.id) && !this.ledgerAllows(c, [{ id: st.id | 0, count: 1 }], ALLOW_SMALL)) { c.ch.send({ t: 'frame', x: m.x | 0, y: m.y | 0, z: m.z | 0, st: had || null }); break; } // (a guest cannot lay what it could not hold)
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
      case 'lectern': {
        // a guest put a book on a lectern, took it off or turned its page
        if (!finite(m.x, m.y, m.z) || !this.near(c, m.x, m.y, m.z, 12)) break;
        g.setLectern(m.x | 0, m.y | 0, m.z | 0, m.s || null, true);
        this.broadcast({ t: 'lectern', x: m.x | 0, y: m.y | 0, z: m.z | 0, s: g.lecterns.get(`${m.x | 0},${m.y | 0},${m.z | 0}`) || null }, c);
        break;
      }
      case 'camp': {
        // a guest laid food on a campfire or took it off
        if (!finite(m.x, m.y, m.z) || !this.near(c, m.x, m.y, m.z, 12)) break;
        const key = `${m.x | 0},${m.y | 0},${m.z | 0}`, theirs = cleanCamp(m.s), cur = g.campfires.get(key) || null;
        if (g.world.getBlock(m.x | 0, m.y | 0, m.z | 0) !== B.CAMPFIRE) break;
        // the guest sees only what lies on the fire; how far it has cooked is ours (it cannot rush or reset that), and food it lays on must be plausible
        const laid = theirs ? theirs.slots.filter((e, i) => e && !(cur && cur.slots[i])).map((e) => ({ id: e.id, count: 1 })) : [];
        if (laid.length && !this.ledgerAllows(c, laid, ALLOW_SMALL)) { c.ch.send({ t: 'camp', x: m.x | 0, y: m.y | 0, z: m.z | 0, s: cur }); break; }
        const next = mergeCamp(cur, theirs);
        g.setCampfire(m.x | 0, m.y | 0, m.z | 0, next, true);
        const now = g.campfires.get(key) || null;
        this.broadcast({ t: 'camp', x: m.x | 0, y: m.y | 0, z: m.z | 0, s: now }, sameCampLayout(now, theirs) ? c : null); // (the guest hears too when the host's picture differs from theirs)
        break;
      }
      case 'note': {
        // a guest punched or retuned a Chime Block: the host plays it and tells the others (rings from signals travel as block edits)
        if (!finite(m.x, m.y, m.z) || !this.near(c, m.x, m.y, m.z, 12) || m.d !== g.world.dimension) break;
        if (g.playChime(m.x | 0, m.y | 0, m.z | 0, { fromNet: true })) this.broadcast({ t: 'note', x: m.x | 0, y: m.y | 0, z: m.z | 0, d: g.world.dimension }, c);
        break;
      }
      case 'vault': this.remoteVault(c, m); break;
      case 'sign': {
        if (!finite(m.x, m.y, m.z) || !this.near(c, m.x, m.y, m.z, 12) || !Array.isArray(m.l)) break;
        g.setSignText(m.x | 0, m.y | 0, m.z | 0, m.l, true);
        this.broadcast({ t: 'sign', x: m.x | 0, y: m.y | 0, z: m.z | 0, l: g.signs.get(`${m.x | 0},${m.y | 0},${m.z | 0}`) }, c);
        break;
      }
      case 'chat': {
        const text = String(m.m || '').slice(0, 256);
        if (!text) break;
        g.chat.add(`<${c.name}> ${text}`, this.social.colorOf(c.name));
        this.broadcast({ t: 'chat', from: c.name, m: text }, c);
        break;
      }
      case 'scmd': this.remoteSocial(c, m); break;
      case 'q': if (g.quests) g.quests.onGuestMessage(c, m); break; // bounties and tales (player/questSystem.js)
      case 'pg': // ping + gamemode for the Tab list; answered at once so the guest can time the round trip
        c.ping = cleanPing(m.rtt);
        if (GAMEMODE_LABEL[m.gm]) c.gm = m.gm;
        c.ch.send({ t: 'pong', ts: m.ts });
        break;
      case 'ping': this.handlePing(c.name, m, c); break;
      case 'emote': {
        const e = cleanEmote(m.e), now = performance.now();
        if (!e || now - (c.lastEmote || -1e9) < EMOTE_COOLDOWN_MS) break;
        c.lastEmote = now;
        c.rp.playEmote(e, now);
        this.broadcast({ t: 'emote', id: c.id, e }, c);
        break;
      }
      case 'hit': this.remoteHit(c, m); break;
      case 'pvp': this.remotePvp(c, m); break;
      case 'ps':
        if (m.p && Array.isArray(m.p.slots)) {
          g.netPlayers[c.name] = { ...m.p, reputation: cleanReputation(c.rp && c.rp.target.reputation), dim: g.world.dimension };
          ledgerOf(c).setHeld(m.p.slots); // what they hold now: the base of what they may drop (net/ledger.js)
        }
        break;
      case 'spawn': this.remoteSpawn(c, m); break;
      case 'take': this.remoteTake(c, m); break;
      case 'mi': this.remoteInteract(c, m); break;
      case 'trade': this.remoteTrade(c, m); break;
      case 'gift': this.remoteGift(c, m); break;
      case 'open': this.openFor(c, m); break;
      case 'close': { const v = this.viewers.get(contKey(m.k, m.x, m.y, m.z)); if (v) v.ids.delete(c.id); break; }
      case 'cset': this.containerSet(c, m); break;
      case 'boxput': { // a guest set down a Gloomshell Box that carried items: they are only unpacked if the guest could have carried them
        if (!this.near(c, m.x + 0.5, m.y + 0.5, m.z + 0.5, 8) || g.chests.get(`${m.x | 0},${m.y | 0},${m.z | 0}`)) break;
        const contents = cleanContents(m.s);
        if (contents && this.ledgerAllows(c, contents.filter(Boolean))) g.onBoxPlaced(m.x | 0, m.y | 0, m.z | 0, { contents }, true);
        break;
      }
      case 'ride': {
        const b = this.entity(m.id);
        // the seats of a mount: the back seat of a Dune Strider (mobs/duneStrider.js), or the saddle of a Galloper, Thistlehorn or Strider
        if (b && b.kind === 'mob') { this.remoteMobSeat(c, b, m); break; }
        if (!b || b.kind !== 'boat') break;
        if (m.on) {
          // a seat of the boat: the driver's, or the second one behind (the guest may ask for either; the snapshot tells it which it got)
          if (b.remoteRider === c.id || b.remoteRider2 === c.id || !this.near(c, b.x, b.y, b.z, 8)) break;
          const seat = b.freeSeat(m.seat === 1 ? 1 : 0);
          if (seat === 0) b.remoteRider = c.id; else if (seat === 1) b.remoteRider2 = c.id;
        } else {
          if (b.remoteRider === c.id) b.remoteRider = null;
          if (b.remoteRider2 === c.id) b.remoteRider2 = null;
        }
        break;
      }
      case 'boat': {
        const b = this.entity(m.id);
        if (!b || b.kind !== 'boat' || b.remoteRider !== c.id || !finite(m.x, m.y, m.z, m.yaw) || !this.near(c, m.x, m.y, m.z, 6)) break;
        b.prev = [b.x, b.y, b.z]; b.prevYaw = b.yaw;
        b.body.setPos(m.x, m.y, m.z); b.yaw = m.yaw;
        break;
      }
      case 'steer': { // the guest in the saddle of a mount: where it wants to go
        const b = this.entity(m.id);
        if (b && b.kind === 'mob' && b.rider === c.rp.target) b.remoteInput = cleanSteer(m, g.ticks);
        break;
      }
      case 'bhit': this.remoteBoatHit(c, m); break;
      case 'fuel': this.remoteFuel(c, m); break;
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
      case 'vib': // a guest ate, opened a door, flipped a lever or tossed an item: the host's sensors hear it (world/vibrations.js)
        if (g.hush && GUEST_KINDS.has(m.k) && this.near(c, m.x, m.y, m.z, 8)) g.hush.vibrate(m.x, m.y, m.z, m.k, c.rp.target);
        break;
      case 'boom': if (this.near(c, m.x, m.y, m.z, 8) && m.power > 0 && m.power <= 6) g.explode(m.x, m.y, m.z, m.power, null); break;
      case 'bye': this.drop(c, 'left the game', true); break;
      default: break;
    }
  }

  welcome(c, m) {
    const g = this.game, soc = this.social;
    if (m.v !== PROTOCOL_VERSION) { c.ch.send({ t: 'reject', reason: 'The host runs a different version of Saturncraft' }); setTimeout(() => this.drop(c), 500); return; }
    const tok = cleanToken(m.tok), base = cleanName(m.name);
    const ban = soc.banOf(base, tok);
    if (ban) { c.ch.send({ t: 'reject', reason: `You are banned from this world${ban.reason ? ': ' + ban.reason : ''}` }); setTimeout(() => this.drop(c), 500); return; }
    // the same guest coming back before the old link timed out: the old link goes, the name stays theirs
    if (tok) for (const o of this.joined()) if (o !== c && o.tok === tok && nameKey(o.name) === nameKey(base)) this.drop(o);
    // (a guest whose link dropped keeps its seat for 60 s: only they can take it, net/ghosts.js)
    if (!this.ghosts.canJoin(base, tok, this.joined().length + 1, this.maxPlayers, performance.now())) { c.ch.send({ t: 'reject', reason: `This world is full (${this.maxPlayers} players)` }); setTimeout(() => this.drop(c), 500); return; }
    let name = base;
    const taken = new Set(this.playerNames().map(nameKey));
    // a name belongs to the browser that first used it (ops, teams and saved belongings go by name)
    for (let n = 2; taken.has(nameKey(name)) || !soc.identityFree(name, tok); n++) name = base.slice(0, 13) + '-' + n;
    soc.bindIdentity(name, tok);
    c.name = name; c.tok = tok;
    const ghost = this.ghosts.claim(name, tok, performance.now()); // back within a minute: exactly where they were
    const p = g.player;
    const chunks = this.editedChunks();
    c.ch.send({
      t: 'welcome', v: PROTOCOL_VERSION, id: c.id, name, hostName: this.name,
      seed: g.seed, time: g.time, weather: g.weather.save(), gamemode: p.gamemode, dim: g.world.dimension,
      dl: g.daylightCycle, df: g.difficulty, pvp: this.pvp, gc: this.guestCommands, ffa: this.friendlyFireAll, mp: this.maxPlayers, se: g.seasons.save(), ev: g.worldEvents ? g.worldEvents.syncOut() : undefined,
      soc: 1, teams: soc.teamsToWire(), wps: soc.waypointsToWire(name), // optional: the social layer (net/social.js); older guests ignore both
      worldSpawn: g.worldSpawn, pos: { x: p.x, y: p.y, z: p.z, yaw: p.yaw },
      player: (ghost && ghost.rec) || g.netPlayers[name] || null, back: ghost ? 1 : undefined,
      signs: [...g.signs], frames: [...g.frames], pots: [...g.pots], lecterns: [...g.lecterns], campfires: [...(g.campfires || [])],
      vaults: g.proving ? g.proving.vaults.save() : [], // who opened which Vault (world/provingSystem.js)
      players: [{ id: 0, name: this.name }, ...this.joined().map((o) => ({ id: o.id, name: o.name }))],
      chunks: chunks.length,
    });
    for (const [k, d] of chunks) c.ch.send({ t: 'ck', k, c: encodePackedChunk(packChunk(d)) });
    c.ch.send({ t: 'ready' });
    c.joined = true;
    ledgerOf(c).setHeld((g.netPlayers[name] || {}).slots); // what they carried when they left: the base of what they may drop
    c.rp = new RemotePlayer(g.scene, c.id, name, this);
    c.rp.target.reputation = cleanReputation((g.netPlayers[name] || {}).reputation); // (the host's copy is the true one)
    this.remotes.set(c.id, c.rp);
    this.broadcast({ t: 'join', id: c.id, name }, c);
    g.chat.add(ghost ? `${name} is back` : `${name} joined the game`);
    this.sendRoster();
  }

  /** Every edited chunk of the current dimension (stored and loaded ones). */
  editedChunks() {
    const w = this.game.world, out = [];
    for (const [k, d] of w.saved) out.push([k, d]);
    for (const ch of w.chunks.values()) if (ch.modified) out.push([chunkKey(ch.cx, ch.cz), ch]);
    return out;
  }

  /** `graceful`: they left on purpose (or were kicked): no ghost, the seat is free at once. */
  drop(c, why = null, graceful = false) {
    if (!this.clients.has(c.id)) return;
    this.clients.delete(c.id);
    console.warn('net: dropped', c.name, why || '(closed)');
    c.ch.close();
    if (!c.joined) return;
    for (const v of this.viewers.values()) v.ids.delete(c.id);
    for (const e of this.game.entities.list) { if (e.kind === 'mob' && e.rider === c.rp.target) this.freeSaddle(e); if (e.remoteRider === c.id) e.remoteRider = null; if (e.remoteRider2 === c.id) e.remoteRider2 = null; if (e.passengerId === c.id) e.passengerId = null; }
    for (const mob of heldBy(this.game, c.rp.target)) unleash(this.game, mob, true); // the leads they held fall
    // their record keeps the last place they stood (newer than the inventory copy of up to 5 s ago): a rejoin continues there
    const rec = this.game.netPlayers && this.game.netPlayers[c.name];
    if (rec && c.raw && finite(c.raw[0], c.raw[1], c.raw[2]) && !((c.raw[6] | 0) & 2)) { // (a dead guest's belongings lie on the ground: keep the older record)
      rec.x = c.raw[0]; rec.y = c.raw[1]; rec.z = c.raw[2]; rec.yaw = c.raw[3]; rec.pitch = c.raw[4]; rec.dim = this.game.world.dimension;
    }
    let ghosted = false;
    if (!graceful && c.name) { this.ghosts.add(c.name, c.tok, rec ? { ...rec } : null, performance.now()); ghosted = true; }
    if (this.spectate && nameKey(this.spectate.target) === nameKey(c.name)) this.cycleSpectate(1);
    c.rp.dispose();
    this.remotes.delete(c.id);
    this.broadcast({ t: 'leave', id: c.id, name: c.name });
    this.sendRoster();
    if (why && this.game) this.game.chat.add(`${c.name} ${why}${ghosted ? ` (their place is kept for ${GHOST_TTL_MS / 1000} s)` : ''}`);
  }

  // ---- blocks ---------------------------------------------------------------------
  /** Meter a guest's message; false drops it. Warns the host once about a guest that floods, kicks one that will not stop. */
  meter(c, m, now) {
    if (!c.meter) return true;
    if (m.t === 'ed') return true; // (counted edit by edit in applyGuestEdits)
    if (c.meter.allow(m.t, now)) return true;
    this.flagFlood(c);
    return false;
  }

  flagFlood(c) {
    const v = c.meter.verdict();
    if (v === 'warn') { c.meter.warned = true; this.game.chat.add(`${c.name} is sending too fast: extra messages are ignored`); }
    else if (v === 'kick') this.kickPlayer(c.name, 'flooding the host');
  }

  applyGuestEdits(c, flat) {
    const g = this.game, w = g.world, broken = [], shaken = [];
    const now = performance.now();
    let budget = c.meter ? allowedEdits(c.meter, Math.floor((flat ? flat.length : 0) / 5), now) : Infinity;
    if (c.meter && budget < Math.floor((flat ? flat.length : 0) / 5)) this.flagFlood(c);
    const bad = this.edits.apply(flat, (x, y, z, nid) => {
      if (budget-- <= 0) return false; // too many edits at once: put the guest's world back
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
  /** Ping of the guest `who` (its stand-in) in ms, or -1. */
  pingOf(who) { const c = who && who.remote ? this.clients.get(who.remote.id) : null; return c && c.ping != null ? c.ping : -1; }

  /** Where `mob` was when the guest `who` saw it: its position rewound by that guest's ping, at most 200 ms (net/lagcomp.js). Null for no rewind. */
  rewoundPos(mob, who) {
    const ms = rewindMs(this.pingOf(who));
    return ms > 0 ? this.history.at(mob.id, performance.now(), ms) : null;
  }

  /** A guest hit one of our mobs (melee or its arrow). */
  remoteHit(c, m) {
    const s = c.rp.state, mob = this.entity(m.id);
    if (!mob || mob.kind !== 'mob' || mob.deathTime > 0 || !s) return;
    if (m.p) { if (Math.hypot(mob.x - s.x, mob.y - s.y, mob.z - s.z) > 120) return; } // (a thrown Returning Disc: flown on the guest's side)
    else if (!meleeHitOk(c.rp.target.eyePos(), mob, this.rewoundPos(mob, c.rp.target), reachOf(s.held == null ? null : { id: s.held }))) return; // the mob where the guest saw it (net/lagcomp.js)
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
    if (this.blocksPvp(c.rp.target, m.id === 0 ? g.player : victim.target)) return; // team mates, friendly fire off
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
    if (attacker && attacker.isPlayer && this.blocksPvp(attacker, t)) return false; // team mates, friendly fire off
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

  /** Something set a guest alight (a Wickling's touch): their own game burns them (at most once a second, so a stream of hits is one message). */
  burnRemote(rp, ticks) {
    const c = this.clients.get(rp.id), now = performance.now();
    if (!c || rp.target.dead || rp.target.creative || now - (c.burnAt || -1e9) < 1000) return;
    c.burnAt = now;
    c.ch.send({ t: 'burn', d: Math.max(1, Math.min(600, ticks | 0)) });
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
      if (!plausibleStack(st)) return; // an id that does not exist, a stack bigger than the item allows, a tool worn past its end
      if (!this.ledgerAllows(c, copyStack(st))) return;
      const e = ents.spawnItem(m.x, m.y, m.z, copyStack(st), v);
      if (e) e.droppedBy = c.id; // (the host knows which stacks on the ground a guest put there)
      if (e && m.pd) e.pickupDelay = Math.min(80, m.pd | 0);
      if (e && m.pd >= 40) e.recycled = true; // thrown or dropped by the guest, not a find
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
      ents.spawnBoat(m.x, m.y, m.z, +m.yaw || 0, !!m.cart, m.variant === 'chest' || m.variant === 'furnace' ? m.variant : null);
    } else if (m.k === 'stand') {
      ents.spawnStand(m.x, m.y, m.z, +m.yaw || 0);
    } else if (m.k === 'critter') {
      // a guest let a Tarnling go from its bucket: it swims off in the host's world, if that cell is water
      const x = Math.floor(m.x), y = Math.floor(m.y), z = Math.floor(m.z);
      if (g.world.getBlock(x, y, z) === B.WATER) releaseTarnling(g, x, y, z, m.col | 0);
    } else if (m.k === 'tnt') {
      // a guest lit TNT: it burns (and blows up) here, so the blast reaches everyone
      const x = Math.floor(m.x), y = Math.floor(m.y), z = Math.floor(m.z);
      if (g.world.getBlock(x, y, z) === B.TNT) igniteTNT(g, x, y, z);
      else ents.add(new PrimedTNT(x + 0.5, y, z + 0.5));
    }
  }

  /** Net/ledger.js: may this guest drop this stack now? A refusal is told once, to the host and the guest. */
  ledgerAllows(c, stacks, allow = ALLOW_PER_KIND) {
    const s = c.rp && c.rp.state, creative = !!(s && s.creative) || c.gm === 'creative';
    if (ledgerOf(c).allowMany([].concat(stacks), performance.now(), creative, allow)) return true;
    if (!ledgerOf(c).warned) {
      c.ledger.warned = true;
      this.game.chat.add(`${c.name} dropped far more than they could hold: the extra is ignored`);
      c.ch.send({ t: 'cmdout', lines: ['The host ignored a drop of more than you could be holding'] });
    }
    return false;
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
      if (!e.recycled && this.game.quests) this.game.quests.emit('pickup', { id: e.stack.id, n }, c.rp.target);
      c.ch.send({ t: 'got', st: { ...copyStack(e.stack), count: n } });
      ledgerOf(c).grantStack({ ...e.stack, count: n }, performance.now());
    } else if (e.kind === 'xp') {
      e.dead = true;
      c.ch.send({ t: 'gotxp', v: e.value });
    } else if (e.kind === 'arrow' && e.thrown === 'spear') {
      // a stuck Tidespear: only its thrower can pull it out (with its wear and enchantments)
      if (!e.stuck || !canPickUpSpear(e, c.rp.target)) return;
      e.dead = true;
      if (!e.creativeThrow) { c.ch.send({ t: 'got', st: copyStack(e.item) }); ledgerOf(c).grantStack({ ...e.item, count: 1 }, performance.now()); }
    } else if (e.kind === 'arrow' && e.stuck && e.pickup) {
      e.dead = true;
      c.ch.send({ t: 'got', st: { id: e.pickupId || I.ARROW, count: 1, damage: 0 } });
      ledgerOf(c).grant(e.pickupId || I.ARROW, 1, performance.now());
    }
  }

  /** A guest used a Vault holding `m.st`: the host's ledger decides; the key goes on 'used', a refusal comes back as 'vaultno'. */
  remoteVault(c, m) {
    const g = this.game, s = c.rp.state;
    if (!finite(m.x, m.y, m.z) || !s || s.dead || !this.near(c, m.x + 0.5, m.y + 0.5, m.z + 0.5, 8) || !g.proving) return;
    const x = m.x | 0, y = m.y | 0, z = m.z | 0;
    if (g.world.getBlock(x, y, z) !== B.VAULT) return;
    const held = m.st && ITEMS[m.st.id] ? { id: m.st.id | 0, count: 1, damage: 0 } : null;
    const r = g.proving.openVault(x, y, z, c.name, held);
    if (r.ok) c.ch.send({ t: 'used', ok: 1, item: I.PROVING_KEY, consume: 1, damage: 0 });
    else c.ch.send({ t: 'vaultno', m: r.msg });
  }

  /** Right-click on a mob by a guest: run the normal interaction with the guest standing in for us. */
  remoteInteract(c, m) {
    const g = this.game, mob = this.entity(m.id), s = c.rp.state;
    if (!mob || mob.kind !== 'mob' || !s || s.dead || Math.hypot(mob.x - s.x, mob.y - s.y, mob.z - s.z) > 8) return;
    const held = m.st && ITEMS[m.st.id] ? withExtras({ id: m.st.id, count: Math.max(1, Math.min(64, m.st.count | 0)), damage: m.st.damage | 0 }, m.st) : null; // (a Name Tag keeps its label)
    const d = held && ITEMS[held.id];
    if ((mob.def.villager || mob.def.trader) && mob.deathTime === 0 && mob.trades.length && !(d && d.food && mob.def.food)) {
      c.ch.send({ t: 'trades', id: mob.id, prof: mob.profession, trades: mob.trades, tc: mob.tradeCount | 0, lv: mob.level | 0, vil: mob.villageId ? mob.villageId(g) : null, gift: mob.lastGift });
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
    const key = mob.villageId ? mob.villageId(this.game) : null, who = c.rp.target;
    const n = refusesTrade(getRep(who, key)) ? 0 : Math.max(0, Math.min(m.n | 0, MAX_USES - o.uses)); // a village that has turned on the guest trades with nobody of theirs
    o.uses += n;
    if (n > 0) { mob.traded = true; recordTrades(mob, n); } // it keeps its trade now even if its job-site block goes (mobs/jobSites.js); trades count towards its level
    c.ch.send({ t: 'traded', id: mob.id, i: m.i | 0, n, trades: mob.trades, tc: mob.tradeCount | 0, lv: mob.level | 0 });
    if (n > 0 && key) repEvent(this.game, who, key, REP.trade * n, 'trade');
  }

  /** A guest hands a settler the item it holds as a gift (the guest takes it from its own hand if this says yes). */
  remoteGift(c, m) {
    const g = this.game, mob = this.entity(m.id), s = c.rp.state;
    if (!mob || !mob.trades || !mob.def.villager || !s || Math.hypot(mob.x - s.x, mob.z - s.z) > 8) return;
    const item = c.rp.state.held, key = mob.villageId(g), who = c.rp.target;
    const worth = item == null || !key ? 0 : giftValue(mob.profession, item);
    const ok = worth > 0 && g.time - mob.lastGift >= GIFT_COOLDOWN;
    if (ok) { mob.lastGift = g.time; repEvent(g, who, key, worth); }
    c.ch.send({ t: 'gifted', id: mob.id, ok: ok ? 1 : 0, item: item == null ? -1 : item, gift: mob.lastGift });
  }

  /** The host tells a guest of a change to its reputation (the host's copy is the true one; it is saved with the guest's record). */
  sendReputation(who, key, value) {
    const c = who && who.remote ? this.clients.get(who.remote.id) : null;
    if (!c) return;
    const rec = this.game.netPlayers[c.name];
    if (rec) rec.reputation = cleanReputation(who.reputation);
    c.ch.send({ t: 'rep', k: key, v: value });
  }

  /** A guest asks for (`m.on`) or gives up a seat on a mob: the front seat is the saddle (steering), seat 1 the one behind (Dune Strider). */
  remoteMobSeat(c, b, m) {
    const me = c.rp.target;
    if (!m.on) {
      claimSeat(b, c.id, false);
      if (b.rider === me) this.freeSaddle(b);
      return;
    }
    const no = () => c.ch.send({ t: 'rno', id: b.id }); // the seat is not theirs: they get off at once
    if (b.rider === me || b.passengerId === c.id) return;
    if (!this.near(c, b.x, b.y, b.z, 8)) { no(); return; }
    if (m.seat === 1) { if (!claimSeat(b, c.id, true)) no(); return; }
    if (driverRefusal(b)) { no(); return; }
    b.rider = me; b.remoteInput = null; b.sitting = false; b.path = null; b.wander = null; b.target = null;
  }

  /** A guest who died, left the area or went away no longer holds the reins. */
  checkSaddles() {
    for (const e of this.game.entities.list) {
      const r = e.kind === 'mob' ? e.rider : null;
      if (!r || !r.isRemotePlayer) continue;
      if (r.dead || !this.remotes.has(r.remote.id) || Math.hypot(r.x - e.x, r.z - e.z) > 12 || e.dead || e.deathTime > 0) { this.freeSaddle(e); continue; }
      // the rider's stamina gauge (the mob snapshot has no room for it; a short message twice a second does)
      const c = this.clients.get(r.remote.id);
      if (c && e.def && e.def.mount) c.ch.send({ t: 'stam', id: e.id, f: Math.round((e.fatigue || 0) * 10) / 10 });
    }
  }

  /** Nobody steers this mount any more. */
  freeSaddle(b) {
    b.rider = null; b.remoteInput = null; b.move = null;
  }

  /**
   * A guest stoked a Minecart with Furnace (it used the fuel up on its side). `m.it` is the fuel item: the burn time must be
   * the item's, and when the cart is full, gone or out of reach the item goes back (`fuelno`) instead of being lost.
   */
  remoteFuel(c, m) {
    const b = this.entity(m.id), item = Number.isInteger(m.it) ? m.it : null;
    const ticks = item === null ? Math.max(0, Math.min(FURNACE_CART.MAX_FUEL, m.n | 0)) : cartFuelTicks(item); // (older guests do not say which item)
    const ok = !!b && b.kind === 'boat' && b.furnace && finite(m.y) && this.near(c, b.x, b.y, b.z, 8) && ticks > 0 && (item === null || (m.n | 0) === ticks) && b.addFuel(ticks, m.y);
    if (!ok && item !== null) c.ch.send({ t: 'fuelno', it: item });
  }

  remoteBoatHit(c, m) {
    const g = this.game, b = this.entity(m.id), s = c.rp.state;
    if (!b || b.kind !== 'boat' || !s || Math.hypot(b.x - s.x, b.z - s.z) > 6) return;
    b.hits++; b.hitTime = 10;
    g.audio.play('hit_wood', [b.x, b.y, b.z]);
    if (b.hits >= 3 || s.creative) g.entities.breakBoat(b, !s.creative); // lets everybody off, spills the cargo
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
    if (!best || best === real) { this.guardTick(e); return; }
    g.player = best;
    try { this.guardTick(e); } finally { g.player = real; }
  }

  /**
   * One entity's tick, isolated: a mob whose AI trips over something about a guest (a field the stand-in lacks) must not
   * abort the whole host tick (and with it every guest's snapshots, which would time them all out). It is logged once,
   * and a creature that keeps failing is removed.
   */
  guardTick(e) {
    try { e.tick(this.game); if (e.netErrors) e.netErrors = 0; } catch (err) {
      e.netErrors = (e.netErrors | 0) + 1;
      if (!e.netErrLogged) { e.netErrLogged = true; console.warn('net: entity tick failed', e.type || e.kind, err); }
      if (e.netErrors >= TICK_FAILS_MAX) { e.dead = true; if (e.kind === 'mob') e.removed = true; }
    }
  }

  // ---- containers -----------------------------------------------------------------
  container(kind, x, y, z) {
    const g = this.game, id = g.world.getBlock(x, y, z);
    if (kind === 'chest') return id === B.CHEST || id === B.BARREL || isBox(id) ? g.getChest(x, y, z) : id === B.HOPPER ? g.getHopper(x, y, z) : id === B.DISPENSER || id === B.DROPPER ? g.getDispenser(x, y, z) : null;
    if (kind === 'chest2') {
      const h = id === B.CHEST ? doubleChestHalves(g.world, x, y, z) : null;
      return h && h[0].x === x && h[0].z === z ? doubleChestView(g.getChest(h[0].x, y, h[0].z), g.getChest(h[1].x, y, h[1].z)) : null;
    }
    if (kind === 'cargo') { const e = this.entity(x); return e && e.cargo ? e.cargo : null; } // the chest of a Chest Boat or Minecart with Chest (x is the entity's id)
    if (kind === 'furnace') return isFurnace(id) ? g.getFurnace(x, y, z) : null;
    if (kind === 'brewing') return id === B.BREWING_STAND ? g.getBrewingStand(x, y, z) : null;
    return null;
  }

  /** Where a container is, for the reach check: a block's middle, or the boat or cart that holds the cargo (`x` is its id). */
  contPos(m) {
    if (m.k !== 'cargo') return [m.x + 0.5, m.y + 0.5, m.z + 0.5];
    const e = this.entity(m.x);
    return e ? [e.x, e.y + 0.5, e.z] : [NaN, NaN, NaN];
  }

  openFor(c, m) {
    if (!this.near(c, ...this.contPos(m), 10)) return;
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
    const before = obj ? containerSlots(m.k, obj).map(copyStack) : null;
    if (!obj || !this.near(c, ...this.contPos(m), 10) || !applySlotChanges(m.k, obj, m.ch)) { c.minEp = (m.ep | 0) + 1; reply(false); return; }
    // what left the container is in the guest's hands now: it may drop that much more
    const after = containerSlots(m.k, obj), now = performance.now();
    for (const id of new Set(before.filter(Boolean).map((x) => x.id))) { const gone = countIn(before, id) - countIn(after, id); if (gone > 0) ledgerOf(c).grant(id, gone, now); }
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
    g.cmdActor = this.buildActor(c); // who is asking: the building tools use their position, game mode and op status
    let out;
    try { out = runCommand(g, text); } catch (e) { out = 'Command failed: ' + e.message; } finally { g.player = real; g.cmdActor = null; }
    c.ch.send({ t: 'cmdout', lines: [].concat(out || []) });
    g.chat.add(`[${c.name}: ${text}]`);
    this.sendEnv();
  }

  /** A guest as the building tools see them (ui/buildCommands.js): position, look direction, creative or op, and a way to answer later. */
  buildActor(c) {
    const t = c.rp.target, social = this.social, host = this.name;
    return {
      key: 'n:' + String(c.name).toLowerCase(), name: c.name, host: false,
      get op() { return !!social && social.isOp(c.name, host); },
      get creative() { return c.gm ? c.gm === 'creative' : !!t.creative; },
      pos: () => ({ x: t.x, y: t.y, z: t.z }),
      look: () => t.lookDir(),
      say: (lines) => { try { c.ch.send({ t: 'cmdout', lines: [].concat(lines) }); } catch { /* they left */ } },
      toast: () => {},
    };
  }

  setOptions(m) { super.setOptions(m); this.sendEnv(); }

  sendEnv() {
    const g = this.game;
    // rb: the raid under way (mobs/raids.js raidStatus): guests near the village show its bar
    this.broadcast({ t: 'env', time: g.time, w: g.weather.save(), dl: g.daylightCycle, df: g.difficulty, pvp: this.pvp, gc: this.guestCommands, ffa: this.friendlyFireAll, mp: this.maxPlayers, se: g.seasons.save(), ev: g.worldEvents ? g.worldEvents.syncOut() : undefined, rb: g.raids && g.raids.status ? g.raids.status() : null });
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

  // ---- social: commands, messages, teams, beacons, the roster ------------------------------------------
  hostName() { return this.name; }

  socialEnv() {
    return {
      social: this.social, hostName: this.name,
      online: () => this.playerNames(),
      teamChanged: () => this.broadcastTeams(),
      posOf: (name) => this.posOf(name),
      waypointsChanged: () => this.sendWaypoints(),
      pm: (from, to, text) => this.deliverPm(from, to, text),
      teamSay: (from, text) => this.deliverTeam(from, text),
      kick: (name, reason) => this.kickPlayer(name, reason),
      ban: (name, reason, by) => this.banPlayer(name, reason, by),
    };
  }

  /** /msg, /team, /kick... typed by the host. */
  socialCommand(text) { return this.teamChatToggle(text) || runSocial(this.socialEnv(), this.name, text); }

  /** The same typed by a guest: the host runs it for them and answers with the lines. */
  remoteSocial(c, m) {
    const text = String(m.text || '').slice(0, 256);
    let out;
    try { out = runSocial(this.socialEnv(), c.name, text); } catch (e) { out = ['Command failed: ' + e.message]; }
    if (out.length) c.ch.send({ t: 'cmdout', lines: out });
  }

  clientByName(name) { return this.joined().find((c) => nameKey(c.name) === nameKey(name)) || null; }

  /** A private message: the recipient and the sender (both get a line, colour-coded). */
  deliverPm(from, to, text) {
    const g = this.game;
    const show = (who, line, m) => {
      if (nameKey(who) === nameKey(this.name)) g.chat.add(line, PM_COLOR);
      else { const c = this.clientByName(who); if (c) c.ch.send(m); }
    };
    show(to, PM_FROM(from, text), { t: 'pm', from, m: text });
    show(from, PM_TO(to, text), { t: 'pm', to, m: text });
  }

  /** /tc: a line for every online member of the sender's team. */
  deliverTeam(from, text) {
    const t = this.social.teamOf(from);
    if (!t) return;
    for (const member of t.members) {
      if (nameKey(member) === nameKey(this.name)) this.game.chat.add(TEAM_CHAT(t.name, from, text), t.color);
      else { const c = this.clientByName(member); if (c) c.ch.send({ t: 'tchat', team: t.name, from, m: text }); }
    }
  }

  broadcastTeams() { this.broadcast({ t: 'teams', teams: this.social.teamsToWire() }); this.sendWaypoints(); }

  /** Where a player stands (for /wp add): { x, y, z, dim }. */
  posOf(name) {
    const pl = this.players().find((p) => nameKey(p.name) === nameKey(name));
    return pl ? { x: pl.obj.x, y: pl.obj.y, z: pl.obj.z, dim: this.game.world.dimension } : null;
  }

  waypointList() { return this.game ? this.social.waypointsFor(this.name).filter((w) => w.dim === this.game.world.dimension) : []; }

  /** Everybody gets the waypoints they may see (a team's are for its members). */
  sendWaypoints() {
    for (const c of this.joined()) c.ch.send({ t: 'wps', w: this.social.waypointsToWire(c.name) });
  }

  kickPlayer(name, reason = '') {
    const c = this.clientByName(name);
    if (!c) return false;
    c.ch.send({ t: 'bye', reason: `You were kicked from the world${reason ? ': ' + reason : ''}`, kick: 1 });
    this.game.chat.add(`${c.name} was kicked${reason ? ' (' + reason + ')' : ''}`);
    setTimeout(() => this.drop(c, null, true), 400); // (lets the message out first)
    return true;
  }

  banPlayer(name, reason = '', by = '') {
    const c = this.clientByName(name);
    this.social.ban(name, reason, by, c ? c.tok : this.social.tokenOf(name));
    return c ? this.kickPlayer(name, reason ? 'banned: ' + reason : 'banned') : false;
  }

  /** A beacon from `sender` (a guest's message or our own key press): checked, then shown to the team (or everybody). */
  handlePing(sender, m, c) {
    const g = this.game, now = performance.now();
    const from = c ? c.rp.state : g.player;
    const r = routePing(this.social, this.pings, sender, m, from, this.playerNames(), now, g.world.dimension);
    if (!r.ok) return;
    const msg = { t: 'ping', from: r.ping.from, x: r.ping.x, y: r.ping.y, z: r.ping.z, d: r.ping.dim, c: r.ping.color || undefined };
    // the host sees it if it is the sender or on the team
    if (!c || r.targets.some((n) => nameKey(n) === nameKey(this.name))) this.showPing(r.ping, now);
    for (const n of r.targets) { const cl = this.clientByName(n); if (cl) cl.ch.send(msg); }
  }

  /** [[id, name, gamemode, ping]] of everybody here (the host's ping is shown as none). */
  hostRoster() {
    return [[0, this.name, this.game ? this.game.player.gamemode : 'survival', -1], ...this.joined().map((c) => [c.id, c.name, c.gm || 'survival', c.ping == null ? -1 : c.ping])];
  }
  currentRoster() { return this.hostRoster(); }
  sendRoster() { this.broadcast({ t: 'roster', r: this.hostRoster() }); }

  sendChat(text) { this.broadcast({ t: 'chat', from: this.name, m: text }); }
  sendSign(x, y, z, l) { this.broadcast({ t: 'sign', x, y, z, l }); }
  sendFrame(x, y, z, st) { this.broadcast({ t: 'frame', x, y, z, st }); }
  sendPot(x, y, z, f) { this.broadcast({ t: 'pot', x, y, z, f }); }
  sendLectern(x, y, z, s) { this.broadcast({ t: 'lectern', x, y, z, s }); }
  sendCampfire(x, y, z, s) { this.broadcast({ t: 'camp', x, y, z, s }); }
  sendNote(x, y, z) { this.broadcast({ t: 'note', x, y, z, d: this.game.world.dimension }); }

  tick() {
    if (this.closed) return;
    const g = this.game;
    this.ticks++;
    this.tickSpectate();
    if (this.clients.size) this.history.record(performance.now(), g.entities.list.filter((x) => x.kind === 'mob' && !x.dead && !x.removed).map((x) => ({ id: x.id, x: x.x, y: x.y, z: x.z }))); else if (this.history.size) this.history.clear();
    if (this.ticks % 40 === 0) this.sendRoster();
    if (this.stalled()) for (const c of this.clients.values()) c.lastSeen = performance.now();
    const e = this.edits.take();
    if (e.length) this.broadcast({ t: 'ed', e, d: g.world.dimension });
    this.simulateGuests();
    if (this.ticks % 10 === 0) this.checkSaddles();
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
        const pressure = c.ch.backlog() > BACKLOG_LIMIT / 4 ? (c.ch.backlog() > BACKLOG_LIMIT / 2 ? 2 : 1) : 0; // a guest whose link is filling up gets the far things less often
        const n = c.entCount | 0;
        for (const x of ents) {
          const dx = Math.abs(x.x - s.x), dz = Math.abs(x.z - s.z);
          if (dx > ENTITY_RANGE || dz > ENTITY_RANGE) continue;
          let p = packed.get(x);
          if (p === undefined) {
            const a = packEntity(x, riderOf, playerIdOf);
            p = a ? { a, key: JSON.stringify(a) } : null;
            packed.set(x, p);
          }
          if (!p) continue;
          const id = p.a[1], old = c.entCache.get(id);
          ids.push(id);
          // far mobs, items and orbs are resent every 2nd or 4th snapshot (a full list sends everything); what is skipped keeps its old key and goes out later
          if (!full && old !== undefined && old !== p.key && !sendsNow(updateEvery(x.kind, Math.hypot(dx, dz), pressure), id, n)) { cache.set(id, old); continue; }
          cache.set(id, p.key);
          if (old !== p.key) changed.push(p.a);
        }
        c.entCache = cache;
        c.ch.send(full ? { t: 'ents', m: changed, d: g.world.dimension } : { t: 'ents', m: changed, ids, d: g.world.dimension });
      }
    }
    if (this.ticks % CONTAINER_EVERY === 0) this.syncContainers();
    if (this.ticks % ENV_EVERY === 0) {
      this.sendEnv();
      const now = performance.now();
      const held = this.ghosts.map.size ? this.ghosts.seats(now).map((x) => x.name) : [];
      if (this.ghostNames && this.ghostNames.length) for (const n of this.ghostNames) if (!held.includes(n) && !this.clientByName(n)) g.chat.add(`${n}'s place was given up`);
      this.ghostNames = held;
      for (const c of [...this.clients.values()]) {
        if (now - c.lastSeen > TIMEOUT_MS) { this.drop(c, 'timed out'); continue; }
        if (!c.joined) continue;
        if (c.ch.rate) c.ch.rate.tick(now);
        if (c.ch.rateIn) c.ch.rateIn.tick(now);
        // a guest that went quiet: say so (once), and when it is back
        const quiet = now - c.lastSeen > LAG_WARN_MS;
        if (quiet && !c.lagging) { c.lagging = true; this.game.chat.add(`${c.name}'s connection is unstable`); }
        else if (!quiet && c.lagging) { c.lagging = false; this.game.chat.add(`${c.name}'s connection recovered`); }
      }
    }
  }

  debugLines() {
    const rows = this.joined();
    const out = rows.reduce((n, c) => n + (c.ch.rate ? c.ch.rate.bps : 0), 0), inn = rows.reduce((n, c) => n + (c.ch.rateIn ? c.ch.rateIn.bps : 0), 0);
    return [
      `Net host ${this.code}  ${rows.length + 1}/${this.maxPlayers} players  out ${rateText(out)}  in ${rateText(inn)}`,
      ...rows.map((c) => `  ${c.name}  ${c.ping >= 0 && c.ping != null ? c.ping + ' ms' : '- ms'}  out ${rateText(c.ch.rate ? c.ch.rate.bps : 0)}  in ${rateText(c.ch.rateIn ? c.ch.rateIn.bps : 0)}  backlog ${Math.round(c.ch.backlog() / 1024)} KB  skipped ${c.skipped | 0}${c.ledger && c.ledger.denied ? '  drops refused ' + c.ledger.denied : ''}`),
    ];
  }

  close() {
    if (this.closed) return;
    this.broadcast({ t: 'bye', reason: 'The host closed the world' });
    this.closed = true;
    if (this._pagehide) globalThis.removeEventListener?.('pagehide', this._pagehide, true);
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
    this.tok = loadClientToken(); // who we are to the host, so our name (and ops, team, belongings) stay ours
    this.code = null;     // the room code we joined with (to reconnect)
    this.resume = null;   // what a dropped link left behind: our place and belongings (net/social.js makeResume)
    this.rtt = -1;        // round trip to the host in ms (shown in the Tab list)
    this.hostSocial = false; // does the host speak the social messages?
    this.waypoints = [];     // shared waypoints the host sent (net/social.js)
    this.teamChatOn = false; // plain chat lines go to the team (/team chat)
  }

  async connect(transport, code, onStatus = () => {}) {
    onStatus('Connecting…');
    const conn = await transport.join(code);
    this.ch = new Channel(conn, (m) => this.onMessage(m), () => this.lost('Lost connection to the host', true));
    this.ch.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, tok: this.tok });
    this.startBackground(); // keep-alives while the world downloads and the terrain loads
    onStatus('Downloading the world…');
    this.onStatus = onStatus;
    await new Promise((resolve, reject) => {
      this._ready = resolve; this._fail = reject;
      this._joinTimer = setTimeout(() => this.lost('The host did not answer', true), 60000);
    });
    clearTimeout(this._joinTimer);
    return this;
  }

  send(msg) { if (!this.closed) this.ch.send(msg); }

  onMessage(m) {
    this.lastSeen = performance.now();
    if (!this.game) {
      if (m.t === 'welcome') { this.welcome = m; this.id = m.id; this.name = m.name; this.setOptions(m); this.hostSocial = !!m.soc; this.social.teamsFromWire(m.teams); this.waypoints = SocialState.waypointsFromWire(m.wps); }
      else if (m.t === 'ck') { this.chunks.push(m); if (this.welcome && this.onStatus) this.onStatus(`Downloading the world… ${this.chunks.length}/${this.welcome.chunks} chunks`); }
      else if (m.t === 'ready') this._ready();
      else if (m.t === 'reject') this.lost(m.reason || 'The host refused the connection');
      else if (m.t === 'bye') this.lost(m.reason || 'The host closed the world');
      else this.queue.push(m);
      return;
    }
    this.handle(m);
  }

  /** The connection warning: nothing from the host for a while (shown before the link is given up on). */
  render(sec) {
    super.render(sec);
    this.updateWarning(performance.now());
  }

  updateWarning(now) {
    const quiet = this.closed ? 0 : now - this.lastSeen;
    const show = quiet > WARN_QUIET_MS;
    if (!show && !this.warnEl) return;
    if (!this.warnEl) {
      this.warnEl = document.createElement('div');
      this.warnEl.id = 'netwarn';
      this.warnEl.setAttribute('role', 'alert');
      document.body.appendChild(this.warnEl);
    }
    this.warnEl.classList.toggle('hidden', !show);
    if (show) this.warnEl.textContent = `No news from the host for ${Math.floor(quiet / 1000)} s - the connection is unstable (disconnecting in ${Math.max(0, Math.ceil((TIMEOUT_MS - quiet) / 1000))} s)`;
  }

  get worldSpawn() { return this.welcome.worldSpawn; }
  /** The dimension to start in (read by Game before the world is created). */
  get dimension() { return this.welcome ? this.welcome.dim || 'overworld' : 'overworld'; }

  /**
   * The host's calendar (`se`: { on, days, offset }, optional so older hosts still work). The season itself
   * follows the synced world time, so only the season length, the offset and the on/off rule travel.
   */
  applySeasons(se) {
    const g = this.game;
    if (!se || typeof se !== 'object' || !g || !g.seasons) return;
    g.seasons.load(se);
    if (typeof se.on === 'boolean') g.settings.seasons = se.on;
    g.seasons.enabled = g.seasonsOn;
  }

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
    for (const [k, c] of w.campfires || []) { const [x, y, z] = String(k).split(',').map(Number); if (finite(x, y, z)) game.setCampfire(x, y, z, c, true); }
    for (const [k, l] of w.lecterns || []) { const [x, y, z] = String(k).split(',').map(Number); if (finite(x, y, z)) game.setLectern(x, y, z, l, true); }
    if (game.proving) game.proving.vaults.load(w.vaults);
    if (typeof w.dl === 'boolean') game.settings.daylightCycle = w.dl;
    if (typeof w.df === 'string') game.settings.difficulty = w.df;
    this.applySeasons(w.se);
    if (game.worldEvents) game.worldEvents.syncIn(w.ev);
    game.spawner.enabled = false;
    game.worldSpawn = { ...w.worldSpawn };
    const p = game.player;
    p.netName = this.name;
    // our own copy from just before the link dropped is newer than the host's (up to 5 s old); the host's is the fallback
    const rec = pickGuestRecord(w.player, this.resume, game.world.dimension);
    this.resume = null;
    if (rec) applyPlayerSave(game, rec);
    p.stats.guide = loadGuestGuide(); // a guest's Field Guide lives on its own machine (player/fieldGuide.js)
    if (!rec || (rec.dim || 'overworld') !== game.world.dimension) {
      if (!rec) { p.setGamemode(w.gamemode); p.spawn = { ...w.worldSpawn }; }
      p.setPosition(w.pos.x, w.pos.y, w.pos.z);
      p.yaw = w.pos.yaw;
    }
    if (w.back && game.chat) game.chat.add('Welcome back - your place was kept');
    this.edits = new EditSync(game.world, { host: false });
    game.world.passive = true; // fluids, fire, falling blocks, simmering pots... run on the host and arrive as edits
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
      case 'chat': g.chat.add(`<${m.from}> ${m.m}`, this.social.colorOf(m.from)); break;
      case 'pm': g.chat.add(m.from ? PM_FROM(String(m.from).slice(0, 16), String(m.m || '').slice(0, 256)) : PM_TO(String(m.to || '').slice(0, 16), String(m.m || '').slice(0, 256)), PM_COLOR); break;
      case 'tchat': { const t = this.social.teamOf(m.from); g.chat.add(TEAM_CHAT(String(m.team || '').slice(0, 12), String(m.from || '').slice(0, 16), String(m.m || '').slice(0, 256)), t ? t.color : null); break; }
      case 'teams': this.social.teamsFromWire(m.teams); break;
      case 'wps': this.waypoints = SocialState.waypointsFromWire(m.w); break;
      case 'roster': this.roster = cleanRoster(m.r); break;
      case 'pong': { const r = performance.now() - m.ts; if (Number.isFinite(r) && r >= 0) this.rtt = this.rtt < 0 ? Math.round(r) : Math.round(this.rtt * 0.5 + r * 0.5); break; }
      case 'ping': {
        if (![m.x, m.y, m.z].every(Number.isFinite) || typeof m.from !== 'string') break;
        this.showPing({ from: m.from, x: m.x, y: m.y, z: m.z, dim: typeof m.d === 'string' ? m.d : g.world.dimension, color: teamColor(m.c) || this.social.colorOf(m.from) });
        break;
      }
      case 'emote': { const rp = this.remotes.get(m.id), e = cleanEmote(m.e); if (rp && e) rp.playEmote(e); break; }
      case 'sign': if (Array.isArray(m.l)) g.setSignText(m.x | 0, m.y | 0, m.z | 0, m.l, true); break;
      case 'frame': g.setFrameItem(m.x | 0, m.y | 0, m.z | 0, m.st || null, true); break;
      case 'pot': g.setPot(m.x | 0, m.y | 0, m.z | 0, m.f || null, true); break;
      case 'lectern': g.setLectern(m.x | 0, m.y | 0, m.z | 0, m.s || null, true); break;
      case 'camp': g.setCampfire(m.x | 0, m.y | 0, m.z | 0, m.s || null, true); break;
      case 'note': if (finite(m.x, m.y, m.z) && m.d === g.world.dimension) g.playChime(m.x | 0, m.y | 0, m.z | 0, { fromNet: true }); break;
      case 'vaultset': if (g.proving && typeof m.k === 'string' && /^-?\d+,-?\d+,-?\d+$/.test(m.k)) g.proving.vaults.set(m.k, m.n); break;
      case 'vaultno': if (g.hud) g.hud.toast(String(m.m || '').slice(0, 80)); break;
      case 'cmdout': for (const l of m.lines || []) g.chat.add(String(l)); break;
      case 'env':
        if (Math.abs(g.time - m.time) > 2) g.time = m.time;
        g.weather.load(m.w);
        if (typeof m.dl === 'boolean') g.settings.daylightCycle = m.dl;
        if (typeof m.df === 'string') g.settings.difficulty = m.df;
        this.applySeasons(m.se);
        if (g.worldEvents) g.worldEvents.syncIn(m.ev); // optional: world events (world/events.js)
        this.setOptions(m);
        this.onRaidStatus(m.rb || null);
        break;
      case 'ents': if (m.d === g.world.dimension && !g.dims.pending) this.ents.apply(m.m, m.ids); break;
      case 'hurt': p.hurt(m.a, m.s, m.x != null ? { x: m.x, z: m.z } : null); break;
      case 'burn': if (!p.creative && !p.dead) p.fireTicks = Math.max(p.fireTicks, Math.max(1, Math.min(600, m.d | 0))); break;
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
        else if (!EFFECTS[m.e].instant) {
          // an Elder Deepeye's curse (reference: elder guardian) also shows its ghost to the guest it lands on
          if (m.e === 'mining_fatigue' && (m.a | 0) === FATIGUE_AMP && (m.d | 0) === FATIGUE_TICKS && needsFatigue(p.effects, p.creative) && g.hud && g.hud.showGhostFace) g.hud.showGhostFace();
          p.addEffect(m.e, Math.max(0, Math.min(72000, m.d | 0)), Math.max(0, Math.min(10, m.a | 0)));
        }
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
        mob.tradeCount = m.tc | 0; mob.level = Math.max(1, m.lv | 0); mob.village = typeof m.vil === 'string' ? m.vil : null; mob.lastGift = Number.isFinite(m.gift) ? m.gift : -1e9;
        if (!g.ui.blocking) { g.ui.openTrade(mob); g.audio.play('hmm', [mob.x, mob.y + 1.5, mob.z]); }
        break;
      }
      case 'traded': this.onTraded(m); break;
      case 'gifted': this.onGifted(m); break;
      case 'q': if (g.quests) g.quests.onHostMessage(m); break;
      case 'rep': if (typeof m.k === 'string' && Number.isFinite(m.v)) setRep(g.player, m.k, m.v); break;
      case 'cont': this.onContainerState(m, false); break;
      case 'cack': case 'cnak': this.onContainerReply(m); break;
      case 'cclose': if (this.cont && this.cont.kind === m.k && this.cont.x === m.x && this.cont.y === m.y && this.cont.z === m.z && this.screenOpen(this.cont)) g.ui.close(); break;
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
      case 'rno': if (p.riding && p.riding.netId === m.id) g.dismount(); break; // the host refused the seat
      case 'stam': { // the stamina of the mount we ride (shown by the HUD like the host's own)
        const mob = this.ents.byNetId(m.id);
        if (!mob || p.riding !== mob || !Number.isFinite(m.f)) break;
        const before = fatigueState(mob.fatigue || 0);
        mob.fatigue = Math.max(0, Math.min(1e6, m.f));
        const after = fatigueState(mob.fatigue);
        if (after !== before && tiredText(after) && g.hud) g.hud.toast(tiredText(after), 3500);
        break;
      }
      case 'fuelno': this.onFuelRefused(m); break;
      case 'bye': this.lost(m.reason || 'The host closed the world', false, m.kick ? { kick: true } : { hostLeft: true }); break;
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
    this.send({ t: 'spawn', k: kind, x: r2(d.x), y: r2(d.y), z: r2(d.z), st: d.st ? copyStack(d.st) : undefined, v: d.v ? d.v.map(r2) : undefined, n: d.n, pd: d.pd, crit: d.crit, yaw: d.yaw, power: d.power, col: d.col, cart: d.cart || undefined, variant: d.variant || undefined });
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

  /** The host would not take the fuel we put in a cart (full, gone, out of reach): it comes back to us. */
  onFuelRefused(m) {
    const g = this.game, p = g.player, it = m.it | 0;
    if (!ITEMS[it] || p.creative || !cartFuelTicks(it)) return;
    const sel = p.inventory.selectedStack;
    if (it === I.LAVA_BUCKET && sel && sel.id === I.BUCKET && sel.count === 1) p.inventory.slots[p.inventory.selected] = { id: I.LAVA_BUCKET, count: 1, damage: 0 };
    else {
      const left = p.inventory.add({ id: it, count: 1, damage: 0 });
      if (left) this.requestSpawn('item', { x: p.x, y: p.y + 1, z: p.z, st: { id: it, count: left, damage: 0 }, pd: 40 });
    }
    p.inventory.changed();
    if (g.hud) g.hud.toast('The cart cannot take any more fuel', 2000);
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
  ride(boat, on, seat = 0) { this.send({ t: 'ride', id: boat.netId, on: on ? 1 : 0, seat }); }
  /** A guest stoked a shared Minecart with Furnace with `ticks` of fuel, pushing off the way `yaw` looks. */
  fuelCart(boat, ticks, yaw, item = null) { this.send({ t: 'fuel', id: boat.netId, n: ticks | 0, y: Math.round(yaw * 100) / 100, it: item == null ? undefined : item }); }

  /** Another player hit by us (PvP). */
  targetHurt(rp, amount, source, attacker) {
    if (!this.pvp || attacker !== this.game.player || rp.target.dead) return false;
    if (this.blocksPvp(attacker, rp.target)) return false; // team mates, friendly fire off
    this.send({ t: 'pvp', id: rp.id, d: Math.round(amount * 100) / 100 });
    return true;
  }

  requestTrade(mob, i, times) { this.send({ t: 'trade', id: mob.netId, i, n: times }); }
  requestGift(mob) { this.send({ t: 'gift', id: mob.netId }); }

  onTraded(m) {
    const g = this.game, inv = g.player.inventory, mob = this.ents.byNetId(m.id);
    const grew = !!(mob && mob.trades && m.trades && m.trades.length !== mob.trades.length); // a new level brought new offers
    if (mob && mob.trades) (m.trades || []).forEach((t, i) => { if (mob.trades[i]) mob.trades[i].uses = t.uses; }); // keep the open screen's offers
    if (mob) { mob.tradeCount = m.tc | 0; mob.level = Math.max(1, m.lv | 0); }
    const o = m.trades && m.trades[m.i];
    if (!o) return;
    let done = 0;
    const market = mob && mob.village ? tradeMarket(g, mob.village, g.player) : null; // our copy of the host's reputation (and the festival's cut)
    for (let k = 0; k < m.n; k++) {
      const price = offerPrice({ ...o, uses: o.uses - m.n + k }, championDiscount(g.player.effects), market); // a Village Champion pays less; demand raised the price with every use
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
    if (done) { g.player.stats.trades += done; g.milestones.event('trade'); if (g.quests) g.quests.emit('trade', { n: done }); if (mob && mob.def && mob.def.trader) g.milestones.event('peddler'); if (mob) g.audio.play('hmm', [mob.x, mob.y + 1.5, mob.z]); g.entities.spawnXp(g.player.x, g.player.y + 1, g.player.z, 3 * done); }
    if (grew) mob.trades = m.trades;
    if (g.ui.open === 'trade') { if (grew) g.ui.openTrade(mob); else g.ui.refreshAll(); }
  }

  /** The host's answer to our gift: a yes takes one of the item from our hand. */
  onGifted(m) {
    const g = this.game, p = g.player, mob = this.ents.byNetId(m.id);
    if (mob) mob.lastGift = Number.isFinite(m.gift) ? m.gift : mob.lastGift;
    const st = p.inventory.selectedStack;
    if (m.ok && st && st.id === m.item && !p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
    if (g.hud) g.hud.toast(m.ok ? 'The settler is delighted' : 'The settler has no use for that right now', 2500);
    if (m.ok && mob) g.audio.play('hmm', [mob.x, mob.y + 1.5, mob.z]);
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
    if (this.screenOpen(c)) this.game.ui.refreshAll(true);
  }

  /** Is the screen of this open container showing? (a double chest and a boat's cargo use the chest screen) */
  screenOpen(c) { return this.game.ui.open === (c.kind === 'chest2' || c.kind === 'cargo' ? 'chest' : c.kind); }

  onContainerReply(m) {
    const c = this.cont, g = this.game;
    if (!c || c.kind !== m.k || c.x !== m.x || c.y !== m.y || c.z !== m.z) return;
    if (m.t === 'cack') {
      c.pending = c.pending.filter((p) => p.seq > m.seq);
      if (!c.pending.length && m.s) { loadContainerState(c.kind, c.obj, m.s); if (this.screenOpen(c)) g.ui.refreshAll(true); }
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
    if (this.screenOpen(c)) g.ui.refreshAll(true);
  }

  // ---- commands, dimensions, misc ---------------------------------------------------------
  sendCommand(text) { this.send({ t: 'cmd', text }); }

  /** /msg, /team, /kick...: the host runs them and answers with the lines (as 'cmdout'). */
  socialCommand(text) {
    const t = this.teamChatToggle(text);
    if (t) return t;
    if (!this.hostSocial) return ['The host runs an older version of Saturncraft without these commands'];
    this.send({ t: 'scmd', text });
    return [];
  }

  hostName() { return this.welcome ? this.welcome.hostName : ''; }

  waypointList() { return this.game ? this.waypoints.filter((w) => w.dim === this.game.world.dimension) : []; }

  /** The host's roster, or (older host) one we make out of the players we can see. */
  currentRoster() {
    const rows = this.roster.length ? this.roster.map((r) => r.slice()) : [[0, this.hostName(), 'survival', -1], ...[...this.remotes.values()].map((rp) => [rp.id, rp.name, 'survival', -1]), [this.id, this.name, 'survival', -1]];
    const me = rows.find((r) => r[0] === this.id);
    if (me) { me[3] = this.rtt; me[2] = GAMEMODE_LABEL[this.game.player.gamemode] ? this.game.player.gamemode : me[2]; }
    return rows;
  }

  sendChat(text) { this.send({ t: 'chat', m: text }); }
  sendSign(x, y, z, l) { this.send({ t: 'sign', x, y, z, l }); }
  sendFrame(x, y, z, st) { this.send({ t: 'frame', x, y, z, st }); }
  sendPot(x, y, z, f) { this.send({ t: 'pot', x, y, z, f }); }
  sendLectern(x, y, z, s) { this.send({ t: 'lectern', x, y, z, s }); }
  sendCampfire(x, y, z, s) { this.send({ t: 'camp', x, y, z, s }); }
  sendNote(x, y, z) { this.send({ t: 'note', x, y, z, d: this.game.world.dimension }); }
  /** Use the Vault at x,y,z with the held stack `st` (the host checks its ledger). */
  useVault(x, y, z, st) { this.send({ t: 'vault', x, y, z, st: st ? { id: st.id, count: 1 } : null }); }

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

  /** Something we did makes a vibration: the host's sensors listen (world/hushSystem.js emit). */
  sendVibration(k, x, y, z) { this.send({ t: 'vib', k, x, y, z }); }

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
    this.tickSpectate();
    const e = this.edits.take();
    if (e.length) this.send({ t: 'ed', e, d: this.game.world.dimension });
    if (this.ticks % 40 === 0 && this.hostSocial) this.send({ t: 'pg', ts: performance.now(), rtt: this.rtt, gm: this.game.player.gamemode });
    if (this.ticks % STATE_EVERY === 0 && this.ch.backlog() < BACKLOG_LIMIT) this.send({ t: 'st', s: this.ownState() }); // skip while our upload is behind
    if (this.ticks % PSAVE_EVERY === 0) { this.send({ t: 'ps', p: playerSaveData(this.game.player) }); this.stands.expire(performance.now()); }
    if (this.ticks % ENV_EVERY === 0) {
      const now = performance.now();
      this.ch.rate.tick(now); this.ch.rateIn.tick(now);
      if (now - this.lastSeen > TIMEOUT_MS) this.lost('Lost connection to the host (timed out)', true);
    }
  }

  debugLines() {
    return [`Net guest of ${this.hostName()}  ping ${this.rtt >= 0 ? this.rtt + ' ms' : '-'}  in ${rateText(this.ch.rateIn.bps)}  out ${rateText(this.ch.rate.bps)}  ${this.remotes.size + 1} players`];
  }

  /** Is the host still reachable? 'alive' | 'gone' (nobody has that room open any more) | 'unknown' (the signalling server or the network is the trouble). */
  async probeHost(transport = null) {
    try {
      const conn = await (transport || createTransport()).join(this.code, 6000);
      try { conn.close(); } catch { /* gone */ }
      return 'alive';
    } catch (e) {
      return /No world is open/i.test(String(e && e.message)) ? 'gone' : 'unknown';
    }
  }

  /**
   * Connection gone. `retry`: it dropped (not a kick, a ban or the host closing the world), so the screen offers to
   * reconnect - automatically after a moment, once the host is known to still be there - and keeps our place and belongings
   * for the rejoin. `opts.hostLeft`: the host closed the world (or has gone: a probe found no room): the screen says so and
   * offers to keep a copy of the world as we have it (net/session.js saveGuestCopy), which a rejoin would throw away.
   */
  lost(msg, retry = false, opts = {}) {
    if (this.closed) return;
    this.closed = true;
    console.warn('net: connection lost -', msg);
    if (this.warnEl) { this.warnEl.remove(); this.warnEl = null; }
    clearInterval(this.bgTimer); if (this.bgWorker) { this.bgWorker.terminate(); this.bgWorker = null; }
    try { this.ch && this.ch.close(); } catch { /* gone */ }
    if (!this.game) { if (this._fail) this._fail(new Error(msg)); return; }
    const g = this.game;
    g.running = false;
    g.input.unlock();
    g.ui.clear();
    g.ui.open = 'netlost';
    const canRetry = retry && this.code && g.hooks.reconnect;
    const s = document.createElement('div');
    s.className = 'screen';
    s.id = 'netlost';
    s.innerHTML = '<h2></h2><p class="sub net-msg"></p><p class="sub net-retry"></p>' +
      '<button class="btn hidden" data-a="now">Reconnect now</button>' +
      (opts.kick ? '' : '<button class="btn" data-a="save">Save a copy of this world</button>') +
      '<button class="btn" data-a="title">Back to Title Screen</button>';
    const head = s.querySelector('h2'), line = s.querySelector('.net-msg'), note = s.querySelector('.net-retry'), now = s.querySelector('[data-a=now]');
    const setHostLeft = (text) => { head.textContent = 'The host left'; line.textContent = text; note.textContent = 'What you built and found here is still on your screen: keep a copy of it as a world of your own.'; now.classList.add('hidden'); };
    head.textContent = opts.hostLeft ? 'The host left' : canRetry ? 'Connection lost' : 'Disconnected';
    line.textContent = msg;
    if (opts.hostLeft) setHostLeft(msg);
    s.querySelector('[data-a=title]').onclick = () => { if (this.retryTimer) clearInterval(this.retryTimer); this.lostGone = true; if (g.hooks.quit) g.hooks.quit(); };
    const saveBtn = s.querySelector('[data-a=save]');
    if (saveBtn) saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        const r = await saveGuestCopy(g, this.hostName());
        note.textContent = r ? `Saved as "${r.name}" - open it from the title screen.` : 'All world slots are in use: delete a world on the title screen first.';
        if (!r) saveBtn.disabled = false;
      } catch (e) { note.textContent = 'Could not save: ' + (e && e.message ? e.message : e); saveBtn.disabled = false; }
    };
    if (canRetry) {
      const resume = makeResume(this.code, this.name, g.world.dimension, playerSaveData(g.player), g.player.dead);
      const go = () => { clearInterval(this.retryTimer); g.hooks.reconnect(resume); };
      now.onclick = go;
      note.textContent = 'Checking whether the host is still there...';
      this.probeHost().then((state) => {
        if (this.lostGone) return;
        if (state === 'gone') { setHostLeft('The host closed the world, or their connection is gone.'); return; }
        now.classList.remove('hidden');
        let left = reconnectDelay(1);
        const show = () => { note.textContent = `Reconnecting in ${left} s - you will come back where you were`; };
        show();
        this.retryTimer = setInterval(() => { left--; if (left <= 0) go(); else show(); }, 1000);
      });
    }
    g.ui.layer.appendChild(s);
  }

  close() {
    if (this.closed) return;
    if (this.isClient) saveGuestGuide(guideOf(this.game.player.stats));
    try { this.send({ t: 'ps', p: playerSaveData(this.game.player) }); this.send({ t: 'bye' }); } catch { /* gone */ }
    this.closed = true;
    clearInterval(this.bgTimer); if (this.bgWorker) { this.bgWorker.terminate(); this.bgWorker = null; }
    if (this.game && this.game.world) this.game.world.passive = false;
    if (this.edits) this.edits.detach();
    if (this.ents) this.ents.clear();
    this.disposeRemotes();
    setTimeout(() => this.ch.close(), 300);
  }
}

/** Connect to a friend's world; resolves once the world data has arrived. */
export async function joinSession(code, name, onStatus, transport = createTransport(), opts = {}) {
  const s = new ClientSession(cleanName(name));
  s.code = code;
  s.resume = opts.resume || null; // coming back after a dropped link (net/social.js)
  return s.connect(transport, code, onStatus);
}


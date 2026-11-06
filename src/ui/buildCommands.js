// Creative building commands: a two-corner selection (the Surveyor Wand, /pos1 and /pos2), /fill, /replace,
// /replacenear, /clone, brushes (/sphere, /cyl, /line), /copy /cut /paste with /rotate and /flip, /undo and /redo,
// and named, shareable blueprints. The logic of patterns, shapes, the clipboard and the blueprint text is in
// world/buildTools.js; this file is the part that knows about players and the game.
//
// Who may build: creative players, ops and the host (and nobody at all when the world was made without cheats,
// which commands.js enforces for every command listed in CHEAT_COMMANDS). Guests send these commands to the host
// (net/protocol.js WORLD_COMMANDS) and the host runs them for the guest: `game.cmdActor` names who is asking.
//
// Every edit goes through world.setBlock, so it reaches the other players (net/editSync.js) and is saved with
// the chunk. A big edit is never done in one frame: it becomes a job that the BuildQueue works through a slice
// per tick (a time budget and a block budget), chunk by chunk, with a progress toast. Each job records what it
// replaced, so /undo and /redo are jobs too, over a bounded history.
import {
  DEFAULT_MAX_VOLUME, MAX_VOLUME_CAP, History, EditSet, Clipboard, parsePattern, parseMask, boxOf, boxSize, boxVolume,
  eachChunkMajor, sphereBox, inSphere, inDisc, lineCells, distToSegment, copyRegion, rotateClipboard, flipClipboard, planPaste,
  encodeBlueprint, decodeBlueprint, cleanBlueprintName, cleanBlueprints, cleanTile, peekBlueprint,
  BLUEPRINT_MAX_COUNT, BLUEPRINT_MAX_VOLUME, BLUEPRINT_TOTAL_TEXT, BLUEPRINT_MAX_TEXT, BLUEPRINT_PREFIX, BLUEPRINT_NAME_MAX,
} from '../world/buildTools.js';
import { B } from '../world/blocks.js';
import { I } from '../world/items.js';
import { MIN_Y, MAX_Y } from '../world/constants.js';

/** Commands this file runs (commands.js sends them here; net/protocol.js lists the world-changing ones for guests). */
export const BUILD_COMMANDS = new Set([
  'wand', 'pos1', 'pos2', 'sel', 'fill', 'replace', 'replacenear', 'clone', 'undo', 'redo', 'copy', 'cut', 'paste', 'rotate', 'flip', 'mirror',
  'blueprint', 'bp', 'sphere', 'cyl', 'line', 'build',
]);
/** The ones that only change a player's own selection: a guest also runs them at home so the wireframe shows. */
export const SELECTION_COMMANDS = new Set(['pos1', 'pos2', 'sel']);

export const SLICE_MS = 6;          // time one tick may spend applying edits
export const SLICE_CELLS = 8192;    // and the most blocks it may touch
const MAX_JOBS = 6;                 // edits being worked on at once, all players together
const NOTIFY_BELOW = 256;           // edits this small tell their neighbours (torches pop off, water flows); bigger ones do not
const fmt = (n) => Number(n).toLocaleString('en-US');
const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;

// ---- who is asking ----------------------------------------------------------------------------
/** The local player as an actor (single player, or the host typing). */
export function localActor(game) {
  const p = game.player, net = game.net;
  return {
    key: '#host', name: net && net.name ? net.name : 'You', host: !net || !net.isClient, op: !net || !net.isClient,
    get creative() { return p.gamemode === 'creative'; },
    pos: () => ({ x: p.x, y: p.y, z: p.z }),
    look: () => (p.lookDir ? p.lookDir() : [0, 0, -1]),
    say(lines) { if (game.chat) for (const l of [].concat(lines)) game.chat.add(l); },
    toast(msg) { if (game.hud && game.hud.toast) game.hud.toast(msg, 900); },
  };
}
const actorOf = (game) => game.cmdActor || localActor(game);

function stateOf(game, actor) {
  if (!game.buildStates) game.buildStates = new Map();
  let s = game.buildStates.get(actor.key);
  if (!s) { s = { pos1: null, pos2: null, clip: null, history: new History(), job: null }; game.buildStates.set(actor.key, s); }
  return s;
}
/** The selection the local viewer should see outlined: { pos1, pos2, dim } (either corner may be null). */
export function selectionOf(game) {
  const st = game.net && game.net.isClient ? game.localSel : game.buildStates && game.buildStates.get('#host');
  return st || null;
}

/** The player's saved blueprints ({ name: text }). */
function blueprintsOf(game, actor) {
  if (actor.key === '#host') { if (!game.player.blueprints) game.player.blueprints = {}; return game.player.blueprints; }
  if (!game.guestBlueprints) game.guestBlueprints = {};
  if (!game.guestBlueprints[actor.key]) game.guestBlueprints[actor.key] = {};
  return game.guestBlueprints[actor.key];
}

export function maxVolumeOf(game) {
  const v = game.settings && game.settings.maxBuildVolume;
  return Number.isFinite(v) ? Math.max(1, Math.min(MAX_VOLUME_CAP, Math.floor(v))) : DEFAULT_MAX_VOLUME;
}
const canBuild = (a) => !!(a.host || a.op || a.creative);
const blockAt = (a) => { const p = a.pos(); return { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) }; };

// ---- block entity data (chests, signs, frames, pots) ------------------------------------------
const key3 = (x, y, z) => `${x},${y},${z}`;
const copy = (o) => JSON.parse(JSON.stringify(o));
/** What is stored beside the block at x,y,z, as a tile (see world/buildTools.js cleanTile), or null. */
export function readTile(game, x, y, z) {
  const k = key3(x, y, z);
  const c = game.chests && game.chests.get(k);
  if (c && c.slots) return { k: 'chest', slots: copy(c.slots) };
  const s = game.signs && game.signs.get(k);
  if (s) return { k: 'sign', lines: s.slice(0, 4) };
  const f = game.frames && game.frames.get(k);
  if (f) return { k: 'frame', st: copy(f) };
  const p = game.pots && game.pots.get(k);
  if (p) return { k: 'pot', faces: p.slice() };
  return null;
}
function clearTile(game, x, y, z) {
  const k = key3(x, y, z);
  if (game.chests) game.chests.delete(k);
  if (game.signs) game.signs.delete(k);
  if (game.frames && game.frames.has(k)) game.setFrameItem ? game.setFrameItem(x, y, z, null) : game.frames.delete(k);
  if (game.pots && game.pots.has(k)) game.setPot ? game.setPot(x, y, z, null) : game.pots.delete(k);
}
function writeTile(game, x, y, z, tile) {
  const t = cleanTile(tile);
  if (!t) return;
  if (t.k === 'chest') game.chests.set(key3(x, y, z), { x, y, z, slots: t.slots });
  else if (t.k === 'sign') { if (game.setSignText) game.setSignText(x, y, z, t.lines); else game.signs.set(key3(x, y, z), t.lines); }
  else if (t.k === 'frame') { if (game.setFrameItem) game.setFrameItem(x, y, z, t.st); else game.frames.set(key3(x, y, z), t.st); }
  else if (t.k === 'pot') { if (game.setPot) game.setPot(x, y, z, t.faces); else game.pots.set(key3(x, y, z), t.faces); }
}

// ---- the work queue ----------------------------------------------------------------------------
/**
 * Applies edit lists a slice per tick. One job per player at a time. A job is a list of EditSets to apply
 * (a normal edit has one; /undo 3 has three) and the record of what they replaced, which becomes the next
 * undo (or redo) step. Undo and redo sets are applied last cell first, so a cell edited twice comes back right.
 */
export class BuildQueue {
  constructor(game) { this.game = game; this.jobs = []; this.sliceMs = SLICE_MS; this.sliceCells = SLICE_CELLS; this.firstSliceMs = 4; }
  get busy() { return this.jobs.length; }

  /**
   * Start a job. `sets`: edit lists; `mode`: 'edit' | 'undo' | 'redo'; `verb`: "Filled". Works the first slice at once and
   * returns the final message when that finishes it, or a "working on it" message (the rest follows in chat).
   */
  start(actor, st, { sets, mode = 'edit', verb = 'Changed', skipped = 0, label = 'Building' }) {
    if (st.job) return `You are still ${st.job.label.toLowerCase()} (${Math.floor(100 * st.job.progress())}%): wait for it, or /build cancel`;
    if (this.jobs.length >= MAX_JOBS) return 'The world is busy with other builders\' edits: try again in a moment';
    const total = sets.reduce((n, s) => n + s.n, 0);
    const job = {
      actor, st, mode, verb, label, sets, si: 0, cursor: mode === 'edit' ? 0 : sets[0].n - 1, total, done: 0, changed: 0, skipped, unloaded: 0,
      records: [], rec: null, dim: this.game.world.dimension, notify: total <= NOTIFY_BELOW, lastToast: 0, startTick: this.game.ticks || 0,
      progress() { return this.total ? Math.min(1, this.done / this.total) : 1; },
    };
    job.rec = new EditSet(Math.min(Math.max(16, sets[0].n), 1 << 16));
    st.job = job;
    this.jobs.push(job);
    const result = this.work(job, Math.min(this.sliceMs, this.firstSliceMs), this.sliceCells);
    if (result) return result;
    return `${label} ${plural(total, 'block')}: ${fmt(Math.floor(100 * job.progress()))}% so far, the rest follows over the next moments`;
  }

  /** Work every job for this tick, sharing the time budget. */
  tick() {
    if (!this.jobs.length) return;
    const ms = this.sliceMs / this.jobs.length, cells = Math.max(1, Math.floor(this.sliceCells / this.jobs.length));
    for (const job of [...this.jobs]) {
      const msg = this.work(job, ms, cells);
      if (msg) job.actor.say(msg);
      else if (job.total > 4096 && (this.game.ticks || 0) - job.lastToast >= 10) {
        job.lastToast = this.game.ticks || 0;
        job.actor.toast(`${job.label}... ${Math.floor(100 * job.progress())}%`);
      }
    }
  }

  /** Run all work to the end at once (tests, and a world that is closing). */
  drain() { let guard = 0; while (this.jobs.length && guard++ < 1e6) this.tick(); }

  /** Cancel a player's job; what was done so far stays and can be undone. */
  cancel(st) {
    const job = st.job;
    if (!job) return 'Nothing is being built';
    if (job.mode !== 'edit') return 'An undo or redo cannot be stopped half way: it will be over in a moment';
    return this.finish(job, 'Stopped after');
  }

  /** Apply cells until the budget is spent; returns the final message when the job is over. */
  work(job, ms, maxCells) {
    const g = this.game, w = g.world;
    if (w.dimension !== job.dim) return this.finish(job, 'Stopped (you changed dimension) after');
    const t0 = performance.now();
    let n = 0;
    while (job.si < job.sets.length) {
      const set = job.sets[job.si], rev = job.mode !== 'edit';
      while (rev ? job.cursor >= 0 : job.cursor < set.n) {
        const i = rev ? job.cursor-- : job.cursor++;
        job.done++;
        this.applyCell(job, set, i);
        if (++n >= maxCells || ((n & 63) === 0 && performance.now() - t0 > ms)) return null;
      }
      job.records.push(job.rec);
      job.si++;
      if (job.si < job.sets.length) { job.cursor = rev ? job.sets[job.si].n - 1 : 0; job.rec = new EditSet(Math.min(Math.max(16, job.sets[job.si].n), 1 << 16)); }
    }
    return this.finish(job, job.verb);
  }

  applyCell(job, set, i) {
    const g = this.game, w = g.world, x = set.x[i], y = set.y[i], z = set.z[i], id = set.id[i], meta = set.meta[i];
    if (!w.isLoaded(x, z)) { job.unloaded++; return; }
    const oid = w.getBlock(x, y, z), om = w.getMeta(x, y, z), tile = set.tiles.get(i) || null;
    const same = oid === id && om === meta;
    if (same && !tile) return;
    const old = readTile(g, x, y, z);
    if (!same && !w.setBlock(x, y, z, id, meta, job.notify)) { if (!w.isLoaded(x, z)) job.unloaded++; return; }
    if (old && oid !== id) clearTile(g, x, y, z);
    if (tile) writeTile(g, x, y, z, tile);
    job.rec.add(x, y, z, oid, om, old && (oid !== id || tile) ? old : null);
    job.changed++;
  }

  finish(job, verb) {
    const st = job.st, g = this.game;
    this.jobs.splice(this.jobs.indexOf(job), 1);
    st.job = null;
    if (job.rec && !job.records.includes(job.rec)) job.records.push(job.rec);
    // what the job replaced becomes the opposite step: an edit is undone by it, an undo is redone by it
    const hist = st.history;
    let kept = true;
    if (job.mode === 'edit') { if (job.records[0] && job.records[0].n) kept = hist.push(job.records[0]); }
    else for (const r of job.records) if (r.n) (job.mode === 'undo' ? hist.pushRedo(r) : hist.pushUndo(r));
    let msg = `${verb} ${plural(job.changed, 'block')}`;
    if (job.skipped + job.unloaded) msg += `, ${fmt(job.skipped + job.unloaded)} left alone in unloaded chunks`;
    if (job.mode === 'edit') msg += !job.changed ? '' : kept ? ' (/undo to take it back)' : ' (too big to undo)';
    if (job.total > 4096) job.actor.toast(msg);
    return msg;
  }
}

function queueOf(game) { if (!game.buildQueue) game.buildQueue = new BuildQueue(game); return game.buildQueue; }

// ---- helpers -----------------------------------------------------------------------------------
function selectionBox(game, st) {
  const dim = game.world.dimension;
  if (!st.pos1 || !st.pos2) return { error: 'Select two corners first: /pos1 and /pos2, or left and right click with a Surveyor Wand (/wand)' };
  if (st.pos1.dim !== dim || st.pos2.dim !== dim) return { error: 'Your selection is in another dimension' };
  return { box: boxOf(st.pos1, st.pos2) };
}
function checkVolume(game, box, what = 'That') {
  const v = boxVolume(box), max = maxVolumeOf(game);
  if (v > max) return `${what} is ${fmt(v)} blocks: more than the limit of ${fmt(max)} (/gamerule maxBuildVolume)`;
  return null;
}
const loadedFn = (world) => (cx, cz) => world.isChunkLoaded(cx, cz);
function hasUnloaded(box, loaded) {
  for (let cx = box.x0 >> 4; cx <= box.x1 >> 4; cx++) for (let cz = box.z0 >> 4; cz <= box.z1 >> 4; cz++) if (!loaded(cx, cz)) return true;
  return false;
}

/** "5", "~", "~-2" relative to a base. */
function coordArg(s, base) {
  if (s === undefined) return NaN;
  if (s.startsWith('~')) return base + (s.length > 1 ? Number(s.slice(1)) : 0);
  return Number(s);
}
function flagsOf(args) {
  const flags = new Set(), rest = [];
  for (const a of args) { if (/^-[a-z]$/i.test(a)) flags.add(a[1].toLowerCase()); else rest.push(a); }
  return { flags, rest };
}

/** Run a plan (an EditSet) as a job. */
function launch(game, c, edits, verb, label, skipped = 0) {
  if (!edits.n) return skipped ? `${plural(skipped, 'block')} of that are in unloaded chunks: go closer first` : 'Nothing to change';
  return queueOf(game).start(c.actor, c.st, { sets: [edits], verb, label, skipped });
}

// ---- the commands -------------------------------------------------------------------------------
const USAGE = {
  fill: 'Usage: /fill <block or pattern> [hollow|outline|walls]   (blocks: stone, oak_planks, "60%stone,40%dirt")',
  replace: 'Usage: /replace <from> <to>   (from: a block, a list "stone,dirt", "!air" for everything else, or *)',
  replacenear: 'Usage: /replacenear <radius> <from> <to>',
  clone: 'Usage: /clone <x> <y> <z> [replace|masked|filtered <mask>] [move|copy] [-c]   (x y z: where the selection\'s lowest corner goes, ~ for relative)',
  sphere: 'Usage: /sphere <block> <radius> [hollow] [-p]   (-p: centre on corner 1)',
  cyl: 'Usage: /cyl <block> <radius> [height] [hollow] [-p]   (a negative height builds downwards)',
  line: 'Usage: /line <block> [thickness]   (from corner 1 to corner 2)',
  rotate: 'Usage: /rotate <90|180|270>   (turns the copied clipboard clockwise around where you copied it)',
  flip: 'Usage: /flip <x|y|z>   (mirrors the clipboard)',
  blueprint: 'Usage: /blueprint save <name> [-c],  load <name>,  list,  delete <name>,  export <name>,  import <name> [text|clipboard]   (-c keeps chest contents)',
};

export function runBuildCommand(game, cmd, args) {
  const actor = actorOf(game), st = stateOf(game, actor);
  const c = { game, actor, st, world: game.world };
  if (cmd === 'bp') cmd = 'blueprint';
  if (cmd === 'mirror') cmd = 'flip';
  if (cmd === 'wand') return giveWand(c);
  if (!canBuild(actor)) return 'The building tools are for creative players, ops and the host: switch with /gamemode creative';
  switch (cmd) {
    case 'pos1': case 'pos2': return setCorner(c, cmd === 'pos1' ? 1 : 2, args);
    case 'sel': return selCommand(c, args);
    case 'fill': return fillCommand(c, args);
    case 'replace': return replaceCommand(c, args);
    case 'replacenear': return replaceNear(c, args);
    case 'clone': return cloneCommand(c, args);
    case 'sphere': return sphereCommand(c, args);
    case 'cyl': return cylCommand(c, args);
    case 'line': return lineCommand(c, args);
    case 'copy': case 'cut': return copyCommand(c, args, cmd === 'cut');
    case 'paste': return pasteCommand(c, args);
    case 'rotate': return rotateCommand(c, args);
    case 'flip': return flipCommand(c, args);
    case 'undo': case 'redo': return undoCommand(c, cmd, args);
    case 'blueprint': return blueprintCommand(c, args);
    case 'build': return buildCommand(c, args);
    default: return null;
  }
}

function giveWand(c) {
  const { game, actor } = c;
  if (game.cmdActor) return 'Run /wand in your own game to get the Surveyor Wand';
  if (!canBuild(actor)) return 'The Surveyor Wand is for creative players, ops and the host: switch with /gamemode creative';
  const inv = game.player.inventory;
  if (inv.slots.some((s) => s && s.id === I.SURVEYOR_WAND)) return 'You already have a Surveyor Wand';
  if (inv.add({ id: I.SURVEYOR_WAND, count: 1, damage: 0 })) return 'Your bag is full';
  return 'Gave a Surveyor Wand: left click marks corner 1, right click corner 2';
}

// -- selection
export function setCorner(c, which, args) {
  const { game, st, actor } = c;
  const base = blockAt(actor);
  let p;
  if (args.length >= 3) {
    p = { x: Math.floor(coordArg(args[0], base.x)), y: Math.floor(coordArg(args[1], base.y)), z: Math.floor(coordArg(args[2], base.z)) };
    if (![p.x, p.y, p.z].every(Number.isFinite)) return `Usage: /pos${which} [x y z]`;
  } else p = base;
  if (p.y < MIN_Y || p.y > MAX_Y) return 'That is outside the world';
  if (Math.abs(p.x) > 3e7 || Math.abs(p.z) > 3e7) return 'That is outside the world';
  st['pos' + which] = { ...p, dim: game.world.dimension };
  const other = st[which === 1 ? 'pos2' : 'pos1'];
  let msg = `Corner ${which} set to ${p.x}, ${p.y}, ${p.z}`;
  if (other && other.dim === game.world.dimension) {
    const box = boxOf(st.pos1, st.pos2);
    msg += `  (${boxSize(box).join(' x ')} = ${plural(boxVolume(box), 'block')})`;
  }
  return msg;
}

const DIRS = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };
function dirArg(name, actor) {
  const n = (name || 'me').toLowerCase();
  if (DIRS[n]) return DIRS[n];
  if (n === 'me' || n === 'look' || n === 'forward') {
    const [x, y, z] = actor.look(), ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ay > ax && ay > az) return [0, Math.sign(y), 0];
    return ax > az ? [Math.sign(x), 0, 0] : [0, 0, Math.sign(z) || -1];
  }
  return null;
}

function selCommand(c, args) {
  const { game, st, actor } = c;
  const sub = (args[0] || 'info').toLowerCase();
  if (sub === 'clear' || sub === 'none') { st.pos1 = st.pos2 = null; return 'Selection cleared'; }
  const sel = selectionBox(game, st);
  if (sub === 'info' || sub === 'query') {
    if (sel.error) return st.pos1 || st.pos2 ? `Selection: corner 1 ${st.pos1 ? [st.pos1.x, st.pos1.y, st.pos1.z].join(', ') : 'not set'}, corner 2 ${st.pos2 ? [st.pos2.x, st.pos2.y, st.pos2.z].join(', ') : 'not set'}` : sel.error;
    const b = sel.box;
    return `Selection ${b.x0}, ${b.y0}, ${b.z0} to ${b.x1}, ${b.y1}, ${b.z1}: ${boxSize(b).join(' x ')} = ${plural(boxVolume(b), 'block')} (limit ${fmt(maxVolumeOf(game))})`;
  }
  if (!['expand', 'contract', 'shift'].includes(sub)) return 'Usage: /sel [info],  /sel clear,  /sel expand|contract|shift <blocks> [up|down|north|south|east|west|me]';
  if (sel.error) return sel.error;
  const n = Math.floor(Number(args[1]));
  if (!Number.isFinite(n) || n < 0 || n > 4096) return 'Usage: /sel expand|contract|shift <blocks> [direction]';
  const d = dirArg(args[2], actor);
  if (!d) return 'Directions: up, down, north, south, east, west, me';
  const b = { ...sel.box };
  const ax = d[0] ? 'x' : d[1] ? 'y' : 'z', s = d[0] + d[1] + d[2], lo = ax + '0', hi = ax + '1';
  if (sub === 'shift') { b[lo] += s * n; b[hi] += s * n; }
  else if (sub === 'expand') { if (s > 0) b[hi] += n; else b[lo] -= n; }
  else { if (b[hi] - b[lo] < n) return 'That would shrink the selection to nothing'; if (s > 0) b[hi] -= n; else b[lo] += n; } // (the face that points that way moves in)
  b.y0 = Math.max(MIN_Y, b.y0); b.y1 = Math.min(MAX_Y, b.y1);
  const dim = game.world.dimension;
  st.pos1 = { x: b.x0, y: b.y0, z: b.z0, dim }; st.pos2 = { x: b.x1, y: b.y1, z: b.z1, dim };
  return `Selection is now ${boxSize(b).join(' x ')} = ${plural(boxVolume(b), 'block')}`;
}

// -- fill, replace
function fillCommand(c, args) {
  const { game, st, world } = c;
  if (!args.length) return USAGE.fill;
  const pat = parsePattern(args[0]);
  if (pat.error) return pat.error;
  const mode = (args[1] || 'solid').toLowerCase();
  if (!['solid', 'hollow', 'outline', 'walls'].includes(mode)) return USAGE.fill;
  const sel = selectionBox(game, st);
  if (sel.error) return sel.error;
  const bad = checkVolume(game, sel.box, 'That selection');
  if (bad) return bad;
  const b = sel.box, edits = new EditSet(Math.min(boxVolume(b), 1 << 16));
  const skipped = eachChunkMajor(b, loadedFn(world), (x, y, z) => {
    const shell = x === b.x0 || x === b.x1 || y === b.y0 || y === b.y1 || z === b.z0 || z === b.z1;
    if (mode === 'walls' && !(x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1)) return;
    if (mode === 'outline' && !shell) return;
    if (mode === 'hollow' && !shell) { edits.add(x, y, z, 0, 0); return; }
    const [id, meta] = pat.pick(x, y, z);
    edits.add(x, y, z, id, meta);
  });
  return launch(game, c, edits, 'Filled', 'Filling', skipped);
}

function replaceCommand(c, args) {
  const { game, st, world } = c;
  if (args.length < 2) return USAGE.replace;
  const mask = parseMask(args[0]), pat = parsePattern(args[1]);
  if (mask.error) return mask.error;
  if (pat.error) return pat.error;
  const sel = selectionBox(game, st);
  if (sel.error) return sel.error;
  const bad = checkVolume(game, sel.box, 'That selection');
  if (bad) return bad;
  const plan = planReplace(world, sel.box, mask, pat);
  return launch(game, c, plan.edits, 'Replaced', 'Replacing', plan.skipped);
}
function planReplace(world, box, mask, pat) {
  const edits = new EditSet(1024);
  const skipped = eachChunkMajor(box, loadedFn(world), (x, y, z) => {
    if (!mask.test(world.getBlock(x, y, z), world.getMeta(x, y, z))) return;
    const [id, meta] = pat.pick(x, y, z);
    edits.add(x, y, z, id, meta);
  });
  return { edits, skipped };
}

function replaceNear(c, args) {
  const { game, actor, world } = c;
  if (args.length < 3) return USAGE.replacenear;
  const r = Math.floor(Number(args[0]));
  if (!(r >= 1 && r <= 256)) return 'The radius is 1 to 256 blocks';
  const mask = parseMask(args[1]), pat = parsePattern(args[2]);
  if (mask.error) return mask.error;
  if (pat.error) return pat.error;
  const at = blockAt(actor), box = boxOf({ x: at.x - r, y: at.y - r, z: at.z - r }, { x: at.x + r, y: at.y + r, z: at.z + r });
  const bad = checkVolume(game, box, `A radius of ${r}`);
  if (bad) return bad;
  const plan = planReplace(world, box, mask, pat);
  return launch(game, c, plan.edits, 'Replaced', 'Replacing', plan.skipped);
}

// -- clone
function cloneCommand(c, args) {
  const { game, st, world, actor } = c;
  const { flags, rest } = flagsOf(args);
  if (rest.length < 3) return USAGE.clone;
  const base = blockAt(actor);
  const dest = { x: Math.floor(coordArg(rest[0], base.x)), y: Math.floor(coordArg(rest[1], base.y)), z: Math.floor(coordArg(rest[2], base.z)) };
  if (![dest.x, dest.y, dest.z].every(Number.isFinite)) return USAGE.clone;
  let mode = 'replace', move = false, mask = null;
  for (let i = 3; i < rest.length; i++) {
    const w = rest[i].toLowerCase();
    if (w === 'replace' || w === 'masked') mode = w;
    else if (w === 'filtered') { mask = parseMask(rest[++i]); if (mask.error) return mask.error; mode = 'filtered'; }
    else if (w === 'move') move = true;
    else if (w === 'copy' || w === 'normal') move = false;
    else return USAGE.clone;
  }
  const sel = selectionBox(game, st);
  if (sel.error) return sel.error;
  const bad = checkVolume(game, sel.box, 'That selection');
  if (bad) return bad;
  const b = sel.box, [w, h, l] = boxSize(b);
  const dx = dest.x - b.x0, dy = dest.y - b.y0, dz = dest.z - b.z0;
  if (dest.y < MIN_Y || dest.y + h - 1 > MAX_Y) return 'The copy would stick out of the world';
  // read the source first (the two boxes may overlap), then lay it down
  const src = copyRegion(world, b, { x: b.x0, y: b.y0, z: b.z0 }, (x, y, z) => readTile(game, x, y, z));
  const picked = (i) => {
    const id = src.ids[i];
    if (mode === 'masked') return id !== 0;
    if (mode === 'filtered') return mask.test(id, src.metas[i]);
    return true;
  };
  const edits = new EditSet(Math.min(src.volume * (move ? 2 : 1), 1 << 16));
  let skipped = 0;
  const loaded = loadedFn(world);
  if (move) {
    skipped += eachChunkMajor(b, loaded, (x, y, z) => { if (picked(src.index(x - b.x0, y - b.y0, z - b.z0))) edits.add(x, y, z, 0, 0); });
  }
  const dbox = { x0: b.x0 + dx, y0: b.y0 + dy, z0: b.z0 + dz, x1: b.x1 + dx, y1: b.y1 + dy, z1: b.z1 + dz };
  skipped += eachChunkMajor(dbox, loaded, (x, y, z) => {
    const i = src.index(x - dbox.x0, y - dbox.y0, z - dbox.z0);
    if (!picked(i)) return;
    let tile = src.tiles.get(i) || null, meta = src.metas[i];
    if (tile && tile.k === 'chest' && !flags.has('c')) { tile = null; if (src.ids[i] === B.CHEST) meta &= 3 | 4 | 128; }
    edits.add(x, y, z, src.ids[i], meta, tile);
  });
  return launch(game, c, edits, move ? 'Moved' : 'Cloned', move ? 'Moving' : 'Cloning', skipped);
}

// -- brushes
function brushCenter(c, flags) {
  const { game, st, actor } = c;
  if (!flags.has('p')) return blockAt(actor);
  if (!st.pos1 || st.pos1.dim !== game.world.dimension) return null;
  return st.pos1;
}
function sphereCommand(c, args) {
  const { game, world } = c;
  const { flags, rest } = flagsOf(args);
  if (rest.length < 2) return USAGE.sphere;
  const pat = parsePattern(rest[0]);
  if (pat.error) return pat.error;
  const r = Number(rest[1]);
  if (!(r >= 0.5 && r <= 256)) return 'The radius is 0.5 to 256 blocks';
  const hollow = rest.slice(2).some((w) => w.toLowerCase() === 'hollow') || flags.has('h');
  const ctr = brushCenter(c, flags);
  if (!ctr) return 'Set corner 1 first (-p centres on it)';
  const box = sphereBox(ctr.x, ctr.y, ctr.z, r);
  const bad = checkVolume(game, box, `A sphere of radius ${r}`);
  if (bad) return bad;
  const inside = (x, y, z) => inSphere(x - ctr.x, y - ctr.y, z - ctr.z, r);
  const edits = new EditSet(1024);
  const skipped = eachChunkMajor(box, loadedFn(world), (x, y, z) => {
    if (!inside(x, y, z)) return;
    if (hollow && inside(x + 1, y, z) && inside(x - 1, y, z) && inside(x, y + 1, z) && inside(x, y - 1, z) && inside(x, y, z + 1) && inside(x, y, z - 1)) return;
    const [id, meta] = pat.pick(x, y, z);
    edits.add(x, y, z, id, meta);
  });
  return launch(game, c, edits, 'Built', 'Building', skipped);
}
function cylCommand(c, args) {
  const { game, world } = c;
  const { flags, rest } = flagsOf(args);
  if (rest.length < 2) return USAGE.cyl;
  const pat = parsePattern(rest[0]);
  if (pat.error) return pat.error;
  const r = Number(rest[1]);
  if (!(r >= 0.5 && r <= 256)) return 'The radius is 0.5 to 256 blocks';
  let height = 1, hollow = flags.has('h');
  for (const w of rest.slice(2)) { if (w.toLowerCase() === 'hollow') hollow = true; else if (/^-?\d+$/.test(w)) height = Number(w); else return USAGE.cyl; }
  if (!height || Math.abs(height) > 512) return 'The height is 1 to 512 blocks (negative builds downwards)';
  const ctr = brushCenter(c, flags);
  if (!ctr) return 'Set corner 1 first (-p centres on it)';
  const n = Math.ceil(r), y0 = height > 0 ? ctr.y : ctr.y + height + 1, y1 = height > 0 ? ctr.y + height - 1 : ctr.y;
  const box = boxOf({ x: ctr.x - n, y: y0, z: ctr.z - n }, { x: ctr.x + n, y: y1, z: ctr.z + n });
  const bad = checkVolume(game, box, `A cylinder of radius ${r}`);
  if (bad) return bad;
  const inside = (x, z) => inDisc(x - ctr.x, z - ctr.z, r);
  const edits = new EditSet(1024);
  const skipped = eachChunkMajor(box, loadedFn(world), (x, y, z) => {
    if (!inside(x, z)) return;
    if (hollow && inside(x + 1, z) && inside(x - 1, z) && inside(x, z + 1) && inside(x, z - 1)) return;
    const [id, meta] = pat.pick(x, y, z);
    edits.add(x, y, z, id, meta);
  });
  return launch(game, c, edits, 'Built', 'Building', skipped);
}
function lineCommand(c, args) {
  const { game, st, world } = c;
  if (!args.length) return USAGE.line;
  const pat = parsePattern(args[0]);
  if (pat.error) return pat.error;
  const t = args[1] === undefined ? 1 : Math.floor(Number(args[1]));
  if (!(t >= 1 && t <= 16)) return 'The thickness is 1 to 16 blocks';
  const sel = selectionBox(game, st);
  if (sel.error) return sel.error;
  const a = st.pos1, b = st.pos2;
  const edits = new EditSet(256);
  let skipped = 0;
  if (t === 1) {
    const bad = checkVolume(game, sel.box, 'That line\'s box');
    if (bad) return bad;
    const loaded = loadedFn(world);
    for (const [x, y, z] of lineCells(a, b)) {
      if (!loaded(x >> 4, z >> 4)) { skipped++; continue; }
      const [id, meta] = pat.pick(x, y, z);
      edits.add(x, y, z, id, meta);
    }
  } else {
    const pad = Math.ceil(t / 2), box = boxOf({ x: sel.box.x0 - pad, y: sel.box.y0 - pad, z: sel.box.z0 - pad }, { x: sel.box.x1 + pad, y: sel.box.y1 + pad, z: sel.box.z1 + pad });
    const bad = checkVolume(game, box, 'That line\'s box');
    if (bad) return bad;
    skipped = eachChunkMajor(box, loadedFn(world), (x, y, z) => {
      if (distToSegment(x, y, z, a, b) > (t - 1) / 2 + 0.3) return;
      const [id, meta] = pat.pick(x, y, z);
      edits.add(x, y, z, id, meta);
    });
  }
  return launch(game, c, edits, 'Built', 'Building', skipped);
}

// -- clipboard
function copyCommand(c, args, cut) {
  const { game, st, world, actor } = c;
  const sel = selectionBox(game, st);
  if (sel.error) return sel.error;
  const bad = checkVolume(game, sel.box, 'That selection');
  if (bad) return bad;
  const b = sel.box, origin = blockAt(actor);
  const loaded = loadedFn(world);
  if (hasUnloaded(b, loaded)) return 'Part of the selection is in unloaded chunks: go closer first';
  st.clip = copyRegion(world, b, origin, (x, y, z) => readTile(game, x, y, z));
  const info = `${boxSize(b).join(' x ')} copied (${plural(st.clip.solid, 'block')}); /paste puts it where you stand`;
  if (!cut) return info;
  const edits = new EditSet(1024);
  eachChunkMajor(b, loaded, (x, y, z) => { if (world.getBlock(x, y, z)) edits.add(x, y, z, 0, 0); });
  const r = launch(game, c, edits, 'Cut', 'Cutting');
  return `${info}\n${r}`.split('\n');
}

function pasteCommand(c, args) {
  const { game, st, world, actor } = c;
  if (!st.clip) return 'Nothing is copied: select, then /copy (or /blueprint load <name>)';
  const { flags, rest } = flagsOf(args);
  const base = blockAt(actor);
  let at = base;
  if (rest.length >= 3) {
    at = { x: Math.floor(coordArg(rest[0], base.x)), y: Math.floor(coordArg(rest[1], base.y)), z: Math.floor(coordArg(rest[2], base.z)) };
    if (![at.x, at.y, at.z].every(Number.isFinite)) return 'Usage: /paste [-a] [-c] [x y z]';
  }
  const max = maxVolumeOf(game);
  if (st.clip.volume > max) return `That is ${fmt(st.clip.volume)} blocks: more than the limit of ${fmt(max)} (/gamerule maxBuildVolume)`;
  const { edits, skipped } = planPaste(st.clip, at, { skipAir: flags.has('a'), contents: flags.has('c'), loaded: loadedFn(world) });
  return launch(game, c, edits, 'Pasted', 'Pasting', skipped);
}

function rotateCommand(c, args) {
  const { st } = c;
  if (!st.clip) return 'Nothing is copied: /copy first';
  const w = (args[0] || '').toLowerCase();
  const deg = w === 'left' ? -90 : w === 'right' ? 90 : Number(w);
  if (!Number.isFinite(deg) || deg % 90 !== 0 || !deg) return USAGE.rotate;
  st.clip = rotateClipboard(st.clip, deg / 90);
  return `Clipboard turned ${((deg % 360) + 360) % 360} degrees: now ${st.clip.w} x ${st.clip.h} x ${st.clip.l}`;
}
function flipCommand(c, args) {
  const { st, actor } = c;
  if (!st.clip) return 'Nothing is copied: /copy first';
  let a = (args[0] || '').toLowerCase();
  if (a === 'up' || a === 'down') a = 'y';
  else if (a === 'north' || a === 'south') a = 'z';
  else if (a === 'east' || a === 'west') a = 'x';
  else if (a === 'me' || a === 'look') { const d = dirArg('me', actor); a = d[0] ? 'x' : d[1] ? 'y' : 'z'; }
  if (!['x', 'y', 'z'].includes(a)) return USAGE.flip;
  st.clip = flipClipboard(st.clip, a);
  return `Clipboard mirrored across ${a}`;
}

// -- undo and redo
function undoCommand(c, cmd, args) {
  const { game, st } = c;
  const n = args[0] === undefined ? 1 : Math.floor(Number(args[0]));
  if (!(n >= 1 && n <= 20)) return `Usage: /${cmd} [steps]  (1 to 20)`;
  if (st.job) return 'Wait for the current edit to finish (or /build cancel) first';
  const undo = cmd === 'undo', sets = [];
  for (let i = 0; i < n; i++) { const s = undo ? st.history.takeUndo() : st.history.takeRedo(); if (!s) break; sets.push(s); }
  if (!sets.length) return undo ? 'Nothing to undo' : 'Nothing to redo';
  return queueOf(game).start(c.actor, st, { sets, mode: undo ? 'undo' : 'redo', verb: undo ? 'Undid' : 'Redid', label: undo ? 'Undoing' : 'Redoing' });
}

function buildCommand(c, args) {
  const { game, st } = c;
  const sub = (args[0] || 'status').toLowerCase();
  const q = queueOf(game);
  if (sub === 'cancel' || sub === 'stop') return q.cancel(st);
  if (sub === 'status') {
    const h = st.history;
    const job = st.job ? `${st.job.label}: ${Math.floor(100 * st.job.progress())}% of ${plural(st.job.total, 'block')}. ` : 'No edit is running. ';
    return `${job}History: ${h.undo.length} undo, ${h.redo.length} redo step${h.undo.length + h.redo.length === 1 ? '' : 's'} (${fmt(h.cells())} blocks). Limit per edit: ${fmt(maxVolumeOf(game))} blocks.`;
  }
  return 'Usage: /build status,  /build cancel';
}

// -- blueprints
/** Where blueprint files and text go: a download and the clipboard in a browser, the text itself elsewhere. */
export const blueprintIO = {
  exportText(name, text) {
    let did = [];
    try {
      if (typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        a.download = `${name}.scbp`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        did.push(`saved as ${name}.scbp`);
      }
    } catch { /* no downloads here */ }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).catch(() => {}); did.push('copied to the clipboard'); }
    } catch { /* no clipboard here */ }
    return did;
  },
  /** Ask for text: 'clipboard' reads it, otherwise a file picker. Resolves to a string or null. */
  readText(from) {
    if (from === 'clipboard') {
      if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.readText) return Promise.resolve(null);
      return navigator.clipboard.readText().catch(() => null);
    }
    return new Promise((resolve) => {
      if (typeof document === 'undefined') { resolve(null); return; }
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.scbp,.txt,text/plain';
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (!f || f.size > BLUEPRINT_MAX_TEXT + 1024) { resolve(null); return; }
        f.text().then(resolve, () => resolve(null));
      });
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  },
};

function storeBlueprint(c, name, text) {
  const store = blueprintsOf(c.game, c.actor);
  const next = { ...store, [name]: text };
  if (!(name in store) && Object.keys(store).length >= BLUEPRINT_MAX_COUNT) return `You can keep ${BLUEPRINT_MAX_COUNT} blueprints: /blueprint delete one first`;
  let total = 0;
  for (const v of Object.values(next)) total += v.length;
  if (total > BLUEPRINT_TOTAL_TEXT) return 'Your blueprints take too much room: /blueprint delete some first';
  store[name] = text;
  return null;
}

function blueprintCommand(c, args) {
  const { game, st, actor, world } = c;
  const sub = (args[0] || '').toLowerCase();
  const store = blueprintsOf(game, actor);
  const { flags, rest } = flagsOf(args.slice(1));
  const needName = () => { const n = cleanBlueprintName(rest[0]); return n; };
  const badName = `Give the blueprint a name of letters, digits, - and _ (up to ${BLUEPRINT_NAME_MAX})`;
  switch (sub) {
    case 'save': {
      const name = needName();
      if (!name) return badName;
      const sel = selectionBox(game, st);
      if (sel.error) return sel.error;
      const vol = boxVolume(sel.box);
      if (vol > BLUEPRINT_MAX_VOLUME) return `A blueprint is at most ${fmt(BLUEPRINT_MAX_VOLUME)} blocks (this is ${fmt(vol)})`;
      const bad = checkVolume(game, sel.box, 'That selection');
      if (bad) return bad;
      if (hasUnloaded(sel.box, loadedFn(world))) return 'Part of the selection is in unloaded chunks: go closer first';
      const cb = copyRegion(world, sel.box, blockAt(actor), (x, y, z) => readTile(game, x, y, z));
      let text;
      try { text = encodeBlueprint(cb, { contents: flags.has('c') }); } catch (e) { return e.message; }
      const err = storeBlueprint(c, name, text);
      if (err) return err;
      return `Saved blueprint '${name}': ${boxSize(sel.box).join(' x ')}, ${fmt(text.length)} characters${flags.has('c') ? ', chest contents kept' : ', chests saved empty'}. Its origin is where you stood.`;
    }
    case 'load': {
      const name = needName();
      if (!name) return badName;
      if (!store[name]) return `No blueprint called '${name}': /blueprint list`;
      let cb;
      try { cb = decodeBlueprint(store[name]); } catch (e) { return e.message; }
      st.clip = cb;
      return `Loaded '${name}' (${cb.w} x ${cb.h} x ${cb.l}) into the clipboard: /paste puts it where you stand; /rotate and /flip turn it`;
    }
    case 'list': {
      const names = Object.keys(store).sort();
      if (!names.length) return 'No blueprints yet: select something and /blueprint save <name>';
      return [`Blueprints (${names.length}/${BLUEPRINT_MAX_COUNT}):`, ...names.map((n) => { const p = peekBlueprint(store[n]); return `  ${n}${p ? ` - ${p.w} x ${p.h} x ${p.l}, ${fmt(store[n].length)} characters` : ' - damaged'}`; })];
    }
    case 'delete': case 'remove': {
      const name = needName();
      if (!name) return badName;
      if (!store[name]) return `No blueprint called '${name}'`;
      delete store[name];
      return `Deleted blueprint '${name}'`;
    }
    case 'export': {
      if (!actor.host) return 'Exporting blueprints to a file is done by the host';
      const name = needName();
      if (!name) return badName;
      if (!store[name]) return `No blueprint called '${name}'`;
      const did = (game.blueprintIO || blueprintIO).exportText(name, store[name]);
      if (!did.length) return [`Blueprint '${name}' (${fmt(store[name].length)} characters):`, store[name]];
      return `Exported '${name}' (${fmt(store[name].length)} characters): ${did.join(' and ')}. Share the text or the file; /blueprint import <name> loads one.`;
    }
    case 'import': {
      if (!actor.host) return 'Importing blueprints from a file is done by the host';
      const name = needName();
      if (!name) return badName;
      const inline = rest.slice(1).join('');
      const finish = (text) => {
        if (text == null) return 'Nothing was imported';
        let cb;
        try { cb = decodeBlueprint(text); } catch (e) { return `Could not import: ${e.message}`; }
        const clean = text.replace(/\s+/g, '');
        const err = storeBlueprint(c, name, clean);
        return err || `Imported '${name}' (${cb.w} x ${cb.h} x ${cb.l}, ${cb.tiles.size} extras): /blueprint load ${name}`;
      };
      if (inline && inline !== 'clipboard') return finish(inline);
      const io = game.blueprintIO || blueprintIO;
      Promise.resolve(io.readText(inline === 'clipboard' ? 'clipboard' : 'file')).then((t) => actor.say(finish(t)), () => actor.say('Could not read that'));
      return inline === 'clipboard' ? 'Reading the clipboard...' : 'Choose a blueprint file (.scbp)...';
    }
    default: return USAGE.blueprint;
  }
}

// ---- the Surveyor Wand and guests ------------------------------------------------------------
/**
 * A click with the Surveyor Wand on block t: corner 1 (left) or 2 (right). A guest also marks it at home (so the
 * outline shows) and has the host record the same corner.
 */
export function wandClick(game, which, t) {
  const net = game.net, text = `/pos${which} ${t.x} ${t.y} ${t.z}`;
  if (net && net.isClient) {
    if (net.sendCommand) { net.sendCommand(text); mirrorSelection(game, text); }
    return null;
  }
  const out = runBuildCommand(game, 'pos' + which, [String(t.x), String(t.y), String(t.z)]);
  const msg = [].concat(out || []);
  const a = actorOf(game);
  if (msg.length) a.toast(msg[0]);
  return out;
}

/** A guest's copy of its own selection, so the wireframe shows without a round trip. */
function mirrorSelection(game, text) {
  const parts = text.trim().replace(/^\//, '').split(/\s+/), cmd = parts.shift().toLowerCase();
  if (!SELECTION_COMMANDS.has(cmd)) return;
  if (!game.localSel) game.localSel = { pos1: null, pos2: null, clip: null, history: null, job: null };
  const saved = game.buildStates, saveActor = game.cmdActor;
  const local = { ...localActor(game), key: '#local', host: true, say() {}, toast() {} };
  game.buildStates = new Map([['#local', game.localSel]]);
  game.cmdActor = local;
  try { runBuildCommand(game, cmd, parts); } finally { game.buildStates = saved; game.cmdActor = saveActor; }
}

/**
 * What a guest sends to the host for a building command: /pos1 and /pos2 without coordinates get the guest's own
 * position (the host would use its idea of where the guest stands, a moment old), and the selection commands also
 * run at home. Returns the text to send.
 */
export function prepareGuestCommand(game, text) {
  const parts = text.trim().replace(/^\//, '').split(/\s+/), cmd = (parts.shift() || '').toLowerCase();
  let out = text;
  if ((cmd === 'pos1' || cmd === 'pos2') && parts.length < 3) {
    const p = game.player;
    out = `/${cmd} ${Math.floor(p.x)} ${Math.floor(p.y + 0.01)} ${Math.floor(p.z)}`;
  }
  mirrorSelection(game, out);
  return out;
}

export { Clipboard, BLUEPRINT_PREFIX, cleanBlueprints };

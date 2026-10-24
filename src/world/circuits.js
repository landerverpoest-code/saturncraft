// Cinnabar circuitry: power levels 0..15 carried by wire, levers, buttons,
// pressure plates, cinnabar torches (inverters), repeaters, lamps, pistons and
// the blocks they open, ignite or ring. A simplified but faithful take on the
// reference game's rules:
//
// * Sources give "weak" power to the blocks around them and "strong" power to
//   one block (the block a lever / button hangs on, the block under a plate,
//   the block above a torch, the block in front of a repeater).
// * A full solid block that is strongly powered powers wire next to it; a
//   block that is only powered by wire running into it (weakly) still powers
//   components (lamps, torches, repeaters, pistons...) but never wire.
// * Wire takes the strongest neighbouring source and loses one level per block.
//   Whole wire networks are recomputed at once (breadth first from the highest
//   level), which keeps long lines cheap and free of update storms.
// * Torches invert the power of the block they are attached to after 2 ticks
//   (they burn out when toggled too often), repeaters delay 2-8 ticks and
//   restore the level to 15, lamps switch off after 4 ticks.
//
// Changes only queue position updates; World.tick() runs the due scheduled
// ticks and then drains the queue with a cap on the work per tick. Only the
// authoritative world (single player or the multiplayer host) simulates:
// guests set `enabled = false` and just apply the host's block edits.
import { B, BLOCKS, SOLID, BLOCK_LIMIT } from './blocks.js';
import { MIN_Y, MAX_Y } from './constants.js';
import { SIDE_DIRS, DOOR_OPEN, DOOR_UPPER, TRAPDOOR_OPEN, GATE_OPEN } from './shapes.js';
import {
  FACING6, CIRCUIT_BLOCK, isWire, isTorchC, isPiston, isConductor, wireMask, wirePowerSides, attachDir, torchAttachDir,
  ON, TURNED, REPEATER_POWERED, PISTON_EXTENDED, HEAD_STICKY, CHIME_POWERED, OPENABLE_POWERED, SIDE_TO_FACING, facingOf,
} from './circuitShapes.js';

export const MAX_PUSH = 12;
export const BUTTON_TICKS = 20;
export const PLATE_TICKS = 20;
export const TORCH_DELAY = 2;
export const LAMP_OFF_DELAY = 4;
export const UPDATES_PER_TICK = 20000;
const MAX_NETWORK = 4096;
const BURNOUT_TOGGLES = 8, BURNOUT_WINDOW = 60, BURNOUT_TICKS = 160;

const DIRS6 = FACING6;
const H4 = SIDE_DIRS;
const key = (x, y, z) => `${x},${y},${z}`;

/** Blocks the simulation reacts to when something next to them changes. */
export const CIRCUIT_REACT = new Uint8Array(BLOCK_LIMIT);
for (const id of [B.CINNABAR_WIRE, B.CINNABAR_TORCH, B.CINNABAR_TORCH_OFF, B.CINNABAR_LAMP, B.CINNABAR_LAMP_ON, B.REPEATER,
  B.PISTON, B.STICKY_PISTON, B.STONE_BUTTON, B.WOODEN_PRESSURE_PLATE, B.CHIME_BLOCK, B.DOOR, B.OAK_TRAPDOOR, B.OAK_FENCE_GATE, B.TNT]) CIRCUIT_REACT[id] = 1;
/** Blocks re-evaluated when their chunk loads or on random ticks (state may be stale after a reload). */
export const CIRCUIT_SETTLE = new Uint8Array(BLOCK_LIMIT);
for (const id of [B.CINNABAR_WIRE, B.CINNABAR_TORCH, B.CINNABAR_TORCH_OFF, B.CINNABAR_LAMP, B.CINNABAR_LAMP_ON, B.REPEATER,
  B.PISTON, B.STICKY_PISTON, B.STONE_BUTTON, B.WOODEN_PRESSURE_PLATE]) CIRCUIT_SETTLE[id] = 1;
export { CIRCUIT_BLOCK };

// ---- power queries (pure functions of a world with getBlock / getMeta) -----------------
const get = (w, x, y, z) => w.getBlock(x, y, z);
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Level a wire sends towards direction d (from the wire). */
export function wireOut(w, x, y, z, d) {
  if (d[1] > 0) return 0;
  const lvl = w.getMeta(x, y, z) & 15;
  if (!lvl || d[1] < 0) return lvl;
  const s = d[0] ? (d[0] > 0 ? 1 : 3) : (d[2] > 0 ? 2 : 0);
  return wirePowerSides(wireMask((a, b, c) => w.getBlock(a, b, c), (a, b, c) => w.getMeta(a, b, c), x, y, z)) & (1 << s) ? lvl : 0;
}

/** Strong power the block at x,y,z sends into its neighbour in direction d. Wire counts only for components. */
export function strongOut(w, x, y, z, d, forWire = false) {
  const id = get(w, x, y, z);
  switch (id) {
    case B.LEVER: case B.STONE_BUTTON: { const m = w.getMeta(x, y, z); return m & ON && same(attachDir(m), d) ? 15 : 0; }
    case B.WOODEN_PRESSURE_PLATE: return w.getMeta(x, y, z) & 1 && d[1] < 0 ? 15 : 0;
    case B.CINNABAR_TORCH: return d[1] > 0 ? 15 : 0;
    case B.REPEATER: { const m = w.getMeta(x, y, z); return m & REPEATER_POWERED && same(H4[m & 3], d) ? 15 : 0; }
    case B.CINNABAR_WIRE: return forWire ? 0 : wireOut(w, x, y, z, d);
    default: return 0;
  }
}

/** Weak power the block at x,y,z sends towards direction d (not counting power passing through solid blocks). */
export function weakOut(w, x, y, z, d, forWire = false) {
  const id = get(w, x, y, z);
  switch (id) {
    case B.LEVER: case B.STONE_BUTTON: return w.getMeta(x, y, z) & ON ? 15 : 0;
    case B.WOODEN_PRESSURE_PLATE: return w.getMeta(x, y, z) & 1 ? 15 : 0;
    case B.CINNABAR_TORCH: return same(torchAttachDir(w.getMeta(x, y, z)), d) ? 0 : 15;
    case B.REPEATER: { const m = w.getMeta(x, y, z); return m & REPEATER_POWERED && same(H4[m & 3], d) ? 15 : 0; }
    case B.CINNABAR_BLOCK: return 15;
    case B.CINNABAR_WIRE: return forWire ? 0 : wireOut(w, x, y, z, d);
    default: return 0;
  }
}

/** Strong power a solid block receives from its neighbours. */
export function strongIn(w, x, y, z, forWire = false) {
  let p = 0;
  for (const d of DIRS6) {
    const v = strongOut(w, x + d[0], y + d[1], z + d[2], [-d[0], -d[1], -d[2]], forWire);
    if (v > p && (p = v) >= 15) break;
  }
  return p;
}

/** Power the block at x,y,z emits towards direction d: its own output, or what a solid block passes on. */
export function emitted(w, x, y, z, d, forWire = false) {
  const id = get(w, x, y, z);
  const own = weakOut(w, x, y, z, d, forWire);
  return isConductor(id) && own < 15 ? Math.max(own, strongIn(w, x, y, z, forWire)) : own;
}

/** Strongest power reaching x,y,z from any side (except the sides in `skip`, FACING6 indices). */
export function powerInto(w, x, y, z, skip = -1) {
  let p = 0;
  for (let i = 0; i < 6; i++) {
    if (i === skip) continue;
    const d = DIRS6[i];
    const v = emitted(w, x + d[0], y + d[1], z + d[2], [-d[0], -d[1], -d[2]]);
    if (v > p && (p = v) >= 15) break;
  }
  return p;
}

/** Input of a repeater: power coming from the block behind it. */
export function repeaterInput(w, x, y, z, meta) {
  const d = H4[meta & 3];
  return emitted(w, x - d[0], y, z - d[2], d);
}

/** Is the block holding a cinnabar torch powered (the torch then turns off)? */
export function torchShouldBeOff(w, x, y, z, meta) {
  const a = torchAttachDir(meta);
  return emitted(w, x + a[0], y + a[1], z + a[2], [-a[0], -a[1], -a[2]]) > 0;
}

/** Wire neighbours of a wire (same level, up a step, down a step), as [x,y,z]. */
export function wireNeighbours(w, x, y, z) {
  const out = [];
  const roof = isConductor(get(w, x, y + 1, z));
  for (const [dx, , dz] of H4) {
    const nx = x + dx, nz = z + dz, n = get(w, nx, y, nz);
    if (isWire(n)) { out.push([nx, y, nz]); continue; }
    if (!roof && isConductor(n) && isWire(get(w, nx, y + 1, nz))) out.push([nx, y + 1, nz]);
    if (!isConductor(n) && isWire(get(w, nx, y - 1, nz))) out.push([nx, y - 1, nz]);
  }
  return out;
}

/** Power a wire gets from non-wire sources around it. */
export function wireSource(w, x, y, z) {
  let p = 0;
  for (const d of DIRS6) {
    const v = emitted(w, x + d[0], y + d[1], z + d[2], [-d[0], -d[1], -d[2]], true);
    if (v > p && (p = v) >= 15) break;
  }
  return p;
}

/**
 * Levels of the wire network around (x,y,z): Map posKey -> {x,y,z,level}.
 * Each wire takes max(its source, best neighbour - 1).
 */
export function solveNetwork(w, x, y, z, cap = MAX_NETWORK) {
  const nodes = new Map();
  const start = key(x, y, z);
  nodes.set(start, { x, y, z, level: 0, nb: null });
  const order = [nodes.get(start)];
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    n.nb = [];
    for (const [a, b, c] of wireNeighbours(w, n.x, n.y, n.z)) {
      const k = key(a, b, c);
      let m = nodes.get(k);
      if (!m) {
        if (nodes.size >= cap) continue;
        m = { x: a, y: b, z: c, level: 0, nb: null };
        nodes.set(k, m); order.push(m);
      }
      n.nb.push(m);
    }
  }
  const buckets = Array.from({ length: 16 }, () => []);
  for (const n of order) { n.level = wireSource(w, n.x, n.y, n.z); if (n.level) buckets[n.level].push(n); }
  for (let L = 15; L > 1; L--) {
    for (const n of buckets[L]) {
      if (n.level !== L || !n.nb) continue;
      for (const m of n.nb) if (m.level < L - 1) { m.level = L - 1; buckets[L - 1].push(m); }
    }
  }
  return nodes;
}

// ---- pistons ------------------------------------------------------------------------
/** Blocks a piston cannot move at all. */
export function immovable(id, meta) {
  const d = BLOCKS[id];
  if (!d || d.hardness < 0 || id === B.OBSIDIAN || d.container || id === B.FURNACE || id === B.FURNACE_LIT || id === B.SPAWNER) return true;
  if (id === B.ENCHANTING_TABLE || id === B.PISTON_HEAD || id === B.RIFT) return true;
  if (isPiston(id) && meta & PISTON_EXTENDED) return true;
  return false;
}
/** Blocks a piston breaks (drops) instead of pushing: plants, torches, wire, fluids... */
export function pushBreaks(id) {
  const d = BLOCKS[id];
  return !!d && (d.replaceable || d.needsSupport || !d.solid || !!d.fluid);
}

/**
 * Blocks a piston at x,y,z facing f would push: { ok, line: [[x,y,z,id,meta]...], end: [x,y,z] | null }.
 * `end` is the first non-pushed cell (air or a block that will break).
 */
export function pushLine(w, x, y, z, f, limit = MAX_PUSH) {
  const [dx, dy, dz] = FACING6[f];
  const line = [];
  for (let i = 1; i <= limit + 1; i++) {
    const px = x + dx * i, py = y + dy * i, pz = z + dz * i;
    if (py < MIN_Y || py > MAX_Y || (w.isLoaded && !w.isLoaded(px, pz))) return { ok: false, line };
    const id = get(w, px, py, pz);
    if (!id || pushBreaks(id)) return { ok: true, line, end: [px, py, pz] };
    const meta = w.getMeta(px, py, pz);
    if (immovable(id, meta) || i > limit) return { ok: false, line };
    line.push([px, py, pz, id, meta]);
  }
  return { ok: false, line };
}

// ---- the simulation ---------------------------------------------------------------------
export class Circuits {
  constructor(world) {
    this.world = world;
    this.enabled = true;       // false on multiplayer guests (the host simulates)
    this.queue = new Set();     // position keys waiting for an update
    this.burn = new Map();      // torch key -> recent turn-off ticks / burnt-out-until
    this.acting = 0;            // > 0 while the simulation itself edits blocks
    this.entitiesOn = null;     // (x, y, z) => is something standing on the plate? (set by the game)
    this.onTNT = null;          // falls back to world.onTNT
    this.stats = { updates: 0, networks: 0 };
    this.solved = new Set();    // wires whose network was solved in this drain (and nothing changed since)
  }

  reset() { this.queue.clear(); this.burn.clear(); this.solved.clear(); }

  /** Something that may matter to wire changed (forget which networks are solved). */
  enqueue(x, y, z) {
    if (!this.enabled) return;
    this.queue.add(key(x, y, z));
    if (this.solved.size) this.solved.clear();
  }

  /** Queue updates for everything within two blocks (Manhattan) of x,y,z: the reach of power through one block. */
  enqueueAround(x, y, z, skipWire = false) {
    if (!this.enabled) return;
    const w = this.world;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
      const id = w.getBlock(x + dx, y + dy, z + dz);
      if (!CIRCUIT_REACT[id] || (skipWire && isWire(id))) continue;
      this.queue.add(key(x + dx, y + dy, z + dz));
    }
  }

  /** World.setBlock hook: a circuit block appeared, vanished or changed state. */
  blockChanged(x, y, z, old, id) {
    if (!this.enabled || this.writingWire) return;
    const w = this.world;
    // a lamp switching or a chime block ringing is no news for wire (they conduct either way)
    const quiet = (old === id && id === B.CHIME_BLOCK) || ((old === B.CINNABAR_LAMP || old === B.CINNABAR_LAMP_ON) && (id === B.CINNABAR_LAMP || id === B.CINNABAR_LAMP_ON));
    if (!quiet && this.solved.size) this.solved.clear();
    this.enqueueAround(x, y, z, quiet);
    // a lever / button / plate that turns on schedules its own release
    if (id === B.STONE_BUTTON && w.getMeta(x, y, z) & ON) w.scheduleTick(x, y, z, BUTTON_TICKS);
    if (id === B.WOODEN_PRESSURE_PLATE && w.getMeta(x, y, z) & 1) w.scheduleTick(x, y, z, PLATE_TICKS);
    // pistons and their heads go together
    if (isPiston(old) && old !== id) {
      // the base was removed: take its head with it (the meta is gone, so look for a head pointing away from here)
      for (let f = 0; f < 6; f++) {
        const [dx, dy, dz] = FACING6[f];
        if (w.getBlock(x + dx, y + dy, z + dz) === B.PISTON_HEAD && (w.getMeta(x + dx, y + dy, z + dz) & 7) === f) this.act(() => w.setBlock(x + dx, y + dy, z + dz, B.AIR));
      }
    }
    if (old === B.PISTON_HEAD && id !== B.PISTON_HEAD) {
      for (let f = 0; f < 6; f++) {
        const [dx, dy, dz] = FACING6[f];
        const bx = x - dx, by = y - dy, bz = z - dz, b = w.getBlock(bx, by, bz), m = w.getMeta(bx, by, bz);
        if (isPiston(b) && (m & 7) === f && m & PISTON_EXTENDED) this.act(() => w.breakBlock(bx, by, bz, true));
      }
    }
  }

  act(fn) { this.acting++; try { return fn(); } finally { this.acting--; } }

  /** Run queued updates (at most `cap`; the rest waits for the next tick). */
  drain(cap = UPDATES_PER_TICK) {
    if (!this.enabled || this.draining) return 0;
    this.draining = true;
    let n = 0;
    try {
      while (this.queue.size && n < cap) {
        const k = this.queue.values().next().value;
        this.queue.delete(k);
        const [x, y, z] = k.split(',').map(Number);
        this.update(x, y, z);
        n++;
      }
    } finally { this.draining = false; this.solved.clear(); }
    this.stats.updates += n;
    return n;
  }

  /** Something near x,y,z changed: re-evaluate the block there. */
  update(x, y, z) {
    const w = this.world;
    if (!w.isLoaded(x, z)) return;
    const id = w.getBlock(x, y, z);
    if (!CIRCUIT_REACT[id]) return;
    const m = w.getMeta(x, y, z);
    switch (id) {
      case B.CINNABAR_WIRE: if (!this.solved.has(key(x, y, z))) this.updateWire(x, y, z); break;
      case B.CINNABAR_TORCH: case B.CINNABAR_TORCH_OFF:
        if (torchShouldBeOff(w, x, y, z, m) === (id === B.CINNABAR_TORCH)) w.scheduleTick(x, y, z, TORCH_DELAY);
        break;
      case B.REPEATER: {
        const on = repeaterInput(w, x, y, z, m) > 0;
        if (on !== !!(m & REPEATER_POWERED)) w.scheduleTick(x, y, z, (((m >> 2) & 3) + 1) * 2);
        break;
      }
      case B.CINNABAR_LAMP: if (powerInto(w, x, y, z) > 0) this.act(() => w.setBlock(x, y, z, B.CINNABAR_LAMP_ON, 0, false)); break;
      case B.CINNABAR_LAMP_ON: if (!powerInto(w, x, y, z)) w.scheduleTick(x, y, z, LAMP_OFF_DELAY); break;
      case B.PISTON: case B.STICKY_PISTON: {
        const p = powerInto(w, x, y, z, m & 7) > 0;
        if (p !== !!(m & PISTON_EXTENDED)) w.scheduleTick(x, y, z, 1);
        break;
      }
      case B.STONE_BUTTON: if (m & ON) w.scheduleTick(x, y, z, BUTTON_TICKS); break;
      case B.WOODEN_PRESSURE_PLATE: if (m & 1) w.scheduleTick(x, y, z, PLATE_TICKS); break;
      case B.CHIME_BLOCK: {
        const p = powerInto(w, x, y, z) > 0;
        if (p !== !!(m & CHIME_POWERED)) this.act(() => w.setBlock(x, y, z, id, p ? m | CHIME_POWERED : m & ~CHIME_POWERED, false));
        break;
      }
      case B.TNT: if (powerInto(w, x, y, z) > 0) { const f = this.onTNT || w.onTNT; if (f) this.act(() => f(x, y, z)); } break;
      case B.DOOR: case B.OAK_TRAPDOOR: case B.OAK_FENCE_GATE: this.updateOpenable(x, y, z, id, m); break;
    }
  }

  /** Doors, trapdoors and gates open while powered (only on changes, so hands can still open them). */
  updateOpenable(x, y, z, id, m) {
    const w = this.world;
    if (id === B.DOOR) {
      const by = m & DOOR_UPPER ? y - 1 : y;
      if (w.getBlock(x, by, z) !== B.DOOR) return;
      const lm = w.getMeta(x, by, z);
      const p = powerInto(w, x, by, z) > 0 || (w.getBlock(x, by + 1, z) === B.DOOR && powerInto(w, x, by + 1, z) > 0);
      if (p === !!(lm & OPENABLE_POWERED)) return;
      this.act(() => {
        for (const yy of [by, by + 1]) {
          if (w.getBlock(x, yy, z) !== B.DOOR) continue;
          const mm = w.getMeta(x, yy, z);
          w.setBlock(x, yy, z, B.DOOR, p ? mm | DOOR_OPEN | OPENABLE_POWERED : mm & ~(DOOR_OPEN | OPENABLE_POWERED), false);
        }
      });
      return;
    }
    const p = powerInto(w, x, y, z) > 0;
    if (p === !!(m & OPENABLE_POWERED)) return;
    const open = id === B.OAK_TRAPDOOR ? TRAPDOOR_OPEN : GATE_OPEN;
    this.act(() => w.setBlock(x, y, z, id, p ? m | open | OPENABLE_POWERED : m & ~(open | OPENABLE_POWERED), false));
  }

  /** Recompute the wire network through x,y,z and update what the changed wires power. */
  updateWire(x, y, z) {
    const w = this.world;
    this.stats.networks++;
    const nodes = solveNetwork(w, x, y, z);
    for (const k of nodes.keys()) this.solved.add(k);
    const changed = [];
    this.writingWire = true;
    try {
      for (const n of nodes.values()) {
        if ((w.getMeta(n.x, n.y, n.z) & 15) === n.level) continue;
        w.setBlock(n.x, n.y, n.z, B.CINNABAR_WIRE, n.level, false);
        changed.push(n);
      }
    } finally { this.writingWire = false; }
    for (const n of changed) this.enqueueAround(n.x, n.y, n.z, true);
    return changed.length;
  }

  /** Scheduled tick of a circuit block. */
  tick(x, y, z, id) {
    if (!this.enabled) return;
    const w = this.world, m = w.getMeta(x, y, z);
    switch (id) {
      case B.CINNABAR_TORCH: case B.CINNABAR_TORCH_OFF: this.tickTorch(x, y, z, id, m); break;
      case B.REPEATER: {
        // reference: an unpowered repeater always turns on when its tick comes (stretching short pulses)
        const input = repeaterInput(w, x, y, z, m) > 0;
        if (m & REPEATER_POWERED) { if (!input) this.act(() => w.setBlock(x, y, z, id, m & ~REPEATER_POWERED)); }
        else {
          this.act(() => w.setBlock(x, y, z, id, m | REPEATER_POWERED));
          if (!input) w.scheduleTick(x, y, z, (((m >> 2) & 3) + 1) * 2);
        }
        break;
      }
      case B.CINNABAR_LAMP_ON: if (!powerInto(w, x, y, z)) this.act(() => w.setBlock(x, y, z, B.CINNABAR_LAMP, 0, false)); break;
      case B.PISTON: case B.STICKY_PISTON: {
        const p = powerInto(w, x, y, z, m & 7) > 0;
        if (p && !(m & PISTON_EXTENDED)) this.extend(x, y, z, id, m);
        else if (!p && m & PISTON_EXTENDED) this.retract(x, y, z, id, m);
        break;
      }
      case B.STONE_BUTTON: if (m & ON) this.act(() => w.setBlock(x, y, z, id, m & ~ON)); break;
      case B.WOODEN_PRESSURE_PLATE:
        if (!(m & 1)) break;
        if (this.entitiesOn && this.entitiesOn(x, y, z)) w.scheduleTick(x, y, z, PLATE_TICKS);
        else this.act(() => w.setBlock(x, y, z, id, 0));
        break;
      case B.CINNABAR_WIRE: this.updateWire(x, y, z); break;
    }
  }

  tickTorch(x, y, z, id, m) {
    const w = this.world, k = key(x, y, z), now = w.tickCount;
    const off = torchShouldBeOff(w, x, y, z, m);
    let b = this.burn.get(k);
    if (b && b.until > now && !off) { w.scheduleTick(x, y, z, b.until - now); return; } // burnt out: stays dark for a while
    if (id === B.CINNABAR_TORCH && off) {
      if (!b) this.burn.set(k, b = { toggles: [], until: 0 });
      b.toggles = b.toggles.filter((t) => now - t < BURNOUT_WINDOW);
      b.toggles.push(now);
      if (b.toggles.length >= BURNOUT_TOGGLES) { b.until = now + BURNOUT_TICKS; b.toggles = []; w.scheduleTick(x, y, z, BURNOUT_TICKS); if (w.emit) w.emit('circuitFx', x, y, z, 'burnout'); }
      this.act(() => w.setBlock(x, y, z, B.CINNABAR_TORCH_OFF, m));
    } else if (id === B.CINNABAR_TORCH_OFF && !off) {
      this.act(() => w.setBlock(x, y, z, B.CINNABAR_TORCH, m));
    }
    if (this.burn.size > 512) for (const [kk, v] of this.burn) if (v.until <= now && !v.toggles.some((t) => now - t < BURNOUT_WINDOW)) this.burn.delete(kk);
  }

  /** Push the line in front of the piston one block and put the head out. */
  extend(x, y, z, id, m) {
    const w = this.world, f = m & 7, [dx, dy, dz] = FACING6[f];
    const r = pushLine(w, x, y, z, f);
    if (!r.ok) return false;
    this.act(() => {
      if (r.end) { const [ex, ey, ez] = r.end; if (w.getBlock(ex, ey, ez)) w.breakBlock(ex, ey, ez, !BLOCKS[w.getBlock(ex, ey, ez)].fluid); }
      for (let i = r.line.length - 1; i >= 0; i--) {
        const [bx, by, bz, bid, bm] = r.line[i];
        w.setBlock(bx + dx, by + dy, bz + dz, bid, bm);
      }
      w.setBlock(x, y, z, id, m | PISTON_EXTENDED, false);
      w.setBlock(x + dx, y + dy, z + dz, B.PISTON_HEAD, f | (id === B.STICKY_PISTON ? HEAD_STICKY : 0));
      if (w.emit) w.emit('pistonMoved', x, y, z, f, r.line.length, true);
    });
    return true;
  }

  /** Pull the head back in (a sticky piston brings the block in front of it along). */
  retract(x, y, z, id, m) {
    const w = this.world, f = m & 7, [dx, dy, dz] = FACING6[f];
    const hx = x + dx, hy = y + dy, hz = z + dz;
    this.act(() => {
      w.setBlock(x, y, z, id, m & ~PISTON_EXTENDED);
      if (w.getBlock(hx, hy, hz) === B.PISTON_HEAD) w.setBlock(hx, hy, hz, B.AIR);
      if (id === B.STICKY_PISTON) {
        const fx = hx + dx, fy = hy + dy, fz = hz + dz, b = w.getBlock(fx, fy, fz), bm = w.getMeta(fx, fy, fz);
        if (b && !pushBreaks(b) && !immovable(b, bm) && !w.getBlock(hx, hy, hz)) {
          w.setBlock(fx, fy, fz, B.AIR);
          w.setBlock(hx, hy, hz, b, bm);
        }
      }
      if (w.emit) w.emit('pistonMoved', x, y, z, f, 0, false);
    });
  }

  /** A chunk (and so its circuit blocks) came into the world: let them settle. */
  settle(positions) {
    if (!this.enabled) return;
    for (const [x, y, z] of positions) this.queue.add(key(x, y, z));
  }

  /** Something stepped on a pressure plate (host / single player). */
  press(x, y, z) {
    const w = this.world;
    if (!this.enabled || w.getBlock(x, y, z) !== B.WOODEN_PRESSURE_PLATE || w.getMeta(x, y, z) & 1) return false;
    this.act(() => w.setBlock(x, y, z, B.WOODEN_PRESSURE_PLATE, 1));
    return true;
  }
}

// ---- placing and using parts (called by the interaction code) -----------------------------
/**
 * Meta for a circuit block placed against `face` of the clicked block, with the
 * player looking along `look`; -1 when it cannot go there.
 */
export function placeMeta(id, face, look) {
  const [lx, ly, lz] = look;
  const sideLook = Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? 1 : 3) : (lz > 0 ? 2 : 0);
  if (id === B.LEVER || id === B.STONE_BUTTON) {
    const turned = Math.abs(lx) > Math.abs(lz) ? TURNED : 0;
    if (face[1] === 1) return 0 | turned;
    if (face[1] === -1) return 5 | turned;
    const s = SIDE_DIRS.findIndex(([a, , c]) => a === -face[0] && c === -face[2]);
    return 1 + s;
  }
  if (id === B.CINNABAR_WIRE || id === B.REPEATER || id === B.WOODEN_PRESSURE_PLATE) {
    if (face[1] !== 1) return -1;
    return id === B.REPEATER ? sideLook : 0;
  }
  if (isPiston(id)) {
    // the front faces the player (up or down when placed looking steeply)
    if (Math.abs(ly) > 0.75) return ly < 0 ? 1 : 0;
    return SIDE_TO_FACING[(sideLook + 2) & 3];
  }
  return 0;
}

/** Does this circuit part have something to hang on? (world.hasSupport) */
export function supported(w, x, y, z, id, meta) {
  const solidAt = (a, b, c) => { const n = w.getBlock(a, b, c); return isConductor(n); };
  if (id === B.LEVER || id === B.STONE_BUTTON) { const [dx, dy, dz] = attachDir(meta); return solidAt(x + dx, y + dy, z + dz); }
  if (isTorchC(id)) { const [dx, dy, dz] = torchAttachDir(meta); return solidAt(x + dx, y + dy, z + dz); }
  return solidAt(x, y - 1, z);
}

/**
 * Right-click on a circuit block: returns the new meta to set, or -1 when the
 * block has no use. (Levers toggle, buttons press, repeaters change delay,
 * chime blocks change pitch.)
 */
export function useMeta(id, meta) {
  if (id === B.LEVER) return meta ^ ON;
  if (id === B.STONE_BUTTON) return meta & ON ? -1 : meta | ON;
  if (id === B.REPEATER) return (meta & ~12) | ((((meta >> 2) & 3) + 1) & 3) << 2;
  if (id === B.CHIME_BLOCK) return (meta & CHIME_POWERED) | (((meta & 31) + 1) % 25);
  return -1;
}

/** Sound for a block change made by circuits (or seen from the host), or null. */
export function changeSound(w, x, y, z, old, id) {
  if (old === id) {
    const m = w.getMeta(x, y, z);
    if (id === B.LEVER || id === B.STONE_BUTTON || id === B.WOODEN_PRESSURE_PLATE) return 'click';
    if (id === B.DOOR || id === B.OAK_TRAPDOOR || id === B.OAK_FENCE_GATE) {
      if (id === B.DOOR && m & DOOR_UPPER) return null;
      const open = id === B.DOOR ? DOOR_OPEN : id === B.OAK_TRAPDOOR ? TRAPDOOR_OPEN : GATE_OPEN;
      return m & open ? 'door_open' : 'door_close';
    }
    if (id === B.CHIME_BLOCK && m & CHIME_POWERED) return 'chime_' + (m & 31);
    return null;
  }
  if (id === B.PISTON_HEAD) return 'piston_out';
  if (old === B.PISTON_HEAD) return 'piston_in';
  if (id === B.CINNABAR_TORCH_OFF && old === B.CINNABAR_TORCH) return null;
  return null;
}

export { facingOf, SOLID };

// Sandvault: a buried vault under the dunes of deserts and badlands (about one in two 232 x 232 regions), a Pharaoh-style trap temple. Nothing shows
// above the sand but a single Sun Glyph, a golden sun carved in a brick, set flush in the sand. Break it and a shaft with a rope ladder drops
// into an antechamber; from there a three-wide corridor of Sandvault Bricks runs on to the burial hall, and it is trapped: Dart Traps sit in its
// walls at three rows, and each row has pressure plates and little lines of Cinnabar Wire on the floor that feed the traps (one row has the plate
// in the middle, one has plates at the sides; there is always a way past without stepping on a plate, and breaking the wire disarms a row). In the
// hall at the far end three chests lie under a golden sun, two Dune Shamblers keep watch, and the centre chest holds the Sun-Warden's ledger.
// Planned from the seed alone and stamped chunk by chunk (world/siteLite.js).
import { B } from './blocks.js';
import { BIOME } from './biomes.js';
import { SEA_LEVEL } from './constants.js';
import { hashf } from './noise.js';
import { toWorld, sideOfLocal } from './siteKit.js';
import { SIDE_TO_FACING } from './circuitShapes.js';
import { makeSiteKind, stampKind } from './siteLite.js';

export const VAULT_HALF = 8;
export const VAULT_REACH = 9;
export const VAULT_LOOT = { ledger: 10, side: 2 }; // chest loot kinds (mobs/spawnerBlocks.js): the Sun Tomb's table for the main chest, the temple's for the others
const FLOOR_H = -9, STAND_H = -8;
/** Where the sun-carved lid sits (local), and the shaft's column. */
export const VAULT_LID = { u: 0, v: 6 };

const kind = makeSiteKind({
  salt: 9797, region: 232, reach: VAULT_REACH, chance: 0.7, tries: 80, siblings: [],
  probe(gen, cx, cz) {
    const c0 = gen.column(cx, cz), t0 = gen.surfaceAt(cx, cz, c0), b0 = gen.biomeFor(c0, t0);
    if ((b0 !== BIOME.DESERT && b0 !== BIOME.BADLANDS) || t0 <= SEA_LEVEL + 1) return null; // (most spots fail here: cheap)
    let lo = t0, hi = t0;
    for (const dx of [-8, 0, 8]) for (const dz of [-8, 0, 8]) {
      const x = cx + dx, z = cz + dz, col = gen.column(x, z), top = gen.surfaceAt(x, z, col), b = gen.biomeFor(col, top);
      if ((b !== BIOME.DESERT && b !== BIOME.BADLANDS) || top <= SEA_LEVEL + 1) return null;
      lo = Math.min(lo, top); hi = Math.max(hi, top);
    }
    return hi - lo <= 6 ? { y: t0 } : null;
  },
});
export const sandvaultInRegion = kind.inRegion;
export const sandvaultsNear = kind.near;
export const nearestSandvault = kind.nearest;

// ---- the traps: rows across the corridor -----------------------------------------------------
/** Rows of the corridor (local v): the plates' and the wires' columns (local u). The dart traps stand in the walls at u = -2 and u = 2. */
export const TRAP_ROWS = [
  { v: 1, plates: [0], wires: [-1, 1] },
  { v: -1, plates: [-1, 1], wires: [0] },
  { v: -3, plates: [0], wires: [-1, 1] },
];
export const TRAP_WALL_U = 2;

// ---- chests, guards ---------------------------------------------------------------------
/** Chests as { u, h, v, fu, fv, loot, lore } (h is the layer the chest stands on). */
export const VAULT_CHESTS = [
  { u: 0, h: STAND_H, v: -7, fu: 0, fv: 1, loot: VAULT_LOOT.ledger, lore: 'sandvault' },
  { u: -4, h: STAND_H, v: -7, fu: 0, fv: 1, loot: VAULT_LOOT.side },
  { u: 4, h: STAND_H, v: -7, fu: 0, fv: 1, loot: VAULT_LOOT.side },
];
export function sandvaultChests(s) {
  return VAULT_CHESTS.map((c) => { const [dx, dz] = toWorld(s.dir, c.u, c.v); return { x: s.cx + dx, y: s.y + c.h, z: s.cz + dz, kind: c.loot, lore: c.lore }; });
}
/** Guards as { type, x, y, z }: two Dune Shamblers in the burial hall. */
export function sandvaultGuards(s) {
  const at = (type, u, h, v) => { const [dx, dz] = toWorld(s.dir, u, v); return { type, x: s.cx + dx, y: s.y + h, z: s.cz + dz }; };
  return [at('dune_shambler', -2, STAND_H, -6), at('dune_shambler', 2, STAND_H, -6)];
}
/** The world position of the Sun Glyph lid, and of each Dart Trap (with the way it faces, as a FACING6 index). */
export function sandvaultLid(s) { const [dx, dz] = toWorld(s.dir, VAULT_LID.u, VAULT_LID.v); return { x: s.cx + dx, y: s.y, z: s.cz + dz }; }
export function sandvaultTraps(s) {
  const out = [];
  for (const r of TRAP_ROWS) for (const side of [-1, 1]) {
    const [dx, dz] = toWorld(s.dir, side * TRAP_WALL_U, r.v);
    out.push({ x: s.cx + dx, y: s.y + STAND_H, z: s.cz + dz, facing: SIDE_TO_FACING[sideOfLocal(s.dir, -side, 0)] });
  }
  return out;
}

// ---- the blocks ------------------------------------------------------------------------
/** Which room, if any, holds the local cell: 'shaft', 'ante' (antechamber), 'corr' (the trap corridor) or 'hall' (the burial hall). */
export function vaultRoom(u, h, v) {
  const au = Math.abs(u);
  if (u === VAULT_LID.u && v === VAULT_LID.v && h >= -4 && h <= -1) return 'shaft';
  if (au <= 2 && v >= 4 && v <= 6 && h >= -8 && h <= -5) return 'ante';
  if (au <= 1 && v >= -4 && v <= 3 && h >= -8 && h <= -6) return 'corr';
  if (au <= 5 && v >= -7 && v <= -5 && h >= -8 && h <= -5) return 'hall';
  return null;
}
const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const inShell = (u, h, v) => NEIGHBOURS.some(([a, b, c]) => vaultRoom(u + a, h + b, v + c));

/**
 * The block of vault s at local (u, h, v) as [id, meta], or null where it leaves the world alone. h = 0 is the sand's surface layer (the Sun
 * Glyph lid); the rooms lie under it with their floor on layer -9.
 */
export function vaultBlock(s, u, h, v) {
  if (Math.abs(u) > VAULT_HALF || Math.abs(v) > VAULT_HALF || h < FLOOR_H || h > 0) return null;
  const AIR = [B.AIR, 0];
  if (h === 0) return u === VAULT_LID.u && v === VAULT_LID.v ? [B.SUN_GLYPH, 0] : null;
  const room = vaultRoom(u, h, v);
  const q = (k) => hashf(s.seed, u * 61 + 900, v * 31 + 900, k + h * 13);
  if (!room) {
    if (!inShell(u, h, v)) return null;
    // the darts sit in the corridor's walls, looking across it
    if (h === STAND_H && Math.abs(u) === TRAP_WALL_U) {
      const row = TRAP_ROWS.find((r) => r.v === v);
      if (row) return [B.DART_TRAP, SIDE_TO_FACING[sideOfLocal(s.dir, -Math.sign(u), 0)]];
    }
    // a golden sun on the back wall of the hall
    if (v === -8 && h === -7 && (u === 0 || Math.abs(u) === 3)) return [B.SUN_GLYPH, 0];
    if (h === FLOOR_H || h === -5 || h === -4) return q(1) < 0.07 ? [B.SANDSTONE, 0] : [B.SANDVAULT_BRICKS, 0];
    return q(2) < 0.05 ? [B.SANDSTONE, 0] : [B.SANDVAULT_BRICKS, 0];
  }
  // ---- inside ----
  if (u === VAULT_LID.u && v === VAULT_LID.v && (room === 'shaft' || room === 'ante')) return [B.ROPE_LADDER, sideOfLocal(s.dir, 0, 1)];
  if (room === 'ante') return h === STAND_H && Math.abs(u) === 2 && v === 4 ? [B.CANDLE, 1] : AIR;
  if (room === 'corr') {
    if (h !== STAND_H) return AIR;
    const row = TRAP_ROWS.find((r) => r.v === v);
    if (row) {
      if (row.plates.includes(u)) return [B.STONE_PRESSURE_PLATE, 0];
      if (row.wires.includes(u)) return [B.CINNABAR_WIRE, 0];
    }
    return AIR;
  }
  if (room === 'hall') {
    if (h === STAND_H) {
      for (const c of VAULT_CHESTS) if (c.u === u && c.v === v) return [B.CHEST, sideOfLocal(s.dir, c.fu, c.fv) | 8 | (c.loot << 4)];
      if (Math.abs(u) === 5 && v === -5) return [B.CANDLE, 1];
      if (Math.abs(u) === 2 && v === -7) return [B.LANTERN, 0];
    }
    return AIR;
  }
  return AIR;
}

/** Stamp the parts of nearby Sandvaults inside chunk (cx, cz). */
export function stampSandvaults(gen, blocks, meta, cx, cz) {
  stampKind(gen, blocks, meta, cx, cz, sandvaultsNear, {
    half: VAULT_HALF, below: FLOOR_H, clear: 0, foundation: 0,
    fill: () => B.SAND,
    blockAt: vaultBlock,
  });
}

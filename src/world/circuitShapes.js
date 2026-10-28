// Shapes and connections of the Cinnabar circuit parts, shared by the mesher
// (worker), selection / collision boxes and the simulation (world/circuits.js).
//
// Parts are modelled "standing up" (attached to the floor, pointing at +y,
// a repeater sending its output towards -z), then turned a number of quarter
// turns about y (`yaw`) and finally tipped over so that +y points along
// `facing` (FACING6 index).
import { B, BLOCKS, SOLID, OPAQUE, BLOCK_LIMIT } from './blocks.js';
// same as shapes.js SIDE_DIRS (not imported: shapes.js imports this module)
const SIDE_DIRS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];

/** Six directions in the reference order: down, up, -z, +z, -x, +x. */
export const FACING6 = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
export const facingOf = (dx, dy, dz) => FACING6.findIndex(([a, b, c]) => a === dx && b === dy && c === dz);
/** FACING6 index of a horizontal side index (0 -z, 1 +x, 2 +z, 3 -x). */
export const SIDE_TO_FACING = [2, 5, 3, 4];

// ---- meta layouts ---------------------------------------------------------------
export const ATTACH_MASK = 7, ON = 8, TURNED = 16;     // levers and buttons
export const REPEATER_POWERED = 16;
export const PISTON_EXTENDED = 8, HEAD_STICKY = 8;
export const CHIME_POWERED = 32;
export const DISPENSER_TRIGGERED = 8;                 // dispensers and droppers: powered since the last shot
export const OPENABLE_POWERED = 16;                   // doors, trapdoors, gates: "the circuit opened it"
export const COMPARATOR_SUBTRACT = 4;                 // comparators: subtract mode (front torch lit); bits 4-7 = output level
export const OBSERVER_POWERED = 8;                    // observers: sending their pulse
export const SENSOR_INVERTED = 16;                    // daylight sensors: inverted; bits 0-3 = output level
/** Output level of a comparator / daylight sensor stored in its meta. */
export const comparatorLevel = (meta) => (meta >> 4) & 15;
/** Direction an observer's back (its output) points to: the opposite of its face. */
export const observerBack = (meta) => { const [a, b, c] = FACING6[meta & 7] || FACING6[0]; return [-a, -b, -c]; };

/** Direction from a lever / button towards the block holding it. */
export function attachDir(meta) {
  const a = meta & ATTACH_MASK;
  if (a === 0) return [0, -1, 0];
  if (a === 5) return [0, 1, 0];
  return SIDE_DIRS[(a - 1) & 3];
}
/** Direction from a (cinnabar) torch towards its block (torch meta: 0 floor, 1..4 wall side+1). */
export function torchAttachDir(meta) { return meta ? SIDE_DIRS[(meta - 1) & 3] : [0, -1, 0]; }

export const isWire = (id) => id === B.CINNABAR_WIRE;
export const isTorchC = (id) => id === B.CINNABAR_TORCH || id === B.CINNABAR_TORCH_OFF;
export const isPiston = (id) => id === B.PISTON || id === B.STICKY_PISTON;
/** Full solid blocks carry power through them (and let wire climb only around them). */
export const isConductor = (id) => !!(SOLID[id] && OPAQUE[id]);

/** Do wires point at this neighbour (on side `side` of the wire)? */
function wireAttracts(id, meta, side) {
  if (id === B.LEVER || id === B.STONE_BUTTON || id === B.WOODEN_PRESSURE_PLATE || isTorchC(id) || id === B.CINNABAR_BLOCK) return true;
  if (id === B.REPEATER) return ((meta & 3) & 1) === (side & 1); // only along its axis
  if (id === B.COMPARATOR || id === B.DAYLIGHT_SENSOR || id === B.TARGET) return true;
  if (id === B.OBSERVER) return (meta & 7) === SIDE_TO_FACING[side]; // only at its back
  return false;
}

/**
 * Connection mask of the wire at x,y,z: bits 0-3 = connects on side s, bits
 * 4-7 = the connection on side s climbs up the neighbouring block.
 * `get(x,y,z)` -> id, `meta(x,y,z)` -> meta.
 */
export function wireMask(get, meta, x, y, z) {
  let m = 0;
  const roof = isConductor(get(x, y + 1, z));
  for (let s = 0; s < 4; s++) {
    const [dx, , dz] = SIDE_DIRS[s];
    const nx = x + dx, nz = z + dz, n = get(nx, y, nz);
    if (isWire(n) || wireAttracts(n, meta(nx, y, nz), s)) { m |= 1 << s; continue; }
    if (!roof && isConductor(n) && isWire(get(nx, y + 1, nz))) { m |= (1 << s) | (16 << s); continue; }
    if (!isConductor(n) && isWire(get(nx, y - 1, nz))) m |= 1 << s;
  }
  return m;
}

/** Sides a wire with this connection mask powers: a lone dot all four, a single connection both ways along its line. */
export function wirePowerSides(mask) {
  const m = mask & 15;
  if (!m) return 15;
  if (m === 1 || m === 4) return 5;
  if (m === 2 || m === 8) return 10;
  return m;
}

/** Wire colour for a power level: dark red when off, bright red at 15. */
export function wireColor(level) {
  const f = level / 15;
  return [Math.round(90 + 165 * f), Math.round(f > 0.6 ? (f - 0.6) * 120 : 0), Math.round(f > 0.6 ? (f - 0.6) * 40 : 0)];
}

// ---- parts -----------------------------------------------------------------------
const P = (x0, y0, z0, x1, y1, z1, tile, more = {}) => ({ box: [x0 / 16, y0 / 16, z0 / 16, x1 / 16, y1 / 16, z1 / 16], tile, uv: 'box', ...more });

/** Where a lever / button points (its "up") and how it is turned. */
function attachedXform(meta) {
  const a = meta & ATTACH_MASK;
  const facing = a === 0 ? 1 : a === 5 ? 0 : SIDE_TO_FACING[((a - 1) + 2) & 3];
  return { facing, yaw: meta & TURNED ? 1 : 0 };
}

/**
 * Parts of a SHAPE.CIRCUIT block: [{box, tile (texture name or six names in face
 * order +x -x +y -y +z -z), uv ('box' | 'torch'), off: [dx,dy,dz], tilt, yaw, facing}].
 */
export function circuitParts(id, meta) {
  if (id === B.LEVER) {
    const x = attachedXform(meta), on = meta & ON;
    return [
      P(5, 0, 4, 11, 3, 12, 'cobblestone', x),
      // the handle, drawn like a torch stick and leaning towards one end
      P(7, 6, 7, 9, 16, 9, 'lever', { ...x, uv: 'torch', off: [0, -5 / 16, 0], tilt: on ? 0.7 : -0.7 }),
    ];
  }
  if (id === B.STONE_BUTTON) return [P(5, 0, 6, 11, meta & ON ? 1 : 2, 10, 'stone', attachedXform(meta))];
  if (id === B.WOODEN_PRESSURE_PLATE) return [P(1, 0, 1, 15, meta & 1 ? 0.5 : 1, 15, 'oak_planks')];
  if (id === B.REPEATER) {
    const yaw = (meta & 3), on = meta & REPEATER_POWERED, delay = ((meta >> 2) & 3) + 1;
    const torch = on ? 'cinnabar_torch' : 'cinnabar_torch_off';
    const zc = 7 + (delay - 1) * 2;
    return [
      P(0, 0, 0, 16, 2, 16, ['smooth_stone', 'smooth_stone', on ? 'repeater_on' : 'repeater', 'smooth_stone', 'smooth_stone', 'smooth_stone'], { yaw }),
      P(7, 6, 2, 9, 11, 4, torch, { yaw, uv: 'torch', off: [0, -4 / 16, 0], lit: on }),
      P(7, 6, zc - 1, 9, 11, zc + 1, torch, { yaw, uv: 'torch', off: [0, -4 / 16, 0], lit: on }),
    ];
  }
  if (id === B.COMPARATOR) {
    // like a repeater: output towards -z before the yaw; two torches at the back (lit while it sends power), one at the front (lit in subtract mode)
    const yaw = meta & 3, on = comparatorLevel(meta) > 0, sub = !!(meta & COMPARATOR_SUBTRACT);
    const back = on ? 'cinnabar_torch' : 'cinnabar_torch_off';
    return [
      P(0, 0, 0, 16, 2, 16, ['smooth_stone', 'smooth_stone', on ? 'comparator_on' : 'comparator', 'smooth_stone', 'smooth_stone', 'smooth_stone'], { yaw }),
      P(4, 6, 11, 6, 11, 13, back, { yaw, uv: 'torch', off: [0, -4 / 16, 0], lit: on }),
      P(10, 6, 11, 12, 11, 13, back, { yaw, uv: 'torch', off: [0, -4 / 16, 0], lit: on }),
      P(7, 6, 2, 9, 11, 4, sub ? 'cinnabar_torch' : 'cinnabar_torch_off', { yaw, uv: 'torch', off: [0, sub ? -4 / 16 : -5 / 16, 0], lit: sub }),
    ];
  }
  if (id === B.OBSERVER) {
    // a full block whose "up" face (the face) looks along FACING6; the back shows a dot that lights while it pulses
    const facing = meta & 7;
    return [P(0, 0, 0, 16, 16, 16, ['observer_side', 'observer_side', 'observer_face', meta & OBSERVER_POWERED ? 'observer_back_on' : 'observer_back', 'observer_top', 'observer_top'], { facing })];
  }
  if (id === B.DAYLIGHT_SENSOR) {
    const top = meta & SENSOR_INVERTED ? 'daylight_sensor_inverted' : 'daylight_sensor_top';
    return [P(0, 0, 0, 16, 6, 16, ['daylight_sensor_side', 'daylight_sensor_side', top, 'oak_planks', 'daylight_sensor_side', 'daylight_sensor_side'])];
  }
  if (isPiston(id)) {
    const facing = meta & 7, ext = meta & PISTON_EXTENDED;
    const front = ext ? 'piston_inner' : id === B.STICKY_PISTON ? 'piston_top_sticky' : 'piston_top';
    return [P(0, 0, 0, 16, ext ? 12 : 16, 16, ['piston_side', 'piston_side', front, 'piston_bottom', 'piston_side', 'piston_side'], { facing })];
  }
  if (id === B.PISTON_HEAD) {
    const facing = meta & 7, face = meta & HEAD_STICKY ? 'piston_top_sticky' : 'piston_top';
    return [
      P(0, 12, 0, 16, 16, 16, ['piston_side', 'piston_side', face, 'piston_top', 'piston_side', 'piston_side'], { facing }),
      P(6, 0, 6, 10, 16, 10, 'piston_rod', { facing, off: [0, -4 / 16, 0] }),
    ];
  }
  return [P(0, 0, 0, 16, 16, 16, 'stone')];
}

// ---- transforms ----------------------------------------------------------------------
/** Rotate a vector (relative to the block centre) from "up" to FACING6 `f`. */
export function rotUp(f, x, y, z) {
  switch (f) {
    case 0: return [x, -y, -z];
    case 2: return [x, z, -y];
    case 3: return [x, -z, y];
    case 4: return [-y, x, z];
    case 5: return [y, -x, z];
    default: return [x, y, z];
  }
}
/** Quarter turns about y: -z -> +x -> +z -> -x. */
export function rotYaw(k, x, y, z) {
  for (let i = 0; i < (k & 3); i++) [x, z] = [-z, x];
  return [x, y, z];
}
/** Block-local point of a part after tilt, offset, yaw and facing (vector = no translation / tilt). */
export function partPoint(part, x, y, z, vector = false) {
  if (!vector) {
    if (part.tilt) z += (y - part.box[1]) * part.tilt * 0.6;
    if (part.off) { x += part.off[0]; y += part.off[1]; z += part.off[2]; }
    x -= 0.5; y -= 0.5; z -= 0.5;
  }
  [x, y, z] = rotYaw(part.yaw || 0, x, y, z);
  [x, y, z] = rotUp(part.facing ?? 1, x, y, z);
  return vector ? [x, y, z] : [x + 0.5, y + 0.5, z + 0.5];
}
/** Axis-aligned bounds of the transformed parts (selection outline / collision). */
export function partsBounds(parts) {
  const o = [1, 1, 1, 0, 0, 0];
  for (const p of parts) {
    const b = p.box;
    for (let k = 0; k < 8; k++) {
      const q = partPoint(p, k & 1 ? b[3] : b[0], k & 2 ? b[4] : b[1], k & 4 ? b[5] : b[2]);
      for (let a = 0; a < 3; a++) { o[a] = Math.min(o[a], q[a]); o[a + 3] = Math.max(o[a + 3], q[a]); }
    }
  }
  for (let a = 0; a < 6; a++) o[a] = Math.max(-0.25, Math.min(1, Math.round(o[a] * 1e6) / 1e6));
  return o;
}

/** Selection box of a circuit block (null = full cube). */
export function circuitSelection(id, meta) {
  if (id === B.CINNABAR_WIRE) return [0, 0, 0, 1, 1 / 16, 1];
  if ((isPiston(id) && !(meta & PISTON_EXTENDED)) || id === B.OBSERVER) return null;
  const b = partsBounds(circuitParts(id, meta));
  return [Math.max(0, b[0]), Math.max(0, b[1]), Math.max(0, b[2]), b[3], b[4], b[5]];
}
/** Collision boxes of the solid circuit blocks (pistons and heads). */
export function circuitCollision(id, meta) {
  if (id === B.OBSERVER) return [[0, 0, 0, 1, 1, 1]];
  if (id === B.DAYLIGHT_SENSOR) return [[0, 0, 0, 1, 6 / 16, 1]];
  if (isPiston(id)) return meta & PISTON_EXTENDED ? [partsBounds(circuitParts(id, meta))] : [[0, 0, 0, 1, 1, 1]];
  if (id === B.PISTON_HEAD) {
    const [plate, rod] = circuitParts(id, meta);
    const r = partsBounds([rod]);
    return [partsBounds([plate]), [Math.max(0, r[0]), Math.max(0, r[1]), Math.max(0, r[2]), Math.min(1, r[3]), Math.min(1, r[4]), Math.min(1, r[5])]];
  }
  return [];
}

export const CIRCUIT_BLOCK = new Uint8Array(BLOCK_LIMIT);
for (const id of [B.CINNABAR_WIRE, B.LEVER, B.STONE_BUTTON, B.WOODEN_PRESSURE_PLATE, B.CINNABAR_TORCH, B.CINNABAR_TORCH_OFF,
  B.CINNABAR_LAMP, B.CINNABAR_LAMP_ON, B.REPEATER, B.PISTON, B.STICKY_PISTON, B.PISTON_HEAD, B.CHIME_BLOCK, B.CINNABAR_BLOCK, B.DISPENSER, B.DROPPER,
  B.COMPARATOR, B.OBSERVER, B.DAYLIGHT_SENSOR, B.HUSH_SENSOR, B.CALIBRATED_HUSH_SENSOR, B.TARGET, B.LECTERN]) CIRCUIT_BLOCK[id] = 1;
CIRCUIT_BLOCK[B.COPPER_BULB] = 1; CIRCUIT_BLOCK[B.COPPER_BULB_LIT] = 1; // (world/provingVaults.js)
export { BLOCKS };

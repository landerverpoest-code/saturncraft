// Small bounded A* over walkable block cells for mob navigation.
import { SOLID, B } from '../world/blocks.js';

function passable(world, x, y, z, h) {
  for (let k = 0; k < h; k++) {
    const id = world.getBlock(x, y + k, z);
    if (SOLID[id] || id === B.LAVA || id === B.CACTUS) return false;
  }
  return true;
}
function standable(world, x, y, z, h) {
  if (!passable(world, x, y, z, h)) return false;
  const below = world.getBlock(x, y - 1, z);
  return (SOLID[below] && below !== B.CACTUS) || world.getBlock(x, y, z) === B.WATER;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * @returns {Array<[number,number,number]>|null} waypoints (block coords) excluding the start
 */
export function findPath(world, sx, sy, sz, tx, ty, tz, opts = {}) {
  const h = Math.ceil(opts.height || 2);
  const maxNodes = opts.maxNodes || 300;
  const maxDrop = opts.maxDrop ?? 3;
  const key = (x, y, z) => `${x},${y},${z}`;
  const heur = (x, y, z) => Math.abs(x - tx) + Math.abs(y - ty) * 1.5 + Math.abs(z - tz);
  const open = [{ x: sx, y: sy, z: sz, g: 0, f: heur(sx, sy, sz), parent: null }];
  const seen = new Map([[key(sx, sy, sz), open[0]]]);
  let best = open[0];
  let expanded = 0;
  while (open.length && expanded < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    expanded++;
    if (cur.x === tx && cur.z === tz && Math.abs(cur.y - ty) <= 1) { best = cur; break; }
    if (heur(cur.x, cur.y, cur.z) < heur(best.x, best.y, best.z)) best = cur;
    for (const [dx, dz] of DIRS) {
      const nx = cur.x + dx, nz = cur.z + dz;
      let ny = null, cost = 1;
      if (standable(world, nx, cur.y, nz, h)) ny = cur.y;
      else if (passable(world, cur.x, cur.y + h, cur.z, 1) && standable(world, nx, cur.y + 1, nz, h)) { ny = cur.y + 1; cost = 2; }
      else if (passable(world, nx, cur.y, nz, h)) {
        for (let d = 1; d <= maxDrop; d++) {
          if (!passable(world, nx, cur.y - d, nz, 1)) break;
          if (standable(world, nx, cur.y - d, nz, h)) { ny = cur.y - d; cost = 1 + d * 0.5; break; }
        }
      } else if (opts.climbs) {
        // climbers may go straight up walls
        for (let up = 1; up <= 4; up++) if (standable(world, nx, cur.y + up, nz, h) && passable(world, cur.x, cur.y + up, cur.z, h)) { ny = cur.y + up; cost = 1 + up; break; }
      }
      if (ny === null) continue;
      const k = key(nx, ny, nz);
      const g = cur.g + cost;
      const prev = seen.get(k);
      if (prev && prev.g <= g) continue;
      const node = { x: nx, y: ny, z: nz, g, f: g + heur(nx, ny, nz), parent: cur };
      seen.set(k, node);
      open.push(node);
    }
  }
  if (best === open[0] && best.parent === null && (best.x !== tx || best.z !== tz)) {
    if (!best.parent) return null;
  }
  const path = [];
  for (let n = best; n && n.parent; n = n.parent) path.push([n.x, n.y, n.z]);
  path.reverse();
  return path.length ? path : null;
}

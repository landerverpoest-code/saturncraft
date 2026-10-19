// Section occlusion culling. Each 16^3 section records which of its six faces
// are connected to each other through non-opaque blocks; a flood fill from
// the camera then only walks through sections a line of sight could pass, so
// sealed caves and solid rock below the surface are never drawn.
import { OPAQUE } from './blocks.js';
import { pidx } from './mesher.js';
import { SECTION_COUNT } from './constants.js';

// Faces: 0 -x, 1 +x, 2 -y, 3 +y, 4 -z, 5 +z (opposite face = d ^ 1)
export const DIRS = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
const ROW = [1, 64, 4096, 262144, 16777216, 1073741824]; // 64^face: six 6-bit rows packed in one number
export const ALL_OPEN = 63 * (1 + 64 + 4096 + 262144 + 16777216 + 1073741824);

/** Can a line of sight enter a section through face a and leave through face b? */
export function connects(vis, a, b) { return (Math.floor(vis / ROW[a]) & (1 << b)) !== 0; }

const seen = new Uint8Array(4096);
const queue = new Int16Array(4096);

/** Face-to-face connectivity of a padded 18^3 section (see mesher.js). */
export function sectionVisibility(blocks) {
  let open = 0;
  for (let i = 0; i < 4096; i++) {
    const o = OPAQUE[blocks[pidx(i & 15, i >> 8, (i >> 4) & 15)]];
    seen[i] = o; open += 1 - o;
  }
  if (open === 4096) return ALL_OPEN;
  if (open === 0) return 0;
  const rows = [0, 0, 0, 0, 0, 0];
  for (let s = 0; s < 4096; s++) {
    if (seen[s]) continue;
    // flood one connected air region, collecting the faces it touches
    let head = 0, tail = 0, faces = 0;
    seen[s] = 1; queue[tail++] = s;
    while (head < tail) {
      const i = queue[head++];
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
      if (x === 0) faces |= 1; else if (!seen[i - 1]) { seen[i - 1] = 1; queue[tail++] = i - 1; }
      if (x === 15) faces |= 2; else if (!seen[i + 1]) { seen[i + 1] = 1; queue[tail++] = i + 1; }
      if (y === 0) faces |= 4; else if (!seen[i - 256]) { seen[i - 256] = 1; queue[tail++] = i - 256; }
      if (y === 15) faces |= 8; else if (!seen[i + 256]) { seen[i + 256] = 1; queue[tail++] = i + 256; }
      if (z === 0) faces |= 16; else if (!seen[i - 16]) { seen[i - 16] = 1; queue[tail++] = i - 16; }
      if (z === 15) faces |= 32; else if (!seen[i + 16]) { seen[i + 16] = 1; queue[tail++] = i + 16; }
    }
    for (let d = 0; d < 6; d++) if (faces & (1 << d)) rows[d] |= faces;
  }
  let vis = 0;
  for (let d = 0; d < 6; d++) vis += rows[d] * ROW[d];
  return vis;
}

/**
 * Does any cell of a padded section (including its 1-block border) carry sky
 * light? Only such sections hold faces that sunlight can reach, so only they
 * need to cast sun shadows.
 */
export function sectionHasSky(light) {
  for (let i = 0; i < light.length; i++) if (light[i] >= 16) return true;
  return false;
}

/**
 * Flood fill over sections from the camera. getVis(cx, sy, cz) returns a
 * section's connectivity, ALL_OPEN when unknown, or -1 if the chunk is not
 * loaded. Like the reference renderer, a walk never turns back against a
 * direction it already took, which keeps it from leaking around corners.
 * Calls onVisible(cx, sy, cz) once per reachable section.
 */
export function floodVisible(camCx, camSy, camCz, radius, getVis, onVisible) {
  const W = radius * 2 + 1;
  const visited = new Uint8Array(W * W * SECTION_COUNT);
  const slot = (cx, sy, cz) => ((cx - camCx + radius) + (cz - camCz + radius) * W) * SECTION_COUNT + sy;
  const q = [];
  const sy0 = Math.max(0, Math.min(SECTION_COUNT - 1, camSy));
  visited[slot(camCx, sy0, camCz)] = 1;
  onVisible(camCx, sy0, camCz);
  q.push(camCx, sy0, camCz, -1, 0);
  for (let h = 0; h < q.length; h += 5) {
    const cx = q[h], sy = q[h + 1], cz = q[h + 2], entry = q[h + 3], dirs = q[h + 4];
    const vis = entry < 0 ? ALL_OPEN : getVis(cx, sy, cz);
    for (let d = 0; d < 6; d++) {
      if (dirs & (1 << (d ^ 1))) continue;           // never walk back
      if (entry >= 0 && !connects(vis, entry, d)) continue;
      const nx = cx + DIRS[d][0], ny = sy + DIRS[d][1], nz = cz + DIRS[d][2];
      if (ny < 0 || ny >= SECTION_COUNT) continue;
      if (Math.abs(nx - camCx) > radius || Math.abs(nz - camCz) > radius) continue;
      const k = slot(nx, ny, nz);
      if (visited[k]) continue;
      if (getVis(nx, ny, nz) < 0) continue;
      visited[k] = 1;
      onVisible(nx, ny, nz);
      q.push(nx, ny, nz, d ^ 1, dirs | (1 << d));
    }
  }
}

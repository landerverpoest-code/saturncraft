// Worn armour drawn on the box player model (third person and remote
// players): slightly larger shells on the head, body, arms and legs in the
// material's colour. Rebuilt only when the worn pieces change.
import * as THREE from 'three';
import { ITEMS, ARMOR_MATERIALS } from '../world/items.js';

const texCache = new Map();
function armorTexture(color) {
  if (texCache.has(color)) return texCache.get(color);
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d'), base = new THREE.Color(color);
  let s = 11; const rnd = () => { s = (s * 1103515245 + 12345) | 0; return ((s >>> 16) & 0x7fff) / 0x7fff; };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const f = (edge ? 0.7 : 0.88 + rnd() * 0.14) * (y < 3 ? 1.1 : 1);
    ctx.fillStyle = `rgb(${Math.min(255, base.r * 255 * f)},${Math.min(255, base.g * 255 * f)},${Math.min(255, base.b * 255 * f)})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(color, t);
  return t;
}

// [part, size (1/16 block), offset] per armour slot (0 helmet, 1 chestplate, 2 leggings, 3 boots)
const SHELLS = [
  [['head', [9.2, 9.2, 9.2], [0, 4.2, 0]]],
  [['body', [9, 12.4, 5], [0, 0.2, 0]], ['armR', [4.9, 6, 4.9], [0, -1, 0]], ['armL', [4.9, 6, 4.9], [0, -1, 0]]],
  [['body', [8.8, 3.4, 4.8], [0, -4.4, 0]], ['legR', [4.7, 9, 4.7], [0, -4.4, 0]], ['legL', [4.7, 9, 4.7], [0, -4.4, 0]]],
  [['legR', [4.9, 4.4, 4.9], [0, -10, 0]], ['legL', [4.9, 4.4, 4.9], [0, -10, 0]]],
];

/** Make the model wear `ids` (four item ids or null). Returns the shell materials (for lighting). */
export function wearArmor(root, ids) {
  const ud = root.userData;
  const key = ids.map((i) => i || 0).join(',');
  if (ud.armorKey === key) return ud.armorMats || [];
  ud.armorKey = key;
  for (const m of ud.armorMeshes || []) { m.parent.remove(m); m.geometry.dispose(); }
  ud.armorMeshes = []; ud.armorMats = [];
  ids.forEach((id, slot) => {
    const a = id && ITEMS[id] && ITEMS[id].armor;
    if (!a) return;
    const mat = new THREE.MeshLambertMaterial({ map: armorTexture(ARMOR_MATERIALS[a.material].color) });
    mat.userData.base = new THREE.Color(0xffffff);
    ud.armorMats.push(mat);
    for (const [part, size, off] of SHELLS[slot]) {
      const parent = ud.parts[part];
      if (!parent) continue;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0] / 16, size[1] / 16, size[2] / 16), mat);
      mesh.position.set(off[0] / 16, off[1] / 16, off[2] / 16);
      mesh.castShadow = true;
      parent.add(mesh);
      ud.armorMeshes.push(mesh);
    }
  });
  return ud.armorMats;
}

/** Light the armour like the rest of the model. */
export function lightArmor(root, L) {
  for (const m of root.userData.armorMats || []) m.color.setScalar(Math.min(1.6, L * 1.35)); // metal reads a little brighter than cloth
}

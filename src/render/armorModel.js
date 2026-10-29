// Worn armour drawn on the box player model (third person and remote
// players): slightly larger shells on the head, body, arms and legs in the
// material's colour. Rebuilt only when the worn pieces change.
import * as THREE from 'three';
import { ITEMS, ARMOR_MATERIALS } from '../world/items.js';
import { itemCanvas } from '../ui/icons.js';

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

/**
 * Make the model wear `ids` (four item ids or null). `glints` (optional, four booleans): which pieces are
 * enchanted; their shells are marked (`material.userData.glint`) so the caller can make them shimmer.
 * Returns the shell materials (for lighting).
 */
export function wearArmor(root, ids, glints = null) {
  const ud = root.userData;
  const key = ids.map((i) => i || 0).join(',') + (glints ? ':' + glints.map((g) => (g ? 1 : 0)).join('') : '');
  if (ud.armorKey === key) return ud.armorMats || [];
  ud.armorKey = key;
  for (const m of ud.armorMeshes || []) { m.parent.remove(m); m.geometry.dispose(); }
  ud.armorMeshes = []; ud.armorMats = [];
  ids.forEach((id, slot) => {
    const a = id && ITEMS[id] && ITEMS[id].armor;
    if (!a) return;
    if (a.glider) { addWings(ud, a); return; } // a Voidwing: two membrane wings on the back
    if (a.pumpkin) { addPumpkinHead(ud); return; } // a Carved Pumpkin: a cube over the head with its face in front
    const mat = new THREE.MeshLambertMaterial({ map: armorTexture(ARMOR_MATERIALS[a.material].color) });
    mat.userData.base = new THREE.Color(0xffffff);
    mat.userData.glint = !!(glints && glints[slot]);
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

/** Voidwing: two folded membrane wings hanging from the shoulders, angled out like the reference elytra. */
function addWings(ud, a) {
  const mat = new THREE.MeshLambertMaterial({ map: armorTexture(ARMOR_MATERIALS[a.material].color), side: THREE.DoubleSide });
  mat.userData.base = new THREE.Color(0xffffff);
  ud.armorMats.push(mat);
  const body = ud.parts.body;
  if (!body) return;
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(10 / 16, 20 / 16, 1 / 16), mat);
    wing.geometry.translate(s * 4 / 16, -8 / 16, 0); // hinge at the shoulder
    wing.position.set(s * 1 / 16, 5 / 16, 3 / 16);
    wing.rotation.set(0.26, 0, s * 0.26);
    wing.castShadow = true;
    body.add(wing);
    ud.armorMeshes.push(wing);
  }
}

/** Light the armour like the rest of the model. */
export function lightArmor(root, L) {
  for (const m of root.userData.armorMats || []) m.color.setScalar(Math.min(1.6, L * 1.35)); // metal reads a little brighter than cloth
}

// ---- Carved Pumpkin on the head ---------------------------------------------------------
const pumpkinTex = {};
function pumpkinTexture(kind) {
  if (pumpkinTex[kind]) return pumpkinTex[kind];
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const px = (x, y, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const f = x % 4 === 0 ? 0.72 : x % 4 === 2 ? 1.04 : 0.92;
    px(x, y, `rgb(${Math.round(216 * f)},${Math.round(128 * f)},${Math.round(30 * f)})`);
  }
  if (kind === 'top') for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) px(x, y, '#6a7a2a');
  if (kind === 'face') {
    const d = '#3a1e06';
    for (const [x0, y0] of [[3, 4], [10, 4]]) for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) if (y - y0 >= Math.abs(x - x0 - 1)) px(x, y, d);
    for (let x = 3; x < 13; x++) { px(x, 10, d); if (x % 3 !== 0) px(x, 11, d); }
    px(4, 9, d); px(11, 9, d);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return (pumpkinTex[kind] = t);
}

/** A cube a little larger than the head, the carved face towards the front (-z). */
function addPumpkinHead(ud) {
  const parent = ud.parts.head;
  if (!parent) return;
  const mats = { side: 'side', top: 'top', face: 'face' };
  const m = {};
  for (const k of Object.keys(mats)) {
    m[k] = new THREE.MeshLambertMaterial({ map: pumpkinTexture(k) });
    m[k].userData.base = new THREE.Color(0xffffff);
    ud.armorMats.push(m[k]);
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(9.4 / 16, 9.4 / 16, 9.4 / 16), [m.side, m.side, m.top, m.top, m.side, m.face]);
  mesh.position.set(0, 4.2 / 16, 0);
  mesh.castShadow = true;
  parent.add(mesh);
  ud.armorMeshes.push(mesh);
}

// ---- Off-hand item of a mob (mobs/offhand.js) ------------------------------------------
const offTex = new Map();
function offhandTexture(id) {
  if (offTex.has(id)) return offTex.get(id);
  const t = new THREE.CanvasTexture(itemCanvas(id));
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  offTex.set(id, t);
  return t;
}

/**
 * Show `st` (a stack or null) in the off-hand of a model: a Shield as a slab across the left side of the chest, any other item as a sprite in that hand, or, on a model without arms (a Vixling), in the mouth.
 * Rebuilt only when the item changes; `L` is the light level.
 */
export function holdOffhand(root, st, L = 1) {
  const ud = root.userData, parts = ud.parts;
  if (!parts) return;
  const id = st && ITEMS[st.id] ? st.id : 0;
  if ((ud.offKey || 0) !== id) {
    ud.offKey = id;
    if (ud.offMesh) { ud.offMesh.parent.remove(ud.offMesh); ud.offMesh.geometry.dispose(); ud.offMats.forEach((m) => m.dispose()); ud.offMesh = null; ud.offMats = []; }
    const hand = parts.armL || null, head = parts.head || null;
    if (id && (hand || head)) {
      const tex = offhandTexture(id);
      let mesh, mats;
      if (ITEMS[id].shield && parts.body) {
        const wood = new THREE.MeshLambertMaterial({ color: 0x5a3d1e });
        wood.userData.base = new THREE.Color(0x5a3d1e);
        const face = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.3 });
        face.userData.base = new THREE.Color(0xffffff);
        mats = [wood, face];
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.06), [wood, wood, wood, wood, face, face]);
        mesh.position.set(0.17, 0.02, -0.27); // strapped across the left side of the chest (the arms may be raised to aim)
        mesh.rotation.y = -0.2;
        parts.body.add(mesh);
      } else if (hand) {
        const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.3, side: THREE.DoubleSide });
        mat.userData.base = new THREE.Color(0xffffff);
        mats = [mat];
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), mat);
        mesh.position.set(0, -0.62, -0.18);
        mesh.rotation.set(0, Math.PI / 2, -0.6);
        hand.add(mesh);
      } else {
        const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.3, side: THREE.DoubleSide });
        mat.userData.base = new THREE.Color(0xffffff);
        mats = [mat];
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), mat);
        mesh.position.set(0, -0.14, -0.42); // carried in the mouth
        mesh.rotation.set(0, Math.PI / 2, 0.5);
        head.add(mesh);
      }
      mesh.castShadow = true;
      ud.offMesh = mesh; ud.offMats = mats;
      if (!ud.disposeOff) {
        const base = ud.dispose;
        ud.disposeOff = true;
        ud.dispose = () => { if (ud.offMesh) { ud.offMesh.geometry.dispose(); ud.offMats.forEach((m) => m.dispose()); } if (base) base(); };
      }
    }
  }
  if (ud.offMats) for (const m of ud.offMats) m.color.copy(m.userData.base).multiplyScalar(L);
}

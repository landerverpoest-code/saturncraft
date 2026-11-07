// The gear round's weapons as small 3D models: the item's own 16x16 pixel art pushed out into a slab of cubes (one per
// opaque pixel), so a Warhammer, Dagger, Glaive or Returning Disc has real thickness in the first-person view and in the
// hands of the third-person and multiplayer player models. Built once per item from the same grid as the icon.
import * as THREE from 'three';
import { ITEMS } from '../world/items.js';
import { toolGrid } from '../ui/icons.js';

const THICK = 0.1; // in model units (the model is 1 wide; callers scale it)

/** Does this item get an extruded model? */
export const hasWeaponModel = (id) => !!(ITEMS[id] && ITEMS[id].weapon && ITEMS[id].weapon.material);

/** Pixels of the grid as [x, y, r, g, b] (opaque only). */
export function gridPixels(grid) {
  const out = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const c = grid[y][x]; if (c) out.push([x, y, c[0], c[1], c[2]]); }
  return out;
}

/** A new model of the weapon `id`, `size` model units wide (call userData.dispose() when done; userData.mat is its material). */
export function buildWeaponModel(id, size = 0.5) {
  const px = gridPixels(toolGrid(ITEMS[id].weapon));
  const geo = new THREE.BoxGeometry(1 / 16, 1 / 16, THICK);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, px.length);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  px.forEach(([x, y, r, g, b], i) => {
    m.makeTranslation((x - 7.5) / 16, (7.5 - y) / 16, 0);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  const g = new THREE.Group();
  g.add(mesh);
  g.scale.setScalar(size);
  g.userData.mat = mat;
  g.userData.dispose = () => { geo.dispose(); mat.dispose(); mesh.dispose(); };
  return g;
}

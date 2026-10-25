// A small 3D Tidespear (reference: trident): a long teal shaft with a butt cap,
// a crossbar and three prongs. Used for the thrown spear, the spear in the
// first-person view and in the hands of the third-person player models.
// It points along +z (prongs forward), so Object3D.lookAt aims it.
import * as THREE from 'three';

export const SPEAR_SHAFT = 0x3f7a72;
export const SPEAR_HEAD = 0x9adcc8;

/** A new spear model (its own geometry and materials; call userData.dispose() when done). */
export function buildSpearModel(scale = 1) {
  const shaft = new THREE.MeshLambertMaterial({ color: SPEAR_SHAFT });
  const head = new THREE.MeshLambertMaterial({ color: SPEAR_HEAD });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const g = new THREE.Group();
  const box = (mat, sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx * scale, sy * scale, sz * scale);
    m.position.set(x * scale, y * scale, z * scale);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  box(shaft, 0.06, 0.06, 1.2, 0, 0, -0.15);       // shaft
  box(head, 0.085, 0.085, 0.1, 0, 0, -0.74);      // butt cap
  box(head, 0.08, 0.08, 0.08, 0, 0, 0.2);         // grip band below the head
  box(head, 0.3, 0.06, 0.06, 0, 0, 0.46);         // crossbar
  box(head, 0.055, 0.055, 0.34, 0, 0, 0.64);      // middle prong
  for (const s of [-1, 1]) {
    box(head, 0.045, 0.045, 0.24, s * 0.125, 0, 0.6); // side prongs
    box(head, 0.03, 0.03, 0.06, s * 0.09, 0, 0.69);   // barbs
  }
  g.userData.mats = [shaft, head];
  g.userData.spear = true;
  g.userData.dispose = () => { geo.dispose(); shaft.dispose(); head.dispose(); };
  return g;
}

/** Light a spear model (L = 0..1) and let an enchanted one shimmer purple. */
export function lightSpear(g, L, glint = false, sec = 0) {
  const [shaft, head] = g.userData.mats;
  shaft.color.setHex(SPEAR_SHAFT).multiplyScalar(L);
  head.color.setHex(SPEAR_HEAD).multiplyScalar(L);
  const k = glint ? 0.5 + 0.5 * Math.sin(sec * 3) : 0;
  for (const m of g.userData.mats) m.emissive.setRGB(glint ? 0.05 + 0.05 * k : 0, 0, glint ? 0.08 + 0.08 * k : 0);
}

/** The spear as held in a model's hand (a group hanging from the arm's pivot; the arm points down -y). */
export function heldSpearModel() {
  const g = buildSpearModel(0.8);
  // the arm hangs down; hold the spear pointing forward-up out of the fist
  g.position.set(0, -0.62, -0.05);
  g.rotation.set(-Math.PI / 2 - 0.25, 0, 0); // prongs up and a little forward
  const holder = new THREE.Group();
  holder.add(g);
  holder.userData.mats = g.userData.mats;
  holder.userData.dispose = g.userData.dispose;
  holder.userData.spear = true;
  return holder;
}

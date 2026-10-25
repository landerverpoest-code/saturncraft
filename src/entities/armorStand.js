// Armour Stand: a wooden figure on a stone plate that wears armour and holds
// an item. Placed on top of a block facing the player (turned in 45-degree
// steps); right-click with armour puts it on (swapping), with any other item
// puts that in its hand, empty-handed takes off the piece that was clicked.
// Two quick hits (or one in creative) knock it down, dropping the stand and
// everything it wore. The host simulates stands; guests see proxies (net/).
import * as THREE from 'three';
import { Body } from '../physics/body.js';
import { ITEMS, I } from '../world/items.js';
import { MIN_Y } from '../world/constants.js';
import { withExtras } from '../world/enchantments.js';
import { itemCanvas } from '../ui/icons.js';
import { wearArmor, lightArmor } from '../render/armorModel.js';

export const STAND_WIDTH = 0.5, STAND_HEIGHT = 1.975;
export const BREAK_WINDOW = 5; // ticks: a second hit within this knocks the stand down
const STEP = Math.PI / 4;
let nextId = 9_000_000;

/** Yaw of a stand placed by a player looking along `playerYaw`: facing back at them, snapped to 45 degrees, in [0, 2pi). */
export function standYaw(playerYaw) {
  const k = ((Math.round((playerYaw + Math.PI) / STEP) % 8) + 8) % 8;
  return k * STEP;
}

/** Which armour slot a click at height `relY` above the stand's feet is aimed at (0 head .. 3 feet). */
export function slotAt(relY) {
  if (relY >= 1.55) return 0;
  if (relY >= 0.95) return 1;
  if (relY >= 0.4) return 2;
  return 3;
}

const copy = (st) => (st ? withExtras({ id: st.id, count: st.count, damage: st.damage | 0 }, st) : null);

/**
 * Right-click on a stand with `held` (the selected stack, or null) at height `relY`.
 * Changes the stand and returns { ok, give }: when ok, the player's selected slot becomes `give`.
 */
export function useStand(stand, held, relY) {
  const d = held && ITEMS[held.id];
  if (d && d.armor) {
    const slot = d.armor.slot, old = stand.armor[slot];
    stand.armor[slot] = copy(held);
    return { ok: true, give: old };
  }
  if (held) {
    const old = stand.hand;
    stand.hand = copy(held);
    return { ok: true, give: old };
  }
  const slot = slotAt(relY);
  if (stand.armor[slot]) { const old = stand.armor[slot]; stand.armor[slot] = null; return { ok: true, give: old }; }
  if (slot === 1 && stand.hand) { const old = stand.hand; stand.hand = null; return { ok: true, give: old }; } // the arm is at chest height
  return { ok: false, give: null };
}

/** A hit at game tick `tick`: 'break' on the second quick hit (or any hit in creative), else 'wobble'. */
export function hitStand(stand, tick, creative = false) {
  if (creative || (stand.lastHit != null && tick - stand.lastHit <= BREAK_WINDOW)) { stand.dead = true; return 'break'; }
  stand.lastHit = tick;
  stand.hitTime = 10;
  return 'wobble';
}

/** What a knocked-down stand drops: the stand itself (not in creative), its armour and its held item. */
export function standDrops(stand, creative = false) {
  const out = creative ? [] : [{ id: I.ARMOR_STAND, count: 1 }];
  for (const st of stand.armor) if (st) out.push(copy(st));
  if (stand.hand) out.push(copy(stand.hand));
  return out;
}

/** A hit by a player (creative or not) on a stand the game simulates: wobble, or knock it down and drop its things. */
export function punchStand(game, stand, creative) {
  const r = hitStand(stand, game.ticks, creative);
  game.audio.play(r === 'break' ? 'break_wood' : 'hit_wood', [stand.x, stand.y + 1, stand.z]);
  if (r !== 'break') return r;
  for (const st of standDrops(stand, creative)) game.entities.spawnItem(stand.x, stand.y + 0.8, stand.z, st);
  if (game.particles) game.particles.smoke(stand.x, stand.y + 1, stand.z, 10, 0.6);
  return r;
}

/** Save form of a stand. */
export function standSaveData(e) {
  return { x: e.x, y: e.y, z: e.z, yaw: e.yaw, armor: e.armor.map(copy), hand: copy(e.hand) };
}

const validStack = (st) => (st && ITEMS[st.id] && Number.isInteger(st.count) && st.count > 0 ? copy(st) : null);

/** A stand from its save form (null if broken). */
export function standFromSave(d) {
  if (!d || ![d.x, d.y, d.z].every(Number.isFinite)) return null;
  const e = new ArmorStand(d.x, d.y, d.z, Number.isFinite(d.yaw) ? d.yaw : 0);
  const arm = Array.isArray(d.armor) ? d.armor : [];
  e.armor = [0, 1, 2, 3].map((i) => { const st = validStack(arm[i]); return st && ITEMS[st.id].armor && ITEMS[st.id].armor.slot === i ? st : null; });
  e.hand = validStack(d.hand);
  return e;
}

/** The armour stands of the current dimension in save form. */
export function liveStands(game) {
  return game.entities.list.filter((e) => e.kind === 'stand' && !e.dead && !e.netProxy).map(standSaveData);
}

/** Put saved armour stands back into the world. */
export function loadStands(game, list) {
  for (const d of list || []) { const e = standFromSave(d); if (e) game.entities.add(e); }
}

/** Is there a stand standing in the block cell x,y,z? */
export function standAt(list, x, y, z) {
  return list.some((e) => e.kind === 'stand' && !e.dead && Math.floor(e.x) === x && Math.floor(e.z) === z && Math.abs(e.y - y) < 1);
}

export class ArmorStand {
  constructor(x, y, z, yaw = 0) {
    this.id = nextId++;
    this.kind = 'stand';
    this.body = new Body(STAND_WIDTH, STAND_HEIGHT);
    this.body.stepHeight = 0;
    this.body.setPos(x, y, z);
    this.yaw = yaw;
    this.armor = [null, null, null, null];
    this.hand = null;
    this.hitTime = 0; this.lastHit = null;
    this.dead = false;
    this.prev = [x, y, z];
  }
  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }
  get width() { return STAND_WIDTH; } get height() { return STAND_HEIGHT; }

  tick(game) {
    const b = this.body;
    this.prev = [b.x, b.y, b.z];
    if (this.hitTime > 0) this.hitTime--;
    b.vx = 0; b.vz = 0;
    b.vy = Math.max(-1, b.vy - 0.04); // it falls when the ground goes
    b.move(game.world, 0, b.vy, 0);
    if (b.onGround) b.vy = 0;
    if (b.y < MIN_Y - 64) this.dead = true;
  }

  // ---- rendering (EntityManager calls these) ----------------------------------------
  createMesh() {
    const root = new THREE.Group(), parts = {};
    const wood = new THREE.MeshLambertMaterial({ color: 0xa8804a }), stone = new THREE.MeshLambertMaterial({ color: 0x9a9a9a });
    const box = (parent, w, h, d, x, y, z, mat = wood) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w / 16, h / 16, d / 16), mat);
      m.position.set(x / 16, y / 16, z / 16); m.castShadow = true; parent.add(m);
    };
    // pivots match the player model's, so the armour shells (render/armorModel.js) sit right
    const part = (name, px, py) => { const g = new THREE.Group(); g.position.set(px / 16, py / 16, 0); root.add(g); parts[name] = g; return g; };
    box(root, 12, 1, 12, 0, 0.5, 0, stone);                     // base plate
    box(part('head', 0, 24), 2, 7, 2, 0, 3.5, 0);                // neck
    const body = part('body', 0, 18);
    box(body, 12, 3, 3, 0, 4.5, 0);                              // shoulders
    box(body, 2, 7, 2, -2, -0.5, 0); box(body, 2, 7, 2, 2, -0.5, 0); // spine
    box(body, 8, 2, 2, 0, -5, 0);                                // hips
    box(part('armR', 6, 22), 2, 12, 2, 0, -5, 0);
    box(part('armL', -6, 22), 2, 12, 2, 0, -5, 0);
    box(part('legR', 2, 12), 2, 11, 2, 0, -5.5, 0);
    box(part('legL', -2, 12), 2, 11, 2, 0, -5.5, 0);
    parts.armR.rotation.set(-0.2, 0, 0.1); parts.armL.rotation.set(-0.2, 0, -0.1);
    root.userData.parts = parts;
    root.userData.mats = [wood, stone];
    root.userData.dispose = () => {
      this.setHeld(root, null);
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      wood.dispose(); stone.dispose();
    };
    return root;
  }

  setHeld(root, id) {
    const ud = root.userData;
    if (ud.heldId === id) return;
    ud.heldId = id;
    if (ud.held) { ud.parts.armR.remove(ud.held); ud.held.geometry.dispose(); ud.held.material.map.dispose(); ud.held.material.dispose(); ud.held = null; }
    if (id == null) return;
    const tex = new THREE.CanvasTexture(itemCanvas(id));
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.3, side: THREE.DoubleSide }));
    m.position.set(0, -0.62, -0.18);
    m.rotation.set(0, Math.PI / 2, 0.6);
    ud.parts.armR.add(m);
    ud.held = m;
  }

  renderUpdate(m, px, py, pz, alpha, L) {
    m.position.set(px, py, pz);
    m.rotation.set(0, this.yaw + (this.hitTime > 0 ? Math.sin(this.hitTime * 1.3) * 0.12 : 0), 0);
    for (const mat of m.userData.mats) mat.color.setHex(mat === m.userData.mats[0] ? 0xa8804a : 0x9a9a9a).multiplyScalar(L);
    wearArmor(m, this.armor.map((s) => (s ? s.id : null)));
    lightArmor(m, L);
    this.setHeld(m, this.hand ? this.hand.id : null);
    if (m.userData.held) m.userData.held.material.color.setScalar(L);
  }
}

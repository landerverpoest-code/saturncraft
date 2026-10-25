// The player's body for the third-person camera views (F5): the mob box
// model system with walking, sneaking, attack swing, head pitch and the held item.
import * as THREE from 'three';
import { buildModel, animateModel } from '../mobs/models.js';
import { itemCanvas } from '../ui/icons.js';
import { lightAt } from '../entities/entities.js';
import { entityGlow } from './entityLight.js';
import { SWING_TICKS } from '../player/interaction.js';
import { wearArmor, lightArmor } from './armorModel.js';
import { heldSpearModel, lightSpear } from './spearModel.js';
import { ITEMS } from '../world/items.js';

export class PlayerModel {
  constructor(scene) {
    this.root = buildModel('player');
    this.root.visible = false;
    scene.add(this.root);
    // adapter with the fields animateModel reads from a mob
    this.anim = { id: 0, type: 'player', limbSwing: 0, limbAmount: 0, hurtTime: 0, deathTime: 0, headPitch: 0, angry: false, target: null };
    this.itemId = -1;
    this.item = null;
    this.lastPos = null;
    this.bodyYaw = 0;
    for (const k of ['head', 'hair']) this.root.userData.parts[k].rotation.order = 'YXZ';
  }

  setHeldItem(id) {
    if (id === this.itemId) return;
    this.itemId = id;
    const arm = this.root.userData.parts.armR;
    if (this.item) { arm.remove(this.item); if (this.item.userData.dispose) this.item.userData.dispose(); else { this.item.material.map.dispose(); this.item.material.dispose(); } this.item = null; }
    if (id == null) return;
    if (ITEMS[id] && ITEMS[id].spear) { this.item = heldSpearModel(); arm.add(this.item); return; } // a 3D Tidespear
    const tex = new THREE.CanvasTexture(itemCanvas(id));
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    this.item = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.3, side: THREE.DoubleSide }));
    this.item.position.set(0, -0.62, -0.18);
    this.item.rotation.set(0, Math.PI / 2, 0.6);
    this.item.castShadow = true;
    arm.add(this.item);
  }

  update(game, visible, alpha, sec) {
    this.root.visible = visible;
    if (!visible) { this.lastPos = null; return; }
    const p = game.player, b = p.body;
    const x = p.prev.x + (b.x - p.prev.x) * alpha, y = p.prev.y + (b.y - p.prev.y) * alpha, z = p.prev.z + (b.z - p.prev.z) * alpha;
    // limbs follow the distance walked; the body turns towards the walking direction / view
    if (this.lastPos) {
      const moved = Math.hypot(x - this.lastPos[0], z - this.lastPos[2]);
      this.anim.limbAmount += (Math.min(1, moved * 6) - this.anim.limbAmount) * 0.25;
      this.anim.limbSwing += moved * 4;
    }
    this.lastPos = [x, y, z];
    let d = p.yaw - this.bodyYaw;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 0.8) this.bodyYaw += d - Math.sign(d) * 0.8; // head turns up to ~45 degrees before the body follows
    this.bodyYaw += d * 0.08;
    this.root.position.set(x, y - (p.sneaking ? 0.12 : 0) + (p.sleeping ? 0 : 0), z);
    this.root.rotation.set(0, this.bodyYaw, 0);
    if (p.sleeping) this.root.rotation.set(-Math.PI / 2, p.yaw, 0, 'YXZ');
    if (p.swimming) { this.root.rotation.set(-Math.PI / 2 - p.pitch, p.yaw, 0, 'YXZ'); this.root.position.y += 0.3; } // flat, head first
    if (p.gliding) { this.root.rotation.set(-Math.PI / 2 - p.pitch * 0.8, p.yaw, 0, 'YXZ'); this.root.position.y += 0.3; this.bodyYaw = p.yaw; } // Voidwing: stretched out along the flight
    this.anim.hurtTime = p.hurtTime;
    this.anim.headPitch = p.pitch;
    const L = lightAt(game, x, y + 1.6, z);
    animateModel(this.root, this.anim, alpha, L, sec, entityGlow(game, x, y + 1.2, z));
    wearArmor(this.root, p.inventory.armor.map((s) => (s ? s.id : null)));
    lightArmor(this.root, L);
    const parts = this.root.userData.parts;
    parts.head.rotation.y = p.yaw - this.bodyYaw;
    parts.hair.rotation.copy(parts.head.rotation);
    parts.body.rotation.x = p.sneaking ? 0.45 : 0;
    if (p.riding) { parts.legL.rotation.x = parts.legR.rotation.x = -1.4; parts.legL.rotation.z = -0.15; parts.legR.rotation.z = 0.15; } // seated in a boat, cart or saddle
    else parts.legL.rotation.z = parts.legR.rotation.z = 0;
    // attack / mining swing of the right arm
    const it = game.interaction;
    const t = it.swing > 0 ? Math.min(1, (SWING_TICKS - it.swing + alpha) / SWING_TICKS) : 0;
    if (t > 0) parts.armR.rotation.x = -Math.sin(t * Math.PI) * 1.6 - 0.3;
    const st = p.inventory.selectedStack;
    this.setHeldItem(st ? st.id : null);
    if (this.item && this.item.userData.spear) {
      // a Tidespear held up behind the head while charging a throw
      if (st && it.bowDraw > 0) parts.armR.rotation.x = Math.PI - 0.3 + p.pitch * 0.5;
      lightSpear(this.item, L, !!(st && st.ench && Object.keys(st.ench).length), sec);
    }
  }
}

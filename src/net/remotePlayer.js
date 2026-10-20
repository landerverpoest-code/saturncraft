// Other players in a multiplayer session: the third-person player model with a
// name tag, smoothed between network updates, plus (on the host) a stand-in
// object that mob AI can target like the local player.
import * as THREE from 'three';
import { wearArmor, lightArmor } from '../render/armorModel.js';
import { buildModel, animateModel } from '../mobs/models.js';
import { itemCanvas } from '../ui/icons.js';
import { lightAt } from '../entities/entities.js';
import { PHYS } from '../physics/constants.js';

const SWING_MS = 300;

function nameTagSprite(name) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = 'bold 28px sans-serif';
  const w = Math.ceil(ctx.measureText(name).width) + 20;
  c.width = w; c.height = 40;
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, w, 40);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 10, 21);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(w / 40 * 0.32, 0.32, 1);
  s.renderOrder = 10;
  return s;
}

export class RemotePlayer {
  constructor(scene, id, name, session = null) {
    this.id = id;
    this.name = name;
    this.scene = scene;
    this.session = session;
    this.root = buildModel('player');
    this.root.visible = false;
    for (const k of ['head', 'hair']) this.root.userData.parts[k].rotation.order = 'YXZ';
    this.tag = nameTagSprite(name);
    this.tag.position.set(0, 2.25, 0);
    this.root.add(this.tag);
    scene.add(this.root);
    this.anim = { id, type: 'player', limbSwing: 0, limbAmount: 0, hurtTime: 0, deathTime: 0, headPitch: 0, angry: false, target: null };
    this.state = null;          // latest received state
    this.from = null;           // displayed state when it arrived
    this.t0 = 0; this.interval = 100; this.lastRecv = 0;
    this.shown = null;          // currently displayed {x,y,z,yaw,pitch}
    this.bodyYaw = 0;
    this.swingSeq = null; this.swingAt = -1e9;
    this.itemId = -1; this.item = null;
    this.target = makeTarget(this);
  }

  /** A new state arrived (see protocol.unpackPlayerState). */
  setState(s, now = performance.now()) {
    if (!s) return;
    if (this.swingSeq !== null && s.swing !== this.swingSeq) this.swingAt = now;
    this.swingSeq = s.swing;
    this.from = this.shown ? { ...this.shown } : { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch };
    if (this.lastRecv) this.interval = Math.max(50, Math.min(300, now - this.lastRecv));
    this.lastRecv = this.t0 = now;
    this.state = s;
  }

  get x() { return this.state ? this.state.x : 0; }
  get y() { return this.state ? this.state.y : 0; }
  get z() { return this.state ? this.state.z : 0; }

  setHeldItem(id) {
    if (id === this.itemId) return;
    this.itemId = id;
    const arm = this.root.userData.parts.armR;
    if (this.item) { arm.remove(this.item); this.item.material.map.dispose(); this.item.material.dispose(); this.item.geometry.dispose(); this.item = null; }
    if (id == null) return;
    let canvas;
    try { canvas = itemCanvas(id); } catch { return; }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    this.item = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.3, side: THREE.DoubleSide }));
    this.item.position.set(0, -0.62, -0.18);
    this.item.rotation.set(0, Math.PI / 2, 0.6);
    arm.add(this.item);
  }

  update(game, sec, now = performance.now()) {
    const s = this.state;
    if (!s || s.dead) { this.root.visible = false; return; }
    this.root.visible = true;
    const f = Math.min(1, (now - this.t0) / this.interval);
    const a = this.from;
    let dyaw = s.yaw - a.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2; while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const cur = { x: a.x + (s.x - a.x) * f, y: a.y + (s.y - a.y) * f, z: a.z + (s.z - a.z) * f, yaw: a.yaw + dyaw * f, pitch: a.pitch + (s.pitch - a.pitch) * f };
    if (this.shown) {
      const moved = Math.hypot(cur.x - this.shown.x, cur.z - this.shown.z);
      this.anim.limbAmount += (Math.min(1, moved * 6) - this.anim.limbAmount) * 0.25;
      this.anim.limbSwing += moved * 4;
    }
    this.shown = cur;
    let d = cur.yaw - this.bodyYaw;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 0.8) this.bodyYaw += d - Math.sign(d) * 0.8;
    this.bodyYaw += d * 0.08;
    this.root.position.set(cur.x, cur.y - (s.sneaking ? 0.12 : 0), cur.z);
    this.root.rotation.set(0, this.bodyYaw, 0);
    if (s.sleeping) this.root.rotation.set(-Math.PI / 2, cur.yaw, 0, 'YXZ');
    this.anim.hurtTime = s.hurt ? 5 : 0;
    this.anim.headPitch = cur.pitch;
    const L = lightAt(game, cur.x, cur.y + 1.6, cur.z);
    animateModel(this.root, this.anim, 1, L, sec);
    wearArmor(this.root, s.armor || [null, null, null, null]);
    lightArmor(this.root, L);
    const parts = this.root.userData.parts;
    parts.head.rotation.y = cur.yaw - this.bodyYaw;
    parts.hair.rotation.copy(parts.head.rotation);
    parts.body.rotation.x = s.sneaking ? 0.45 : 0;
    const t = (now - this.swingAt) / SWING_MS;
    if (t >= 0 && t < 1) parts.armR.rotation.x = -Math.sin(t * Math.PI) * 1.6 - 0.3;
    this.setHeldItem(s.held);
  }

  dispose() {
    this.setHeldItem(null);
    this.scene.remove(this.root);
    this.tag.material.map.dispose(); this.tag.material.dispose();
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

/** What mob AI sees of a remote player on the host (same fields it reads from game.player). */
function makeTarget(rp) {
  const st = () => rp.state || { x: 0, y: -1000, z: 0, yaw: 0, pitch: 0, dead: true };
  return {
    isPlayer: true, isRemotePlayer: true, remote: rp,
    get netName() { return rp.name; },
    get x() { return st().x; }, get y() { return st().y; }, get z() { return st().z; },
    get yaw() { return st().yaw; }, get pitch() { return st().pitch; },
    get dead() { return !rp.state || !!rp.state.dead; },
    get creative() { return !!st().creative; },
    get sneaking() { return !!st().sneaking; },
    get eyeHeight() { return st().sneaking ? PHYS.PLAYER_SNEAK_EYE : PHYS.PLAYER_EYE; },
    width: 0.6, height: PHYS.PLAYER_HEIGHT,
    body: { height: PHYS.PLAYER_HEIGHT, width: PHYS.PLAYER_WIDTH, vx: 0, vy: 0, vz: 0, onGround: true },
    lastHurtBy: null, lastAttacked: null,
    stats: { kills: 0, blocksMined: 0 },
    inventory: { get selectedStack() { const h = st().held; return h == null ? null : { id: h, count: 1 }; } },
    eyePos() { const s = st(); return [s.x, s.y + this.eyeHeight, s.z]; },
    lookDir() { const s = st(), cp = Math.cos(s.pitch); return [-Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp]; },
    // a mob, an explosion or another player hurts this player: their own game applies it (armour etc.)
    hurt(amount, source = 'generic', attacker = null) {
      return rp.session ? rp.session.targetHurt(rp, amount, source, attacker) : false;
    },
  };
}

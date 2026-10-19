// Block selection outline, break-progress cracks and the first-person held item.
import * as THREE from 'three';
import { BLOCKS, SHAPE } from '../world/blocks.js';
import { ITEMS } from '../world/items.js';
import { texturePixels } from '../world/textures.js';
import { itemCanvas } from '../ui/icons.js';
import { blockFaceTexture, lightAt } from '../entities/entities.js';
import { SWING_TICKS } from '../player/interaction.js';

export class BlockOverlay {
  constructor(scene) {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
    this.outline.visible = false;
    scene.add(this.outline);
    this.crackTex = [];
    for (let i = 0; i < 10; i++) {
      const t = new THREE.DataTexture(new Uint8Array(texturePixels('destroy_' + i)), 16, 16, THREE.RGBAFormat);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.needsUpdate = true;
      this.crackTex.push(t);
    }
    // Cracks are multiplied into the block (2 * crack * block), so they follow
    // its lighting: grey texels leave it unchanged, dark ones darken it.
    this.crackMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.crackTex[0] } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.a > 0.5 ? t.rgb : vec3(0.5), 1.0); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), this.crackMat);
    this.crack.visible = false;
    scene.add(this.crack);
  }

  update(interaction, hidden) {
    const t = interaction.target;
    if (!t || hidden || interaction.mobTarget) { this.outline.visible = false; this.crack.visible = false; return; }
    const d = BLOCKS[t.id];
    this.outline.visible = true;
    if (d.shape === SHAPE.CROSS) { this.outline.scale.set(0.7, 0.8, 0.7); this.outline.position.set(t.x + 0.5, t.y + 0.4, t.z + 0.5); }
    else if (d.shape === SHAPE.TORCH) { this.outline.scale.set(0.25, 0.625, 0.25); this.outline.position.set(t.x + 0.5, t.y + 0.3125, t.z + 0.5); }
    else { this.outline.scale.set(1, 1, 1); this.outline.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5); }
    const br = interaction.breaking;
    if (br && br.progress > 0) {
      this.crack.visible = true;
      this.crack.position.set(br.x + 0.5, br.y + 0.5, br.z + 0.5);
      this.crackMat.uniforms.map.value = this.crackTex[Math.min(9, Math.floor(br.progress * 10))];
    } else this.crack.visible = false;
  }
}

const SHOULDER = new THREE.Vector3(0.6, -0.95, -0.55); // swing pivot, below the bottom-right of the view
const _pivotRot = new THREE.Vector3(), _offset = new THREE.Vector3();

export class HeldItem {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6);
    dl.position.set(0.5, 1, 0.8);
    this.scene.add(dl);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.currentId = -1;
    this.mesh = null;
    // first-person arm: a sleeve with a bare hand at the end
    this.hand = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.36, 0.15), new THREE.MeshLambertMaterial({ color: 0x3a5a7a }));
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshLambertMaterial({ color: 0xc9946a }));
    sleeve.position.y = -0.1; palm.position.y = 0.15;
    this.hand.add(sleeve, palm);
    this.equipAnim = 0;
  }

  resize() { this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix(); }

  build(id) {
    this.group.clear();
    this.mesh = null;
    if (id == null) { this.group.add(this.hand); this.hand.position.set(0.52, -0.48, -0.8); this.hand.rotation.set(-0.55, 0.2, 0.32); return; }
    const d = ITEMS[id];
    if (d.block !== undefined && BLOCKS[d.block].shape !== SHAPE.CROSS && BLOCKS[d.block].shape !== SHAPE.TORCH) {
      const b = BLOCKS[d.block];
      const side = new THREE.MeshLambertMaterial({ map: blockFaceTexture(b.tex.side), transparent: true, alphaTest: 0.3 });
      const top = new THREE.MeshLambertMaterial({ map: blockFaceTexture(b.tex.top), transparent: true, alphaTest: 0.3 });
      if (b.tint) { const c = b.tint === 'grass' ? 0x6eb446 : 0x50962f; top.color.set(c); if (b.tint !== 'grass') side.color.set(c); }
      this.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), [side, side, top, top, side, side]);
      this.mesh.position.set(0.5, -0.45, -0.75);
      this.mesh.rotation.set(0.1, 0.8, 0);
    } else {
      const tex = new THREE.CanvasTexture(itemCanvas(id));
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), mat);
      this.mesh.position.set(0.55, -0.35, -0.75);
      this.mesh.rotation.set(0, -1.2, 0.35);
    }
    this.group.add(this.mesh);
  }

  render(renderer, alpha, sec) {
    const g = this.game, p = g.player;
    if (p.dead || !g.hud.visible) return;
    const st = p.inventory.selectedStack;
    const id = st ? st.id : null;
    if (id !== this.currentId) { this.currentId = id; this.build(id); this.equipAnim = 1; }
    this.equipAnim = Math.max(0, this.equipAnim - 0.12);
    const it = g.interaction;
    // Swing: an arc toward the screen centre and a forward chop, pivoting at
    // the shoulder (curves follow the reference game's first-person swing).
    const t = it.swing > 0 ? Math.min(1, (SWING_TICKS - it.swing + alpha) / SWING_TICKS) : 0;
    const arc = Math.sin(Math.sqrt(t) * Math.PI), lift = Math.sin(Math.sqrt(t) * Math.PI * 2), push = Math.sin(t * Math.PI);
    const twist = Math.sin(t * t * Math.PI);
    const eat = it.eating > 0 ? Math.sin(sec * 20) * 0.03 : 0;
    const b = p.body;
    const walk = b.onGround ? Math.min(1, Math.hypot(b.vx, b.vz) * 6) : 0;
    this.group.rotation.set(arc * 0.35 - push * 0.25, twist * 0.3, arc * 0.45);
    _pivotRot.copy(SHOULDER).applyEuler(this.group.rotation);
    this.group.position.copy(SHOULDER).sub(_pivotRot).add(_offset.set(
      Math.sin(sec * 9) * 0.02 * walk - arc * 0.2 - (it.eating ? 0.25 : 0),
      -Math.abs(Math.cos(sec * 9)) * 0.02 * walk - this.equipAnim * 0.5 + eat + (it.eating ? 0.1 : 0) + arc * 0.1 + lift * 0.05,
      -push * 0.15));
    const L = lightAt(g, p.x, p.y + 1.6, p.z) * (0.4 + 0.6 * Math.min(1, g.sky.state.combined + 0.25));
    this.scene.children[0].intensity = 0.1 + 1.9 * L;
    this.scene.children[1].intensity = 1.6 * L;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}

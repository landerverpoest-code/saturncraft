// Ambient critters on screen: butterflies by day over flowers, fireflies at night in swamps and forests, leaves falling from autumn
// canopies, dragonfly-like skimmers over water and bird flocks high in the sky. One InstancedMesh of camera-facing quads per kind (five draw
// calls at most, hard caps from world/critterRules.js), no entities, no collision, nothing sent over the network, nothing saved. Positions
// are closed-form functions of the world seed and a local clock (see the rules file), rebuilt twice a second; a frame costs a handful of
// multiplications and one matrix per visible critter. Reduced motion lowers the counts and slows the clock (ui/accessibility.js
// motionScales); reduced flashing / motion keeps the fireflies steadily lit instead of blinking.
import * as THREE from 'three';
import { climate } from '../world/seasons.js';
import { fxOf } from '../ui/accessibility.js';
import {
  KINDS, CAPS, CELL, VIEW, REFRESH, newPools, rebuild, critterPos, birdPos, kindFactors, critterScales, flockCount, flockSize, seedNumber,
} from '../world/critterRules.js';

const px = (ctx, color, pts) => { ctx.fillStyle = color; for (const [x, y, w = 1, h = 1] of pts) ctx.fillRect(x, y, w, h); };

/** A 16 x 16 pixel sprite for each kind (white shapes get tinted by the instance colour). Null without a canvas (tests). */
function spriteTexture(kind) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d');
  if (kind === 'butterfly') {
    px(ctx, '#ffffff', [[1, 4, 5, 2], [2, 6, 4, 3], [3, 9, 3, 2], [10, 4, 5, 2], [10, 6, 4, 3], [10, 9, 3, 2]]);
    px(ctx, '#b0b0b0', [[2, 5, 1, 1], [13, 5, 1, 1], [4, 7, 1, 1], [11, 7, 1, 1]]);
    px(ctx, '#2a2420', [[7, 4, 2, 8], [6, 3, 1, 1], [9, 3, 1, 1]]);
  } else if (kind === 'firefly') {
    px(ctx, 'rgba(255,255,255,0.18)', [[3, 3, 10, 10]]);
    px(ctx, 'rgba(255,255,255,0.45)', [[5, 5, 6, 6]]);
    px(ctx, '#ffffff', [[7, 7, 2, 2]]);
  } else if (kind === 'leaf') {
    px(ctx, '#ffffff', [[4, 6, 8, 5], [6, 4, 5, 2], [5, 11, 5, 2]]);
    px(ctx, '#8a8a8a', [[7, 7, 1, 1], [8, 8, 1, 1], [9, 9, 1, 1], [3, 12, 2, 1]]);
  } else if (kind === 'skimmer') {
    px(ctx, 'rgba(255,255,255,0.7)', [[1, 4, 6, 3], [9, 4, 6, 3], [2, 9, 5, 2], [9, 9, 5, 2]]);
    px(ctx, '#ffffff', [[1, 7, 14, 2]]);
    px(ctx, '#3a6a6a', [[13, 7, 2, 2]]);
  } else { // bird: a gull-wing "v"
    px(ctx, '#ffffff', [[0, 6, 3, 2], [3, 7, 3, 2], [6, 8, 4, 2], [10, 7, 3, 2], [13, 6, 3, 2], [7, 7, 2, 1]]);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SHAPE = { butterfly: [1, 0.9], firefly: [1, 1], leaf: [1, 1], skimmer: [1.5, 0.5], bird: [1.6, 0.6] }; // quad width / height multipliers

export class Critters {
  /** `scene`: the THREE scene the meshes join. */
  constructor(scene) {
    this.scene = scene;
    this.pools = newPools();
    this.meshes = {};
    this.mats = {};
    const geo = new THREE.PlaneGeometry(1, 1);
    for (const kind of KINDS) {
      const glow = kind === 'firefly';
      const mat = new THREE.MeshBasicMaterial({
        map: spriteTexture(kind), transparent: true, alphaTest: glow ? 0 : 0.35, depthWrite: false, side: THREE.DoubleSide,
        blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, CAPS[kind]);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1)); // makes the colour buffer
      mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; mesh.renderOrder = glow ? 3 : 2;
      scene.add(mesh);
      this.meshes[kind] = mesh; this.mats[kind] = mat;
    }
    this.clock = 0; this.lastSec = null; this.lastRefresh = -1e9; this.cell = null;
    this.factors = null; this.flocks = 0; this.shown = { butterfly: 0, firefly: 0, leaf: 0, skimmer: 0, bird: 0 };
    this._m = new THREE.Matrix4(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._r = new THREE.Quaternion(); this._z = new THREE.Vector3(0, 0, 1); this._c = new THREE.Color(); this._o = [0, 0, 0, 0];
  }

  /** Hide everything (another dimension, underground). */
  hide() {
    for (const k of KINDS) { this.meshes[k].count = 0; this.meshes[k].visible = false; this.shown[k] = 0; }
  }

  /** The total number of critters drawn this frame. */
  get total() { let n = 0; for (const k of KINDS) n += this.shown[k]; return n; }

  /**
   * One frame. `game` supplies world, player, sky, weather, seasons and fx; `camera` the view; `sec` the render clock in seconds.
   */
  update(game, camera, sec) {
    const w = game.world, p = game.player;
    const dt = this.lastSec === null ? 0 : Math.min(0.1, Math.max(0, sec - this.lastSec));
    this.lastSec = sec;
    const [count, speed] = critterScales(fxOf(game));
    if (w.dimension !== 'overworld' || count <= 0 || p.dead) { this.hide(); return; }
    this.clock += dt * speed;
    const x = camera.position.x, y = camera.position.y, z = camera.position.z;
    // underground (a cave well below the surface): nothing to see
    const ix = Math.floor(x), iz = Math.floor(z);
    if (y < w.heightAt(ix, iz) - 14) { this.hide(); return; }
    const day = Math.min(1, game.sky.state.combined);
    const cell = Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
    if (this.cell !== cell || sec - this.lastRefresh >= REFRESH || this.factors === null) {
      this.cell = cell; this.lastRefresh = sec;
      this.factors = kindFactors({ day, rain: game.weather ? game.weather.level : 0, season: climate.on && game.seasons ? game.seasons.state.key : null, scale: count });
      this.seed = seedNumber(w.seed);
      rebuild(this.pools, w, this.seed, x, z, this.factors);
      this.flocks = flockCount(this.factors);
    }
    const t = this.clock, cam = camera.quaternion, o = this._o, m = this._m, pos = this._p, sc = this._s, q = this._q;
    const L = 0.3 + 0.7 * day; // daylight on the sprites
    const glowBoost = game.postfx && game.postfx.enabled ? 1.8 : 1;
    const twinkle = fxOf(game).twinkle; // 0 when motion or flashing are reduced: the fireflies then stay steadily lit
    // ground critters
    for (const kind of ['butterfly', 'firefly', 'leaf', 'skimmer']) {
      const mesh = this.meshes[kind], pool = this.pools[kind], [wm, hm] = SHAPE[kind];
      let n = 0;
      for (let i = 0; i < pool.n; i++) {
        const s = pool.list[i];
        critterPos(kind, s, t, o);
        const dx = o[0] - x, dy = o[1] - y, dz = o[2] - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > VIEW) continue;
        const fade = Math.min(1, (VIEW - d) / 8) * s.presence * (d < 1.5 ? d / 1.5 : 1); // shrinks away at the edge, fades in as the weather turns
        if (fade < 0.02) continue;
        let size = s.size * fade, flapX = 1;
        q.copy(cam);
        if (kind === 'butterfly') flapX = o[3];
        else if (kind === 'leaf') { this._r.setFromAxisAngle(this._z, o[3]); q.multiply(this._r); }
        if (kind === 'firefly') {
          const blink = twinkle > 0 ? 0.25 + 0.75 * o[3] : 0.8; // glow
          this._c.setRGB(s.cr * blink * glowBoost, s.cg * blink * glowBoost, s.cb * blink * glowBoost);
          mesh.setColorAt(n, this._c);
        } else if (kind === 'skimmer' && o[3] < 0.55) size *= 0.82; // wing blur
        pos.set(o[0], o[1], o[2]);
        sc.set(size * wm * flapX, size * hm, 1);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(n, m);
        if (kind !== 'firefly') { this._c.setRGB(s.cr, s.cg, s.cb); mesh.setColorAt(n, this._c); }
        n++;
      }
      this.finish(kind, n);
    }
    // bird flocks, high up
    {
      const mesh = this.meshes.bird;
      let n = 0;
      for (let f = 0; f < this.flocks; f++) {
        const size = flockSize(this.seed, f);
        for (let i = 0; i < size && n < CAPS.bird; i++) {
          birdPos(this.seed, f, i, t, x, z, o);
          pos.set(o[0], o[1], o[2]);
          q.copy(cam);
          sc.set(0.95 * 1.6, 0.95 * 0.6 * (0.35 + 0.65 * o[3]), 1);
          m.compose(pos, q, sc);
          mesh.setMatrixAt(n, m);
          this._c.setRGB(0.12, 0.13, 0.16);
          mesh.setColorAt(n, this._c);
          n++;
        }
      }
      this.finish('bird', n);
    }
    for (const kind of KINDS) {
      const c = this.mats[kind].color;
      if (kind === 'firefly') c.setRGB(1, 1, 1);
      else if (kind === 'bird') c.setScalar(0.4 + 0.6 * day);
      else c.setScalar(L);
    }
  }

  finish(kind, n) {
    const mesh = this.meshes[kind];
    mesh.count = n; mesh.visible = n > 0; this.shown[kind] = n;
    if (n > 0) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  }

  dispose() {
    for (const k of KINDS) {
      this.scene.remove(this.meshes[k]);
      this.meshes[k].dispose();
      if (this.mats[k].map) this.mats[k].map.dispose();
      this.mats[k].dispose();
    }
  }
}

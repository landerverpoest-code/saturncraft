// Blocky cloud layer: 12x12-block cells, 4 blocks thick, drifting east at
// 0.03 blocks per tick at y=192, like the reference game's "fancy" clouds.
// Drawn in two passes (depth, then colour) so overlapping cloud faces never
// blend into each other; colour follows the combined light of the three suns.
import * as THREE from 'three';
import { Simplex } from '../world/noise.js';

export const CLOUD_Y = 192;
export const CLOUD_CELL = 12;
export const CLOUD_THICKNESS = 4;
export const CLOUD_SPEED = 0.03; // blocks per tick

const vertex = /* glsl */ `
attribute float shade;
varying float vShade;
varying vec3 vWorld;
void main() {
  vShade = shade;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const fragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFog;
uniform float uRange;
uniform float uOpacity;
varying float vShade;
varying vec3 vWorld;
void main() {
  float d = length(vWorld.xz - cameraPosition.xz);
  float fade = smoothstep(uRange, uRange * 0.6, d);
  vec3 col = mix(uColor * vShade, uFog, smoothstep(uRange * 0.25, uRange, d) * 0.75);
  gl_FragColor = vec4(col, uOpacity * fade);
  #include <colorspace_fragment>
}`;

export class Clouds {
  constructor(scene, seed) {
    this.noise = new Simplex(seed ^ 0x5c10d);
    this.uniforms = {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uFog: { value: new THREE.Color() },
      uRange: { value: 300 },
      uOpacity: { value: 0.8 },
    };
    this.geometry = new THREE.BufferGeometry();
    const depth = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms, colorWrite: false, transparent: true, fog: false });
    const color = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms, depthWrite: false, depthFunc: THREE.LessEqualDepth, transparent: true, fog: false });
    this.depthMesh = new THREE.Mesh(this.geometry, depth);
    this.mesh = new THREE.Mesh(this.geometry, color);
    for (const m of [this.depthMesh, this.mesh]) { m.frustumCulled = false; scene.add(m); }
    this.depthMesh.renderOrder = 10; this.mesh.renderOrder = 11;
    this.key = '';
    this.visible = true;
  }

  /** Is there cloud in cell (i, j) of the (drifting) cloud grid? */
  cell(i, j) {
    const n = this.noise.noise2(i * 0.16, j * 0.16) + 0.45 * this.noise.noise2(i * 0.45 + 50, j * 0.45 - 20);
    return n > 0.32;
  }

  rebuild(i0, j0, N) {
    const pos = [], shade = [], idx = [];
    const S = CLOUD_CELL, H = CLOUD_THICKNESS;
    const filled = new Uint8Array((N + 2) * (N + 2));
    for (let j = -1; j <= N; j++) for (let i = -1; i <= N; i++) filled[(i + 1) + (j + 1) * (N + 2)] = this.cell(i0 + i, j0 + j) ? 1 : 0;
    const at = (i, j) => filled[(i + 1) + (j + 1) * (N + 2)];
    const quad = (a, b, c, d, s) => {
      const v = pos.length / 3;
      pos.push(...a, ...b, ...c, ...d);
      shade.push(s, s, s, s);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (!at(i, j)) continue;
      const x0 = i * S, x1 = x0 + S, z0 = j * S, z1 = z0 + S;
      quad([x0, H, z1], [x1, H, z1], [x1, H, z0], [x0, H, z0], 1.0);   // top
      quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], 0.72);  // bottom
      if (!at(i - 1, j)) quad([x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0], 0.88);
      if (!at(i + 1, j)) quad([x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1], 0.88);
      if (!at(i, j - 1)) quad([x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0], 0.8);
      if (!at(i, j + 1)) quad([x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1], 0.8);
    }
    // the cloud cover as a small texture, so the terrain shader can cast cloud shadows
    const cover = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) cover[(i + j * N) * 4] = at(i, j) * 255;
    if (this.shadowTex) this.shadowTex.dispose();
    this.shadowTex = new THREE.DataTexture(cover, N, N, THREE.RGBAFormat);
    this.shadowTex.magFilter = this.shadowTex.minFilter = THREE.LinearFilter;
    this.shadowTex.needsUpdate = true;
    this.shadowN = N;
    const g = this.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
  }

  /**
   * @param camera   camera (world position)
   * @param ticks    world time in ticks (drives the drift)
   * @param sky      Sky (combined sun state and horizon colour)
   * @param range    horizontal distance at which clouds have faded out
   */
  update(camera, ticks, sky, range) {
    const drift = (ticks * CLOUD_SPEED) % (CLOUD_CELL * 100000);
    const N = Math.ceil((range * 2) / CLOUD_CELL) + 2;
    const i0 = Math.floor((camera.position.x - drift) / CLOUD_CELL) - (N >> 1);
    const j0 = Math.floor(camera.position.z / CLOUD_CELL) - (N >> 1);
    const key = `${i0},${j0},${N}`;
    if (key !== this.key) { this.key = key; this.rebuild(i0, j0, N); }
    this.origin = [i0 * CLOUD_CELL + drift, j0 * CLOUD_CELL]; // world x, z of the cover texture's corner
    for (const m of [this.depthMesh, this.mesh]) {
      m.position.set(i0 * CLOUD_CELL + drift, CLOUD_Y, j0 * CLOUD_CELL);
      m.visible = this.visible;
    }
    const st = sky.state, lc = st.lightColor, day = Math.min(1, st.combined);
    // white by day (slightly tinted by the blend of visible suns), dark blue-grey at night
    const k = (0.1 + 0.9 * Math.pow(day, 0.8)) * (1 - 0.5 * (sky.rain || 0)); // grey rain clouds
    this.uniforms.uColor.value.setRGB(
      k * (0.75 + 0.25 * lc[0]) + 0.02, k * (0.75 + 0.25 * lc[1]) + 0.025, k * (0.75 + 0.25 * lc[2]) + 0.04);
    this.uniforms.uFog.value.copy(sky.horizon);
    this.uniforms.uRange.value = range;
  }
}

// Weather: clear spells of 12000-180000 ticks alternate with rain of
// 12000-24000 ticks (reference timers). The rain level fades in and out at
// 0.01 per tick. Biomes colder than 0.15 get snow, deserts stay dry.
// WeatherRenderer draws falling rain/snow on billboard columns around the
// player down to the highest block of each column (so roofs keep it out).
import * as THREE from 'three';
import { BIOMES } from '../world/biomes.js';

export const CLEAR_TICKS = [12000, 180000];
export const RAIN_TICKS = [12000, 24000];
// Thunder runs on its own timer and only shows while it is also raining.
export const CLEAR_THUNDER_TICKS = [12000, 180000];
export const THUNDER_TICKS = [3600, 15600];

const randRange = (rng, [a, b]) => a + Math.floor(rng() * (b - a));

export class Weather {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.raining = false;
    this.timer = randRange(rng, CLEAR_TICKS);
    this.level = 0;
    this.thundering = false;
    this.thunderTimer = randRange(rng, CLEAR_THUNDER_TICKS);
    this.thunderLevel = 0;
  }

  tick() {
    if (--this.timer <= 0) {
      this.raining = !this.raining;
      this.timer = randRange(this.rng, this.raining ? RAIN_TICKS : CLEAR_TICKS);
    }
    this.level = Math.max(0, Math.min(1, this.level + (this.raining ? 0.01 : -0.01)));
    if (--this.thunderTimer <= 0) {
      this.thundering = !this.thundering;
      this.thunderTimer = randRange(this.rng, this.thundering ? THUNDER_TICKS : CLEAR_THUNDER_TICKS);
    }
    this.thunderLevel = Math.max(0, Math.min(1, this.thunderLevel + (this.thundering && this.raining ? 0.01 : -0.01)));
  }

  /** How stormy it is (0..1): thunder only counts while it rains. */
  get storm() { return this.thunderLevel * this.level; }

  /** 'rain', 'snow' or null for a biome. */
  static precipitation(biomeId) {
    const b = BIOMES[biomeId];
    if (!b || b.key === 'desert') return null;
    return b.temp < 0.15 ? 'snow' : 'rain';
  }

  /** Is it raining on this spot (open to the sky, in a rainy biome)? */
  rainingAt(world, x, y, z) {
    if (this.level < 0.2) return false;
    const bx = Math.floor(x), bz = Math.floor(z);
    if (Weather.precipitation(world.biomeAt(bx, bz)) !== 'rain') return false;
    return world.heightAt(bx, bz) < Math.floor(y);
  }

  save() { return { raining: this.raining, timer: this.timer, level: this.level, thundering: this.thundering, thunderTimer: this.thunderTimer, thunderLevel: this.thunderLevel }; }
  load(d) {
    if (!d) return;
    this.raining = d.raining; this.timer = d.timer; this.level = d.level;
    if (d.thunderTimer !== undefined) { this.thundering = d.thundering; this.thunderTimer = d.thunderTimer; this.thunderLevel = d.thunderLevel; }
  }
}

const R = 9;        // column radius around the player
const ABOVE = 14;   // how far above the eye the streaks start
const BELOW = 10;   // how far below the eye they may reach

const vertex = /* glsl */ `
attribute float seed;
attribute float kind;
varying vec2 vUv;
varying float vSeed;
varying float vKind;
varying float vDist;
void main() {
  vUv = uv; vSeed = seed; vKind = kind;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDist = length(wp.xz - cameraPosition.xz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const fragment = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform vec3 uColor;
varying vec2 vUv;
varying float vSeed;
varying float vKind;
varying float vDist;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float a = 0.0;
  if (vKind < 0.5) {
    // rain: thin streaks scrolling down quickly
    vec2 g = vec2(vUv.x * 6.0, vUv.y * 0.9 + uTime * (2.6 + vSeed * 0.8) + vSeed * 7.0);
    vec2 cell = floor(g);
    float h = hash(cell + vSeed * 13.0);
    float x = fract(g.x) - 0.5;
    float y = fract(g.y);
    a = step(abs(x), 0.06) * step(0.55, h) * smoothstep(0.0, 0.25, y) * smoothstep(1.0, 0.6, y);
  } else {
    // snow: flakes drifting slowly with a sideways wobble
    vec2 g = vec2(vUv.x * 4.0 + sin(uTime * 1.3 + vUv.y * 3.0 + vSeed * 6.0) * 0.15, vUv.y * 2.5 + uTime * (0.35 + vSeed * 0.15) + vSeed * 5.0);
    vec2 cell = floor(g);
    float h = hash(cell + vSeed * 17.0);
    vec2 f = fract(g) - vec2(0.3 + 0.4 * hash(cell + 3.1), 0.5);
    a = step(0.5, h) * smoothstep(0.12, 0.06, length(f * vec2(1.0, 0.7)));
  }
  a *= uLevel * smoothstep(${R.toFixed(1)}, ${(R * 0.5).toFixed(1)}, vDist);
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor * (vKind < 0.5 ? 0.85 : 1.0), a * (vKind < 0.5 ? 0.55 : 0.9));
  #include <colorspace_fragment>
}`;

export class WeatherRenderer {
  constructor(scene) {
    this.uniforms = { uTime: { value: 0 }, uLevel: { value: 0 }, uColor: { value: new THREE.Color(0.75, 0.8, 0.9) } };
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    scene.add(this.mesh);
    this.key = '';
    this.rebuildTicks = 0;
  }

  /** Rebuild the billboard columns around (x, z), each facing the camera. */
  rebuild(world, cx, cy, cz, yaw) {
    const pos = [], uv = [], seed = [], kind = [], idx = [];
    const rx = Math.cos(yaw) * 0.5, rz = -Math.sin(yaw) * 0.5; // camera right vector / 2
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > R * R || (Math.abs(dx) + Math.abs(dz) === 0)) continue; // skip the camera's own column (seen edge-on)
      const x = cx + dx, z = cz + dz;
      const p = Weather.precipitation(world.biomeAt(x, z));
      if (!p) continue;
      const top = cy + ABOVE;
      const bottom = Math.max(cy - BELOW, world.heightAt(x, z) + 1);
      if (bottom >= top) continue;
      const mx = x + 0.5, mz = z + 0.5;
      const v = pos.length / 3;
      pos.push(mx - rx, bottom, mz - rz, mx + rx, bottom, mz + rz, mx + rx, top, mz + rz, mx - rx, top, mz - rz);
      const v0 = bottom * 0.25, v1 = top * 0.25; // world-anchored so streaks do not jump when rebuilt
      uv.push(0, v0, 1, v0, 1, v1, 0, v1);
      const s = ((x * 73856093) ^ (z * 19349663)) >>> 0;
      const sd = (s % 1000) / 1000;
      for (let k = 0; k < 4; k++) { seed.push(sd); kind.push(p === 'snow' ? 1 : 0); }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    const g = this.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('kind', new THREE.Float32BufferAttribute(kind, 1));
    g.setIndex(idx);
  }

  update(world, camera, yaw, level, seconds, lightLevel) {
    this.mesh.visible = level > 0.01;
    this.uniforms.uLevel.value = level;
    this.uniforms.uTime.value = seconds;
    this.uniforms.uColor.value.setRGB(0.25 + 0.6 * lightLevel, 0.27 + 0.62 * lightLevel, 0.32 + 0.62 * lightLevel);
    if (!this.mesh.visible) return;
    const cx = Math.floor(camera.position.x), cy = Math.floor(camera.position.y), cz = Math.floor(camera.position.z);
    const yawStep = Math.round(yaw / 0.2);
    const key = `${cx},${cy},${cz},${yawStep}`;
    if (key !== this.key || --this.rebuildTicks <= 0) { this.key = key; this.rebuildTicks = 30; this.rebuild(world, cx, cy, cz, yawStep * 0.2); }
  }
}

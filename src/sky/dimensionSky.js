// Skies of the other dimensions. The Cinderdeep has none (a bedrock ceiling,
// thick red-orange haze, no suns or weather); the Hollow has a black-violet
// void full of stars and faint nebulae. The overworld Sky object is kept but
// hidden while away: its suns are switched off and its state replaced by a
// constant "sunless" one so sunlight rules (burning, sleeping) never apply.
import * as THREE from 'three';
import { skyState } from './suns.js';
import { DIMENSIONS } from '../world/dimensions/dims.js';

const vert = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = `
uniform float uTime;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  vec3 d = normalize(vDir);
  float n = noise(d * 3.0) * 0.6 + noise(d * 7.0) * 0.3 + noise(d * 15.0) * 0.1;
  vec3 base = mix(vec3(0.012, 0.006, 0.024), vec3(0.05, 0.02, 0.08), smoothstep(-0.6, 0.6, d.y));
  vec3 neb = vec3(0.22, 0.07, 0.30) * smoothstep(0.55, 0.85, n) + vec3(0.04, 0.12, 0.16) * smoothstep(0.6, 0.9, noise(d * 4.0 + 7.0));
  vec3 c = base + neb * 0.55;
  vec3 g = d * 220.0;
  vec3 cell = floor(g);
  float h = hash(cell);
  if (h > 0.985) {
    vec3 f = fract(g) - 0.5;
    float s = smoothstep(0.32, 0.0, length(f)) * (0.6 + 0.4 * sin(uTime * (1.0 + h * 3.0) + h * 40.0));
    c += vec3(0.85, 0.85, 1.0) * s * (h - 0.985) * 66.0;
  }
  gl_FragColor = vec4(c, 1.0);
}`;

export class DimensionSky {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = { uTime: { value: 0 } };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.dome.renderOrder = 1000;
    this.dome.frustumCulled = false;
    this.dome.visible = false;
    scene.add(this.dome);
    this.background = new THREE.Color();
  }

  /** Show/hide the overworld sky pieces for a dimension. */
  apply(game, dim) {
    const over = dim === 'overworld';
    const sky = game.sky;
    sky.mesh.visible = over;
    if (sky.rings && sky.rings.ring) sky.rings.ring.visible = over;
    if (game.clouds) game.clouds.visible = over;
    this.dome.visible = dim === 'hollow';
    if (over) { game.scene.background = null; return; }
    const f = DIMENSIONS[dim].fog;
    this.background.setRGB(f[0], f[1], f[2]);
    game.scene.background = dim === 'cinderdeep' ? this.background : null;
  }

  /** Per-frame sky for a non-overworld dimension; returns the sunless sky state. */
  update(game, dim, t, seconds, camera) {
    const sky = game.sky, def = DIMENSIONS[dim];
    const st = { ...skyState(t), aboveCount: 1, isDay: true, phase: 'day', combined: 1, skyDarken: 0, sunlit: false };
    sky.state = st;
    sky.horizon.setRGB(def.fog[0], def.fog[1], def.fog[2]);
    sky.zenith.copy(sky.horizon);
    for (const l of sky.lights) { l.intensity = 0; l.shadow.needsUpdate = false; }
    if (dim === 'cinderdeep') {
      // a warm dim glow for mobs, items and the held item; terrain uses block light and the ambient floor
      sky.hemi.color.setRGB(1.0, 0.62, 0.48); sky.hemi.groundColor.setRGB(0.5, 0.18, 0.1); sky.hemi.intensity = 1.1;
      const flick = 0.92 + 0.08 * Math.sin(seconds * 0.7) * Math.sin(seconds * 1.9);
      this.background.setRGB(def.fog[0] * flick, def.fog[1] * flick, def.fog[2] * flick);
      sky.horizon.copy(this.background);
    } else {
      sky.hemi.color.setRGB(0.78, 0.72, 0.9); sky.hemi.groundColor.setRGB(0.3, 0.26, 0.36); sky.hemi.intensity = 0.95;
      this.dome.position.copy(camera.position);
      this.uniforms.uTime.value = seconds;
    }
    return st;
  }
}

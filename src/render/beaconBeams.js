// Beacon beams: a bright core and a faint outer glow rising from each active
// beacon to the top of the world, in the colour the stained glass above gives
// them, with bands drifting upwards (additive, so the bloom pass makes them glow).
import * as THREE from 'three';
import { MAX_Y } from '../world/constants.js';

const VERT = `
varying float vY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG = `
uniform vec3 uColor; uniform float uAlpha; uniform float uTime; uniform float uBase;
varying float vY;
void main() {
  float bands = 0.75 + 0.25 * sin(vY * 0.9 - uTime * 4.0);
  float fade = smoothstep(0.0, 1.5, vY - uBase);
  gl_FragColor = vec4(uColor * bands * 1.6, uAlpha * fade);
}`;

const GEO = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

export class BeaconBeams {
  constructor(scene) {
    this.scene = scene;
    this.beams = new Map(); // "x,y,z" -> { group, mats }
  }

  /** Show exactly these beams: [{ x, y, z, color: [r, g, b] }]. */
  set(list) {
    const keep = new Set();
    for (const b of list) {
      const k = `${b.x},${b.y},${b.z}`;
      keep.add(k);
      let e = this.beams.get(k);
      if (!e) {
        const group = new THREE.Group(), mats = [];
        for (const [w, a] of [[0.36, 0.9], [0.62, 0.22]]) {
          const mat = new THREE.ShaderMaterial({
            vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: a }, uTime: { value: 0 }, uBase: { value: b.y + 1 } },
          });
          const mesh = new THREE.Mesh(GEO, mat);
          mesh.scale.set(w, MAX_Y - b.y, w);
          mesh.frustumCulled = false;
          group.add(mesh); mats.push(mat);
        }
        group.position.set(b.x + 0.5, b.y + 1, b.z + 0.5);
        this.scene.add(group);
        e = { group, mats };
        this.beams.set(k, e);
      }
      for (const m of e.mats) m.uniforms.uColor.value.setRGB(b.color[0], b.color[1], b.color[2]);
    }
    for (const [k, e] of this.beams) if (!keep.has(k)) { this.scene.remove(e.group); for (const m of e.mats) m.dispose(); this.beams.delete(k); }
  }

  update(sec) {
    for (const e of this.beams.values()) {
      e.group.rotation.y = sec * 0.6;
      for (const m of e.mats) m.uniforms.uTime.value = sec;
    }
  }
}

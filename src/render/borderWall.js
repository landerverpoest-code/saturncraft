// The world border's wall (world/border.js): four tall translucent sheets with drifting diagonal stripes, drawn only for
// the walls the player is close to. Pale blue at rest, red while the border closes in, green while it opens.
import * as THREE from 'three';
import { BORDER_SHOW } from '../world/border.js';

const SPAN = 48; // each sheet covers this many blocks to either side of the player, and up and down

export class BorderWall {
  constructor(scene) {
    this.uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.35, 0.75, 1) }, uFade: { value: 1 }, uBox: { value: new THREE.Vector4() } }; // uBox: the square (minX, minZ, maxX, maxZ); a sheet is cut off at its corners
    const mat = () => new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uFade: { value: 1 } },
      vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uFade; uniform vec4 uBox; varying vec3 vW;
        void main() { if (vW.x < uBox.x - 0.01 || vW.x > uBox.z + 0.01 || vW.z < uBox.y - 0.01 || vW.z > uBox.w + 0.01) discard; float s = fract((vW.x + vW.z + vW.y) * 0.5 + uTime * 0.6); float a = (s < 0.5 ? 0.42 : 0.16) * uFade; gl_FragColor = vec4(uColor, a); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.sheets = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(SPAN * 2, SPAN * 2), mat());
      if (i < 2) m.rotation.y = Math.PI / 2; // the two walls at x = centre -/+ half
      m.visible = false; m.frustumCulled = false; m.renderOrder = 5;
      scene.add(m); this.sheets.push(m);
    }
  }

  /** Place the sheets for where the player stands; `sec` is the running time in seconds. */
  update(border, px, py, pz, sec) {
    const on = border && border.active;
    this.uniforms.uTime.value = sec;
    if (on) { const mv = border.moving; this.uniforms.uColor.value.setRGB(mv < 0 ? 1 : 0.35, mv < 0 ? 0.25 : mv > 0 ? 1 : 0.75, mv < 0 ? 0.2 : mv > 0 ? 0.45 : 1); }
    const h = on ? border.half : 0;
    if (on) this.uniforms.uBox.value.set(border.cx - h, border.cz - h, border.cx + h, border.cz + h);
    const walls = on ? [[border.cx - h, 0], [border.cx + h, 0], [border.cz - h, 1], [border.cz + h, 1]] : [];
    for (let i = 0; i < 4; i++) {
      const m = this.sheets[i];
      if (!on) { m.visible = false; continue; }
      const [at, axis] = walls[i];
      const d = Math.abs((axis ? pz : px) - at);
      m.visible = d < BORDER_SHOW;
      if (!m.visible) continue;
      m.material.uniforms.uFade.value = Math.min(1, (BORDER_SHOW - d) / 8);
      if (axis) m.position.set(Math.max(border.cx - h, Math.min(border.cx + h, px)), py, at);
      else m.position.set(at, py, Math.max(border.cz - h, Math.min(border.cz + h, pz)));
    }
  }

  dispose(scene) { for (const m of this.sheets) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); } }
}

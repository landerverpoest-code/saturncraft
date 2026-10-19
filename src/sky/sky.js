// Sky renderer + sun lights. Combines the three suns into sky colours, the
// ambient term, fog colour, and three shadow-casting directional lights.
import * as THREE from 'three';
import { SUNS, skyState } from './suns.js';
import { skyVertex, skyFragment } from './skyShader.js';

const DEG = Math.PI / 180;

export const PLANET = {
  azimuth: 200 * DEG,
  elevation: 34 * DEG,
  angularRadius: 8.5 * DEG,
  axisTiltToView: 72 * DEG, // how open the rings appear
  axisRoll: 18 * DEG,
  ringInner: 1.28,
  ringOuter: 2.35,
  librationPeriod: 96000,
};

/** Direction to the gas giant (slow libration of a tidally locked moon). */
export function planetDirection(t) {
  const lib = Math.sin((t / PLANET.librationPeriod) * Math.PI * 2);
  const az = PLANET.azimuth + lib * 2.5 * DEG;
  const el = PLANET.elevation + Math.cos((t / PLANET.librationPeriod) * Math.PI * 2) * 1.5 * DEG;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export class Sky {
  constructor(scene, renderer, opts = {}) {
    this.scene = scene;
    this.uniforms = {
      uSunDir: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      uSunColor: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
      uSunFactor: { value: [0, 0, 0] },
      uSunSize: { value: SUNS.map((s) => s.size) },
      uSunIntensity: { value: SUNS.map((s) => s.intensity) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uCombined: { value: 0 },
      uTime: { value: 0 },
      uPlanetDir: { value: new THREE.Vector3() },
      uPlanetAxis: { value: new THREE.Vector3() },
      uPlanetRadius: { value: Math.sin(PLANET.angularRadius) },
      uRingInner: { value: PLANET.ringInner },
      uRingOuter: { value: PLANET.ringOuter },
      uUnderwater: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: skyVertex, fragmentShader: skyFragment,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // Lights
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a4030, 1);
    scene.add(this.hemi);
    this.lights = [];
    this.shadowSize = opts.shadowMapSize ?? 1024;
    this.shadowExtent = opts.shadowExtent ?? 44;
    for (let i = 0; i < 3; i++) {
      const l = new THREE.DirectionalLight(0xffffff, 0);
      l.castShadow = true;
      l.shadow.mapSize.set(this.shadowSize, this.shadowSize);
      const cam = l.shadow.camera;
      cam.left = -this.shadowExtent; cam.right = this.shadowExtent; cam.top = this.shadowExtent; cam.bottom = -this.shadowExtent;
      cam.near = 1; cam.far = 400;
      l.shadow.bias = -0.0004;
      l.shadow.normalBias = 0.04;
      l.shadow.autoUpdate = false;
      scene.add(l); scene.add(l.target);
      this.lights.push(l);
    }
    this.frame = 0;
    this.state = skyState(0);
    this.horizon = new THREE.Color();
    this.zenith = new THREE.Color();
  }

  setShadowsEnabled(on) {
    for (const l of this.lights) l.castShadow = on;
  }

  /** Recompute everything for world time t (ticks) and the camera/player position. */
  update(t, seconds, camera, focus) {
    const st = skyState(t);
    this.state = st;
    const u = this.uniforms;
    u.uTime.value = seconds;
    u.uCombined.value = st.combined;

    // Sky colours: night base + day colour tinted by blended sunlight
    const lc = st.lightColor;
    const day = Math.min(1, st.combined);
    const nightZ = [0.004, 0.006, 0.018], nightH = [0.02, 0.025, 0.05];
    const dayZ = [0.18 * (0.6 + 0.4 * lc[2]), 0.36 * (0.7 + 0.3 * lc[1]), 0.85 * lc[2] + 0.1];
    const dayH = [0.62 * lc[0] + 0.1, 0.72 * lc[1] + 0.08, 0.9 * lc[2] + 0.05];
    // Warm horizon when suns are low
    let warm = 0;
    for (const s of st.suns) warm += s.factor * Math.exp(-Math.abs(s.elevation) * 6);
    warm = Math.min(1, warm);
    const mix = (a, b, k) => a + (b - a) * k;
    const d = Math.pow(day, 0.8);
    this.zenith.setRGB(mix(nightZ[0], dayZ[0], d), mix(nightZ[1], dayZ[1], d), mix(nightZ[2], dayZ[2], d));
    this.horizon.setRGB(
      mix(nightH[0], dayH[0], d) + warm * 0.35,
      mix(nightH[1], dayH[1], d) + warm * 0.14,
      mix(nightH[2], dayH[2], d) * (1 - warm * 0.4),
    );
    u.uZenith.value.copy(this.zenith);
    u.uHorizon.value.copy(this.horizon);

    st.suns.forEach((s, i) => {
      u.uSunDir.value[i].set(s.dir[0], s.dir[1], s.dir[2]);
      u.uSunColor.value[i].setRGB(s.color[0], s.color[1], s.color[2]);
      u.uSunFactor.value[i] = s.factor;
    });
    const pd = planetDirection(t);
    u.uPlanetDir.value.copy(pd);
    // ring axis: tilted relative to the view direction so rings appear as an open ellipse
    const side = new THREE.Vector3().crossVectors(pd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, pd).normalize();
    const axis = up.clone().multiplyScalar(Math.sin(PLANET.axisTiltToView)).addScaledVector(pd, -Math.cos(PLANET.axisTiltToView));
    axis.applyAxisAngle(pd, PLANET.axisRoll).normalize();
    u.uPlanetAxis.value.copy(axis);

    this.mesh.position.copy(camera.position);

    // Ambient: sky hemisphere scaled by combined light, plus faint planetshine at night
    const planetShine = 0.06 * (1 - day);
    this.hemi.color.setRGB(this.zenith.r * 0.6 + lc[0] * 0.4 * day, this.zenith.g * 0.6 + lc[1] * 0.4 * day, this.zenith.b * 0.6 + lc[2] * 0.4 * day);
    this.hemi.groundColor.setRGB(0.3 * day + 0.03, 0.27 * day + 0.03, 0.22 * day + 0.04);
    this.hemi.intensity = 0.45 + 1.05 * day + planetShine * 10;

    // Directional sun lights following the focus point
    const snap = (this.shadowExtent * 2) / this.shadowSize;
    st.suns.forEach((s, i) => {
      const l = this.lights[i];
      const f = s.factor * s.sun.shadowStrength;
      l.color.setRGB(s.color[0], s.color[1], s.color[2]);
      l.intensity = f * 3.4 * (s.elevation > 0 ? 1 : 0);
      const fx = Math.round(focus.x / snap) * snap, fy = Math.round(focus.y / snap) * snap, fz = Math.round(focus.z / snap) * snap;
      l.target.position.set(fx, fy, fz);
      l.position.set(fx + s.dir[0] * 200, fy + s.dir[1] * 200, fz + s.dir[2] * 200);
      l.target.updateMatrixWorld();
    });
    // Round-robin shadow map refresh: brightest sun every other frame, others in turn
    this.frame++;
    const order = st.suns.map((s, i) => [s.factor, i]).sort((a, b) => b[0] - a[0]);
    const pick = this.frame % 2 === 0 ? order[0][1] : order[1 + ((this.frame >> 1) % 2)][1];
    for (let i = 0; i < 3; i++) this.lights[i].shadow.needsUpdate = false;
    if (this.lights[pick].intensity > 0.01) this.lights[pick].shadow.needsUpdate = true;
    else if (this.lights[order[0][1]].intensity > 0.01) this.lights[order[0][1]].shadow.needsUpdate = true;
    return st;
  }
}

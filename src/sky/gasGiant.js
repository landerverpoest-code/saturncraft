// Ring system of the gas giant: a ring mesh with a shader for banded density,
// differential (Keplerian) rotation per radius, translucency, specular
// glints and the planet's shadow, plus a particle layer of orbiting ice
// chunks. Both live in camera-relative sky space and are occluded by the
// planet sphere that the sky shader draws.
import * as THREE from 'three';

export const SKY_DIST = 400; // distance of the planet centre in sky space

const common = /* glsl */ `
uniform vec3 uSunDir[3];
uniform vec3 uSunColor[3];
uniform float uSunIntensity[3];
uniform vec3 uPlanetC;      // planet centre (sky space, camera-relative)
uniform float uPlanetR;     // planet radius (sky space)
uniform vec3 uAxis;
uniform vec3 uE1;
uniform vec3 uE2;
uniform float uTime;
uniform float uInner;
uniform float uOuter;
uniform float uDay;
float sphereHit(vec3 o, vec3 d, vec3 c, float r) {
  vec3 oc = o - c;
  float b = dot(oc, d);
  float h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) return -1.0;
  return -b - sqrt(h);
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float omegaAt(float rho) { return 0.035 * pow(rho, -1.5); } // Kepler: angular speed ~ r^-1.5
`;

const ringVertex = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz - cameraPosition; // camera-relative
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w * 0.99999; // behind everything but the sky
}
`;

const ringFragment = /* glsl */ `
${common}
varying vec3 vPos;
float ringDensity(float rho, float phi) {
  float x = (rho - uInner) / (uOuter - uInner);
  if (x < 0.0 || x > 1.0) return 0.0;
  float bands = 0.55 + 0.45 * sin(x * 38.0 + 1.3 * sin(x * 7.0));
  float fine = vnoise(vec2(rho * 140.0, 0.5));
  float gap = smoothstep(0.015, 0.035, abs(x - 0.62)) * smoothstep(0.005, 0.02, abs(x - 0.86));
  float edge = smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.92, x);
  float clump = vnoise(vec2(rho * 60.0, phi * 40.0));
  float d = bands * (0.55 + 0.45 * fine) * gap * edge * (0.8 + 0.35 * clump);
  return clamp(d * (x < 0.3 ? 0.55 : 1.0), 0.0, 1.0);
}
void main() {
  vec3 dir = normalize(vPos);
  float dist = length(vPos);
  // hidden behind the planet?
  float tp = sphereHit(vec3(0.0), dir, uPlanetC, uPlanetR);
  if (tp > 0.0 && tp < dist) discard;
  vec3 rv = (vPos - uPlanetC) / uPlanetR;
  float rho = length(rv);
  float phi = atan(dot(rv, uE2), dot(rv, uE1));
  float phiRot = phi - uTime * omegaAt(rho);   // each radius band rotates at its own speed
  float dens = ringDensity(rho, phiRot);
  if (dens <= 0.001) discard;
  vec3 lit = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec3 sd = uSunDir[i];
    float sh = sphereHit(vPos, sd, uPlanetC, uPlanetR) > 0.0 ? 0.0 : 1.0;      // planet shadow
    float sameSide = sign(dot(sd, uAxis)) == sign(dot(-dir, uAxis)) ? 1.0 : 0.35; // back-lit translucency
    float tilt = 0.25 + 0.75 * abs(dot(sd, uAxis));
    vec3 hv = normalize(sd - dir);
    float spec = pow(abs(dot(hv, uAxis)), 60.0);
    float sparkle = step(0.993, hash12(floor(vec2(rho * 320.0, phiRot * 800.0))));
    lit += uSunColor[i] * uSunIntensity[i] * sh * (sameSide * tilt + spec * 1.4 + sparkle * spec * 4.0 + sparkle * 0.12 * tilt);
  }
  vec3 col = mix(vec3(0.82, 0.74, 0.62), vec3(0.95, 0.9, 0.82), vnoise(vec2(rho * 30.0, 1.0)));
  float vis = 1.0 - 0.72 * clamp(uDay, 0.0, 1.0);
  gl_FragColor = vec4(col * (lit + 0.03), dens * 0.88 * vis);
  #include <colorspace_fragment>
}
`;

const particleVertex = /* glsl */ `
${common}
attribute vec3 orbit; // radius (planet radii), start angle, vertical offset
varying vec3 vCol;
varying float vAlpha;
void main() {
  float rho = orbit.x;
  float phi = orbit.y - uTime * omegaAt(rho);
  vec3 p = uPlanetC + (uE1 * cos(phi) + uE2 * sin(phi)) * rho * uPlanetR + uAxis * orbit.z * uPlanetR;
  vec3 dir = normalize(p);
  float tp = sphereHit(vec3(0.0), dir, uPlanetC, uPlanetR);
  float hidden = (tp > 0.0 && tp < length(p)) ? 0.0 : 1.0;
  vec3 lit = vec3(0.0);
  float glint = 0.0;
  for (int i = 0; i < 3; i++) {
    float sh = sphereHit(p, uSunDir[i], uPlanetC, uPlanetR) > 0.0 ? 0.0 : 1.0;
    vec3 hv = normalize(uSunDir[i] - dir);
    float tw = 0.5 + 0.5 * sin(uTime * (3.0 + fract(orbit.y * 13.7) * 6.0) + orbit.y * 50.0);
    glint += pow(abs(dot(hv, uAxis)), 40.0) * tw * sh * uSunIntensity[i];
    lit += uSunColor[i] * uSunIntensity[i] * sh;
  }
  vCol = vec3(0.9, 0.92, 1.0) * (lit * 0.6 + glint * 3.0);
  vAlpha = hidden * (0.12 + glint) * (1.0 - 0.8 * clamp(uDay, 0.0, 1.0));
  vec4 mv = viewMatrix * vec4(p + cameraPosition, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999;
  gl_PointSize = 1.0 + 2.5 * glint;
}
`;

const particleFragment = /* glsl */ `
varying vec3 vCol;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.01) discard;
  gl_FragColor = vec4(vCol, vAlpha);
  #include <colorspace_fragment>
}
`;

export class RingSystem {
  constructor(scene, planet, inner, outer) {
    this.uniforms = {
      uSunDir: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      uSunColor: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
      uSunIntensity: { value: [1, 1, 1] },
      uPlanetC: { value: new THREE.Vector3() },
      uPlanetR: { value: 1 },
      uAxis: { value: new THREE.Vector3(0, 1, 0) },
      uE1: { value: new THREE.Vector3(1, 0, 0) },
      uE2: { value: new THREE.Vector3(0, 0, 1) },
      uTime: { value: 0 },
      uInner: { value: inner },
      uOuter: { value: outer },
      uDay: { value: 0 },
    };
    // Ring mesh in the ring plane (unit = planet radius, scaled at runtime)
    const geo = new THREE.RingGeometry(inner, outer, 256, 6);
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: ringVertex, fragmentShader: ringFragment,
      side: THREE.DoubleSide, depthWrite: false, depthTest: true, transparent: false,
      blending: THREE.NormalBlending, fog: false,
    });
    this.ring = new THREE.Mesh(geo, this.ringMat);
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 1001; // after the sky dome, behind all terrain
    scene.add(this.ring);

    // Orbiting ice particles, distributed by ring density bands
    const N = 6000;
    const orbit = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const x = Math.pow(Math.random(), 0.8);
      orbit[i * 3] = inner + (outer - inner) * x;
      orbit[i * 3 + 1] = Math.random() * Math.PI * 2;
      orbit[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    pg.setAttribute('orbit', new THREE.BufferAttribute(orbit, 3));
    this.particles = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: particleVertex, fragmentShader: particleFragment,
      depthWrite: false, depthTest: true, transparent: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 1002;
    scene.add(this.particles);
    this.planet = planet;
  }

  update(camera, planetDir, axis, planetRadiusRad, sunDirs, sunColors, sunIntensities, time, day) {
    const u = this.uniforms;
    const C = planetDir.clone().multiplyScalar(SKY_DIST);
    const R = Math.sin(planetRadiusRad) * SKY_DIST;
    u.uPlanetC.value.copy(C);
    u.uPlanetR.value = R;
    u.uAxis.value.copy(axis);
    const ref = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    u.uE1.value.crossVectors(axis, ref).normalize();
    u.uE2.value.crossVectors(axis, u.uE1.value).normalize();
    for (let i = 0; i < 3; i++) {
      u.uSunDir.value[i].copy(sunDirs[i]);
      u.uSunColor.value[i].copy(sunColors[i]);
      u.uSunIntensity.value[i] = sunIntensities[i];
    }
    u.uTime.value = time;
    u.uDay.value = day;
    // ring mesh: centred on the planet in camera-relative sky space, normal = axis
    this.ring.position.copy(camera.position).add(C);
    this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
    this.ring.scale.setScalar(R);
  }
}

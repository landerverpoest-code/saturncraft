// Sky dome fragment shader: atmosphere gradient, three suns with glare and
// twilight scattering, stars, and a ray-traced gas giant with a banded
// animated atmosphere, limb glow, polar aurora and the rings' shadow on its
// cloud tops. The rings themselves are a mesh + particles (gasGiant.js).

export const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // at far plane
}
`;

export const skyFragment = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir[3];
uniform vec3 uSunColor[3];
uniform float uSunFactor[3];
uniform float uSunSize[3];
uniform float uSunIntensity[3];
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uCombined;
uniform float uTime;
uniform vec3 uPlanetDir;
uniform vec3 uPlanetAxis;
uniform float uPlanetRadius;
uniform float uRingInner;
uniform float uRingOuter;
uniform float uUnderwater;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return s;
}

// Ring optical density at radius rho (planet radii) and rotated angle phi
float ringDensity(float rho, float phi) {
  if (rho < uRingInner || rho > uRingOuter) return 0.0;
  float x = (rho - uRingInner) / (uRingOuter - uRingInner);
  // broad bands + fine ringlets + a dark division gap
  float bands = 0.55 + 0.45 * sin(x * 38.0 + 1.3 * sin(x * 7.0));
  float fine = vnoise(vec2(rho * 140.0, 0.5));
  float gap = smoothstep(0.015, 0.035, abs(x - 0.62)) * smoothstep(0.005, 0.02, abs(x - 0.86));
  float edge = smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.92, x);
  // particle clumps orbiting at the local speed
  float clump = vnoise(vec2(rho * 60.0, phi * 40.0));
  float d = bands * (0.55 + 0.45 * fine) * gap * edge * (0.8 + 0.35 * clump);
  return clamp(d * (x < 0.3 ? 0.55 : 1.0), 0.0, 1.0);
}

// Ray (origin o, direction d) vs sphere (c, r). Returns near t or -1.
float sphereHit(vec3 o, vec3 d, vec3 c, float r) {
  vec3 oc = o - c;
  float b = dot(oc, d);
  float cc = dot(oc, oc) - r * r;
  float h = b * b - cc;
  if (h < 0.0) return -1.0;
  return -b - sqrt(h);
}

vec3 ringFrameDir(vec3 axis, out vec3 e1) {
  vec3 ref = abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  e1 = normalize(cross(axis, ref));
  return normalize(cross(axis, e1));
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  // Atmosphere gradient
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
  if (h < 0.0) col = mix(uHorizon, uHorizon * 0.35, clamp(-h * 3.0, 0.0, 1.0));

  // Stars (fade with combined daylight)
  float starVis = clamp(1.0 - uCombined * 2.2, 0.0, 1.0) * smoothstep(-0.05, 0.15, h);
  if (starVis > 0.0) {
    vec3 sd = dir * 280.0;
    vec3 cell = floor(sd);
    float s = hash13(cell);
    if (s > 0.9965) {
      vec3 sp = cell + 0.5 + 0.35 * (vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) - 0.5);
      float d = length(sd - sp);
      float tw = 0.75 + 0.25 * sin(uTime * (1.5 + s * 40.0) + s * 100.0);
      vec3 sc = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.85, 0.7), hash13(cell + 9.0));
      col += sc * smoothstep(0.55, 0.0, d) * starVis * tw * 1.2;
    }
    // faint galactic band
    float band = exp(-pow(dot(dir, normalize(vec3(0.3, 0.5, -0.8))) * 4.0, 2.0));
    col += vec3(0.05, 0.05, 0.08) * band * fbm(dir.xz * 6.0 + dir.y * 3.0) * starVis;
  }

  // Suns: twilight scattering, glare and discs
  for (int i = 0; i < 3; i++) {
    vec3 sd = uSunDir[i];
    vec3 sc = uSunColor[i];
    float c = dot(dir, sd);
    float elev = sd.y;
    float above = smoothstep(-0.2, 0.05, elev);
    // horizon glow strongest when the sun is near the horizon
    float twilight = exp(-abs(elev) * 7.0) * above;
    float facing = pow(max(c * 0.5 + 0.5, 0.0), 5.0);
    col += sc * vec3(1.0, 0.62, 0.38) * twilight * facing * exp(-max(h, 0.0) * 5.0) * 0.9 * uSunIntensity[i];
    // Mie-like glare
    float glare = pow(max(c, 0.0), 14.0) * 0.12 + pow(max(c, 0.0), 260.0) * 0.35;
    col += sc * glare * above * uSunIntensity[i];
    // disc with limb darkening
    float rad = 0.0185 * uSunSize[i];
    float ang = acos(clamp(c, -1.0, 1.0));
    float disc = smoothstep(rad, rad * 0.82, ang);
    float limb = 1.0 - 0.45 * pow(clamp(ang / rad, 0.0, 1.0), 2.0);
    // keep the disc in its own colour: saturated body, small hot core
    vec3 discCol = sc * 1.05 * limb + vec3(0.25) * smoothstep(rad * 0.45, 0.0, ang);
    col = mix(col, discCol, disc * smoothstep(-0.03, 0.01, h));
  }

  // Gas giant (centre at unit distance along uPlanetDir)
  vec3 C = uPlanetDir;
  float R = uPlanetRadius;
  float tP = sphereHit(vec3(0.0), dir, C, R);
  vec3 axis = uPlanetAxis;
  vec3 e1; vec3 e2 = ringFrameDir(axis, e1);
  float vis = (1.0 - 0.72 * clamp(uCombined, 0.0, 1.0)) * smoothstep(-0.12, 0.02, h);

  if (tP > 0.0) {
    vec3 p = dir * tP;
    vec3 n = normalize(p - C);
    float lat = asin(clamp(dot(n, axis), -1.0, 1.0));
    float lon = atan(dot(n, e2), dot(n, e1));
    // differential rotation of the cloud bands
    float spin = uTime * (0.012 + 0.006 * cos(lat * 3.0));
    vec2 uvp = vec2(lon + spin, lat);
    float turb = fbm(vec2(uvp.x * 3.0, uvp.y * 12.0) + vec2(uTime * 0.01, 0.0));
    float b = lat * 9.0 + turb * 1.6 + 0.4 * sin(lon * 2.0 + uTime * 0.02);
    vec3 bandA = vec3(0.86, 0.72, 0.52), bandB = vec3(0.68, 0.52, 0.36), bandC = vec3(0.92, 0.86, 0.72);
    vec3 surf = mix(bandA, bandB, 0.5 + 0.5 * sin(b));
    surf = mix(surf, bandC, smoothstep(0.6, 0.9, fbm(uvp * vec2(6.0, 24.0))) * 0.5);
    // storm oval
    vec2 so = vec2(mod(lon + spin * 0.7 + 3.14159, 6.28318) - 3.14159 - 1.0, lat + 0.35);
    float storm = smoothstep(0.12, 0.02, length(so * vec2(0.6, 2.2)));
    surf = mix(surf, vec3(0.75, 0.42, 0.28), storm * 0.8);
    surf = mix(surf, vec3(0.62, 0.66, 0.7), smoothstep(1.0, 1.35, abs(lat))); // polar hoods

    vec3 light = vec3(0.0);
    float lightAmt = 0.0;
    for (int i = 0; i < 3; i++) {
      vec3 sd = uSunDir[i];
      float ndl = max(dot(n, sd), 0.0);
      // ring shadow on the planet
      float dr = dot(sd, axis);
      float rs = 1.0;
      if (abs(dr) > 1e-4) {
        float tt = dot(C - p, axis) / dr;
        if (tt > 0.0) {
          vec3 rq = p + sd * tt;
          vec3 rr = (rq - C) / R;
          float rho2 = length(rr);
          rs = 1.0 - 0.8 * ringDensity(rho2, 0.0);
        }
      }
      light += uSunColor[i] * uSunIntensity[i] * ndl * rs;
      lightAmt += ndl * uSunIntensity[i];
    }
    vec3 pc = surf * (light * 1.15 + 0.012);
    // limb glow (atmosphere rim lit by suns)
    float rim = pow(1.0 - max(dot(n, -dir), 0.0), 3.0);
    vec3 rimLight = vec3(0.0);
    for (int i = 0; i < 3; i++) rimLight += uSunColor[i] * uSunIntensity[i] * smoothstep(-0.35, 0.4, dot(n, uSunDir[i]));
    pc += rim * vec3(0.55, 0.7, 1.0) * (rimLight * 0.75 + 0.05);
    // polar aurora on the night side
    float night = 1.0 - clamp(lightAmt * 2.5, 0.0, 1.0);
    float auroraLat = smoothstep(0.95, 1.12, abs(lat)) * smoothstep(1.45, 1.22, abs(lat));
    float curtain = fbm(vec2(lon * 9.0 + uTime * 0.12, abs(lat) * 18.0 - uTime * 0.05));
    float aur = auroraLat * smoothstep(0.42, 0.75, curtain) * (0.25 + 0.75 * night);
    pc += mix(vec3(0.15, 1.0, 0.55), vec3(0.65, 0.3, 1.0), smoothstep(1.1, 1.3, abs(lat))) * aur * 0.55;
    // planet edge anti-aliasing (the ring mesh and ice particles are drawn on top by RingSystem)
    float edgeAA = smoothstep(0.0, 0.0025, R - length(cross(dir, C)));
    col = mix(col, pc + col * 0.25 * uCombined, vis * edgeAA);
  }

  if (uUnderwater > 0.5) col = mix(col, vec3(0.05, 0.15, 0.4), 0.7);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

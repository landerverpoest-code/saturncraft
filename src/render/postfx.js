// Shaders: the scene is drawn into a floating-point picture first, then a few
// small passes add bloom around bright things (suns, torches, lava, glowing
// blocks) and light shafts streaming from the brightest sun through leaves
// and clouds, and a final pass applies a soft filmic tone curve, a little
// extra colour, a vignette and a ripple when the eyes are underwater.
// The sky dome writes alpha 0, so the shafts only start from open sky.
import * as THREE from 'three';

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// bright parts of the picture (soft-knee threshold), at half size
const BRIGHT = `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; varying vec2 vUv;
void main() {
  vec3 c = (texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
    + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
  float l = max(c.r, max(c.g, c.b)), knee = uThreshold * 0.5;
  float s = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  s = s * s / (4.0 * knee + 1e-4);
  gl_FragColor = vec4(min(c * max(s, l - uThreshold) / max(l, 1e-4), vec3(6.0)), 1.0);
}`;

// dual-filter blur: down then up again, adding every level on the way up
const DOWN = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;
const UP = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec2 h = uTexel * 0.75;
  vec3 s = texture2D(tSrc, vUv + h * vec2(-2.0, 0.0)).rgb + texture2D(tSrc, vUv + h * vec2(2.0, 0.0)).rgb
    + texture2D(tSrc, vUv + h * vec2(0.0, -2.0)).rgb + texture2D(tSrc, vUv + h * vec2(0.0, 2.0)).rgb;
  s += (texture2D(tSrc, vUv + h * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + h * vec2(1.0, 1.0)).rgb
    + texture2D(tSrc, vUv + h * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + h * vec2(1.0, -1.0)).rgb) * 2.0;
  gl_FragColor = vec4(s / 12.0, 1.0);
}`;

// light shafts: march from each pixel towards the sun, gathering bright open sky
const RAYS = `uniform sampler2D tSrc; uniform vec2 uSun; uniform float uAspect; varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 d = (uSun - vUv) / 40.0;
  vec2 uv = vUv + d * hash(vUv * 731.0);
  float acc = 0.0, w = 1.0;
  for (int i = 0; i < 40; i++) {
    vec4 s = texture2D(tSrc, uv);
    float sky = (1.0 - s.a) * smoothstep(0.75, 1.3, max(s.r, max(s.g, s.b)));
    acc += sky * w;
    w *= 0.955;
    uv += d;
  }
  float r = length((vUv - uSun) * vec2(uAspect, 1.0));
  gl_FragColor = vec4(vec3(acc / 40.0 * smoothstep(1.3, 0.0, r)), 1.0);
}`;

const COMPOSITE = `uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tRays;
uniform float uBloom; uniform vec3 uRayColor; uniform float uTime; uniform float uWater; uniform float uAspect; uniform float uSaturation; uniform vec3 uGrade; uniform float uHurt;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 shoulder(vec3 c) {
  // leave everything below 0.75 as it was, roll brighter light off smoothly towards white
  vec3 t = 0.75 + 0.25 * (1.0 - exp(-(c - 0.75) * 4.0));
  return mix(c, t, step(0.75, c));
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 uv = vUv;
  if (uWater > 0.5) uv += vec2(sin(uv.y * 22.0 + uTime * 2.1), cos(uv.x * 18.0 + uTime * 1.7)) * 0.0022;
  vec3 c = texture2D(tScene, uv).rgb;
  c += texture2D(tBloom, uv).rgb * uBloom;
  c += texture2D(tRays, uv).rgb * uRayColor;
  c = shoulder(max(c * 1.06 * uGrade, vec3(0.0)));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, uSaturation), vec3(0.0));
  c = toSRGB(clamp(c, 0.0, 1.0));
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.2); // a little contrast
  vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= 1.0 - 0.28 * smoothstep(0.45, 1.05, length(v));
  c = mix(c, vec3(0.55, 0.02, 0.02), uHurt * smoothstep(0.25, 1.0, length(v))); // red edges when hurt
  c += (hash(vUv * 917.0 + fract(uTime)) - 0.5) / 255.0; // dither away banding in the sky
  gl_FragColor = vec4(c, 1.0);
}`;

const LEVELS = 5;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    const rt = (w, h, depth = false) => new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, depthBuffer: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.target = rt(1, 1, true);
    this.levels = [];
    for (let i = 0; i < LEVELS; i++) this.levels.push(rt(1, 1));
    this.rays = rt(1, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
    this.bright = mat(BRIGHT, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.1 } });
    this.down = mat(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = mat(UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.raysMat = mat(RAYS, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
    this.composite = mat(COMPOSITE, {
      tScene: { value: this.target.texture }, tBloom: { value: this.levels[0].texture }, tRays: { value: this.rays.texture },
      uBloom: { value: 0.6 }, uRayColor: { value: new THREE.Color(0, 0, 0) }, uTime: { value: 0 }, uWater: { value: 0 },
      uAspect: { value: 1 }, uSaturation: { value: 1.1 }, uGrade: { value: new THREE.Color(1, 1, 1) }, uHurt: { value: 0 },
    });
    this.size = new THREE.Vector2();
    this.sunNdc = new THREE.Vector3();
    this.rayStrength = 0;
  }

  setSize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.target.setSize(w, h);
    for (let i = 0; i < LEVELS; i++) this.levels[i].setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)));
    this.rays.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
  }

  /** Point drawing at the off-screen picture (call before rendering the scene). */
  begin() {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    this.setSize(this.size.x, this.size.y);
    r.setRenderTarget(this.target);
    r.setClearAlpha(1);
    r.clear();
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.cam);
  }

  /**
   * Finish the frame onto the screen. `sun` = { dir: [x,y,z], color: THREE.Color, strength } for
   * the light shafts (strength 0 for none), `underwater` ripples the picture.
   */
  /**
   * Colour grading: `warm` (0-1) tints the picture golden when the sun is low, `night` (0-1)
   * cools it towards moonlight blue, `hurt` (0-1) reddens the edges.
   */
  grade(warm, night, hurt) {
    const g = this.composite.uniforms.uGrade.value;
    g.setRGB(1 + 0.07 * warm - 0.12 * night, 1 - 0.02 * warm - 0.05 * night, 1 - 0.14 * warm + 0.1 * night);
    this.composite.uniforms.uHurt.value = hurt;
    this.composite.uniforms.uSaturation.value = 1.1 - 0.25 * night;
  }

  end(camera, sec, sun, underwater) {
    const r = this.renderer, aspect = this.w / Math.max(1, this.h);
    // bloom: bright pass, blur down the chain, then add each level back on the way up
    this.bright.uniforms.tSrc.value = this.target.texture;
    this.bright.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    this.pass(this.bright, this.levels[0]);
    for (let i = 1; i < LEVELS; i++) {
      const src = this.levels[i - 1];
      this.down.uniforms.tSrc.value = src.texture;
      this.down.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.down, this.levels[i]);
    }
    for (let i = LEVELS - 1; i > 0; i--) {
      const src = this.levels[i];
      this.up.uniforms.tSrc.value = src.texture;
      this.up.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.up, this.levels[i - 1]);
    }
    // light shafts towards the sun, when it is in front of the camera
    let rays = 0;
    if (sun && sun.strength > 0.001) {
      this.sunNdc.set(camera.position.x + sun.dir[0] * 400, camera.position.y + sun.dir[1] * 400, camera.position.z + sun.dir[2] * 400).project(camera);
      const facing = camera.getWorldDirection(new THREE.Vector3()).dot(new THREE.Vector3(sun.dir[0], sun.dir[1], sun.dir[2]));
      if (facing > 0) {
        const off = Math.max(Math.abs(this.sunNdc.x), Math.abs(this.sunNdc.y));
        rays = sun.strength * THREE.MathUtils.smoothstep(2.2, 0.9, off) * THREE.MathUtils.smoothstep(0, 0.35, facing);
      }
    }
    this.rayStrength += (rays - this.rayStrength) * 0.1;
    const cu = this.composite.uniforms;
    if (this.rayStrength > 0.002) {
      this.raysMat.uniforms.tSrc.value = this.target.texture;
      this.raysMat.uniforms.uSun.value.set(this.sunNdc.x * 0.5 + 0.5, this.sunNdc.y * 0.5 + 0.5);
      this.raysMat.uniforms.uAspect.value = aspect;
      this.pass(this.raysMat, this.rays);
      cu.uRayColor.value.copy(sun.color).multiplyScalar(this.rayStrength * 0.35);
    } else cu.uRayColor.value.setRGB(0, 0, 0);
    cu.uTime.value = sec;
    cu.uWater.value = underwater ? 1 : 0;
    cu.uAspect.value = aspect;
    this.pass(this.composite, null);
  }

  dispose() {
    this.target.dispose(); this.rays.dispose();
    for (const l of this.levels) l.dispose();
    for (const m of [this.bright, this.down, this.up, this.raysMat, this.composite]) m.dispose();
    this.quad.geometry.dispose();
  }
}

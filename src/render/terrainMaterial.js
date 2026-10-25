// Terrain materials: three.js Lambert (so the three sun lights and their
// shadow maps work) with a texture-array lookup and baked sky/block light.
import * as THREE from 'three';
import { generateTextureData, TEX_NAMES, TEX_SIZE, texId } from '../world/textures.js';
import { CLOUD_Y } from '../sky/clouds.js';
import { HUSH_PULSE } from '../world/hushTextures.js';

// How strongly each light-giving texture glows when shaders are on (its bright
// pixels are pushed above white so the bloom pass haloes them).
const GLOW = {
  lava: 0.9, lava_flow: 0.9, furnace_front_lit: 0.8, torch: 1.1, pumpkin_lantern: 0.7, fire: 1, lantern: 1, lantern_top: 0.5,
  glowshard: 0.8, rift: 0.8, hollow_gate: 0.6, far_gate: 0.6, cinnabar_torch: 0.9, cinnabar_lamp_on: 0.8, wisp_rod: 1, tide_lantern: 0.8, cave_vines_lit: 0.9, candle_flame: 1.2, beacon: 0.5, amber_croaklight_side: 0.6, pearl_croaklight_side: 0.6, moss_croaklight_side: 0.6, amber_croaklight_top: 0.6, pearl_croaklight_top: 0.6, moss_croaklight_top: 0.6,
};
for (let i = 0; i < 8; i++) GLOW['fire_' + i] = 1;
GLOW.hush_tendril_active = 0.9; GLOW.hush_catalyst_side = 0.5; GLOW.hush_catalyst_top = 0.5;
// Deep Hush tiles (green channel): their bright cyan specks glow in slow waves, shaders on or off
const PULSE = new Set(HUSH_PULSE);
function glowTexture() {
  const w = Math.max(512, TEX_NAMES.length), data = new Uint8Array(w * 4);
  TEX_NAMES.forEach((n, i) => { if (GLOW[n]) data[i * 4] = Math.round(GLOW[n] * 200); if (PULSE.has(n)) data[i * 4 + 1] = 255; });
  const t = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

export const REMOTE_LIGHTS = 8;

export const terrainUniforms = {
  uAtlas: { value: null },
  uTorch: { value: new THREE.Color(1.0, 0.82, 0.6) },
  uMinLight: { value: 0.035 },
  uHand: { value: 0 },
  // light sources of the other players (a held torch or lantern): world xyz + light level, level 0 = unused
  uRemoteLights: { value: Array.from({ length: REMOTE_LIGHTS }, () => new THREE.Vector4()) },
  uWind: { value: 1 }, // how hard plants and leaves sway (stronger in storms) // light level of what the player holds (a torch lights the area around them)
  uTime: { value: 0 },
  uFire: { value: texId('fire') },
  uFireFrames: { value: texId('fire_0') },
  uSaw: { value: texId('stonecutter_saw') },
  uSawFrames: { value: texId('stonecutter_saw_0') },
  uGlowTiles: { value: null },
  uGlow: { value: 0 }, // 0 with shaders off
  // water surfaces reflect the sky and glint where the brightest sun catches the ripples
  uWaterTiles: { value: new THREE.Vector2(texId('water'), texId('water_flow')) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(0, 0, 0) },
  uSkyTop: { value: new THREE.Color(0.3, 0.5, 0.9) },
  uSkyLow: { value: new THREE.Color(0.7, 0.8, 1.0) },
  uWet: { value: 0 },
  uCloudTex: { value: null },
  uCloud: { value: new THREE.Vector4(0, 0, 1, 0) }, // cover texture corner x, z, its size in blocks, shadow strength // how wet the open ground looks (rain)
};

export function createTextureArray() {
  const data = generateTextureData();
  const tex = new THREE.DataArrayTexture(data, TEX_SIZE, TEX_SIZE, TEX_NAMES.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  terrainUniforms.uAtlas.value = tex;
  terrainUniforms.uGlowTiles.value = glowTexture();
  return { tex, data };
}

function patch(material, { water = false } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 tuv;
attribute vec4 lit;
varying vec2 vTuv;
varying vec3 vLit;
varying float vShade;
varying vec3 vWorld;
flat varying float vTile;
uniform float uTime;
uniform float uWind;
varying float vWave;
varying float vUnder;
${water ? 'varying vec3 vWN; uniform vec2 uWaterTiles; uniform float uGlow;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTuv = tuv;
vUnder = floor(lit.z / 16.0 + 0.01);
float flags = lit.z - vUnder * 16.0;
float wave = floor(flags / 4.0 + 0.01);
vLit = vec3(lit.x / 255.0, lit.y / 255.0, flags - wave * 4.0);
vWave = wave;
if (wave > 0.5) {
  // plants sway at the top, leaves rustle a little, in a breeze that rolls across the land
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float amp = (wave > 1.5 ? 0.075 : 0.022) * uWind;
  float ph = uTime * 1.7 + wp.x * 0.37 + wp.z * 0.23;
  transformed.x += sin(ph) * amp + sin(ph * 2.3 + wp.y) * amp * 0.35;
  transformed.z += cos(ph * 0.83 + wp.x * 0.11) * amp * 0.7;
  if (wave < 1.5) transformed.y += sin(ph * 1.9 + wp.z) * amp * 0.4;
}
vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
${water ? `if (uGlow > 0.0 && (abs(lit.w - uWaterTiles.x) < 0.5 || abs(lit.w - uWaterTiles.y) < 0.5) && fract(vWorld.y) > 0.05) {
  // the water surface heaves gently (vertices at a block's bottom edge stay put, so faces keep meeting)
  float wv = sin(vWorld.x * 0.8 + uTime * 1.4) * 0.5 + sin(vWorld.z * 0.9 - uTime * 1.1 + vWorld.x * 0.3) * 0.5;
  transformed.y += wv * 0.035 - 0.04;
  vWorld.y += wv * 0.035 - 0.04;
}` : ''}
vTile = lit.w;
${water ? 'vWN = normal;' : ''}
vShade = abs(normal.y) > 0.5 ? (normal.y > 0.0 ? 1.0 : 0.55) : (abs(normal.z) > 0.5 ? 0.82 : 0.68);
`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform vec3 uTorch;
uniform float uMinLight;
uniform float uHand;
uniform vec4 uRemoteLights[${REMOTE_LIGHTS}];
varying vec3 vWorld;
uniform float uTime;
uniform float uFire;
uniform float uFireFrames;
uniform float uSaw;
uniform float uSawFrames;
uniform sampler2D uGlowTiles;
uniform float uGlow;
varying vec2 vTuv;
varying vec3 vLit;
varying float vShade;
flat varying float vTile;
varying float vWave;
varying float vUnder;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyTop;
uniform vec3 uSkyLow;
uniform float uWet;
uniform sampler2D uCloudTex;
uniform vec4 uCloud;
${water ? `varying vec3 vWN;
uniform vec2 uWaterTiles;` : ''}
#define SUN_MASK ( vLit.x > 0.0 ) // sunlight is scaled by sky light: none underground
float lightCurve(float f) {
  float b = f / (4.0 - 3.0 * f);
  float g = 1.0 - pow(1.0 - b, 4.0);
  return mix(b, g, 0.55);
}`)
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= pow(vColor, vec3(2.2));')
      .replace('#include <map_fragment>', `
vec2 tuv = vTuv;
${water ? 'if (abs(vTile - uWaterTiles.x) < 0.5) tuv += vec2(uTime * 0.02, uTime * 0.035); // still water drifts (not ice or glass)' : ''}
float tile = vTile;
if (abs(tile - uFire) < 0.5) tile = uFireFrames + mod(floor(uTime * 12.0), 8.0); // animated fire
else if (abs(tile - uSaw) < 0.5) tile = uSawFrames + mod(floor(uTime * 16.0), 4.0); // the stonecutter's spinning blade
vec4 texel = texture(uAtlas, vec3(tuv, tile));
diffuseColor *= texel;`)
      .replace(
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
        `float skyB = lightCurve(vLit.x);
float handL = uHand > 0.0 ? clamp((uHand - length(vViewPosition) * 1.1) / 15.0, 0.0, 1.0) : 0.0;
for (int i = 0; i < ${REMOTE_LIGHTS}; i++) {
  vec4 rl = uRemoteLights[i];
  if (rl.w > 0.0) handL = max(handL, clamp((rl.w - distance(vWorld, rl.xyz) * 1.1) / 15.0, 0.0, 1.0));
}
float blkB = lightCurve(max(vLit.y, handL));
// with shaders on, torchlight flickers a little, in slow waves that roll across the blocks
if (uGlow > 0.0) blkB *= 1.0 + 0.05 * sin(uTime * 8.3 + vWorld.x * 0.31 + vWorld.z * 0.27) * sin(uTime * 13.1 + vWorld.y * 0.43);
float aoF = 1.0 - vLit.z * 0.19;
float cloudSh = 1.0;
if (uCloud.w > 0.0 && uSunDir.y > 0.05) {
  // cloud shadows: follow the sun's ray up to the cloud layer and look at the cover there
  vec3 cp = vWorld + uSunDir * ((${CLOUD_Y.toFixed(1)} - vWorld.y) / uSunDir.y);
  vec2 cuv = (cp.xz - uCloud.xy) / uCloud.z;
  if (all(greaterThan(cuv, vec2(0.0))) && all(lessThan(cuv, vec2(1.0)))) cloudSh = 1.0 - uCloud.w * texture2D(uCloudTex, cuv).r;
}
vec3 outgoingLight = reflectedLight.directDiffuse * skyB * mix(1.0, aoF, 0.5) * cloudSh
  + reflectedLight.indirectDiffuse * skyB * aoF * vShade
  + diffuseColor.rgb * (uTorch * blkB * 1.15 + vec3(uMinLight)) * aoF * vShade
  + totalEmissiveRadiance;
if (uGlow > 0.0) {
  float gl = texelFetch(uGlowTiles, ivec2(int(vTile + 0.5), 0), 0).r * 1.275;
  if (gl > 0.0) outgoingLight += diffuseColor.rgb * gl * uGlow * smoothstep(0.45, 0.95, max(texel.r, max(texel.g, texel.b)));
}
{
  // Hushmoss specks breathe: waves of light rolling slowly over the Deep Hush
  float hp = texelFetch(uGlowTiles, ivec2(int(vTile + 0.5), 0), 0).g;
  if (hp > 0.5) {
    float speck = smoothstep(0.25, 0.6, texel.g - texel.r);
    float wave = sin(uTime * 1.3 - dot(vWorld, vec3(0.23, 0.11, 0.17)));
    float pulse = 0.25 + 0.75 * pow(0.5 + 0.5 * wave, 3.0);
    outgoingLight += diffuseColor.rgb * speck * pulse * (0.55 + 0.6 * uGlow);
  }
}
if (uGlow > 0.0 && vUnder > 0.5) {
  // caustics: sunlight focused by the waves above dances over the sea floor
  vec2 cp = vWorld.xz * 0.9 + vWorld.y * 0.3;
  float c1 = sin(cp.x * 2.1 + uTime * 1.3 + sin(cp.y * 1.7 + uTime * 0.9) * 1.6);
  float c2 = sin(cp.y * 2.3 - uTime * 1.1 + sin(cp.x * 1.9 - uTime * 0.7) * 1.6);
  float caustic = pow(max(0.0, 1.0 - abs(c1 + c2) * 0.6), 4.0);
  outgoingLight += diffuseColor.rgb * (uSunCol * 0.9 + vec3(0.08)) * caustic * skyB * skyB;
}
if (uGlow > 0.0) {
  vec3 toFrag = normalize(vWorld - cameraPosition);
  // sunlight glowing through leaves and grass when looking towards the sun
  if (vWave > 0.5) outgoingLight += diffuseColor.rgb * uSunCol * pow(max(dot(toFrag, uSunDir), 0.0), 6.0) * 0.7 * skyB;
  // rain: surfaces open to the sky darken and pick up a sheen of the sky
  ${water ? '' : `float wet = uWet * smoothstep(0.8, 1.0, vLit.x);
  if (wet > 0.0) {
    float top = vShade > 0.99 ? 1.0 : 0.35;
    outgoingLight *= 1.0 - 0.2 * wet;
    outgoingLight += mix(uSkyLow, uSkyTop, 0.3) * pow(1.0 - abs(toFrag.y), 4.0) * 0.3 * wet * top * skyB;
    if (top > 0.5) {
      // raindrops: little rings spreading in a scatter of cells over the ground
      vec2 cell = floor(vWorld.xz * 2.0), f = fract(vWorld.xz * 2.0) - 0.5;
      float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
      float t = fract(uTime * 0.9 + h);
      float ring = smoothstep(0.05, 0.0, abs(length(f + (h - 0.5) * 0.4) - t * 0.45)) * (1.0 - t);
      outgoingLight += mix(uSkyLow, uSkyTop, 0.5) * ring * 0.35 * wet * skyB;
    }
  }`}
}
${water ? `if ((abs(vTile - uWaterTiles.x) < 0.5 || abs(vTile - uWaterTiles.y) < 0.5) && vWN.y > 0.5 && cameraPosition.y > vWorld.y) {
  // ripples: a few travelling waves bend the surface normal
  vec2 wp = vWorld.xz;
  vec3 n = normalize(vec3(
    sin(wp.x * 1.3 + uTime * 1.6) * 0.035 + sin(wp.x * 0.6 - wp.y * 1.1 + uTime * 1.1) * 0.045 + sin((wp.x + wp.y) * 3.7 + uTime * 2.6) * 0.015,
    1.0,
    cos(wp.y * 1.2 + uTime * 1.4) * 0.035 + sin(wp.y * 0.7 + wp.x * 0.9 - uTime * 0.9) * 0.045 + cos((wp.x - wp.y) * 3.3 + uTime * 2.2) * 0.015));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 skyRef = mix(uSkyLow, uSkyTop, clamp(R.y * 1.6, 0.0, 1.0)) * skyB;
  outgoingLight = mix(outgoingLight, skyRef * 0.9, fres * 0.6);
  diffuseColor.a = mix(diffuseColor.a, 1.0, fres * 0.55);
  // sun glint, only where the sun actually reaches (shadowed water has little direct light)
  float lit = clamp(dot(reflectedLight.directDiffuse, vec3(0.333)) / max(dot(diffuseColor.rgb, vec3(0.333)), 0.02), 0.0, 1.0);
  float spec = pow(max(dot(R, uSunDir), 0.0), 180.0) * 4.0 + pow(max(dot(R, uSunDir), 0.0), 24.0) * 0.12;
  outgoingLight += uSunCol * spec * lit;
}` : ''}`);
  };
  material.customProgramCacheKey = () => (water ? 'terrain-water' : 'terrain');
  return material;
}

export function createTerrainMaterials() {
  // Solid blocks get no alpha test, so the GPU can reject hidden fragments
  // before shading them; leaves/plants/glass/torches use the cutout material.
  const opaque = patch(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const cutout = patch(new THREE.MeshLambertMaterial({ vertexColors: true, alphaTest: 0.5 }));
  const trans = patch(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: true }), { water: true });
  return { opaque, cutout, trans };
}

/** Depth material for shadow maps that respects cut-out alpha (leaves, plants). */
export function createTerrainDepthMaterial() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = terrainUniforms.uAtlas;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 tuv;
attribute vec4 lit;
varying vec2 vTuv;
flat varying float vTile;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTuv = tuv; vTile = lit.w;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
varying vec2 vTuv;
flat varying float vTile;`)
      .replace('#include <map_fragment>', `if (texture(uAtlas, vec3(vTuv, vTile)).a < 0.5) discard;`);
  };
  m.customProgramCacheKey = () => 'terrain-depth';
  return m;
}

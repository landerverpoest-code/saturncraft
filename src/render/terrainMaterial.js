// Terrain materials: three.js Lambert (so the three sun lights and their
// shadow maps work) with a texture-array lookup and baked sky/block light.
import * as THREE from 'three';
import { generateTextureData, TEX_NAMES, TEX_SIZE, texId } from '../world/textures.js';

export const terrainUniforms = {
  uAtlas: { value: null },
  uTorch: { value: new THREE.Color(1.0, 0.82, 0.6) },
  uMinLight: { value: 0.035 },
  uHand: { value: 0 }, // light level of what the player holds (a torch lights the area around them)
  uTime: { value: 0 },
  uFire: { value: texId('fire') },
  uFireFrames: { value: texId('fire_0') },
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
flat varying float vTile;
uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTuv = tuv;
vLit = vec3(lit.x / 255.0, lit.y / 255.0, lit.z);
vTile = lit.w;
vShade = abs(normal.y) > 0.5 ? (normal.y > 0.0 ? 1.0 : 0.55) : (abs(normal.z) > 0.5 ? 0.82 : 0.68);
`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform vec3 uTorch;
uniform float uMinLight;
uniform float uHand;
uniform float uTime;
uniform float uFire;
uniform float uFireFrames;
varying vec2 vTuv;
varying vec3 vLit;
varying float vShade;
flat varying float vTile;
#define SUN_MASK ( vLit.x > 0.0 ) // sunlight is scaled by sky light: none underground
float lightCurve(float f) {
  float b = f / (4.0 - 3.0 * f);
  float g = 1.0 - pow(1.0 - b, 4.0);
  return mix(b, g, 0.55);
}`)
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= pow(vColor, vec3(2.2));')
      .replace('#include <map_fragment>', `
vec2 tuv = vTuv;
${water ? 'tuv += vec2(uTime * 0.02, uTime * 0.035);' : ''}
float tile = vTile;
if (abs(tile - uFire) < 0.5) tile = uFireFrames + mod(floor(uTime * 12.0), 8.0); // animated fire
vec4 texel = texture(uAtlas, vec3(tuv, tile));
diffuseColor *= texel;`)
      .replace(
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
        `float skyB = lightCurve(vLit.x);
float handL = uHand > 0.0 ? clamp((uHand - length(vViewPosition) * 1.1) / 15.0, 0.0, 1.0) : 0.0;
float blkB = lightCurve(max(vLit.y, handL));
float aoF = 1.0 - vLit.z * 0.19;
vec3 outgoingLight = reflectedLight.directDiffuse * skyB * mix(1.0, aoF, 0.5)
  + reflectedLight.indirectDiffuse * skyB * aoF * vShade
  + diffuseColor.rgb * (uTorch * blkB * 1.15 + vec3(uMinLight)) * aoF * vShade
  + totalEmissiveRadiance;`);
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

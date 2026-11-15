// Original box models for every mob (units: 1/16 block, facing -Z), with
// procedurally painted textures and simple limb animation.
import { breathe, blinkClosed, earTwitch, headTurn, idleLook, tailWag, hurtLean, walkBob, deathSink, wrapPi, ANIM_RANGE, LOOK_RANGE } from './mobAnim.js';
import * as THREE from 'three';
import { hasVariants, paintParts, variantOverlays } from './variants.js';

const noiseTexCache = new Map();
function noiseTexture(key, contrast = 0.18) {
  if (noiseTexCache.has(key)) return noiseTexCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d');
  let s = 0; for (const ch of key) s = (s * 31 + ch.charCodeAt(0)) | 0;
  const rnd = () => { s = (s * 1103515245 + 12345) | 0; return ((s >>> 16) & 0x7fff) / 0x7fff; };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = Math.round(255 * (1 - contrast + rnd() * contrast));
    ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  noiseTexCache.set(key, t);
  return t;
}

function faceTexture(key, base, draw) {
  const k = 'face:' + key;
  if (noiseTexCache.has(k)) return noiseTexCache.get(k);
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(base);
  let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) | 0; return ((s >>> 16) & 0x7fff) / 0x7fff; };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const f = 0.85 + rnd() * 0.15;
    ctx.fillStyle = `rgb(${col.r * 255 * f},${col.g * 255 * f},${col.b * 255 * f})`; ctx.fillRect(x, y, 1, 1);
  }
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  noiseTexCache.set(k, t);
  return t;
}
const px = (ctx, color, pts) => { ctx.fillStyle = color; for (const [x, y, w = 1, h = 1] of pts) ctx.fillRect(x, y, w, h); };


// A part's grey-scale skin (tinted by the part's colour): mottled, with a darker rim so the boxes read as solid forms, a lighter
// back and a darker underside, and per-kind touches (dark paws on limbs, a brow shadow on heads, ring bands on tails).
function skinTexture(key, kind) {
  const k = `skin:${kind}:${key}`;
  if (noiseTexCache.has(k)) return noiseTexCache.get(k);
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d');
  let s = 0; for (const ch of key) s = (s * 31 + ch.charCodeAt(0)) | 0;
  const rnd = () => { s = (s * 1103515245 + 12345) | 0; return ((s >>> 16) & 0x7fff) / 0x7fff; };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let v = 0.86 + rnd() * 0.14;
    if (rnd() < 0.07) v -= 0.12; // flecks
    if (rnd() < 0.04) v += 0.1;
    v += (7.5 - y) / 7.5 * 0.07; // lighter above, darker below
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    if (edge) v *= 0.82; else if (x === 1 || y === 1) v *= 1.05;
    if (kind === 'limb') { if (y >= 12) v *= 0.62; else if (y >= 10) v *= 0.84; }
    if (kind === 'head' && (y === 6 || y === 7)) v *= 0.9;
    if (kind === 'tail' && (y % 4 === 3)) v *= 0.78;
    if (kind === 'body' && x >= 3 && x <= 12 && y >= 11) v *= 1.08; // a paler belly
    v = Math.max(0, Math.min(1, v));
    const g = Math.round(255 * v);
    ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  noiseTexCache.set(k, t);
  return t;
}
const partKind = (name) => (/^(leg|arm|foot|hand|paw|hoof|fin|flip)/i.test(name) ? 'limb' : /^head|^skull/i.test(name) ? 'head' : /^tail|^seg/i.test(name) ? 'tail' : /^body|^torso|^belly|^shell/i.test(name) ? 'body' : 'plain');

/** Bake light-and-shade into a box's vertices: tops catch the light, undersides and the far side fall into shadow. */
function shadeBox(geo) {
  const n = geo.attributes.normal, pos = geo.attributes.position, col = new Float32Array(n.count * 3);
  geo.computeBoundingBox();
  const h = Math.max(1e-6, geo.boundingBox.max.y - geo.boundingBox.min.y);
  for (let i = 0; i < n.count; i++) {
    const ny = n.getY(i), nx = Math.abs(n.getX(i));
    let v = ny > 0.5 ? 1 : ny < -0.5 ? 0.58 : nx > 0.5 ? 0.8 : 0.9;
    if (Math.abs(ny) < 0.5) v *= 0.9 + 0.1 * ((pos.getY(i) - geo.boundingBox.min.y) / h); // sides darken towards the ground
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

// The eyes a head gets when no one painted its face: whites, a coloured pupil, nostrils and a brow line, tinted from the head.
function defaultFace(key, base) {
  return faceTexture('auto' + key, base, (c) => {
    const col = new THREE.Color(base), dark = col.clone().multiplyScalar(0.35), lum = col.r * 0.3 + col.g * 0.6 + col.b * 0.1;
    const brow = '#' + dark.getHexString(), pupil = lum > 0.55 ? '#1c1410' : '#e8c040';
    px(c, brow, [[2, 4, 4, 1], [10, 4, 4, 1]]);
    px(c, '#f4f0e6', [[3, 5, 3, 3], [10, 5, 3, 3]]);
    px(c, pupil, [[4, 6, 2, 2], [10, 6, 2, 2]]);
    px(c, '#080808', [[4, 7], [11, 7]]);
    px(c, brow, [[7, 10, 2, 1], [5, 12, 6, 1]]);
  });
}

// part: [name, size[w,h,d], pivot[x,y,z], offset[x,y,z], colour, opts]
// Helpers for the lists below. A quadruped's four legs (pivot at the hip, hanging down; front pair then back pair, diagonal pairs swing together):
const quad = (size, x, py, zF, zB, col, o = {}) => [
  ['legFL', size, [x, py, zF], [0, -size[1] / 2, 0], col, { anim: 'legA', ...o }],
  ['legFR', size, [-x, py, zF], [0, -size[1] / 2, 0], col, { anim: 'legB', ...o }],
  ['legBL', size, [x, py, zB], [0, -size[1] / 2, 0], col, { anim: 'legB', ...o }],
  ['legBR', size, [-x, py, zB], [0, -size[1] / 2, 0], col, { anim: 'legA', ...o }],
];
// A band laid round each of some limbs (a sock, hoof, glove or cuff): same pivot and animation as the limb, so it swings with it.
// `from` is the height of the band's foot above the limb's tip.
const sock = (limbs, prefix, col, h, grow = 0.5, from = 0, o = {}) => limbs.map(([n, [w, hh, d], pv, off, , lo]) => [prefix + n.replace(/^(leg|arm|tendril|t)/, ''), [w + grow, h, d + grow], pv, [off[0], off[1] - hh / 2 + from + h / 2, off[2]], col, { ...lo, ...o }]);
const pick = (limbs, ...names) => limbs.filter((l) => names.includes(l[0]));
// a darkening (or lightening) wash over a coat, whatever colour it is tinted to: stripes, spots and shadows
const wash = (name, size, pivot, offset, a = 0.25, col = '#000000') => [name, size, pivot, offset, col, { alpha: a }];

const MODELS = {
  // Bristleback: a stocky boar with a dark bristled ridge, pale belly, tusks and a curly tail.
  bristleback: {
    parts: [
      ['body', [10, 8, 16], [0, 10, 0], [0, 0, 0], '#8a5a3a'],
      ['belly', [10.4, 2.4, 12], [0, 10, 0], [0, -2.8, 0], '#c49a74'],
      ['rump', [10.4, 8.4, 5], [0, 10, 0], [0, 0, 5.5], '#74492c'],
      ['shoulder', [10.4, 8.4, 4], [0, 10, 0], [0, 0, -5.5], '#74492c'],
      ['ridge', [2, 2, 14], [0, 14.5, 0], [0, 0, 0], '#3a281a'],
      ...[-5.5, -2, 1.5, 5].map((z, i) => [`bristle${i}`, [1.2, 3, 1.4], [0, 14.5, z], [0, 2, 0], '#2a1c12']),
      ['head', [8, 8, 8], [0, 12, -8], [0, 0, -3], '#8a5a3a', { face: 'bristleback' }],
      ['band', [10.6, 8.6, 1.6], [0, 10, -5], [0, 0, 0], '#d8c23a'], // a tame Bristleback's yellow sash
      ['snout', [4.4, 3.4, 2.6], [0, 12, -8], [0, -1.8, -8.1], '#d89a8a'],
      ['nose', [3.4, 2, 0.6], [0, 12, -8], [0, -1.6, -9.6], '#b8685c'],
      ['cheekL', [1, 3.5, 3], [0, 12, -8], [4.1, -1, -4.5], '#4a3020'],
      ['cheekR', [1, 3.5, 3], [0, 12, -8], [-4.1, -1, -4.5], '#4a3020'],
      ['tuskL', [1, 3, 1], [0, 12, -8], [2.4, -2.6, -8.4], '#f0ead8'],
      ['tuskR', [1, 3, 1], [0, 12, -8], [-2.4, -2.6, -8.4], '#f0ead8'],
      ['earL', [2.4, 3, 1], [0, 12, -8], [3, 5, -2], '#6a4228'],
      ['earR', [2.4, 3, 1], [0, 12, -8], [-3, 5, -2], '#6a4228'],
      ...quad([4, 6, 4], 3, 6, -5, 5, '#6a4228'),
      ['tail', [1.6, 1.6, 3], [0, 12, 8], [0, 1, 1.5], '#6a4228'],
      ['tailTip', [2.4, 2.4, 1.6], [0, 12, 8], [0, 2.4, 3.4], '#2a1c12'],
    ],
  },
  // Mooxen: a shaggy blue-grey bison with a high hump, a heavy fringe and swept-back horns.
  mooxen: {
    parts: [
      ['body', [12, 10, 18], [0, 17, 0], [0, 0, 0], '#4f5f70'],
      ['belly', [10, 2, 14], [0, 11.5, 0], [0, 0, 0], '#8a96a2'],
      ['mantle', [12.8, 10.8, 6], [0, 17, 0], [0, 0, -6], '#3f4d5c'],
      ['fringe', [12.8, 3, 18.8], [0, 17, 0], [0, -3.4, 0], '#33404c'],
      ['hump', [10, 4, 6], [0, 23, -5], [0, 0, 0], '#3f4d5c'],
      ['hump2', [11, 2, 5], [0, 25.5, -5], [0, 0, 0], '#2f3a46'],
      ['head', [8, 8, 6], [0, 20, -9], [0, 0, -3], '#4f5f70', { face: 'mooxen' }],
      ['muzzle', [6, 3.6, 2.4], [0, 20, -9], [0, -2.4, -6.9], '#8a96a2'],
      ['nose', [4, 1.4, 0.6], [0, 20, -9], [0, -2.2, -8.3], '#2a2a32'],
      ['forelock', [8.6, 2.6, 4], [0, 20, -9], [0, 3.7, -3.6], '#2f3a46'],
      ['hornL', [6, 2, 2], [0, 20, -9], [6, 3, -3], '#e8dcc0'],
      ['hornR', [6, 2, 2], [0, 20, -9], [-6, 3, -3], '#e8dcc0'],
      ['hornTipL', [2, 4, 2], [0, 20, -9], [8.6, 5, -3], '#b8a878'],
      ['hornTipR', [2, 4, 2], [0, 20, -9], [-8.6, 5, -3], '#b8a878'],
      ['earL', [3, 1.6, 2], [0, 20, -9], [5.2, 0.4, -2], '#3f4d5c'],
      ['earR', [3, 1.6, 2], [0, 20, -9], [-5.2, 0.4, -2], '#3f4d5c'],
      ...(() => { const legs = quad([4, 12, 4], 4, 12, -6, 6, '#3a4652'); return [...legs, ...sock(legs, 'sock', '#9aa6b0', 4, 0.8, 2), ...sock(legs, 'hoof', '#1e242a', 2, 0.5)]; })(),
      ['tail', [2, 9, 2], [0, 21, 9], [0, -4.5, 1], '#3f4d5c'],
      ['tailTuft', [3.2, 4, 3.2], [0, 21, 9], [0, -10, 1], '#26303a'],
    ],
  },
  // Fleecer: a woolly sheep with a dark face, floppy ears and a pink muzzle.
  fleecer: {
    parts: [
      ['skin', [8, 8, 14], [0, 16, 0], [0, 0, 0], '#cdbcb4'],
      ['wool', [10, 10, 16], [0, 16, 0], [0, 0, 0], '#e8e2f0'],
      ['head', [6, 6, 8], [0, 19, -8], [0, 0, -3], '#3a3040', { face: 'fleecer' }],
      ['tuft', [7, 3, 4], [0, 19, -8], [0, 3.5, -2], '#e8e2f0'],
      ['muzzle', [4, 2.6, 1.4], [0, 19, -8], [0, -1.6, -7.5], '#6a5260'],
      ['nose', [2, 1, 0.6], [0, 19, -8], [0, -1.2, -8.3], '#e0a0b0'],
      ['earL', [3.6, 1.6, 2], [0, 19, -8], [4.4, 0.6, -2], '#3a3040'],
      ['earR', [3.6, 1.6, 2], [0, 19, -8], [-4.4, 0.6, -2], '#3a3040'],
      ['earInL', [2.4, 0.8, 1.2], [0, 19, -8], [4.6, 0.6, -2.3], '#b88a98'],
      ['earInR', [2.4, 0.8, 1.2], [0, 19, -8], [-4.6, 0.6, -2.3], '#b88a98'],
      ...(() => { const legs = quad([4, 11, 4], 3, 11, -5, 5, '#3a3040'); return [...legs, ...sock(legs, 'hoof', '#1a1420', 2, 0.5)]; })(),
      ['tail', [3, 3, 2], [0, 18, 8], [0, 0, 1], '#cdbcb4'],
    ],
  },
  // Cluckling: a plump little hen with a comb, wattle, hooked beak and a fan of tail feathers.
  cluckling: {
    parts: [
      ['body', [6, 6, 8], [0, 7, 0], [0, 0, 0], '#d8c8a0'],
      ['breast', [6.4, 3.2, 3.6], [0, 7, 0], [0, -1.2, -2.2], '#efe4c4'],
      ['backPatch', [6.4, 2, 6], [0, 7, 0], [0, 2.2, 0.6], '#b09868'],
      ['head', [4, 6, 3], [0, 10, -3], [0, 2, -1], '#d8c8a0', { face: 'cluckling' }],
      ['beak', [2, 1.2, 2], [0, 10, -3], [0, 2.2, -3.4], '#f0a020'],
      ['beakLow', [1.6, 0.8, 1.6], [0, 10, -3], [0, 1.2, -3.2], '#d88a18'],
      ['wattle', [1, 1.8, 0.8], [0, 10, -3], [0, 0.2, -2.8], '#c8302a'],
      ['crest', [1, 3, 3], [0, 10, -3], [0, 6, -1], '#c8302a'],
      ['crestB', [1, 1.6, 1.2], [0, 10, -3], [0, 7.6, -0.4], '#d8403a'],
      ['wingL', [1, 4, 6], [3.5, 9, 0], [0, -2, 0], '#c8b890', { anim: 'wingL' }],
      ['wingR', [1, 4, 6], [-3.5, 9, 0], [0, -2, 0], '#c8b890', { anim: 'wingR' }],
      ['wingTipL', [1.4, 1.6, 3.4], [3.5, 9, 0], [0.2, -3.8, 1.4], '#8a7a56', { anim: 'wingL' }],
      ['wingTipR', [1.4, 1.6, 3.4], [-3.5, 9, 0], [-0.2, -3.8, 1.4], '#8a7a56', { anim: 'wingR' }],
      ['tailFan', [1.2, 4.4, 2.2], [0, 7, 0], [0, 3.4, 4.6], '#a89870'],
      ['tailFanB', [1.2, 3.2, 1.8], [0, 7, 0], [0, 4.4, 6.2], '#8a7a56'],
      ['legL', [1, 4, 1], [1.5, 4, 0], [0, -2, 0], '#e0a020', { anim: 'legA' }],
      ['legR', [1, 4, 1], [-1.5, 4, 0], [0, -2, 0], '#e0a020', { anim: 'legB' }],
      ['footL', [2.4, 0.8, 2.8], [1.5, 4, 0], [0, -3.6, -0.6], '#d89a18', { anim: 'legA' }],
      ['footR', [2.4, 0.8, 2.8], [-1.5, 4, 0], [0, -3.6, -0.6], '#d89a18', { anim: 'legB' }],
    ],
  },
  // Shambler: a lurching green-skinned ghoul in a torn purple shirt.
  shambler: {
    parts: [
      ['head', [8, 8, 8], [0, 24, 0], [0, 4, 0], '#6a8a5a', { face: 'shambler' }],
      ['hairPatch', [4.4, 1, 5], [0, 24, 0], [-1.5, 8.2, 0.6], '#2a3a22'],
      ['hairBack', [6, 3, 1], [0, 24, 0], [0.5, 6.5, 4.2], '#2a3a22'],
      ['nose', [2, 2, 1.2], [0, 24, 0], [0, 3.4, -4.4], '#587a4a'],
      ['earL', [1, 2.4, 1.6], [0, 24, 0], [4.4, 3.6, 0.4], '#587a4a'],
      ['earR', [1, 2.4, 1.6], [0, 24, 0], [-4.4, 3.6, 0.4], '#587a4a'],
      ['body', [8, 12, 4], [0, 18, 0], [0, 0, 0], '#5a3a5a'],
      ['wound', [3, 3, 0.6], [0, 18, 0], [1.5, 2, -2.2], '#7a2a2a'],
      ['ribsPatch', [4, 2.4, 0.6], [0, 18, 0], [-1.5, -1.5, -2.2], '#a8b890'],
      ['tatterA', [2.4, 3, 4.6], [0, 18, 0], [-2.8, -5.8, 0], '#5a3a5a'],
      ['tatterB', [2.2, 2, 4.6], [0, 18, 0], [2.6, -5.2, 0], '#4a2e4a'],
      ['belt', [8.4, 1.2, 4.4], [0, 18, 0], [0, -3.4, 0], '#3a2438'],
      ...(() => { const arms = [
        ['armL', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#6a8a5a', { anim: 'armForward' }],
        ['armR', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#6a8a5a', { anim: 'armForward' }]];
        return [...arms, ...sock(arms, 'sleeve', '#5a3a5a', 4, 0.7, 6), ...sock(arms, 'hand', '#587a4a', 3, 0.4), ...sock(arms, 'claw', '#d8d0a8', 1, 0.2, 0)]; })(),
      ['legL', [4, 12, 4], [2, 12, 0], [0, -6, 0], '#3a3a2a', { anim: 'legA' }],
      ['legR', [4, 12, 4], [-2, 12, 0], [0, -6, 0], '#3a3a2a', { anim: 'legB' }],
    ],
  },
  // Rattler: a bony skeleton archer with a ribcage, spine and a strung bow.
  rattler: {
    parts: [
      ['head', [8, 8, 8], [0, 24, 0], [0, 4, 0], '#d8d4c4', { face: 'rattler' }],
      ['jaw', [6, 1.6, 6], [0, 24, 0], [0, 0.4, -0.6], '#c0bcac'],
      ['body', [8, 12, 4], [0, 18, 0], [0, 0, 0], '#b8b4a4'],
      ['spine', [1.6, 12.4, 4.6], [0, 18, 0], [0, 0, 0.3], '#d8d4c4'],
      ...[4, 1.8, -0.4, -2.6].map((y, i) => [`rib${i}`, [8.4, 1, 4.4], [0, 18, 0], [0, y, 0], '#6a665a']),
      ['pelvis', [8.4, 2.6, 4.4], [0, 18, 0], [0, -4.8, 0], '#c8c4b4'],
      ['armL', [2, 12, 2], [5, 22, 0], [0, -5, 0], '#d8d4c4', { anim: 'armAim' }],
      ['armR', [2, 12, 2], [-5, 22, 0], [0, -5, 0], '#d8d4c4', { anim: 'armAim' }],
      ['handL', [2.6, 2.4, 2.6], [5, 22, 0], [0, -10.8, 0], '#c0bcac', { anim: 'armAim' }],
      ['handR', [2.6, 2.4, 2.6], [-5, 22, 0], [0, -10.8, 0], '#c0bcac', { anim: 'armAim' }],
      ['bow', [1, 14, 1], [-5, 22, 0], [0, -1, -11], '#5a3a1a', { anim: 'armAim' }],
      ['bowGrip', [1.6, 3, 1.6], [-5, 22, 0], [0, -1, -11], '#3a2410', { anim: 'armAim' }],
      ['bowString', [0.4, 13, 0.4], [-5, 22, 0], [0, -1, -9.6], '#e8e0c8', { anim: 'armAim' }],
      ['arrow', [0.6, 0.6, 9], [-5, 22, 0], [0, -1, -6], '#8a6a3a', { anim: 'armAim' }],
      ['arrowHead', [1.2, 1.2, 1.6], [-5, 22, 0], [0, -1, -11], '#4a4a52', { anim: 'armAim' }],
      ['legL', [2, 12, 2], [2, 12, 0], [0, -6, 0], '#c8c4b4', { anim: 'legA' }],
      ['legR', [2, 12, 2], [-2, 12, 0], [0, -6, 0], '#c8c4b4', { anim: 'legB' }],
    ],
  },
  // Fizzler: a squat teal sprite with a cluster of glowing amber crystals and a molten core that flares as it swells.
  fizzler: {
    parts: [
      ['body', [8, 12, 5], [0, 12, 0], [0, 0, 0], '#2a5a5a', { glow: true }],
      ['chest', [4.4, 5, 0.6], [0, 12, 0], [0, 1.5, -2.7], '#ffb03a', { emissive: '#e07a10' }],
      ['ventL', [0.6, 7, 2], [0, 12, 0], [4.2, 0, 0], '#1a3a3a'],
      ['ventR', [0.6, 7, 2], [0, 12, 0], [-4.2, 0, 0], '#1a3a3a'],
      ['head', [8, 8, 8], [0, 18, 0], [0, 4, 0], '#2a5a5a', { face: 'fizzler' }],
      ['browRidge', [8.6, 1.4, 8.6], [0, 18, 0], [0, 7.2, 0], '#1e4444'],
      ['crystal', [3, 5, 3], [0, 26, 0], [0, 2, 0], '#e8a83a', { emissive: '#e88a1a' }],
      ['crystalB', [2, 3.8, 2], [0, 26, 0], [-2.6, 0.6, -1.2], '#f0b84a', { emissive: '#e88a1a' }],
      ['crystalC', [1.8, 2.8, 1.8], [0, 26, 0], [2.6, 0, 1.4], '#d89828', { emissive: '#c8700a' }],
      ['crystalD', [1.4, 2.2, 1.4], [0, 26, 0], [1.4, 0.2, -2.6], '#f8c860', { emissive: '#e88a1a' }],
      ...(() => { const legs = quad([4, 6, 4], 2, 6, -4, 4, '#204848'); return [...legs, ...sock(legs, 'foot', '#143030', 2, 0.6)]; })(),
    ],
  },
  // Skitterer: a fat black cave spider with a red hourglass, fangs, palps and jointed legs.
  skitterer: {
    parts: [
      ['abdomen', [10, 8, 12], [0, 7, 5], [0, 0, 0], '#2a2a32'],
      ['hourglass', [3, 8.5, 5], [0, 7, 5], [0, 0, 0.5], '#a82a2a'],
      ['hourglassB', [5, 8.4, 1.6], [0, 7, 5], [0, 0, 5], '#a82a2a'],
      ['spinneret', [3, 3, 2], [0, 7, 5], [0, -1, 6.8], '#1e1e24'],
      ['thorax', [6, 6, 6], [0, 6, -3], [0, 0, 0], '#34343c'],
      ['head', [8, 8, 8], [0, 6, -6], [0, 0, -4], '#2a2a32', { face: 'skitterer' }],
      ['fangL', [1.2, 3.4, 1.2], [0, 6, -6], [1.4, -3.6, -8.2], '#d8d0c0'],
      ['fangR', [1.2, 3.4, 1.2], [0, 6, -6], [-1.4, -3.6, -8.2], '#d8d0c0'],
      ['palpL', [1.6, 1.6, 3], [0, 6, -6], [3.2, -2, -8.6], '#34343c'],
      ['palpR', [1.6, 1.6, 3], [0, 6, -6], [-3.2, -2, -8.6], '#34343c'],
      ...(() => { const legs = [-4, -1, 2, 5].flatMap((z, i) => [
        [`legL${i}`, [16, 2, 2], [3, 6, z * 0.6], [8, 0, 0], '#1e1e24', { anim: 'spiderL', idx: i }],
        [`legR${i}`, [16, 2, 2], [-3, 6, z * 0.6], [-8, 0, 0], '#1e1e24', { anim: 'spiderR', idx: i }]]);
        const side = (s) => legs.filter((l) => l[2][0] * s > 0);
        return [...legs,
          ...[1, -1].flatMap((s) => side(s).map(([n, , pv, , , o]) => [`knee${n.slice(3)}`, [3, 3, 3], pv, [s * 8.5, 0, 0], '#3e3e48', o])),
          ...[1, -1].flatMap((s) => side(s).map(([n, , pv, , , o]) => [`tip${n.slice(3)}`, [4, 1.4, 1.4], pv, [s * 14.2, 0, 0], '#5a4a3a', o]))]; })(),
    ],
  },
  // Voidwalker: a gaunt, very tall shadow with violet veins, shoulder shards and glowing cyan eyes.
  voidwalker: {
    parts: [
      ['head', [8, 8, 8], [0, 38, 0], [0, 4, 0], '#14102a', { face: 'voidwalker' }],
      ['shardA', [1.4, 5, 1.4], [0, 38, 0], [0, 10.4, -1.5], '#6a4ac8', { emissive: '#4a2a98' }],
      ['shardB', [1.2, 3.6, 1.2], [0, 38, 0], [-2.4, 9.8, 1], '#6a4ac8', { emissive: '#4a2a98' }],
      ['shardC', [1.2, 3.6, 1.2], [0, 38, 0], [2.4, 9.8, 1], '#6a4ac8', { emissive: '#4a2a98' }],
      ['body', [8, 12, 4], [0, 32, 0], [0, 0, 0], '#1a1434'],
      ['veinA', [0.8, 10, 4.4], [0, 32, 0], [-2.2, 0, 0], '#6a4ac8', { emissive: '#3a2278' }],
      ['veinB', [0.8, 8, 4.4], [0, 32, 0], [2.4, -1, 0], '#6a4ac8', { emissive: '#3a2278' }],
      ['core', [2, 2, 0.6], [0, 32, 0], [0, 2.4, -2.2], '#5ff0ff', { emissive: '#20a0b0' }],
      ['shoulderL', [3, 2, 3], [0, 32, 0], [5.4, 5.4, 0], '#2a1e50'],
      ['shoulderR', [3, 2, 3], [0, 32, 0], [-5.4, 5.4, 0], '#2a1e50'],
      ...(() => { const arms = [
        ['armL', [2, 28, 2], [5, 38, 0], [0, -13, 0], '#14102a', { anim: 'armSwing' }],
        ['armR', [2, 28, 2], [-5, 38, 0], [0, -13, 0], '#14102a', { anim: 'armSwingB' }]];
        return [...arms, ...sock(arms, 'hand', '#2a1e50', 5, 0.8), ...sock(arms, 'claw', '#6a4ac8', 2, 0.3, 0, { emissive: '#3a2278' })]; })(),
      ['legL', [2, 26, 2], [2, 26, 0], [0, -13, 0], '#14102a', { anim: 'legA' }],
      ['legR', [2, 26, 2], [-2, 26, 0], [0, -13, 0], '#14102a', { anim: 'legB' }],
      ['kneeL', [2.8, 3, 2.8], [2, 26, 0], [0, -13, 0], '#2a1e50', { anim: 'legA' }],
      ['kneeR', [2.8, 3, 2.8], [-2, 26, 0], [0, -13, 0], '#2a1e50', { anim: 'legB' }],
    ],
  },
};

// Howlers: grey wolves with a shaggy mane, pale muzzle and chest, dark saddle; a red collar once tamed.
MODELS.howler = {
  parts: [
    ['body', [6, 6, 9], [0, 10, 2], [0, 0, 0], '#9a9a9e'],
    ['mane', [8, 8, 6], [0, 10.5, -3], [0, 0, 0], '#b4b4b8'],
    ['collar', [8.6, 2, 6.6], [0, 10.5, -3], [0, 2.5, -0.2], '#c8282a'],
    ['head', [6, 6, 4], [0, 12, -6], [0, 0, -2], '#a8a8ac', { face: 'howler' }],
    ['cheekL', [1, 3, 2.4], [0, 12, -6], [3.1, -0.8, -2], '#c8c6c4'],
    ['cheekR', [1, 3, 2.4], [0, 12, -6], [-3.1, -0.8, -2], '#c8c6c4'],
    ['snout', [3, 2.6, 4.5], [0, 12, -6], [0, -1.2, -5.9], '#c8c4bc'],
    ['jaw', [2.6, 1, 3.6], [0, 12, -6], [0, -2.9, -5.6], '#e0dcd4'],
    ['nose', [2, 1.4, 1], [0, 12, -6], [0, -0.4, -8.1], '#202022'],
    ['earL', [2, 3, 1], [0, 12, -6], [2, 4.5, -1.5], '#8a8a8e'],
    ['earR', [2, 3, 1], [0, 12, -6], [-2, 4.5, -1.5], '#8a8a8e'],
    ['earInL', [1, 2, 0.6], [0, 12, -6], [2, 4.2, -2.1], '#5a5058'],
    ['earInR', [1, 2, 0.6], [0, 12, -6], [-2, 4.2, -2.1], '#5a5058'],
    ...quad([2, 8, 2], 1.5, 8, -3, 5, '#9a9a9e'),
    ['tail', [2.6, 8, 2.6], [0, 12, 6.5], [0, -4, 0], '#7a7a7e'],
  ],
};

// Ironguards: hulking iron golems with riveted plates, long arms and a little vine growth.
MODELS.ironguard = {
  parts: [
    ...(() => { const legs = [
      ['legL', [6, 16, 5], [5, 16, 0], [0, -8, 0], '#b8b2a8', { anim: 'legA' }],
      ['legR', [6, 16, 5], [-5, 16, 0], [0, -8, 0], '#b8b2a8', { anim: 'legB' }]];
      return [...legs, ...sock(legs, 'foot', '#8a8478', 4, 1.4), ...sock(legs, 'kneeCap', '#c8c2b8', 3, 1, 8)]; })(),
    ['waist', [9, 6, 7], [0, 19, 0], [0, 0, 0], '#c4beb4'],
    ['belt', [10, 1.6, 8], [0, 19, 0], [0, 1.6, 0], '#8a8478'],
    ['body', [18, 12, 11], [0, 28, 0], [0, 0, 0], '#cfc9bf'],
    ['plateL', [8, 9, 1], [0, 28, 0], [4.6, 0.5, -5.8], '#b8b2a8'],
    ['plateR', [8, 9, 1], [0, 28, 0], [-4.6, 0.5, -5.8], '#b8b2a8'],
    ...[[2.2, 4], [7, 4], [-2.2, 4], [-7, 4], [2.2, -3], [-2.2, -3]].map(([x, y], i) => [`rivet${i}`, [1.2, 1.2, 0.6], [0, 28, 0], [x, y + 0.5, -6.4], '#7a7468']),
    ['shoulderBar', [19, 2, 11.6], [0, 28, 0], [0, 5.2, 0], '#b8b2a8'],
    ['vine', [6, 8, 1], [0, 28, 0], [-4, -1, -5.8], '#4a7a2a'],
    ['vineB', [1.6, 7, 1], [0, 28, 0], [3.4, 1.5, -6.4], '#3a6a22'],
    ['leaf', [3, 0.8, 1.2], [0, 28, 0], [-6, 3.4, -6.4], '#5a8a3a'],
    ['moss', [7, 1, 6], [0, 28, 0], [-4, 6.4, 0], '#4a7a2a'],
    ['head', [8, 10, 8], [0, 34, -2], [0, 5, -2], '#cfc9bf', { face: 'ironguard' }],
    ['crown', [5, 1.6, 5], [0, 34, -2], [0, 10.6, -2], '#a8a298'],
    ['brow', [9, 1.8, 1.6], [0, 34, -2], [0, 6.8, -5.8], '#a8a298'],
    ['cheekL', [1, 4, 3], [0, 34, -2], [4.4, 3.6, -3], '#b8b2a8'],
    ['cheekR', [1, 4, 3], [0, 34, -2], [-4.4, 3.6, -3], '#b8b2a8'],
    ['nose', [2, 4, 2], [0, 34, -2], [0, 3, -7], '#b8b2a8'],
    ['chin', [6, 2, 1.6], [0, 34, -2], [0, 0.8, -6.2], '#b8b2a8'],
    ['armL', [5, 30, 6], [11.5, 33, 0], [0, -13, 0], '#c4beb4', { anim: 'armSwing' }],
    ['armR', [5, 30, 6], [-11.5, 33, 0], [0, -13, 0], '#c4beb4', { anim: 'armSwingB' }],
  ],
};

// Wobblers: a see-through green cube with a solid core and a face (size 1; scaled by size).
MODELS.wobbler = {
  parts: [
    ['core', [5, 5, 5], [0, 4, 0], [0, 0, 0], '#3f8a28'],
    ['bubbleA', [1.2, 1.2, 1.2], [0, 4, 0], [-2.2, -0.6, 1.2], '#a8e890'],
    ['bubbleB', [0.9, 0.9, 0.9], [0, 4, 0], [2.4, 1.6, 1.4], '#a8e890'],
    ['eyeL', [1.8, 1.8, 1], [0, 4, 0], [1.6, 1.2, -3.2], '#f4f8ec'],
    ['eyeR', [1.8, 1.8, 1], [0, 4, 0], [-1.6, 1.2, -3.2], '#f4f8ec'],
    ['pupilL', [0.9, 1.2, 0.6], [0, 4, 0], [1.3, 1.1, -3.7], '#10200a'],
    ['pupilR', [0.9, 1.2, 0.6], [0, 4, 0], [-1.3, 1.1, -3.7], '#10200a'],
    ['mouth', [2.6, 0.7, 1], [0, 4, 0], [0, -1.3, -3.3], '#10200a'],
    ['mouthL', [0.7, 0.7, 1], [0, 4, 0], [1.6, -0.8, -3.3], '#10200a'],
    ['mouthR', [0.7, 0.7, 1], [0, 4, 0], [-1.6, -0.8, -3.3], '#10200a'],
    ['shell', [8, 8, 8], [0, 4, 0], [0, 0, 0], '#7ad05a', { alpha: 0.55 }],
    ['gloss', [2.6, 0.8, 0.4], [0, 4, 0], [-2, 2.8, -4.05], '#ffffff', { alpha: 0.5 }],
    ['glossB', [0.8, 2, 0.4], [0, 4, 0], [-3.2, 1.8, -4.05], '#ffffff', { alpha: 0.4 }],
  ],
};

// Gallopers: horses with a long neck, flowing mane and tail, dark-tipped ears and pale socks; a saddle once saddled.
MODELS.galloper = {
  parts: [
    ['body', [10, 10, 22], [0, 18, 2], [0, 0, 0], '#8a5a32'],
    wash('barrel', [10.4, 3, 16], [0, 18, 2], [0, -3.6, 0], 0.28, '#ffffff'),
    ['saddle', [10.6, 3, 8], [0, 18, 2], [0, 5.5, -1], '#5a3418'],
    // Horse Armour (mobs/mounts.js): plates over the body, neck and head, tinted by tier and shown only when worn (hidden from the Field Guide picture)
    ['bardingBody', [10.9, 9, 14], [0, 18, 2], [0, -0.3, 4.5], '#a8aeb6', { gear: true }],
    ['bardingNeck', [5.8, 12.4, 7.8], [0, 22, -8], [0, 4, -1], '#a8aeb6', { gear: true }],
    ['bardingHead', [6.6, 2.4, 11.6], [0, 29, -10], [0, 3.8, -3], '#a8aeb6', { gear: true }],
    ['neck', [5, 12, 7], [0, 22, -8], [0, 4, -1], '#8a5a32'],
    ['mane', [2, 12, 4], [0, 22, -8], [0, 5, 2.4], '#3a2414'],
    ['head', [6, 6, 11], [0, 29, -10], [0, 1, -3], '#8a5a32', { face: 'galloper' }],
    wash('muzzle', [6.3, 3.4, 3.4], [0, 29, -10], [0, -0.4, -7.6], 0.32),
    ['eyeL', [0.6, 1.6, 1.6], [0, 29, -10], [3.1, 2, -4.4], '#161210'],
    ['eyeR', [0.6, 1.6, 1.6], [0, 29, -10], [-3.1, 2, -4.4], '#161210'],
    ['earL', [1.6, 3.4, 1.4], [0, 29, -10], [2, 5.4, -0.4], '#4a3626'],
    ['earR', [1.6, 3.4, 1.4], [0, 29, -10], [-2, 5.4, -0.4], '#4a3626'],
    ...(() => { const legs = quad([4, 13, 4], 3, 13, -6, 10, '#8a5a32'); return [...legs, ...sock(legs, 'sock', '#ffffff', 5, 0.5, 1.6, { alpha: 0.4 }), ...sock(legs, 'hoof', '#2a2018', 1.8, 0.7)]; })(),
    ['tail', [3, 12, 3], [0, 21, 13], [0, -6, 0], '#3a2414'],
  ],
};

// Flitters: a small furry bat with big ears, a pale chest, fangs and wide ribbed wings.
MODELS.flitter = {
  parts: [
    ['body', [4, 6, 4], [0, 8, 0], [0, 0, 0], '#4a3a2e'],
    ['chest', [3.4, 4, 0.8], [0, 8, 0], [0, 0.4, -2.2], '#8a7060'],
    ['head', [5, 5, 4], [0, 11, 0], [0, 2.5, 0], '#4a3a2e', { face: 'flitter' }],
    ['muzzle', [3, 2, 1], [0, 11, 0], [0, 1.2, -2.4], '#6a5040'],
    ['nose', [1.2, 1, 0.6], [0, 11, 0], [0, 1.8, -3], '#d88a9a'],
    ['earL', [1.6, 3.4, 1], [0, 11, 0], [1.7, 6.2, 0], '#3a2a20'],
    ['earR', [1.6, 3.4, 1], [0, 11, 0], [-1.7, 6.2, 0], '#3a2a20'],
    ['earInL', [0.8, 2.2, 0.6], [0, 11, 0], [1.7, 6, -0.6], '#b8788a'],
    ['earInR', [0.8, 2.2, 0.6], [0, 11, 0], [-1.7, 6, -0.6], '#b8788a'],
    ['footL', [1, 1.6, 1], [0, 8, 0], [1, -3.8, 0.4], '#2a1e18'],
    ['footR', [1, 1.6, 1], [0, 8, 0], [-1, -3.8, 0.4], '#2a1e18'],
    ['wingL', [8, 6, 1], [2, 10, 0], [4, -2, 0], '#2a1e18', { anim: 'batL' }],
    ['wingR', [8, 6, 1], [-2, 10, 0], [-4, -2, 0], '#2a1e18', { anim: 'batR' }],
    ['boneL', [8.4, 0.8, 1.4], [2, 10, 0], [4.2, 0.7, 0], '#5a4636', { anim: 'batL' }],
    ['boneR', [8.4, 0.8, 1.4], [-2, 10, 0], [-4.2, 0.7, 0], '#5a4636', { anim: 'batR' }],
    ['spar1L', [0.8, 5, 1.4], [2, 10, 0], [6, -2, 0], '#5a4636', { anim: 'batL' }],
    ['spar1R', [0.8, 5, 1.4], [-2, 10, 0], [-6, -2, 0], '#5a4636', { anim: 'batR' }],
    ['spar2L', [0.8, 4, 1.4], [2, 10, 0], [8.2, -1.2, 0], '#5a4636', { anim: 'batL' }],
    ['spar2R', [0.8, 4, 1.4], [-2, 10, 0], [-8.2, -1.2, 0], '#5a4636', { anim: 'batR' }],
  ],
};

// Frostlings: two snowballs with a carved pumpkin head, a red scarf, coal buttons and stick arms.
MODELS.frostling = {
  parts: [
    ['body', [12, 12, 12], [0, 6, 0], [0, 0, 0], '#eef2f6'],
    wash('bodyShade', [12.4, 3, 12.4], [0, 6, 0], [0, -4.5, 0], 0.12),
    ['chest', [10, 10, 10], [0, 17, 0], [0, 0, 0], '#e6ecf2'],
    ...[0, 1, 2].map((i) => [`button${i}`, [1.6, 1.6, 0.8], [0, 17, 0], [0, 2.4 - i * 3.4, -5.3], '#1a1a1e']),
    ['scarf', [10.8, 2, 10.8], [0, 17, 0], [0, 4.6, 0], '#c83a3a'],
    ['scarfTail', [2.6, 6, 1], [0, 17, 0], [3, 1.6, -5.4], '#b02e2e'],
    ['head', [8, 8, 8], [0, 22, 0], [0, 4, 0], '#e8922a', { face: 'frostling' }],
    ['stem', [2, 2.4, 2], [0, 22, 0], [0, 8.8, 0.4], '#4a6a2a'],
    ['stemTip', [1.2, 1.2, 1.2], [0, 22, 0], [0.8, 10.4, 0.4], '#3a5a22'],
    ['ribL', [1, 8.4, 8.4], [0, 22, 0], [3, 4, 0], '#c8741a'],
    ['ribR', [1, 8.4, 8.4], [0, 22, 0], [-3, 4, 0], '#c8741a'],
    ['armL', [12, 1, 1], [5, 19, 0], [6, 0, 0], '#6a4a28'],
    ['armR', [12, 1, 1], [-5, 19, 0], [-6, 0, 0], '#6a4a28'],
    ['twigL1', [1, 3, 1], [5, 19, 0], [11, 1.8, 0], '#6a4a28'],
    ['twigL2', [1, 2.4, 1], [5, 19, 0], [9, -1.6, 0], '#5a3e20'],
    ['twigR1', [1, 3, 1], [-5, 19, 0], [-11, 1.8, 0], '#6a4a28'],
    ['twigR2', [1, 2.4, 1], [-5, 19, 0], [-9, -1.6, 0], '#5a3e20'],
  ],
};

// Hoppers: small rabbits with long ears, a white scut and big haunches; Frostbears: big white bears; Vixlings: orange foxes with a white-tipped tail.
MODELS.hopper = {
  parts: [
    ['body', [5, 5, 8], [0, 4, 1], [0, 0, 0], '#9a7a5a'],
    ['backPatch', [5.4, 2, 6], [0, 4, 1], [0, 2, 0.4], '#7a5a3a'],
    ['chest', [4.6, 3.2, 3], [0, 4, 1], [0, -0.8, -3.2], '#d8c0a0'],
    ['haunchL', [2.4, 4.4, 4.4], [0, 4, 1], [2.5, -0.2, 2.2], '#8a6a4a'],
    ['haunchR', [2.4, 4.4, 4.4], [0, 4, 1], [-2.5, -0.2, 2.2], '#8a6a4a'],
    ['head', [5, 4, 5], [0, 6, -3], [0, 1, -2], '#9a7a5a', { face: 'hopper' }],
    ['band', [5.6, 5.6, 1.2], [0, 4, -1.5], [0, 0, 0], '#d84a8a'], // a tame Hopper's pink ribbon
    ['muzzle', [3, 2, 1.2], [0, 6, -3], [0, 0.2, -4.6], '#e0d0b8'],
    ['nose', [1.2, 0.9, 0.6], [0, 6, -3], [0, 0.9, -5.2], '#d8788a'],
    ['cheekL', [1.2, 2, 2.4], [0, 6, -3], [2.6, 0.2, -3.4], '#c8b090'],
    ['cheekR', [1.2, 2, 2.4], [0, 6, -3], [-2.6, 0.2, -3.4], '#c8b090'],
    ['earL', [1.4, 6, 1.4], [0, 6, -3], [1.3, 5.2, -1.5], '#b89a7a'],
    ['earR', [1.4, 6, 1.4], [0, 6, -3], [-1.3, 5.2, -1.5], '#b89a7a'],
    ['earInL', [0.7, 4.6, 0.6], [0, 6, -3], [1.3, 5, -2.3], '#e0a8a0'],
    ['earInR', [0.7, 4.6, 0.6], [0, 6, -3], [-1.3, 5, -2.3], '#e0a8a0'],
    ['tail', [3, 3, 2.6], [0, 4, 5], [0, 1, 0.4], '#f0ece4'],
    ['legFL', [2, 3, 2], [1.5, 2, -2], [0, -1, 0], '#8a6a4a', { anim: 'legA' }],
    ['legFR', [2, 3, 2], [-1.5, 2, -2], [0, -1, 0], '#8a6a4a', { anim: 'legA' }],
    ['legBL', [2, 3, 3], [1.5, 2, 3], [0, -1, 0], '#8a6a4a', { anim: 'legB' }],
    ['legBR', [2, 3, 3], [-1.5, 2, 3], [0, -1, 0], '#8a6a4a', { anim: 'legB' }],
  ],
};
MODELS.frostbear = {
  parts: [
    ['body', [14, 14, 22], [0, 15, 2], [0, 0, 0], '#ecedf0'],
    ['withers', [14.4, 3, 9], [0, 15, 2], [0, 7, -5], '#f6f7f9'],
    wash('bellyShade', [14.4, 4, 18], [0, 15, 2], [0, -5, 0], 0.14),
    ['head', [8, 8, 8], [0, 18, -10], [0, 0, -3], '#ecedf0', { face: 'frostbear' }],
    ['band', [14.6, 14.6, 2], [0, 15, -6], [0, 0, 0], '#3a7ad8'], // a tame Frostbear's blue harness
    ['snout', [4.4, 3.4, 3.2], [0, 18, -10], [0, -2, -8.3], '#d8d8dc'],
    ['nose', [2.4, 1.4, 0.8], [0, 18, -10], [0, -0.9, -9.9], '#1a1a22'],
    ['browL', [2.2, 1, 1], [0, 18, -10], [2.2, 2.4, -7.2], '#d0d2d8'],
    ['browR', [2.2, 1, 1], [0, 18, -10], [-2.2, 2.4, -7.2], '#d0d2d8'],
    ['earL', [2.6, 2.6, 1.4], [0, 18, -10], [3.4, 4.4, -2], '#d8d8dc'],
    ['earR', [2.6, 2.6, 1.4], [0, 18, -10], [-3.4, 4.4, -2], '#d8d8dc'],
    ['earInL', [1.4, 1.4, 0.6], [0, 18, -10], [3.4, 4.4, -2.8], '#a89aa4'],
    ['earInR', [1.4, 1.4, 0.6], [0, 18, -10], [-3.4, 4.4, -2.8], '#a89aa4'],
    ...quad([5, 10, 5], 4, 10, -6, 9, '#e2e3e6'),
    ['tail', [3.4, 3, 2.4], [0, 16, 13.4], [0, 0, 0.6], '#e2e3e6'],
  ],
};
// (white parts are tinted per bird; slightly different whites keep their materials apart)
MODELS.squawklet = {
  parts: [
    ['body', [3, 6, 3], [0, 6, 0], [0, 0, 0], '#ffffff'],
    ['breast', [3.4, 3.4, 1], [0, 6, 0], [0, -0.8, -1.4], '#fff6e4'],
    ['head', [2, 3, 2], [0, 10, -0.5], [0, 1.5, 0], '#ffffff', { face: 'squawklet' }],
    ['cheekL', [0.4, 1.6, 1.4], [0, 10, -0.5], [1.1, 1.2, -0.2], '#fffaf0'],
    ['cheekR', [0.4, 1.6, 1.4], [0, 10, -0.5], [-1.1, 1.2, -0.2], '#fffaf0'],
    ['beak', [1.2, 1.4, 1.4], [0, 10, -0.5], [0, 1.9, -1.4], '#e8a020'],
    ['beakTip', [0.8, 1.1, 0.8], [0, 10, -0.5], [0, 1.3, -2.1], '#c88010'],
    ['crest', [1, 2.6, 2], [0, 10, -0.5], [0, 3.8, 0.8], '#fdfdfd'],
    ['wingL', [1, 5, 3], [1.9, 8.5, 0], [0, -2, 0], '#fefefe', { anim: 'wingL' }],
    ['wingR', [1, 5, 3], [-1.9, 8.5, 0], [0, -2, 0], '#fefefe', { anim: 'wingR' }],
    ['tail', [2, 1, 4.6], [0, 4, 1.5], [0, 0, 1.9], '#fefefe'],
    ['tailTipA', [1.2, 0.8, 1.6], [0, 4, 1.5], [0.7, -0.1, 4.7], '#d85a3a'],
    ['tailTipB', [1.2, 0.8, 1.6], [0, 4, 1.5], [-0.7, -0.1, 4.7], '#3a7ad8'],
    ['legL', [1, 2, 1], [1, 3, 0], [0, -1, 0], '#3a3a3a'],
    ['legR', [1, 2, 1], [-1, 3, 0], [0, -1, 0], '#3a3a3a'],
    ['toesL', [1.6, 0.6, 1.8], [1, 3, 0], [0, -2, -0.3], '#2a2a2a'],
    ['toesR', [1.6, 0.6, 1.8], [-1, 3, 0], [0, -2, -0.3], '#2a2a2a'],
  ],
};
MODELS.shellback = {
  parts: [
    ['body', [14, 4, 16], [0, 4, 0], [0, 0, 0], '#c8c8a0'],
    ['shell', [16, 4, 18], [0, 4, 0], [0, 3, 0], '#3a7a3a'],
    ['shellRim', [16.8, 1.2, 18.8], [0, 4, 0], [0, 1.6, 0], '#8a9a5a'],
    ['shellTop', [10, 2, 12], [0, 4, 0], [0, 5.8, 0], '#2a5a2a'],
    ['plateA', [3.6, 2.4, 3.6], [0, 4, 0], [-3, 6.4, -3], '#4a8a44'],
    ['plateB', [3.6, 2.4, 3.6], [0, 4, 0], [3, 6.4, -3], '#4a8a44'],
    ['plateC', [3.6, 2.4, 3.6], [0, 4, 0], [-3, 6.4, 3], '#4a8a44'],
    ['plateD', [3.6, 2.4, 3.6], [0, 4, 0], [3, 6.4, 3], '#4a8a44'],
    ['ridgeLine', [1.2, 4.6, 18.4], [0, 4, 0], [0, 3, 0], '#2a5a2a'],
    ['head', [6, 5, 6], [0, 4, -8], [0, 0.5, -3], '#5aa84a', { face: 'shellback' }],
    ['beak', [3.6, 1.2, 1.6], [0, 4, -8], [0, -0.8, -6.6], '#8ab85a'],
    ['neckSkin', [5, 3.6, 3], [0, 4, -8], [0, -0.4, 0.2], '#4a9a3a'],
    ['legFL', [6, 2, 3], [6, 3, -6], [3, 0, 0], '#5aa84a', { anim: 'flipA' }],
    ['legFR', [6, 2, 3], [-6, 3, -6], [-3, 0, 0], '#5aa84a', { anim: 'flipB' }],
    ['legBL', [4, 2, 3], [5, 3, 7], [2, 0, 1], '#5aa84a', { anim: 'flipB' }],
    ['legBR', [4, 2, 3], [-5, 3, 7], [-2, 0, 1], '#5aa84a', { anim: 'flipA' }],
    ['tail', [2, 1.4, 3], [0, 3, 9], [0, 0, 1.4], '#4a9a3a'],
  ],
};
MODELS.buzzling = {
  parts: [
    ['body', [7, 7, 10], [0, 5, 0], [0, 0, 0], '#f0c030', { face: 'buzzling' }],
    ['fuzz', [7.5, 3, 3], [0, 5, 0], [0, 2.5, -3], '#f4d868'],
    ['stripeA', [7.4, 7.4, 1.6], [0, 5, 0], [0, 0, 0.5], '#3a2410'],
    ['stripeB', [7.4, 7.4, 1.6], [0, 5, 0], [0, 0, 3.4], '#3a2410'],
    ['sting', [1, 1, 2], [0, 5, 0], [0, -0.5, 5.8], '#2a1a0a'],
    ['mouth', [2.6, 1, 0.8], [0, 5, 0], [0, -2, -5.2], '#3a2410'],
    ['antL', [0.6, 3, 0.6], [0, 5, 0], [1.4, 4.5, -5], '#2a1a0a'],
    ['antR', [0.6, 3, 0.6], [0, 5, 0], [-1.4, 4.5, -5], '#2a1a0a'],
    ['antTipL', [1.2, 1.2, 1.2], [0, 5, 0], [1.7, 6.4, -5.2], '#2a1a0a'],
    ['antTipR', [1.2, 1.2, 1.2], [0, 5, 0], [-1.7, 6.4, -5.2], '#2a1a0a'],
    ['legsL', [1, 2, 6], [0, 5, 0], [2.4, -4, -0.5], '#2a1a0a'],
    ['legsR', [1, 2, 6], [0, 5, 0], [-2.4, -4, -0.5], '#2a1a0a'],
    ['wingL', [6, 0.4, 4], [1, 8.6, -1], [3, 0, 0], '#e8f4ff', { anim: 'beeL', alpha: 0.6 }],
    ['wingR', [6, 0.4, 4], [-1, 8.6, -1], [-3, 0, 0], '#e8f4ff', { anim: 'beeR', alpha: 0.6 }],
    ['wingLowL', [4, 0.4, 2.6], [1, 8.6, 1.4], [2, 0, 0], '#e8f4ff', { anim: 'beeL', alpha: 0.45 }],
    ['wingLowR', [4, 0.4, 2.6], [-1, 8.6, 1.4], [-2, 0, 0], '#e8f4ff', { anim: 'beeR', alpha: 0.45 }],
  ],
};
MODELS.cragbuck = {
  parts: [
    ['body', [9, 10, 16], [0, 15, 1], [0, 0, 0], '#e8e4da'],
    ['belly', [9.4, 2.4, 12], [0, 15, 1], [0, -3.8, 0], '#c8c0b0'],
    ['saddleMark', [9.4, 10.4, 4], [0, 15, 1], [0, 0, 4], '#cfc8b8'],
    ['head', [5, 7, 10], [0, 20, -7], [0, 1, -4], '#ecebe4', { face: 'cragbuck' }],
    ['band', [9.6, 10.6, 1.6], [0, 15, -6], [0, 0, 0], '#d8822a'], // a tame Cragbuck's harness band
    ['muzzle', [4, 3.4, 1.4], [0, 20, -7], [0, -1.6, -9.2], '#c8c0b0'],
    ['nose', [2, 1.2, 0.6], [0, 20, -7], [0, -0.6, -10.2], '#2a2428'],
    ['beard', [2, 4, 2], [0, 20, -7], [0, -4, -7], '#d8d0c0'],
    ['hornL', [1.6, 7, 1.6], [0, 20, -7], [1.6, 7, -2], '#b8ac90'],
    ['hornR', [1.6, 7, 1.6], [0, 20, -7], [-1.6, 7, -2], '#b8ac90'],
    ['earL', [3, 1, 2], [0, 20, -7], [3.5, 3, -2], '#d8d0c0'],
    ['earR', [3, 1, 2], [0, 20, -7], [-3.5, 3, -2], '#d8d0c0'],
    ...quad([3, 10, 3], 2.5, 10, -5, 7, '#d8d2c6'),
    ['tail', [2, 2.4, 2], [0, 19, 9], [0, 0.6, 1], '#d8d0c0'],
  ],
};
MODELS.purrling = {
  parts: [
    ['body', [4, 4, 12], [0, 8, 1], [0, 0, 0], '#c8883a'],
    ['mane', [4.4, 4.4, 3], [0, 8.5, -4], [0, 0, 0], '#c8883a'],
    ['collar', [5, 1.4, 3.4], [0, 8.5, -4], [0, 1.6, -0.2], '#2a6ad8'],
    ['head', [5, 4, 5], [0, 10, -6], [0, 0, -2], '#ffffff', { face: 'purrling' }], // white: tinted with the coat
    wash('tabby', [1, 4.4, 2.4], [0, 10, -6], [0, 0, -1.5], 0.32),
    ['snout', [3, 2, 1], [0, 10, -6], [0, -1, -5], '#e8d8c0'],
    ['nose', [1, 1, 0.6], [0, 10, -6], [0, -0.2, -5.6], '#e88a9a'],
    ['earL', [1.4, 1.6, 1], [0, 10, -6], [1.6, 2.6, -1], '#a86a2a'],
    ['earR', [1.4, 1.6, 1], [0, 10, -6], [-1.6, 2.6, -1], '#a86a2a'],
    ...quad([2, 6, 2], 1.1, 6, -3.5, 5.5, '#c8883a'),
    ['tail', [1, 8, 1], [0, 9.5, 7], [0, -4, 0], '#a86a2a'],
  ],
};
MODELS.vixling = {
  parts: [
    ['body', [6, 6, 11], [0, 7, 1], [0, 0, 0], '#e07a2a'],
    ['chestW', [5, 4, 3], [0, 7, 1], [0, -1.2, -4.2], '#f4ece0'],
    wash('backShade', [6.3, 2, 9], [0, 7, 1], [0, 2.4, 0.6], 0.14),
    ['head', [7, 6, 5], [0, 9, -5], [0, 0, -2], '#e07a2a', { face: 'vixling' }],
    ['band', [6.6, 6.6, 1.4], [0, 7, -4], [0, 0, 0], '#3aa860'], // a tame Vixling's green scarf
    ['cheekL', [1.2, 3, 3], [0, 9, -5], [3.7, -1.2, -2.4], '#f4ece0'],
    ['cheekR', [1.2, 3, 3], [0, 9, -5], [-3.7, -1.2, -2.4], '#f4ece0'],
    ['snout', [3, 2.2, 3.4], [0, 9, -5], [0, -1.4, -5.7], '#f4ece0'],
    ['nose', [1.4, 1, 0.8], [0, 9, -5], [0, -0.6, -7.5], '#1a1210'],
    ['earL', [2, 3.4, 1], [0, 9, -5], [2, 4.4, -1.5], '#2a1a10'],
    ['earR', [2, 3.4, 1], [0, 9, -5], [-2, 4.4, -1.5], '#2a1a10'],
    ['earInL', [1, 2, 0.6], [0, 9, -5], [2, 4.2, -2.1], '#f4ece0'],
    ['earInR', [1, 2, 0.6], [0, 9, -5], [-2, 4.2, -2.1], '#f4ece0'],
    ['tail', [4, 4, 9], [0, 8, 6], [0, -1, 4], '#e07a2a'],
    ['tailTip', [4.2, 4.2, 3], [0, 8, 6], [0, -1, 8.5], '#f4ece0'],
    ...quad([2, 5, 2], 1.5, 4, -3, 5, '#2a1a10'),
  ],
};

// Fish: a slim body with a tail fin that wags (mobTypes customRender)
MODELS.silverfin = {
  parts: [
    ['body', [3, 4, 8], [0, 3, 0], [0, 0, 0], '#9aa8b0'],
    ['back', [3.3, 1.4, 7.4], [0, 3, 0], [0, 1.8, 0.2], '#5a6a78'],
    ['belly', [3.3, 1.4, 6.6], [0, 3, 0], [0, -1.8, 0.4], '#dce4e8'],
    ['lateral', [3.2, 0.6, 6.4], [0, 3, 0], [0, 0.2, 0.4], '#4a5a66'],
    ['head', [3.2, 3.4, 1.8], [0, 3, 0], [0, 0, -4], '#8a98a2'],
    ['eyeL', [0.5, 1.1, 1.1], [0, 3, 0], [1.6, 0.6, -3.8], '#101418'],
    ['eyeR', [0.5, 1.1, 1.1], [0, 3, 0], [-1.6, 0.6, -3.8], '#101418'],
    ['gill', [3.4, 2.8, 0.5], [0, 3, 0], [0, -0.2, -3], '#6a7a84'],
    ['fin', [1, 2, 3], [0, 5, 0], [0, 1.5, 0], '#7a8890'],
    ['finAnal', [0.8, 1.4, 2], [0, 3, 0], [0, -2.6, 2], '#7a8890'],
    ['finL', [2, 0.5, 1.8], [0, 3, 0], [2.2, -1.2, -1.4], '#7a8890'],
    ['finR', [2, 0.5, 1.8], [0, 3, 0], [-2.2, -1.2, -1.4], '#7a8890'],
    ['tail', [1, 4, 3], [0, 3, 4], [0, 0, 1.5], '#7a8890'],
  ],
};
MODELS.reeffin = {
  parts: [
    ['body', [2, 5, 6], [0, 3, 0], [0, 0, 0], '#f08a1a'],
    ['stripe', [2.2, 5.2, 1.2], [0, 3, 0], [0, 0, 0], '#f4f4f0'],
    ['stripeB', [2.2, 5.2, 0.8], [0, 3, 0], [0, 0, 1.8], '#f4f4f0'],
    ['stripeC', [2.2, 5.2, 0.6], [0, 3, 0], [0, 0, -2.2], '#3a3a40'],
    ['snout', [1.6, 2.4, 1], [0, 3, 0], [0, -0.2, -3.4], '#f08a1a'],
    ['eyeL', [0.5, 1.4, 1.4], [0, 3, 0], [1.1, 1, -2.4], '#f8f8f0'],
    ['eyeR', [0.5, 1.4, 1.4], [0, 3, 0], [-1.1, 1, -2.4], '#f8f8f0'],
    ['pupilL', [0.4, 0.8, 0.8], [0, 3, 0], [1.3, 1, -2.6], '#101018'],
    ['pupilR', [0.4, 0.8, 0.8], [0, 3, 0], [-1.3, 1, -2.6], '#101018'],
    ['fin', [0.8, 2.6, 3.6], [0, 5.5, 0], [0, 1.1, 0], '#3a6ad8'],
    ['finAnal', [0.8, 1.8, 2], [0, 3, 0], [0, -2.8, 1.4], '#3a6ad8'],
    ['finL', [1.6, 0.5, 1.4], [0, 3, 0], [1.6, -0.6, -1.2], '#3a6ad8'],
    ['finR', [1.6, 0.5, 1.4], [0, 3, 0], [-1.6, -0.6, -1.2], '#3a6ad8'],
    ['tail', [1, 4, 2], [0, 3, 3], [0, 0, 1], '#3a6ad8'],
  ],
};
MODELS.dolphin = {
  parts: [
    ['body', [6, 6, 14], [0, 4, 0], [0, 0, 0], '#6a7a8a'],
    ['back', [6.4, 2.4, 10], [0, 4, 0], [0, 2.8, 1], '#52626f'],
    ['belly', [5, 2, 12], [0, 4, 0], [0, -2.5, 0], '#c8d0d8'],
    ['throat', [5.4, 2.6, 5], [0, 4, 0], [0, -2.2, -4], '#d0d8de'],
    ['melon', [5.4, 3.6, 3.4], [0, 4, 0], [0, 0.8, -7.2], '#6a7a8a'],
    ['snout', [2.4, 2, 4.6], [0, 4, -7], [0, -1, -2], '#7a8a9a'],
    ['lip', [2.6, 0.5, 4.8], [0, 4, -7], [0, -1.7, -2], '#3a4654'],
    ['eyeL', [0.5, 1, 1], [0, 4, 0], [3.1, 1, -5.2], '#0a0a10'],
    ['eyeR', [0.5, 1, 1], [0, 4, 0], [-3.1, 1, -5.2], '#0a0a10'],
    ['fin', [1, 4, 3.4], [0, 7, 0], [0, 2, 1], '#5a6a7a'],
    ['finTip', [0.8, 1.6, 1.8], [0, 7, 0], [0, 4.4, 2.6], '#4a5a6a'],
    ['flipL', [4, 1, 3], [3, 3, -3], [2, 0, 0], '#5a6a7a'],
    ['flipR', [4, 1, 3], [-3, 3, -3], [-2, 0, 0], '#5a6a7a'],
    ['stock', [3, 3.4, 3], [0, 4, 7], [0, 0, 0.8], '#5a6a7a'],
    ['tail', [7, 1, 4], [0, 4, 7], [0, 0, 2.5], '#5a6a7a'],
  ],
};
// Croakers: a squat body, a wide head with eyes on top, a throat sac and a tongue that shoots out (tinted per colour)
MODELS.croaker = {
  parts: [
    ['body', [7, 4, 8], [0, 3, 0], [0, 0, 0], '#d89a4a'],
    wash('belly', [6.4, 1.4, 7], [0, 3, 0], [0, -1.4, 0.2], 0.32, '#ffffff'),
    wash('spotA', [1.8, 4.3, 1.8], [0, 3, 0], [1.6, 0, 1.2], 0.3),
    wash('spotB', [1.4, 4.3, 1.4], [0, 3, 0], [-1.8, 0, 2.6], 0.3),
    wash('spotC', [1.2, 4.3, 1.2], [0, 3, 0], [-0.4, 0, -0.6], 0.3),
    wash('hauncheL', [2.4, 3.8, 5], [0, 3, 0], [3.2, 0, 2.2], 0.2),
    wash('hauncheR', [2.4, 3.8, 5], [0, 3, 0], [-3.2, 0, 2.2], 0.2),
    ['head', [7, 3, 5], [0, 4, -3], [0, 0.5, -2.5], '#fffffc', { face: 'croaker' }],
    ['eyeL', [2, 2, 2], [0, 4, -3], [2.2, 2.6, -3.2], '#f0f0e0'],
    ['eyeR', [2, 2, 2], [0, 4, -3], [-2.2, 2.6, -3.2], '#f0f0e1'],
    ['irisL', [1.5, 1.5, 0.4], [0, 4, -3], [2.2, 2.6, -4.25], '#e0b838'],
    ['irisR', [1.5, 1.5, 0.4], [0, 4, -3], [-2.2, 2.6, -4.25], '#e0b838'],
    ['pupilL', [0.6, 1.4, 0.4], [0, 4, -3], [2.2, 2.6, -4.45], '#141010'],
    ['pupilR', [0.6, 1.4, 0.4], [0, 4, -3], [-2.2, 2.6, -4.45], '#141010'],
    wash('lidL', [2.3, 0.7, 2.3], [0, 4, -3], [2.2, 3.5, -3.2], 0.35),
    wash('lidR', [2.3, 0.7, 2.3], [0, 4, -3], [-2.2, 3.5, -3.2], 0.35),
    ['throat', [5, 1, 3], [0, 2.4, -4], [0, -0.5, -1.5], '#f4e8c8'],
    ['tongue', [1, 1, 2], [0, 3.5, -8], [0, 0, -1], '#e86a80'],
    ['legFL', [2, 3, 2], [2.5, 2, -2], [0, -1.5, 0], '#d89a4b', { anim: 'legA' }],
    ['legFR', [2, 3, 2], [-2.5, 2, -2], [0, -1.5, 0], '#d89a4b', { anim: 'legB' }],
    ['legBL', [2.5, 2, 4], [3, 1.5, 3], [0.5, -0.5, 0], '#d89a4c'],
    ['legBR', [2.5, 2, 4], [-3, 1.5, 3], [-0.5, -0.5, 0], '#d89a4c'],
    ['toesL', [2.4, 0.6, 1.4], [2.5, 2, -2], [0, -3, -0.8], '#000000', { alpha: 0.28 }],
    ['toesR', [2.4, 0.6, 1.4], [-2.5, 2, -2], [0, -3, -0.8], '#000000', { alpha: 0.28 }],
  ],
};
// Gillnewts: a long low body, a wide head with frilly gills, four stubby legs and a finned tail (tinted per colour)
MODELS.gillnewt = {
  parts: [
    ['body', [5, 3.4, 10], [0, 2.6, 0], [0, 0, 0], '#f0a8c0'],
    wash('belly', [4.6, 1.2, 9], [0, 2.6, 0], [0, -1.4, 0], 0.32, '#ffffff'),
    wash('spotA', [1.6, 3.6, 1.6], [0, 2.6, 0], [0.8, 0, -1.8], 0.22),
    wash('spotB', [1.4, 3.6, 1.4], [0, 2.6, 0], [-1, 0, 0.4], 0.22),
    wash('spotC', [1.6, 3.6, 1.6], [0, 2.6, 0], [0.6, 0, 2.8], 0.22),
    ['head', [6, 3.6, 4.4], [0, 3, -5], [0, 0, -2], '#fffffd', { face: 'gillnewt' }],
    ['eyeL', [1.4, 1, 1.4], [0, 3, -5], [2.2, 2, -1.8], '#141018'],
    ['eyeR', [1.4, 1, 1.4], [0, 3, -5], [-2.2, 2, -1.8], '#141018'],
    ['eyeHiL', [0.5, 0.5, 0.5], [0, 3, -5], [2.4, 2.5, -2.3], '#ffffff'],
    ['eyeHiR', [0.5, 0.5, 0.5], [0, 3, -5], [-2, 2.5, -2.3], '#ffffff'],
    ['gillL', [1, 3, 1.4], [3, 4.4, -6], [0.5, 1, 0], '#d0406a'],
    ['gillR', [1, 3, 1.4], [-3, 4.4, -6], [-0.5, 1, 0], '#d0406a'],
    ['crest', [0.8, 1.6, 8], [0, 4.3, 0.5], [0, 0.6, 0], '#d0406b'],
    ['tail', [1, 3.4, 7], [0, 2.8, 5], [0, 0, 3.5], '#f0a8c2'],
    wash('tailBandA', [1.2, 3.6, 1.2], [0, 2.8, 5], [0, 0, 2], 0.24),
    wash('tailBandB', [1.2, 3.6, 1.2], [0, 2.8, 5], [0, 0, 4.4], 0.24),
    ['legFL', [1.6, 1.6, 1.6], [2.8, 1.4, -3], [0.6, -0.6, 0], '#f0a8c3', { anim: 'legA' }],
    ['legFR', [1.6, 1.6, 1.6], [-2.8, 1.4, -3], [-0.6, -0.6, 0], '#f0a8c3', { anim: 'legB' }],
    ['legBL', [1.6, 1.6, 1.6], [2.8, 1.4, 3], [0.6, -0.6, 0], '#f0a8c3', { anim: 'legB' }],
    ['legBR', [1.6, 1.6, 1.6], [-2.8, 1.4, 3], [-0.6, -0.6, 0], '#f0a8c3', { anim: 'legA' }],
  ],
};
// Inklings: a dark blue squid-like body with a pointed mantle, fins, a beak and eight tentacles that sweep with each pulse.
MODELS.inkling = {
  parts: [
    ['body', [10, 12, 10], [0, 12, 0], [0, 0, 0], '#2a3a6a', { face: 'inkling' }],
    ['mantle', [8.4, 1.6, 8.4], [0, 12, 0], [0, 6.8, 0.3], '#222f58'],
    ['finL', [1.2, 6, 5], [0, 12, 0], [5.4, 2.4, 1.6], '#35488a'],
    ['finR', [1.2, 6, 5], [0, 12, 0], [-5.4, 2.4, 1.6], '#35488a'],
    wash('spotA', [2.4, 2.4, 10.4], [0, 12, 0], [-2, 4.4, 0], 0.28, '#8ab0ff'),
    wash('spotB', [1.8, 1.8, 10.4], [0, 12, 0], [2.4, 1.4, 0], 0.28, '#8ab0ff'),
    wash('spotC', [10.4, 1.6, 2], [0, 12, 0], [0, 5.2, 3], 0.22, '#8ab0ff'),
    ['beak', [3, 2, 1.6], [0, 12, 0], [0, -3.4, -5.4], '#14183a'],
    ...(() => { const ts = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
      const a = (k / 8) * Math.PI * 2;
      return [`t${k}`, [2, 10, 2], [Math.sin(a) * 4, 6, Math.cos(a) * 4], [0, -5, 0], '#24325c', { anim: 'tentacle', idx: k }];
    });
      return [...ts, ...sock(ts, 'tip', '#4a64b0', 4, 0.8, 0, { emissive: '#101a40' })]; })(),
  ],
};

// Deepeyes (Tide Citadel guardians): a boxy fish with one great eye, spikes that
// stand out while it holds still (scaled by oceanMobs.js), side fins, a crest and a three-part tail.
// The Elder Deepeye is the same body in pale colours, drawn larger.
function deepeyeModel(body, panel, spike, tail) {
  const spikes = [];
  // two spikes on each face, pointing straight out (pivot on the surface, so they shrink back into it)
  for (const [nx, ny, nz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    for (const s of [-1, 1]) {
      const off = nx ? [0, s * 3, s * 3] : ny ? [s * 3, 0, -s * 3] : [s * 3, s * 3, 0];
      if (nz < 0 && Math.abs(off[0]) < 4 && Math.abs(off[1]) < 4) { off[0] = s * 5; off[1] = 5; } // keep the eye clear
      const size = nx ? [5, 1.6, 1.6] : ny ? [1.6, 5, 1.6] : [1.6, 1.6, 5];
      spikes.push([`spike${spikes.length}`, size, [nx * 6 + off[0], 7 + ny * 6 + off[1], nz * 6 + off[2]], [nx * 2.5, ny * 2.5, nz * 2.5], spike]);
    }
  }
  return {
    parts: [
      ['body', [12, 12, 12], [0, 7, 0], [0, 0, 0], body, { face: 'deepeye' }],
      ['panelL', [0.6, 8, 8], [6.2, 7, 0], [0, 0, 0], panel],
      ['panelR', [0.6, 8, 8], [-6.2, 7, 0], [0, 0, 0], panel],
      ['panelT', [8, 0.6, 8], [0, 13.2, 0], [0, 0, 0], panel],
      ['crestD', [1.4, 3, 8], [0, 14, 2], [0, 0, 0], tail],
      ['finL', [4, 1.2, 5], [6, 4, 1], [2, 0, 0], tail],
      ['finR', [4, 1.2, 5], [-6, 4, 1], [-2, 0, 0], tail],
      ...spikes,
      ['tail0', [8, 8, 7], [0, 7, 8], [0, 0, 1.5], body, { anim: 'tailSeg', idx: 1 }],
      ['tail1', [5, 5, 7], [0, 7, 14], [0, 0, 1.5], tail, { anim: 'tailSeg', idx: 2 }],
      ['tail2', [2, 7, 6], [0, 7, 20], [0, 0, 1.5], tail, { anim: 'tailSeg', idx: 3 }],
    ],
  };
}
MODELS.deepeye = deepeyeModel('#3f7a74', '#2d5c58', '#e6d2a4', '#c8805a');
MODELS.elder_deepeye = deepeyeModel('#c4c0cc', '#9a94a8', '#8a6aa0', '#7a6a8a');

// Marauders: grey-skinned raiders in dark coats and red headbands, crossbow raised when they aim.
MODELS.marauder = {
  parts: [
    ['head', [8, 10, 8], [0, 24, 0], [0, 5, 0], '#8a908a', { face: 'marauder' }],
    ['brow', [8.6, 1.6, 8.6], [0, 24, 0], [0, 8, 0], '#8a2a2a'],
    ['browKnot', [2, 2, 1.4], [0, 24, 0], [3.4, 8, 4.6], '#6a1e1e'],
    ['nose', [2, 4, 2], [0, 24, 0], [0, 2, -5], '#7a807a'],
    ['earL', [1, 3, 1.8], [0, 24, 0], [4.4, 5, 0.4], '#7a807a'],
    ['earR', [1, 3, 1.8], [0, 24, 0], [-4.4, 5, 0.4], '#7a807a'],
    ['body', [8, 12, 6], [0, 18, 0], [0, 0, 0], '#3a3a44'],
    ['neckRim', [9, 2.6, 7], [0, 18, 0], [0, 5.8, 0], '#2a2a32'],
    ['lapelL', [2, 10, 0.6], [0, 18, 0], [1.8, 0, -3.2], '#4e4e5a'],
    ['lapelR', [2, 10, 0.6], [0, 18, 0], [-1.8, 0, -3.2], '#4e4e5a'],
    ['belt', [8.4, 1.6, 6.4], [0, 18, 0], [0, -3.4, 0], '#5a4a2a'],
    ['buckle', [2, 1.6, 0.6], [0, 18, 0], [0, -3.4, -3.3], '#c8a838'],
    ['coatTail', [8.8, 4, 6.8], [0, 18, 0], [0, -7.4, 0], '#32323c'],
    ...(() => { const arms = [
      ['armL', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#2e2e36', { anim: 'armAim' }],
      ['armR', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#2e2e36', { anim: 'armAim' }]];
      return [...arms, ...sock(arms, 'hand', '#8a908a', 3, 0.4), ...sock(arms, 'cuff', '#4a4a56', 2, 0.8, 3)]; })(),
    ['bow', [1, 2, 10], [-6, 22, 0], [0, -11, -1], '#5a3a1a', { anim: 'armAim' }],
    ['prod', [10, 1, 1.4], [-6, 22, 0], [0, -11, -5.4], '#3a2a1a', { anim: 'armAim' }],
    ['bowString', [9, 0.4, 0.4], [-6, 22, 0], [0, -11, -3.4], '#e8e0c8', { anim: 'armAim' }],
    ['bolt', [0.6, 0.6, 7], [-6, 22, 0], [0, -9.8, -3], '#8a8a92', { anim: 'armAim' }],
    ['legL', [4, 12, 4], [2, 12, 0], [0, -6, 0], '#24242a', { anim: 'legA' }],
    ['legR', [4, 12, 4], [-2, 12, 0], [0, -6, 0], '#24242a', { anim: 'legB' }],
  ],
};

// Hexwife: a hunched brewer in a moss-green robe with a sash, a long warty nose
// and a tall crooked hat; she lifts a vial to drink (hostileVariants.js shows it).
MODELS.hexwife = {
  parts: [
    ['head', [8, 10, 8], [0, 24, 0], [0, 5, 0], '#8a9a78', { face: 'hexwife' }],
    ['nose', [2, 5, 2], [0, 24, 0], [0, 2, -5], '#7a8a68'],
    ['wart', [1, 1, 1], [0, 24, 0], [1, 1, -6.2], '#4a5a30'],
    ['brim', [12, 1, 12], [0, 24, 0], [0, 10.5, 0], '#2a2236'],
    ['hat1', [7, 4, 7], [0, 24, 0], [0, 13, 0.5], '#2a2236'],
    ['band', [7.4, 1, 7.4], [0, 24, 0], [0, 11.5, 0.5], '#8a3a5a'],
    ['hat2', [4, 4, 4], [0, 24, 0], [0, 17, 1.5], '#2a2236'],
    ['hat3', [2, 3, 2], [0, 24, 0], [0, 20, 2.8], '#2a2236'],
    ['robe', [8, 12, 6], [0, 18, 0], [0, 0, 0], '#3e5a3a'],
    ['hump', [6, 5, 3], [0, 18, 0], [0, 3.4, 4], '#34502f'],
    ['apron', [5, 9, 0.6], [0, 18, 0], [0, -1.5, -3.3], '#6a8a58'],
    ['sash', [8.4, 2, 6.4], [0, 18, 0], [0, -2, 0], '#8a3a5a'],
    ['pouch', [2.4, 3, 1.6], [0, 18, 0], [3.4, -4.4, -3.6], '#6a4a2a'],
    ['hem', [9, 3, 7], [0, 12, 0], [0, -1, 0], '#34502f'],
    ...(() => { const arms = [
      ['armL', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#3e5a3a', { anim: 'armSwingB' }],
      ['armR', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#3e5a3a', { anim: 'armSwing' }]];
      return arms; })(),
    ['vial', [2, 4, 2], [-6, 22, 0], [0, -11, -2], '#9ad0e8', { emissive: '#305a70' }],
    ['legL', [4, 12, 4], [2, 12, 0], [0, -6, 0], '#2a2a22', { anim: 'legA' }],
    ['legR', [4, 12, 4], [-2, 12, 0], [0, -6, 0], '#2a2a22', { anim: 'legB' }],
  ],
};
// Dune Shambler: a sun-dried Shambler in sand-coloured wrappings.
MODELS.dune_shambler = {
  parts: [
    ['head', [8, 8, 8], [0, 24, 0], [0, 4, 0], '#a8946a', { face: 'dune_shambler' }],
    ['wrap', [8.6, 3, 8.6], [0, 24, 0], [0, 6.6, 0], '#d8c49a'],
    ['wrapB', [8.6, 1.2, 8.6], [0, 24, 0], [0, 3.4, 0], '#c8b488'],
    ['wrapTail', [2, 4, 1], [0, 24, 0], [-2, 4.4, 4.5], '#d8c49a'],
    ['nose', [2, 2, 1.2], [0, 24, 0], [0, 2.8, -4.4], '#98845a'],
    ['body', [8, 12, 4], [0, 18, 0], [0, 0, 0], '#8a6a42'],
    ['strapA', [10, 1.4, 4.6], [0, 18, 0], [0, 3, 0], '#d8c49a'],
    ['strapB', [10, 1.4, 4.6], [0, 18, 0], [0, -1.4, 0], '#c8b488'],
    ['scarf', [9, 3, 5], [0, 18, 0], [0, 4.6, 0], '#d8c49a'],
    ['scarfTail', [2.4, 6, 0.8], [0, 18, 0], [-2.6, 0.8, -2.6], '#c8b488'],
    ...(() => { const arms = [
      ['armL', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#a8946a', { anim: 'armForward' }],
      ['armR', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#a8946a', { anim: 'armForward' }]];
      return [...arms, ...sock(arms, 'wrapArm', '#d8c49a', 4, 0.7, 2), ...sock(arms, 'claw', '#e8dcb8', 1, 0.3)]; })(),
    ['legL', [4, 12, 4], [2, 12, 0], [0, -6, 0], '#5a4630', { anim: 'legA' }],
    ['legR', [4, 12, 4], [-2, 12, 0], [0, -6, 0], '#5a4630', { anim: 'legB' }],
  ],
};
// Sodden Shambler: a waterlogged teal Shambler trailing strands of weed.
MODELS.sodden_shambler = {
  parts: [
    ['head', [8, 8, 8], [0, 24, 0], [0, 4, 0], '#4a8a86', { face: 'sodden_shambler' }],
    ['nose', [2, 2, 1.2], [0, 24, 0], [0, 2.8, -4.4], '#3a7a76'],
    ['finH', [1, 3, 5], [0, 24, 0], [0, 9, 0.6], '#3a7a3a'],
    ['gillL', [0.8, 2.4, 2], [0, 24, 0], [4.3, 2.4, 0.4], '#2e6a68'],
    ['gillR', [0.8, 2.4, 2], [0, 24, 0], [-4.3, 2.4, 0.4], '#2e6a68'],
    ['body', [8, 12, 4], [0, 18, 0], [0, 0, 0], '#2e5a50'],
    ['barnacleA', [2, 2, 0.8], [0, 18, 0], [-1.6, 1.6, -2.2], '#8a9a8a'],
    ['barnacleB', [1.4, 1.4, 0.8], [0, 18, 0], [2, -2.4, -2.2], '#8a9a8a'],
    ['weedA', [2, 8, 1], [0, 18, 0], [2, -7, -2.4], '#3a7a3a'],
    ['weedB', [1, 6, 1], [0, 18, 0], [-3, -6, -2.4], '#2f6a34'],
    ['weedC', [3, 1, 9], [0, 24, 0], [1, 8.5, 0], '#3a7a3a'],
    ['weedD', [1.4, 7, 1], [0, 18, 0], [3, -4.5, 2.4], '#2f6a34'],
    ...(() => { const arms = [
      ['armL', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#4a8a86', { anim: 'armForward' }],
      ['armR', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#4a8a86', { anim: 'armForward' }]];
      return [...arms, ...sock(arms, 'hand', '#3a7a76', 3, 0.4), ...sock(arms, 'claw', '#a8d8c8', 1, 0.3)]; })(),
    ['legL', [4, 12, 4], [2, 12, 0], [0, -6, 0], '#24463e', { anim: 'legA' }],
    ['legR', [4, 12, 4], [-2, 12, 0], [0, -6, 0], '#24463e', { anim: 'legB' }],
    // a Tidespear in the hand (shown for the ones that carry one)
    ['spear', [1, 1, 22], [-6, 22, 0], [0, -11, 1], '#5aa898'],
    ['spearHead', [5, 1, 3], [-6, 22, 0], [0, -11, 13], '#9adcc8'],
  ],
};
// Rime Rattler: a frost-blue Rattler in a ragged hood and cloak, with ice shards on its shoulders.
MODELS.rime_rattler = {
  parts: [
    ['head', [8, 8, 8], [0, 24, 0], [0, 4, 0], '#c8d8e2', { face: 'rime_rattler' }],
    ['hood', [9, 4, 9], [0, 24, 0], [0, 7, 0.4], '#5a6a7e'],
    ['hoodSide', [9.4, 6, 3], [0, 24, 0], [0, 4, 3.8], '#4a5a6e'],
    ['icicleA', [1, 3, 1], [0, 24, 0], [-2.5, 3.8, -4.6], '#bfe6f8'],
    ['icicleB', [1, 2, 1], [0, 24, 0], [1.5, 4.2, -4.6], '#bfe6f8'],
    ['body', [8, 12, 4], [0, 18, 0], [0, 0, 0], '#a8bcc8'],
    ...[3.6, 1.4, -0.8, -3].map((y, i) => ['rib' + i, [8.4, 1, 4.4], [0, 18, 0], [0, y, 0], '#6a7e8e']),
    ['cloak', [9, 10, 2], [0, 18, 0], [0, -1, 2.6], '#5a6a7e'],
    ['cloakHem', [9.4, 2, 2.4], [0, 18, 0], [0, -5.6, 2.6], '#46566a'],
    ['shardL', [2, 5, 2], [0, 18, 0], [5.2, 6.6, 0.4], '#bfe6f8', { emissive: '#3a6a8a' }],
    ['shardR', [2, 3.6, 2], [0, 18, 0], [-5.2, 6.2, 0.4], '#bfe6f8', { emissive: '#3a6a8a' }],
    ['armL', [2, 12, 2], [5, 22, 0], [0, -5, 0], '#c8d8e2', { anim: 'armAim' }],
    ['armR', [2, 12, 2], [-5, 22, 0], [0, -5, 0], '#c8d8e2', { anim: 'armAim' }],
    ['handL', [2.6, 2.4, 2.6], [5, 22, 0], [0, -10.8, 0], '#a8bcc8', { anim: 'armAim' }],
    ['handR', [2.6, 2.4, 2.6], [-5, 22, 0], [0, -10.8, 0], '#a8bcc8', { anim: 'armAim' }],
    ['bow', [1, 14, 1], [-5, 22, 0], [0, -1, -11], '#4a3a2a', { anim: 'armAim' }],
    ['bowGrip', [1.6, 3, 1.6], [-5, 22, 0], [0, -1, -11], '#2a2018', { anim: 'armAim' }],
    ['bowString', [0.4, 13, 0.4], [-5, 22, 0], [0, -1, -9.6], '#e8f4ff', { anim: 'armAim' }],
    ['arrow', [0.6, 0.6, 9], [-5, 22, 0], [0, -1, -6], '#8aa8c0', { anim: 'armAim' }],
    ['legL', [2, 12, 2], [2, 12, 0], [0, -6, 0], '#b8ccd8', { anim: 'legA' }],
    ['legR', [2, 12, 2], [-2, 12, 0], [0, -6, 0], '#b8ccd8', { anim: 'legB' }],
  ],
};

// Settlers: big-nosed villagers in a robe whose colour shows the profession, with a brow, hair and an apron.
MODELS.settler = {
  parts: [
    ['head', [8, 10, 8], [0, 24, 0], [0, 5, 0], '#b8835a', { face: 'settler' }],
    ['hairTop', [8.6, 2, 8.6], [0, 24, 0], [0, 9.8, 0.2], '#4a3426'],
    ['hairBack', [8.6, 7, 1.4], [0, 24, 0], [0, 6, 4.1], '#4a3426'],
    ['nose', [2, 4, 2], [0, 24, 0], [0, 2, -5], '#a87350'],
    ['noseTip', [2.4, 1.4, 1], [0, 24, 0], [0, 0.4, -5.8], '#9a6648'],
    ['brow', [8.4, 1.2, 1], [0, 24, 0], [0, 6.6, -4.1], '#3a2a1a'],
    ['robe', [8, 12, 6], [0, 18, 0], [0, 0, 0], '#8a6a3a'],
    wash('neckShade', [8.6, 1.6, 6.6], [0, 18, 0], [0, 5.4, 0], 0.26),
    wash('hemShade', [8.6, 2.4, 6.6], [0, 18, 0], [0, -4.8, 0], 0.22),
    ['apron', [6, 8, 0.6], [0, 18, 0], [0, -1.6, -3.3], '#d8c8a0'],
    ['belt', [8.4, 1.2, 6.4], [0, 18, 0], [0, -2.6, 0], '#4a3a22'],
    ['arms', [8, 4, 4], [0, 20, -1], [0, -1, -3.5], '#8a6a3a'],
    wash('armsShade', [8.4, 1.4, 4.4], [0, 20, -1], [0, -2.4, -3.5], 0.25),
    ['hands', [3.6, 2.2, 1.4], [0, 20, -1], [0, -1.2, -5.9], '#b8835a'],
    ['legR', [4, 12, 4], [2, 12, 0], [0, -6, 0], '#3a2a20', { anim: 'legB' }],
    ['legL', [4, 12, 4], [-2, 12, 0], [0, -6, 0], '#3a2a20', { anim: 'legA' }],
  ],
};

// The player as seen in third-person views (faces -z like the mobs; its right arm is +x).
MODELS.player = {
  parts: [
    ['head', [8, 8, 8], [0, 24, 0], [0, 4, 0], '#c9946a', { face: 'player' }],
    ['hair', [8.4, 2.4, 8.4], [0, 24, 0], [0, 7.2, 0.3], '#4a3220'],
    ['body', [8, 12, 4], [0, 18, 0], [0, 0, 0], '#3a6a9a'],
    ['neck', [4, 1.6, 4.4], [0, 18, 0], [0, 5.6, -0.1], '#c9946a'],
    ['shirtStripe', [8.4, 1.4, 4.4], [0, 18, 0], [0, 1, 0], '#4a82b8'],
    ['belt', [8.4, 1.6, 4.4], [0, 18, 0], [0, -4.4, 0], '#3a2a1a'],
    ['buckle', [1.8, 1.4, 0.5], [0, 18, 0], [0, -4.4, -2.3], '#c8a838'],
    ['armR', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#3a6a9a', { anim: 'armSwing' }],
    ['armL', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#3a6a9a', { anim: 'armSwingB' }],
    ['legR', [4, 12, 4], [2, 12, 0], [0, -6, 0], '#2c2c4a', { anim: 'legB' }],
    ['legL', [4, 12, 4], [-2, 12, 0], [0, -6, 0], '#2c2c4a', { anim: 'legA' }],
  ],
};

// ---- Cinderdeep and Hollow mobs ----
// Ashwraith: a huge pale shroud with a sorrowful face, hanging folds and nine trailing tendrils.
MODELS.ashwraith = {
  parts: [
    ['head', [60, 52, 60], [0, 38, 0], [0, 0, 0], '#e6e1da', { face: 'ashwraith' }],
    ...[-24, -12, 12, 24].map((x, i) => wash(`fold${i}`, [3, 52.6, 60.6], [0, 38, 0], [x, 0, 0], 0.1)),
    ['hemFringe', [61.5, 4, 61.5], [0, 38, 0], [0, -24, 0], '#c8c2b8'],
    ['hood', [62, 5, 62], [0, 38, 0], [0, 22.6, 0], '#d4cec6'],
    ...(() => { const ts = [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => [`tendril${i}${j}`, [5, 30, 5], [i * 18, 12, j * 18], [0, -15, 0], '#d4cec6', { anim: 'tendril', idx: (i + 1) * 3 + j + 1 }]));
      return [...ts, ...sock(ts, 'wisp', '#b8b2aa', 10, 1, 0)]; })(),
  ],
};
// Cinder Brute: hulking fire-immune brawler, charred hide split by molten seams, with horns, a brow and spiked shoulders.
MODELS.cinder_brute = {
  parts: [
    ['head', [10, 9, 9], [0, 26, 0], [0, 4.5, -1], '#4a221c', { face: 'cinder_brute' }],
    ['brow', [10.8, 1.8, 1.8], [0, 26, 0], [0, 7.2, -5.4], '#2a100c'],
    ['jaw', [8, 2.2, 1.8], [0, 26, 0], [0, 1.2, -5.2], '#3a1814'],
    ['hornL', [2, 5, 2], [0, 26, 0], [4.4, 10.6, -0.5], '#2a1a14'],
    ['hornR', [2, 5, 2], [0, 26, 0], [-4.4, 10.6, -0.5], '#2a1a14'],
    ['hornTipL', [1.2, 2.6, 1.2], [0, 26, 0], [4.8, 13.8, -0.5], '#e8d8b0'],
    ['hornTipR', [1.2, 2.6, 1.2], [0, 26, 0], [-4.8, 13.8, -0.5], '#e8d8b0'],
    ['tuskL', [2, 4, 2], [0, 26, 0], [3.5, 1.5, -6], '#e8d8b0'],
    ['tuskR', [2, 4, 2], [0, 26, 0], [-3.5, 1.5, -6], '#e8d8b0'],
    ['body', [12, 14, 7], [0, 19, 0], [0, 0, 0], '#5a2a22'],
    ['plate', [12.6, 4, 7.6], [0, 19, 0], [0, 4.6, 0], '#3a1814'],
    ['seam', [6, 8, 1], [0, 19, 0], [0, 1, -3.8], '#ff7a1a', { emissive: '#ff5a00' }],
    ['seamB', [1.2, 10, 0.8], [0, 19, 0], [-4.4, -1, -3.7], '#ff7a1a', { emissive: '#ff5a00' }],
    ['seamC', [1.2, 7, 0.8], [0, 19, 0], [4.4, 0, -3.7], '#ff7a1a', { emissive: '#ff5a00' }],
    ['belt', [12.6, 2, 7.6], [0, 19, 0], [0, -5.4, 0], '#2a100c'],
    ['buckle', [3, 2, 0.6], [0, 19, 0], [0, -5.4, -3.8], '#ff9a2a', { emissive: '#e05a00' }],
    ['spikeL', [2.2, 4, 2.2], [9.4, 28, 0], [0, 0, 0], '#2a1a14'],
    ['spikeR', [2.2, 4, 2.2], [-9.4, 28, 0], [0, 0, 0], '#2a1a14'],
    ...(() => { const arms = [
      ['armL', [5, 14, 5], [8.5, 25, 0], [0, -5, 0], '#4a221c', { anim: 'armForward' }],
      ['armR', [5, 14, 5], [-8.5, 25, 0], [0, -5, 0], '#4a221c', { anim: 'armForward' }]];
      return [...arms, ...sock(arms, 'fist', '#2a100c', 5, 1.2), ...sock(arms, 'knuckle', '#ff7a1a', 1, 0.8, 0, { emissive: '#ff5a00' })]; })(),
    ['legL', [5, 12, 5], [3, 12, 0], [0, -6, 0], '#3a1814', { anim: 'legA' }],
    ['legR', [5, 12, 5], [-3, 12, 0], [0, -6, 0], '#3a1814', { anim: 'legB' }],
  ],
};
// Ember Lord: a burning mask crowned in flames, circled by two rings of glowing rods over a smoky core.
MODELS.ember_lord = {
  parts: [
    ['head', [8, 8, 8], [0, 22, 0], [0, 4, 0], '#e8a52a', { face: 'ember_lord', emissive: '#a05000' }],
    ...[[0, 0, 5], [-2.6, 1.4, 3.4], [2.6, 1.4, 3.4], [-2.4, -2.4, 3], [2.4, -2.4, 3]].map(([x, z, h], i) => [`flame${i}`, [1.8, h, 1.8], [0, 30, 0], [x, h / 2 - 0.4, z], i ? '#ffb83a' : '#fff0a0', { emissive: '#ff8a10' }]),
    ['neckRing', [9, 1.6, 9], [0, 22, 0], [0, 0.2, 0], '#ff9a2a', { emissive: '#c85a00' }],
    ['core', [4, 10, 4], [0, 10, 0], [0, 4, 0], '#3a2a24'],
    ['coreGlow', [2.6, 7, 2.6], [0, 10, 0], [0, 4, 0], '#ff9a2a', { emissive: '#ff6a00' }],
    ['ringA', [11, 0.8, 11], [0, 16, 0], [0, 0, 0], '#5a3a2a', { alpha: 0.6 }],
    ...[0, 1, 2, 3].map((i) => [`rodA${i}`, [2, 8, 2], [0, 16, 0], [8, 0, 0], '#ffb83a', { anim: 'orbit', idx: i, emissive: '#ff8a10' }]),
    ...[0, 1, 2, 3].map((i) => [`rodB${i}`, [2, 8, 2], [0, 6, 0], [6, 0, 0], '#ffb83a', { anim: 'orbitB', idx: i, emissive: '#ff8a10' }]),
    ...[0, 1, 2, 3].map((i) => [`tipA${i}`, [2.6, 2, 2.6], [0, 16, 0], [8, 3.6, 0], '#fff2a0', { anim: 'orbit', idx: i, emissive: '#ffcc40' }]),
    ...[0, 1, 2, 3].map((i) => [`tipB${i}`, [2.6, 2, 2.6], [0, 6, 0], [6, 3.6, 0], '#fff2a0', { anim: 'orbitB', idx: i, emissive: '#ffcc40' }]),
  ],
};
// Mending Crystal: a glowing core spinning inside two gem-studded frames over a small plinth.
MODELS.void_crystal = {
  parts: [
    ['plinthA', [7, 2, 7], [0, 1, 0], [0, 0, 0], '#4a4078'],
    ['plinthB', [3.6, 5, 3.6], [0, 5.5, 0], [0, 0, 0], '#6050a0', { emissive: '#2a2058' }],
    ['core', [8, 8, 8], [0, 14, 0], [0, 0, 0], '#ffb8f4', { anim: 'spin', emissive: '#e070d0' }],
    ['coreShell', [10, 10, 10], [0, 14, 0], [0, 0, 0], '#ffd8fa', { anim: 'spin', alpha: 0.35, emissive: '#c060b0' }],
    ['frameA', [14, 14, 1.5], [0, 14, 0], [0, 0, 0], '#c8c0ff', { anim: 'spinA', emissive: '#6050a0' }],
    ['frameB', [1.5, 14, 14], [0, 14, 0], [0, 0, 0], '#c8c0ff', { anim: 'spinB', emissive: '#6050a0' }],
    ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy], i) => [`studA${i}`, [2.4, 2.4, 2.4], [0, 14, 0], [sx * 7, sy * 7, 0], '#ffb8f4', { anim: 'spinA', emissive: '#e070d0' }]),
    ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sy, sz], i) => [`studB${i}`, [2.4, 2.4, 2.4], [0, 14, 0], [0, sy * 7, sz * 7], '#ffb8f4', { anim: 'spinB', emissive: '#e070d0' }]),
  ],
};
// Void Wyrm: long dark serpent-dragon with ribbed membrane wings, a spined back, fanged jaws and a blade-tipped swaying tail.
MODELS.void_wyrm = {
  parts: [
    ['body', [26, 20, 46], [0, 16, 0], [0, 0, 0], '#45375e'],
    ['dorsal', [12, 20.6, 42], [0, 16, 0], [0, 0, 0], '#3a2e52'],
    ['belly', [20, 4, 40], [0, 6, 0], [0, 0, 0], '#7a6a98'],
    ...[-16, -6, 4, 14].map((z, i) => [`spine${i}`, [3, 7, 4], [0, 26, z], [0, 3, 0], '#b6a6de']),
    ...[-11, -1, 9, 19].map((z, i) => [`spineS${i}`, [2, 4, 3], [0, 26, z], [0, 1.5, 0], '#9686c4']),
    ['neck', [12, 12, 20], [0, 19, -22], [0, 0, -9], '#45375e', { anim: 'wyrmNeck' }],
    ['head', [16, 13, 22], [0, 21, -40], [0, 0, -6], '#4e3f6a', { face: 'void_wyrm' }],
    ['snout', [12, 7, 10], [0, 21, -40], [0, -2, -21], '#3e3254'],
    ['browL', [5.5, 1.8, 2.6], [0, 21, -40], [4.4, 3.4, -17.6], '#2e2444'],
    ['browR', [5.5, 1.8, 2.6], [0, 21, -40], [-4.4, 3.4, -17.6], '#2e2444'],
    ['nostrilL', [1.6, 1.4, 0.6], [0, 21, -40], [3, -0.4, -26.2], '#14081e'],
    ['nostrilR', [1.6, 1.4, 0.6], [0, 21, -40], [-3, -0.4, -26.2], '#14081e'],
    ['fangL', [1.6, 3.6, 1.6], [0, 21, -40], [4.4, -6.6, -24], '#f4f0ff'],
    ['fangR', [1.6, 3.6, 1.6], [0, 21, -40], [-4.4, -6.6, -24], '#f4f0ff'],
    ['hornL', [3, 3, 12], [0, 21, -40], [5, 7.5, 3], '#ece6ff'],
    ['hornR', [3, 3, 12], [0, 21, -40], [-5, 7.5, 3], '#ece6ff'],
    ['hornTipL', [2, 2, 5], [0, 21, -40], [5, 8.4, 10.6], '#b8a8e8'],
    ['hornTipR', [2, 2, 5], [0, 21, -40], [-5, 8.4, 10.6], '#b8a8e8'],
    ['jaw', [12, 3, 16], [0, 16, -40], [0, -1.5, -12], '#2a2038', { anim: 'jaw' }],
    ['toothLowL', [1.2, 2.4, 1.2], [0, 16, -40], [4.4, 0.8, -18], '#f4f0ff', { anim: 'jaw' }],
    ['toothLowR', [1.2, 2.4, 1.2], [0, 16, -40], [-4.4, 0.8, -18], '#f4f0ff', { anim: 'jaw' }],
    ['wingL', [72, 2, 34], [13, 24, -6], [36, 0, 4], '#5a3f86', { anim: 'wyrmWingL', emissive: '#1c0c30' }],
    ['wingR', [72, 2, 34], [-13, 24, -6], [-36, 0, 4], '#5a3f86', { anim: 'wyrmWingR', emissive: '#1c0c30' }],
    ['wingArmL', [72, 3.4, 3.4], [13, 24, -6], [36, 1.4, -12.6], '#3a2658', { anim: 'wyrmWingL' }],
    ['wingArmR', [72, 3.4, 3.4], [-13, 24, -6], [-36, 1.4, -12.6], '#3a2658', { anim: 'wyrmWingR' }],
    ...[14, 34, 54].flatMap((x, i) => [
      [`wingRibL${i}`, [2.4, 3, 32], [13, 24, -6], [x, 1.2, 4], '#3a2658', { anim: 'wyrmWingL' }],
      [`wingRibR${i}`, [2.4, 3, 32], [-13, 24, -6], [-x, 1.2, 4], '#3a2658', { anim: 'wyrmWingR' }]]),
    ...(() => { const limbs = [
      ['armL', [5, 14, 5], [9, 10, -14], [0, -6, 0], '#45375e'],
      ['armR', [5, 14, 5], [-9, 10, -14], [0, -6, 0], '#45375e'],
      ['legL', [7, 14, 8], [10, 10, 16], [0, -6, 0], '#45375e'],
      ['legR', [7, 14, 8], [-10, 10, 16], [0, -6, 0], '#45375e']];
      return [...limbs, ...sock(limbs, 'claw', '#ece6ff', 2.4, 0.8, 0)]; })(),
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => [`tail${i}`, [14 - i * 1.6, 12 - i * 1.3, 14], [0, 16 - i * 0.5, 30 + i * 13.5], [0, 0, 0], i % 2 ? '#3c3054' : '#45375e', { anim: 'tailSeg', idx: i }]),
    ['tailBlade', [1.6, 9, 10], [0, 13, 111], [0, 0, 11], '#ece6ff', { anim: 'tailSeg', idx: 7 }],
  ],
};

// Face painters: each draws on the 16x16 front face of a head (the noisy base colour is already there). `eyes` paints a mirrored pair:
// a white (optional), an iris with a pupil on its outer or inner column (look 1 = inwards, -1 = outwards) and a bright highlight.
const eyes = (c, { x = 3, y = 6, w = 3, h = 2, white = '#f4f0e6', iris = '#3a6a2a', pupil = '#0a0a0a', hi = '#ffffff', look = 1 } = {}) => {
  const iw = Math.min(2, w);
  for (const side of [0, 1]) {
    const ex = side ? 16 - x - w : x, ix = side ? ex : ex + w - iw;
    if (white) px(c, white, [[ex, y, w, h]]);
    px(c, iris, [[ix, y, iw, h]]);
    const inner = side ? ix : ix + iw - 1, outer = side ? ix + iw - 1 : ix;
    px(c, pupil, [[look > 0 ? inner : outer, y, 1, h]]);
    if (hi) px(c, hi, [[look > 0 ? outer : inner, y]]);
  }
};
const FACES = {
  hexwife: (c) => {
    px(c, '#2a2a22', [[1, 3, 5, 1], [10, 3, 5, 1], [0, 2, 2, 1], [14, 2, 2, 1]]);
    eyes(c, { x: 2, y: 5, w: 4, h: 3, white: '#e8e8a0', iris: '#7a2a6a', pupil: '#1a0a14' });
    px(c, '#4a5a30', [[3, 8, 2, 1], [11, 8, 2, 1]]);
    px(c, '#3a2a2a', [[4, 12, 8, 1], [3, 11], [12, 11]]); px(c, '#e8e0c0', [[6, 13], [9, 13]]);
  },
  dune_shambler: (c) => {
    px(c, '#d8c49a', [[0, 0, 16, 3], [0, 3, 2, 3], [14, 3, 2, 3]]); px(c, '#b8a478', [[0, 3, 16, 1]]);
    eyes(c, { x: 3, y: 6, w: 3, h: 2, white: '#3a2a14', iris: '#f0d070', pupil: '#3a2a14', hi: '#fff6c0' });
    px(c, '#5a4428', [[4, 12, 8, 2]]); px(c, '#d8c49a', [[5, 12], [7, 12], [9, 12], [11, 12]]);
    px(c, '#8a7650', [[2, 9], [13, 9], [3, 10], [12, 10]]);
  },
  sodden_shambler: (c) => {
    px(c, '#3a7a3a', [[0, 0, 5, 2], [9, 0, 7, 1], [11, 1, 2, 2]]);
    eyes(c, { x: 3, y: 6, w: 3, h: 2, white: '#103a3a', iris: '#70fff0', pupil: '#103a3a', hi: '#d0fffa' });
    px(c, '#2e6a68', [[1, 9, 2, 2], [13, 9, 2, 2]]);
    px(c, '#1a3a34', [[4, 12, 8, 2]]); px(c, '#6ac8b8', [[5, 12], [8, 12], [10, 12]]);
  },
  rime_rattler: (c) => {
    px(c, '#5a6a7e', [[0, 0, 16, 2]]); px(c, '#e8f4ff', [[2, 2, 2, 1], [9, 2, 1, 1]]);
    px(c, '#18222e', [[3, 5, 3, 3], [10, 5, 3, 3], [7, 9, 2, 2], [4, 12, 8, 1]]);
    px(c, '#8ae0ff', [[4, 6, 1, 2], [11, 6, 1, 2]]); px(c, '#ffffff', [[4, 6], [11, 6]]);
    px(c, '#e8f4ff', [[5, 13], [7, 13], [9, 13], [11, 13], [6, 12], [8, 12], [10, 12]]);
  },
  settler: (c) => {
    px(c, '#4a3426', [[0, 0, 16, 3], [0, 3, 1, 4], [15, 3, 1, 4]]);
    px(c, '#3a2a1a', [[2, 4, 4, 1], [10, 4, 4, 1]]);
    eyes(c, { x: 3, y: 6, w: 3, h: 2, white: '#ffffff', iris: '#2a6a3a', pupil: '#0a1a0a', hi: null });
    px(c, '#8a5a3e', [[2, 9, 2, 1], [12, 9, 2, 1]]);
    px(c, '#7a3a2a', [[5, 13, 6, 1]]); px(c, '#9a6648', [[7, 8, 2, 4]]);
  },
  player: (c) => {
    px(c, '#4a3220', [[0, 0, 16, 3], [0, 3, 2, 3], [14, 3, 2, 3], [2, 3, 3, 1], [11, 3, 3, 1]]);
    px(c, '#3a2616', [[0, 2, 16, 1]]);
    eyes(c, { x: 3, y: 7, w: 3, h: 2, white: '#ffffff', iris: '#3a5ab0', pupil: '#14183a', hi: null });
    px(c, '#3a2616', [[3, 6, 3, 1], [10, 6, 3, 1]]);
    px(c, '#a87450', [[7, 10, 2, 2]]); px(c, '#7a3a2a', [[5, 13, 6, 1]]); px(c, '#9a5a44', [[6, 13], [9, 13]]);
  },
  ironguard: (c) => {
    px(c, '#8a8478', [[1, 2, 14, 1]]); px(c, '#6a645a', [[2, 4, 12, 2]]);
    px(c, '#f06a2a', [[4, 6, 2, 2], [10, 6, 2, 2]]); px(c, '#ffd070', [[4, 6], [11, 6]]);
    px(c, '#8a8478', [[7, 8, 2, 5]]); px(c, '#8a8478', [[1, 9, 1, 4], [14, 9, 1, 4]]);
    px(c, '#6a645a', [[3, 14, 10, 1]]); px(c, '#a8a298', [[4, 15, 8, 1]]);
  },
  galloper: (c) => {
    // the front of a long muzzle: nostrils, a pale blaze and a darker lip
    px(c, '#f0e8dc', [[6, 0, 4, 9]]);
    px(c, '#241a14', [[2, 9, 3, 3], [11, 9, 3, 3]]); px(c, '#3a2a20', [[3, 10, 1, 1], [12, 10, 1, 1]]);
    px(c, '#4a3020', [[2, 13, 12, 3]]); px(c, '#6a4a34', [[6, 14, 4, 1]]);
  },
  flitter: (c) => {
    eyes(c, { x: 3, y: 5, w: 3, h: 3, white: null, iris: '#1a1010', pupil: '#000000', hi: '#ffffff' });
    px(c, '#2a1a14', [[2, 4, 4, 1], [10, 4, 4, 1]]);
    px(c, '#e8d8c8', [[5, 12, 1, 3], [10, 12, 1, 3]]); px(c, '#b8788a', [[7, 11, 2, 2]]); px(c, '#2a1a14', [[6, 14, 4, 1]]);
  },
  frostling: (c) => {
    px(c, '#3a1a08', [[2, 4, 4, 1], [10, 4, 4, 1], [3, 5, 3, 3], [10, 5, 3, 3], [4, 11, 8, 2], [5, 10], [10, 10], [6, 13], [9, 13], [7, 8, 2, 2]]);
    px(c, '#ffd040', [[4, 6, 1, 1], [11, 6, 1, 1], [3, 5], [10, 5]]); px(c, '#fff0a0', [[4, 6], [11, 6]]);
    px(c, '#ffd040', [[5, 12], [8, 12], [10, 12]]); px(c, '#ffb020', [[0, 0, 16, 1]]);
  },
  croaker: (c) => {
    px(c, '#3a2a20', [[1, 9, 14, 1], [0, 8, 1, 1], [15, 8, 1, 1]]);
    px(c, '#2a1a10', [[5, 4, 1, 1], [10, 4, 1, 1]]); px(c, '#00000022', [[1, 10, 14, 2]]);
  },
  gillnewt: (c) => {
    eyes(c, { x: 2, y: 5, w: 3, h: 3, white: null, iris: '#141018', pupil: '#000000', hi: '#ffffff' });
    px(c, '#00000044', [[5, 11, 6, 1]]); px(c, '#00000033', [[4, 10], [11, 10], [7, 7], [8, 7]]);
  },
  hopper: (c) => {
    eyes(c, { x: 2, y: 5, w: 3, h: 3, white: null, iris: '#2a1414', pupil: '#000000', hi: '#ffffff', look: -1 });
    px(c, '#e8a0a0', [[7, 9, 2, 1]]); px(c, '#7a5a4a', [[8, 10, 1, 2], [6, 12, 2, 1], [9, 12, 2, 1]]);
    px(c, '#d8c0a0', [[0, 8, 3, 4], [13, 8, 3, 4]]); px(c, '#6a4a3a', [[5, 14, 1, 1], [10, 14, 1, 1]]);
  },
  frostbear: (c) => {
    px(c, '#c8ccd4', [[2, 3, 4, 1], [10, 3, 4, 1]]);
    eyes(c, { x: 3, y: 5, w: 2, h: 2, white: null, iris: '#14141c', pupil: '#000000', hi: '#ffffff' });
    px(c, '#a8aab4', [[0, 7, 2, 4], [14, 7, 2, 4]]);
  },
  squawklet: (c) => {
    px(c, '#f0f0f0', [[1, 4, 5, 5], [10, 4, 5, 5]]); px(c, '#d8d0c0', [[0, 3, 6, 1], [10, 3, 6, 1]]);
    px(c, '#101010', [[2, 5, 3, 3], [11, 5, 3, 3]]); px(c, '#ffffff', [[2, 5], [11, 5]]);
  },
  shellback: (c) => {
    eyes(c, { x: 2, y: 5, w: 3, h: 3, white: '#e8e0b0', iris: '#101010', pupil: '#000000', hi: '#ffffff', look: -1 });
    px(c, '#3a7a3a', [[4, 11, 8, 1], [3, 10, 1, 1], [12, 10, 1, 1]]); px(c, '#2a5a2a', [[2, 3, 4, 1], [10, 3, 4, 1]]);
    px(c, '#2a5a2a', [[7, 8, 1, 1], [8, 8, 1, 1]]);
  },
  buzzling: (c) => {
    px(c, '#1a1010', [[1, 4, 4, 6], [11, 4, 4, 6]]); px(c, '#3a2a20', [[2, 5, 2, 4], [12, 5, 2, 4]]);
    px(c, '#ffffff', [[2, 5], [12, 5]]); px(c, '#6a5a50', [[3, 8], [13, 8]]);
    px(c, '#3a2410', [[5, 11, 6, 1], [4, 10, 1, 1], [11, 10, 1, 1]]);
  },
  cragbuck: (c) => {
    px(c, '#d8d2c6', [[6, 0, 4, 7]]);
    eyes(c, { x: 2, y: 5, w: 3, h: 2, white: '#e8d8a0', iris: '#c8a020', pupil: '#101010', hi: '#fffbe0', look: -1 });
    px(c, '#8a8070', [[2, 4, 4, 1], [10, 4, 4, 1]]);
    px(c, '#b8a8a0', [[6, 12, 4, 2]]);
  },
  purrling: (c) => {
    px(c, '#00000033', [[7, 0, 2, 3], [5, 1, 1, 2], [10, 1, 1, 2]]);
    eyes(c, { x: 2, y: 6, w: 4, h: 3, white: '#e8ffd8', iris: '#7fe070', pupil: '#0a0a0a', hi: '#ffffff' });
    px(c, '#00000055', [[3, 6, 2, 1]]);
    px(c, '#00000033', [[4, 12], [6, 12], [9, 12], [11, 12]]);
  },
  vixling: (c) => {
    px(c, '#f4ece0', [[0, 8, 4, 6], [12, 8, 4, 6], [6, 0, 4, 2]]);
    px(c, '#2a1a10', [[2, 4, 4, 1], [10, 4, 4, 1]]);
    eyes(c, { x: 2, y: 5, w: 4, h: 3, white: '#f0d890', iris: '#a85a10', pupil: '#0a0606', hi: '#ffffff' });
    px(c, '#c85a18', [[0, 4, 2, 4], [14, 4, 2, 4]]);
  },
  deepeye: (c) => {
    px(c, '#f4f0e0', [[3, 3, 10, 10]]); px(c, '#e8e0c8', [[2, 5, 1, 6], [13, 5, 1, 6], [5, 2, 6, 1], [5, 13, 6, 1]]);
    px(c, '#d8c8b8', [[3, 3, 1, 1], [12, 3, 1, 1], [3, 12, 1, 1], [12, 12, 1, 1]]);
    px(c, '#c85a4a', [[4, 8, 1, 1], [11, 7, 1, 1], [7, 4, 1, 1]]);
    px(c, '#7a3aa0', [[5, 5, 6, 6]]); px(c, '#a85ad0', [[6, 5, 4, 1], [5, 6, 1, 4]]);
    px(c, '#1a0a24', [[7, 6, 2, 4]]); px(c, '#ffffff', [[6, 6, 1, 1]]);
  },
  inkling: (c) => {
    px(c, '#4a64b0', [[1, 4, 14, 1]]);
    px(c, '#e8e8f0', [[2, 6, 4, 4], [10, 6, 4, 4]]); px(c, '#f0c030', [[3, 6, 2, 4], [11, 6, 2, 4]]);
    px(c, '#101018', [[4, 6, 1, 4], [11, 6, 1, 4]]); px(c, '#ffffff', [[3, 6], [12, 6]]);
    px(c, '#14183a', [[6, 12, 4, 1]]);
  },
  marauder: (c) => {
    px(c, '#8a2a2a', [[0, 2, 16, 2]]); px(c, '#2a2a2a', [[1, 5, 5, 1], [10, 5, 5, 1]]);
    eyes(c, { x: 3, y: 6, w: 3, h: 2, white: '#f0f0f0', iris: '#3a5a3a', pupil: '#101810', hi: null });
    px(c, '#5a605a', [[1, 8, 2, 2], [13, 8, 2, 2]]);
    px(c, '#3a3a3a', [[4, 13, 8, 1]]); px(c, '#6a6a6a', [[5, 14, 6, 1]]);
  },
  howler: (c) => {
    px(c, '#7a7a80', [[2, 4, 4, 1], [10, 4, 4, 1]]); px(c, '#6a6a72', [[0, 3, 2, 8], [14, 3, 2, 8]]);
    eyes(c, { x: 2, y: 6, w: 4, h: 2, white: '#f0f0f0', iris: '#d89a20', pupil: '#1a1408', hi: '#ffffff' });
    px(c, '#58585e', [[7, 1, 2, 4]]);
  },
  bristleback: (c) => {
    px(c, '#3a281a', [[7, 0, 2, 3], [1, 3, 5, 1], [10, 3, 5, 1]]);
    eyes(c, { x: 2, y: 4, w: 3, h: 3, white: '#f0e8d8', iris: '#5a2a10', pupil: '#0a0606', hi: '#ffffff' });
    px(c, '#4a3020', [[0, 8, 2, 4], [14, 8, 2, 4]]);
  },
  mooxen: (c) => {
    px(c, '#2a323c', [[1, 4, 5, 1], [10, 4, 5, 1]]);
    eyes(c, { x: 1, y: 5, w: 4, h: 2, white: '#e8e0d0', iris: '#3a2010', pupil: '#0a0606', hi: '#ffffff', look: -1 });
    px(c, '#8a96a2', [[5, 7, 6, 1]]);
  },
  fleecer: (c) => {
    eyes(c, { x: 1, y: 5, w: 4, h: 3, white: '#f4f0f8', iris: '#d8b040', pupil: '#1a1a10', hi: null, look: 1 });
    px(c, '#1a1a10', [[2, 6, 3, 1], [11, 6, 3, 1]]); // sideways pupils
    px(c, '#4a3c4c', [[1, 4, 4, 1], [11, 4, 4, 1]]);
  },
  cluckling: (c) => {
    px(c, '#101010', [[2, 3, 3, 3], [11, 3, 3, 3]]); px(c, '#ffffff', [[2, 3, 1, 1], [11, 3, 1, 1]]);
    px(c, '#f0a020', [[5, 6, 6, 4]]); px(c, '#c8302a', [[6, 11, 4, 4]]); px(c, '#a02018', [[7, 14, 2, 1]]);
  },
  shambler: (c) => {
    px(c, '#2a3a22', [[0, 0, 16, 2], [0, 2, 3, 1], [12, 2, 4, 1]]);
    px(c, '#4a6a3a', [[1, 3, 5, 1], [10, 3, 5, 1]]);
    eyes(c, { x: 3, y: 5, w: 3, h: 3, white: '#e8e060', iris: '#1a1a10', pupil: '#1a1a10', hi: '#fffbb0' });
    px(c, '#2a3a20', [[4, 12, 8, 2]]); px(c, '#d8d8b0', [[5, 12], [7, 12], [9, 12], [11, 12]]);
    px(c, '#7a2a2a', [[2, 9, 2, 1], [3, 10, 1, 1]]);
  },
  rattler: (c) => {
    px(c, '#9a9686', [[1, 3, 4, 1], [11, 3, 4, 1]]);
    px(c, '#1a1a1a', [[3, 5, 3, 3], [10, 5, 3, 3], [7, 9, 2, 2], [4, 12, 8, 1], [4, 13, 1, 2], [7, 13, 2, 2], [11, 13, 1, 2]]);
    px(c, '#ff4a2a', [[4, 6, 1, 2], [11, 6, 1, 2]]); px(c, '#ffd0a0', [[4, 6], [11, 6]]);
    px(c, '#e8e4d4', [[5, 13], [6, 13], [9, 13], [10, 13]]);
  },
  fizzler: (c) => {
    px(c, '#1a2a2a', [[1, 4, 5, 4], [10, 4, 5, 4], [6, 2, 4, 1]]); px(c, '#ffb03a', [[2, 5, 3, 2], [11, 5, 3, 2]]);
    px(c, '#fff0b0', [[3, 5, 1, 1], [12, 5, 1, 1]]);
    px(c, '#ffb03a', [[5, 11, 6, 1], [4, 12, 1, 2], [11, 12, 1, 2], [6, 13, 4, 1]]);
    px(c, '#ff7a1a', [[7, 9, 2, 1]]);
  },
  skitterer: (c) => {
    px(c, '#ff3a2a', [[2, 5, 2, 2], [12, 5, 2, 2], [5, 4, 2, 2], [9, 4, 2, 2], [4, 8], [11, 8], [6, 7], [9, 7]]);
    px(c, '#ffb0a0', [[2, 5], [12, 5], [5, 4], [9, 4]]);
    px(c, '#16161c', [[3, 11, 10, 3]]); px(c, '#d8d0c0', [[4, 11], [6, 11], [9, 11], [11, 11]]);
  },
  ashwraith: (c) => {
    px(c, '#c8c2ba', [[2, 3, 12, 1]]);
    px(c, '#3a3436', [[3, 5, 3, 1], [10, 5, 3, 1], [4, 6, 1, 3], [11, 6, 1, 3], [3, 6, 1, 2], [12, 6, 1, 2]]);
    px(c, '#9a3a3a', [[4, 8, 1, 2], [11, 8, 1, 2]]); px(c, '#c86a6a', [[4, 9], [11, 9]]);
    px(c, '#2a2426', [[6, 11, 4, 3], [5, 12, 1, 1], [10, 12, 1, 1]]);
    px(c, '#cfc8c0', [[2, 8, 1, 4], [13, 8, 1, 4]]);
  },
  cinder_brute: (c) => {
    px(c, '#2a100c', [[1, 3, 6, 2], [9, 3, 6, 2]]);
    eyes(c, { x: 3, y: 6, w: 3, h: 2, white: '#ffb03a', iris: '#fff0b0', pupil: '#ff6a1a', hi: null });
    px(c, '#2a100c', [[5, 11, 6, 2]]); px(c, '#e8d8b0', [[5, 11], [10, 11]]); px(c, '#ff6a1a', [[7, 1, 2, 2], [7, 5, 2, 1]]);
    px(c, '#ff6a1a', [[2, 9, 1, 3], [13, 9, 1, 3]]);
  },
  ember_lord: (c) => {
    px(c, '#ffd060', [[0, 0, 16, 2]]); px(c, '#ff8a10', [[0, 2, 16, 1]]);
    px(c, '#2a1406', [[2, 5, 4, 3], [10, 5, 4, 3], [6, 11, 4, 1], [5, 12, 1, 1], [10, 12, 1, 1]]);
    px(c, '#fff2a0', [[3, 6, 2, 1], [11, 6, 2, 1]]); px(c, '#ffffff', [[3, 6], [12, 6]]);
    px(c, '#c85a00', [[7, 8, 2, 2]]);
  },
  void_wyrm: (c) => {
    px(c, '#2e2444', [[0, 4, 6, 1], [10, 4, 6, 1]]);
    px(c, '#d070ff', [[1, 6, 4, 2], [11, 6, 4, 2]]); px(c, '#ffffff', [[2, 6, 2, 1], [12, 6, 2, 1]]);
    px(c, '#1a0c28', [[2, 6, 1, 2], [13, 6, 1, 2]]);
    px(c, '#0c0812', [[3, 12, 10, 2]]); px(c, '#f4f0ff', [[4, 12], [6, 12], [9, 12], [11, 12]]);
  },
  voidwalker: (c) => {
    px(c, '#14102a', [[1, 7, 6, 3], [9, 7, 6, 3]]);
    px(c, '#5ff0ff', [[2, 8, 4, 1], [10, 8, 4, 1]]); px(c, '#b8ffff', [[3, 8, 2, 1], [11, 8, 2, 1]]);
    px(c, '#2a5a8a', [[1, 9, 2, 1], [13, 9, 2, 1]]);
    px(c, '#3a2a6a', [[5, 2], [11, 3], [8, 13], [7, 4, 1, 2]]);
  },
};
export function buildModel(type, variant = 0) {
  const spec = MODELS[type];
  const partList = hasVariants(type) ? paintParts(spec.parts, type, variant) : spec.parts; // a coat variant's colours (mobs/variants.js)
  const root = new THREE.Group();
  const parts = {};
  const mats = [];
  const matCache = new Map();
  const matFor = (color, opts, kind) => {
    const k = color + kind + (opts.emissive || '') + (opts.glow ? 'g' : '') + (opts.alpha ? 'a' : '');
    if (matCache.has(k)) return matCache.get(k);
    const m = new THREE.MeshLambertMaterial({ map: skinTexture(type + color, kind), vertexColors: true, color, ...(opts.alpha ? { transparent: true, opacity: opts.alpha, depthWrite: false } : {}) });
    m.userData.base = new THREE.Color(color);
    if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.userData.emissive = m.emissive.clone(); }
    matCache.set(k, m); mats.push(m);
    return m;
  };
  for (const [name, size, pivot, offset, color, opts = {}] of partList) {
    const pivotGroup = new THREE.Group();
    pivotGroup.position.set(pivot[0] / 16, pivot[1] / 16, pivot[2] / 16);
    const geo = new THREE.BoxGeometry(size[0] / 16, size[1] / 16, size[2] / 16);
    shadeBox(geo);
    const kind = partKind(name);
    const base = matFor(color, opts, kind);
    let material = base;
    const autoFace = !opts.face && name === 'head' && !opts.alpha && !opts.emissive && size[0] >= 5 && size[1] >= 5 && !(spec.noFace);
    if (opts.face || autoFace) {
      const fm = new THREE.MeshLambertMaterial({ vertexColors: true, map: opts.face ? faceTexture(type, color, FACES[opts.face]) : defaultFace(type + color, color) });
      fm.userData.base = new THREE.Color(0xffffff);
      mats.push(fm);
      material = [base, base, base, base, base, fm];
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(offset[0] / 16, offset[1] / 16, offset[2] / 16);
    mesh.castShadow = true;
    pivotGroup.add(mesh);
    pivotGroup.userData = { anim: opts.anim, idx: opts.idx, baseX: pivot[0] / 16, baseY: pivot[1] / 16 };
    root.add(pivotGroup);
    parts[name] = pivotGroup;
  }
  if (hasVariants(type)) {
    // spots, stripes and patches: thin boxes inside the host part's pivot, so they move with it
    for (const [host, size, off, color] of variantOverlays(type, variant)) {
      const hp = parts[host], hs = partList.find((q) => q[0] === host);
      if (!hp || !hs) continue;
      const geo = new THREE.BoxGeometry(size[0] / 16, size[1] / 16, size[2] / 16);
      shadeBox(geo);
      const mesh = new THREE.Mesh(geo, matFor(color, {}, 'body'));
      mesh.position.set((hs[3][0] + off[0]) / 16, (hs[3][1] + off[1]) / 16, (hs[3][2] + off[2]) / 16);
      mesh.castShadow = true;
      hp.add(mesh);
    }
  }
  root.userData.parts = parts;
  root.userData.variant = variant;
  root.userData.mats = mats;
  root.userData.dispose = () => { root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const m of mats) m.dispose(); };
  return root;
}

// A closed-eyes copy of a face texture (the bright eye pixels become skin with a dark lid line), cached per source texture.
const closedCache = new WeakMap();
function closedFace(tex) {
  let c = closedCache.get(tex);
  if (c) return c;
  const src = tex.image;
  const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
  const ctx = cv.getContext('2d'); ctx.drawImage(src, 0, 0);
  const W = cv.width, H = cv.height, sc = W / 16, d = ctx.getImageData(0, 0, W, H), a = d.data;
  let y0 = H, y1 = -1;
  const bright = (i) => a[i] > 200 && a[i + 1] > 190 && a[i + 2] > 170;
  for (let y = 2 * sc; y < 11 * sc; y++) for (let x = 0; x < W; x++) { if (bright((y * W + x) * 4)) { if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (y1 >= 0) {
    const mid = Math.floor((y0 + y1) / 2);
    // paint every pixel in the eye rows that sits in a bright run's column band (pupils included); the lid is the middle row
    const cols = new Uint8Array(W);
    for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) if (bright((y * W + x) * 4)) cols[x] = 1;
    for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) {
      if (!cols[x]) continue;
      const i = (y * W + x) * 4, j = (Math.max(0, y0 - 1) * W + x) * 4;
      if (y === mid) { a[i] = 24; a[i + 1] = 18; a[i + 2] = 16; } else { a[i] = a[j]; a[i + 1] = a[j + 1]; a[i + 2] = a[j + 2]; }
    }
  }
  ctx.putImageData(d, 0, 0);
  c = new THREE.CanvasTexture(cv);
  c.magFilter = THREE.NearestFilter; c.minFilter = THREE.NearestFilter; c.colorSpace = THREE.SRGBColorSpace;
  closedCache.set(tex, c);
  return c;
}

/** The generic life layer: additive deltas on parts that no module poses by name; customRender hooks run after and may override. */
function animateLife(root, mob, parts, alpha, sec, amt) {
  const g = mob._game;
  if (!g || !g.player || !mob.def || typeof mob.id !== 'number') return;
  const pl = g.player, dx = pl.x - mob.x, dz = pl.z - mob.z, d2 = dx * dx + dz * dz;
  const calm = !!(g.settings && g.settings.reduceMotion);
  const dead = mob.deathTime > 0;
  if (dead) {
    root.position.y -= deathSink(mob.deathTime, alpha, mob.height || 1);
    return;
  }
  if (d2 > ANIM_RANGE * ANIM_RANGE) return;
  const id = mob.id, idle = amt < 0.1;
  if (mob.hurtTime > 0 && !calm) { root.rotation.order = 'YXZ'; root.rotation.x = hurtLean(mob.hurtTime - alpha + 1); }
  if (amt > 0.05 && (parts.legFL || parts.legL)) root.position.y += walkBob(mob.limbSwing, amt) * (root.scale.y || 1);
  const body = parts.body;
  if (body && body.userData.anim === undefined && !mob.def.flying) body.scale.y = 1 + (breathe(id, sec) - 1) * (calm ? 0.4 : 1);
  if (calm) return;
  const head = parts.head;
  if (head && !head.userData.anim && !mob.sitting) {
    let ty, tp = 0;
    if (d2 < LOOK_RANGE * LOOK_RANGE && !pl.dead) {
      const r = headTurn(wrapPi(Math.atan2(-dx, -dz) - mob.yaw), pl.y + (pl.eyeHeight || 1.6) - (mob.eyeY || mob.y + 1), Math.sqrt(d2));
      ty = r[0]; tp = mob.headPitch ? 0 : r[1];
    } else ty = idle ? idleLook(id, sec) : 0;
    const k = head.userData;
    k.lookY = (k.lookY || 0) + (ty - (k.lookY || 0)) * 0.12;
    k.lookP = (k.lookP || 0) + (tp - (k.lookP || 0)) * 0.12;
    head.rotation.y = k.lookY;
    head.rotation.x += k.lookP;
    // blink: swap the head's face map for a closed-eyes copy
    const mesh = head.children[0], mat = mesh && Array.isArray(mesh.material) ? mesh.material[5] : null;
    if (mat && mat.map) {
      const ud = mat.userData;
      if (!ud.openMap) ud.openMap = mat.map;
      const want = blinkClosed(id, sec) ? (ud.closedMap || (ud.closedMap = closedFace(ud.openMap))) : ud.openMap;
      if (mat.map !== want) mat.map = want;
    }
  }
  const happy = !!(mob.tamed || mob.loveTicks > 0);
  for (const name in parts) {
    const part = parts[name];
    if (part.userData.anim) continue;
    if (name.charCodeAt(0) === 116 && name.startsWith('tail')) { if (idle && !happy) part.rotation.y = 0; else part.rotation.y = tailWag(id, sec, happy, !idle); }
    else if (name.startsWith('ear')) part.rotation.z = earTwitch(id, sec, name.endsWith('R') ? -1 : 1);
  }
}

export function animateModel(root, mob, alpha, L, sec, glow = null) {
  const { parts, mats } = root.userData;
  const swing = mob.limbSwing * 0.6662;
  const amt = mob.limbAmount;
  const hurt = mob.hurtTime > 0 || mob.deathTime > 0;
  for (const g of Object.values(parts)) {
    const a = g.userData.anim;
    if (!a) continue;
    switch (a) {
      case 'legA': g.rotation.x = Math.cos(swing) * 1.4 * amt; break;
      case 'legB': g.rotation.x = Math.cos(swing + Math.PI) * 1.4 * amt; break;
      case 'armForward': g.rotation.x = -Math.PI / 2 + Math.sin(sec * 2 + (mob.id % 7)) * 0.05 + Math.cos(swing) * 0.1 * amt; break;
      case 'armAim': g.rotation.x = mob.target ? -Math.PI / 2 : Math.cos(swing + (g === parts.armL ? Math.PI : 0)) * amt; break;
      case 'armSwing': g.rotation.x = Math.cos(swing + Math.PI) * amt * 0.8 - (mob.angry ? 0.4 : 0); break;
      case 'armSwingB': g.rotation.x = Math.cos(swing) * amt * 0.8 - (mob.angry ? 0.4 : 0); break;
      case 'flipA': g.rotation.y = Math.sin(mob.limbSwing * 0.5) * 0.6 * mob.limbAmount; break;
      case 'flipB': g.rotation.y = -Math.sin(mob.limbSwing * 0.5) * 0.6 * mob.limbAmount; break;
      case 'beeL': g.rotation.z = Math.sin(sec * 60 + mob.id) * 0.7; break;
      case 'beeR': g.rotation.z = -Math.sin(sec * 60 + mob.id) * 0.7; break;
      case 'batL': g.rotation.y = mob.roosting ? -1.2 : Math.sin(sec * 25 + mob.id) * 0.9; break;
      case 'batR': g.rotation.y = mob.roosting ? 1.2 : -Math.sin(sec * 25 + mob.id) * 0.9; break;
      case 'tentacle': { const ph = Math.sin(sec * 3 + mob.id) * 0.5 + 0.6, a = (g.userData.idx / 8) * Math.PI * 2; g.rotation.set(Math.cos(a) * ph, 0, -Math.sin(a) * ph); break; }
      case 'wingL': g.rotation.z = mob.body.onGround ? 0 : Math.sin(sec * 30) * 0.8; break;
      case 'wingR': g.rotation.z = mob.body.onGround ? 0 : -Math.sin(sec * 30) * 0.8; break;
      case 'tendril': g.rotation.x = Math.sin(sec * 1.7 + g.userData.idx * 1.3) * 0.25; g.rotation.z = Math.cos(sec * 1.3 + g.userData.idx) * 0.15; break;
      case 'orbit': g.rotation.y = sec * 1.6 + g.userData.idx * Math.PI / 2; g.position.y = g.userData.baseY + Math.sin(sec * 3 + g.userData.idx) * 0.08; break;
      case 'orbitB': g.rotation.y = -sec * 1.2 + g.userData.idx * Math.PI / 2 + Math.PI / 4; break;
      case 'spin': g.rotation.set(sec * 0.9, sec * 1.4, 0); g.position.y = g.userData.baseY + Math.sin(sec * 2) * 0.12; break;
      case 'spinA': g.rotation.y = sec * 0.8; g.position.y = g.userData.baseY + Math.sin(sec * 2) * 0.12; break;
      case 'spinB': g.rotation.x = sec * 0.7; g.position.y = g.userData.baseY + Math.sin(sec * 2) * 0.12; break;
      case 'wyrmWingL': g.rotation.z = Math.sin(sec * 2.6) * 0.55 + 0.1; break;
      case 'wyrmWingR': g.rotation.z = -Math.sin(sec * 2.6) * 0.55 - 0.1; break;
      case 'wyrmNeck': g.rotation.x = Math.sin(sec * 1.3) * 0.08; break;
      case 'jaw': g.rotation.x = 0.15 + Math.max(0, Math.sin(sec * 1.1)) * 0.35; break;
      case 'tailSeg': g.position.x = g.userData.baseX + Math.sin(sec * 2.2 - g.userData.idx * 0.7) * g.userData.idx * 0.13; g.rotation.y = Math.cos(sec * 2.2 - g.userData.idx * 0.7) * 0.25; break;
      case 'spiderL':
      case 'spiderR': {
        const s = a === 'spiderL' ? 1 : -1;
        const i = g.userData.idx;
        const ph = Math.cos(swing * 2 + i * Math.PI / 2) * 0.4 * amt;
        g.rotation.z = s * (-0.6 + (i % 2 ? 0.1 : 0) + Math.abs(ph) * 0.4);
        g.rotation.y = s * (((i - 1.5) * 0.35) + ph);
        break;
      }
    }
  }
  if (parts.head) { parts.head.rotation.x = mob.headPitch || 0; }
  animateLife(root, mob, parts, alpha, sec, amt);
  // fuse swelling + flashing
  let flash = 0;
  if (mob.type === 'fizzler') {
    const f = (mob.prevFuse + (mob.fuse - mob.prevFuse) * alpha) / mob.def.fuse;
    const s = 1 + f * 0.25 + Math.sin(f * 100) * f * 0.02;
    const k = mob.age < 0 ? 0.5 : 1; // a Fizzlet swells from its half size
    root.scale.set(k * s * (1 + f * 0.1), k * s / (1 + f * 0.1), k * s * (1 + f * 0.1));
    if (f > 0 && Math.floor(f * 10) % 2 === 0) flash = f;
  }
  for (const m of mats) {
    m.color.copy(m.userData.base).multiplyScalar(L);
    if (m.userData.emissive) m.emissive.copy(m.userData.emissive).multiplyScalar(0.6 + 0.4 * Math.sin(sec * 4));
    else {
      if (glow) m.emissive.copy(m.userData.base).multiply(glow); else m.emissive.setRGB(0, 0, 0); // torchlight and moonlight
      if (hurt || flash) { m.emissive.r += hurt ? 0.45 : flash; m.emissive.g += flash; m.emissive.b += flash; }
    }
  }
}

// ---- the Marauder Captain's banner -------------------------------------------------
// A crimson war banner on a pole strapped to the Captain's back: a black border and
// a pale broken ring (the ringed giant, shattered) around a single staring eye.
let bannerTex = null;
function captainBannerTexture() {
  if (bannerTex) return bannerTex;
  const c = document.createElement('canvas'); c.width = 10; c.height = 16;
  const ctx = c.getContext('2d');
  let s = 91; const rnd = () => { s = (s * 1103515245 + 12345) | 0; return ((s >>> 16) & 0x7fff) / 0x7fff; };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 10; x++) {
    const f = 0.85 + rnd() * 0.15;
    ctx.fillStyle = `rgb(${Math.round(128 * f)},${Math.round(22 * f)},${Math.round(30 * f)})`; ctx.fillRect(x, y, 1, 1);
  }
  px(ctx, '#151215', [[0, 0, 10, 1], [0, 0, 1, 16], [9, 0, 1, 16], [0, 15, 10, 1], [1, 14, 2, 1], [4, 14, 2, 1], [7, 14, 2, 1]]);
  // the broken ring
  px(ctx, '#e8dcc4', [[3, 3, 4, 1], [2, 4, 1, 1], [7, 4, 1, 1], [1, 5, 1, 3], [8, 5, 1, 1], [2, 8, 1, 1], [7, 8, 1, 1], [3, 9, 3, 1]]);
  // the eye inside it
  px(ctx, '#f0e8d0', [[3, 5, 4, 3]]); px(ctx, '#151215', [[4, 5, 2, 3]]); px(ctx, '#d0a020', [[4, 6, 1, 1]]);
  // a tattered hem
  px(ctx, '#151215', [[3, 11, 4, 1], [4, 12, 2, 1]]);
  bannerTex = new THREE.CanvasTexture(c);
  bannerTex.magFilter = THREE.NearestFilter; bannerTex.minFilter = THREE.NearestFilter; bannerTex.colorSpace = THREE.SRGBColorSpace;
  return bannerTex;
}

/** Strap a banner to a (Marauder) model's back; it is lit and flashes like the rest of the model. */
export function addCaptainBanner(root) {
  const { mats } = root.userData;
  const group = new THREE.Group();
  group.position.set(0, 20 / 16, 4 / 16);
  const wood = new THREE.MeshLambertMaterial({ map: noiseTexture('bannerpole#5a3a1a'), color: '#5a3a1a' });
  wood.userData.base = new THREE.Color('#5a3a1a');
  const cloth = new THREE.MeshLambertMaterial({ map: captainBannerTexture(), color: 0xffffff });
  cloth.userData.base = new THREE.Color(0xffffff);
  mats.push(wood, cloth);
  const box = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w / 16, h / 16, d / 16), mat);
    m.position.set(x / 16, y / 16, z / 16); m.castShadow = true; group.add(m); return m;
  };
  box(1, 28, 1, 0, 6, 0, wood);        // pole, from the waist to well above the head
  box(12, 1, 1, 0, 19.5, 0, wood);     // crossbar
  const flag = new THREE.Group();      // the cloth hangs from the crossbar and sways
  flag.position.set(0, 19 / 16, 0.8 / 16);
  const c = new THREE.Mesh(new THREE.BoxGeometry(10 / 16, 16 / 16, 0.5 / 16), cloth);
  c.position.set(0, -8 / 16, 0); c.castShadow = true;
  flag.add(c); group.add(flag);
  root.add(group);
  root.userData.banner = group;
  root.userData.bannerFlag = flag;
  return group;
}

// Other modules (e.g. mobs/gloomshell.js) register their own models and faces here.
export { MODELS, FACES };

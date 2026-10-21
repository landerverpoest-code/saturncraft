// Original box models for every mob (units: 1/16 block, facing -Z), with
// procedurally painted textures and simple limb animation.
import * as THREE from 'three';

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

// part: [name, size[w,h,d], pivot[x,y,z], offset[x,y,z], colour, opts]
const MODELS = {
  bristleback: {
    parts: [
      ['body', [10, 8, 16], [0, 10, 0], [0, 0, 0], '#8a5a3a'],
      ['ridge', [2, 2, 14], [0, 14.5, 0], [0, 0, 0], '#3a281a'],
      ['head', [8, 8, 8], [0, 12, -8], [0, 0, -3], '#8a5a3a', { face: 'bristleback' }],
      ['snout', [4, 3, 1], [0, 12, -8], [0, -2, -7.5], '#d89a8a'],
      ['tuskL', [1, 2, 1], [0, 12, -8], [2.5, -3, -7.5], '#f0ead8'],
      ['tuskR', [1, 2, 1], [0, 12, -8], [-2.5, -3, -7.5], '#f0ead8'],
      ['legFL', [4, 6, 4], [3, 6, -5], [0, -3, 0], '#6a4228', { anim: 'legA' }],
      ['legFR', [4, 6, 4], [-3, 6, -5], [0, -3, 0], '#6a4228', { anim: 'legB' }],
      ['legBL', [4, 6, 4], [3, 6, 5], [0, -3, 0], '#6a4228', { anim: 'legB' }],
      ['legBR', [4, 6, 4], [-3, 6, 5], [0, -3, 0], '#6a4228', { anim: 'legA' }],
    ],
  },
  mooxen: {
    parts: [
      ['body', [12, 10, 18], [0, 17, 0], [0, 0, 0], '#4f5f70'],
      ['belly', [10, 2, 14], [0, 11.5, 0], [0, 0, 0], '#8a96a2'],
      ['hump', [10, 4, 6], [0, 23, -5], [0, 0, 0], '#3f4d5c'],
      ['head', [8, 8, 6], [0, 20, -9], [0, 0, -3], '#4f5f70', { face: 'mooxen' }],
      ['hornL', [6, 2, 2], [0, 20, -9], [6, 3, -3], '#e8dcc0'],
      ['hornR', [6, 2, 2], [0, 20, -9], [-6, 3, -3], '#e8dcc0'],
      ['legFL', [4, 12, 4], [4, 12, -6], [0, -6, 0], '#3a4652', { anim: 'legA' }],
      ['legFR', [4, 12, 4], [-4, 12, -6], [0, -6, 0], '#3a4652', { anim: 'legB' }],
      ['legBL', [4, 12, 4], [4, 12, 6], [0, -6, 0], '#3a4652', { anim: 'legB' }],
      ['legBR', [4, 12, 4], [-4, 12, 6], [0, -6, 0], '#3a4652', { anim: 'legA' }],
    ],
  },
  fleecer: {
    parts: [
      ['skin', [8, 8, 14], [0, 16, 0], [0, 0, 0], '#cdbcb4'],
      ['wool', [10, 10, 16], [0, 16, 0], [0, 0, 0], '#e8e2f0'],
      ['head', [6, 6, 8], [0, 19, -8], [0, 0, -3], '#3a3040', { face: 'fleecer' }],
      ['tuft', [7, 3, 4], [0, 19, -8], [0, 3.5, -2], '#e8e2f0'],
      ['legFL', [4, 11, 4], [3, 11, -5], [0, -5.5, 0], '#3a3040', { anim: 'legA' }],
      ['legFR', [4, 11, 4], [-3, 11, -5], [0, -5.5, 0], '#3a3040', { anim: 'legB' }],
      ['legBL', [4, 11, 4], [3, 11, 5], [0, -5.5, 0], '#3a3040', { anim: 'legB' }],
      ['legBR', [4, 11, 4], [-3, 11, 5], [0, -5.5, 0], '#3a3040', { anim: 'legA' }],
    ],
  },
  cluckling: {
    parts: [
      ['body', [6, 6, 8], [0, 7, 0], [0, 0, 0], '#d8c8a0'],
      ['head', [4, 6, 3], [0, 10, -3], [0, 2, -1], '#d8c8a0', { face: 'cluckling' }],
      ['beak', [2, 2, 2], [0, 10, -3], [0, 2, -3.5], '#f0a020'],
      ['crest', [1, 3, 3], [0, 10, -3], [0, 6, -1], '#c8302a'],
      ['wingL', [1, 4, 6], [3.5, 9, 0], [0, -2, 0], '#c8b890', { anim: 'wingL' }],
      ['wingR', [1, 4, 6], [-3.5, 9, 0], [0, -2, 0], '#c8b890', { anim: 'wingR' }],
      ['legL', [1, 4, 1], [1.5, 4, 0], [0, -2, 0], '#e0a020', { anim: 'legA' }],
      ['legR', [1, 4, 1], [-1.5, 4, 0], [0, -2, 0], '#e0a020', { anim: 'legB' }],
    ],
  },
  shambler: {
    parts: [
      ['head', [8, 8, 8], [0, 24, 0], [0, 4, 0], '#6a8a5a', { face: 'shambler' }],
      ['body', [8, 12, 4], [0, 18, 0], [0, 0, 0], '#5a3a5a'],
      ['armL', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#6a8a5a', { anim: 'armForward' }],
      ['armR', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#6a8a5a', { anim: 'armForward' }],
      ['legL', [4, 12, 4], [2, 12, 0], [0, -6, 0], '#3a3a2a', { anim: 'legA' }],
      ['legR', [4, 12, 4], [-2, 12, 0], [0, -6, 0], '#3a3a2a', { anim: 'legB' }],
    ],
  },
  rattler: {
    parts: [
      ['head', [8, 8, 8], [0, 24, 0], [0, 4, 0], '#d8d4c4', { face: 'rattler' }],
      ['body', [8, 12, 4], [0, 18, 0], [0, 0, 0], '#b8b4a4'],
      ['armL', [2, 12, 2], [5, 22, 0], [0, -5, 0], '#d8d4c4', { anim: 'armAim' }],
      ['armR', [2, 12, 2], [-5, 22, 0], [0, -5, 0], '#d8d4c4', { anim: 'armAim' }],
      ['bow', [1, 14, 1], [-5, 22, 0], [0, -1, -11], '#5a3a1a', { anim: 'armAim' }],
      ['legL', [2, 12, 2], [2, 12, 0], [0, -6, 0], '#c8c4b4', { anim: 'legA' }],
      ['legR', [2, 12, 2], [-2, 12, 0], [0, -6, 0], '#c8c4b4', { anim: 'legB' }],
    ],
  },
  fizzler: {
    parts: [
      ['body', [8, 12, 5], [0, 12, 0], [0, 0, 0], '#2a5a5a', { glow: true }],
      ['head', [8, 8, 8], [0, 18, 0], [0, 4, 0], '#2a5a5a', { face: 'fizzler' }],
      ['crystal', [3, 5, 3], [0, 26, 0], [0, 2, 0], '#e8a83a', { emissive: '#e88a1a' }],
      ['legFL', [4, 6, 4], [2, 6, -4], [0, -3, 0], '#204848', { anim: 'legA' }],
      ['legFR', [4, 6, 4], [-2, 6, -4], [0, -3, 0], '#204848', { anim: 'legB' }],
      ['legBL', [4, 6, 4], [2, 6, 4], [0, -3, 0], '#204848', { anim: 'legB' }],
      ['legBR', [4, 6, 4], [-2, 6, 4], [0, -3, 0], '#204848', { anim: 'legA' }],
    ],
  },
  skitterer: {
    parts: [
      ['abdomen', [10, 8, 12], [0, 7, 5], [0, 0, 0], '#2a2a32'],
      ['thorax', [6, 6, 6], [0, 6, -3], [0, 0, 0], '#34343c'],
      ['head', [8, 8, 8], [0, 6, -6], [0, 0, -4], '#2a2a32', { face: 'skitterer' }],
      ...[-4, -1, 2, 5].flatMap((z, i) => [
        [`legL${i}`, [16, 2, 2], [3, 6, z * 0.6], [8, 0, 0], '#1e1e24', { anim: 'spiderL', idx: i }],
        [`legR${i}`, [16, 2, 2], [-3, 6, z * 0.6], [-8, 0, 0], '#1e1e24', { anim: 'spiderR', idx: i }],
      ]),
    ],
  },
  voidwalker: {
    parts: [
      ['head', [8, 8, 8], [0, 38, 0], [0, 4, 0], '#14102a', { face: 'voidwalker' }],
      ['body', [8, 12, 4], [0, 32, 0], [0, 0, 0], '#1a1434'],
      ['armL', [2, 28, 2], [5, 38, 0], [0, -13, 0], '#14102a', { anim: 'armSwing' }],
      ['armR', [2, 28, 2], [-5, 38, 0], [0, -13, 0], '#14102a', { anim: 'armSwingB' }],
      ['legL', [2, 26, 2], [2, 26, 0], [0, -13, 0], '#14102a', { anim: 'legA' }],
      ['legR', [2, 26, 2], [-2, 26, 0], [0, -13, 0], '#14102a', { anim: 'legB' }],
    ],
  },
};

// Howlers: grey wolves with a shaggy mane; a red collar once tamed.
MODELS.howler = {
  parts: [
    ['body', [6, 6, 9], [0, 10, 2], [0, 0, 0], '#9a9a9e'],
    ['mane', [8, 8, 6], [0, 10.5, -3], [0, 0, 0], '#b4b4b8'],
    ['collar', [8.6, 2, 6.6], [0, 10.5, -3], [0, 2.5, -0.2], '#c8282a'],
    ['head', [6, 6, 4], [0, 12, -6], [0, 0, -2], '#a8a8ac', { face: 'howler' }],
    ['snout', [3, 3, 4], [0, 12, -6], [0, -1.5, -5.5], '#c8c4bc'],
    ['nose', [1.6, 1, 1], [0, 12, -6], [0, -0.5, -7.6], '#202022'],
    ['earL', [2, 2, 1], [0, 12, -6], [2, 4, -1.5], '#8a8a8e'],
    ['earR', [2, 2, 1], [0, 12, -6], [-2, 4, -1.5], '#8a8a8e'],
    ['legFL', [2, 8, 2], [1.5, 8, -3], [0, -4, 0], '#9a9a9e', { anim: 'legA' }],
    ['legFR', [2, 8, 2], [-1.5, 8, -3], [0, -4, 0], '#9a9a9e', { anim: 'legB' }],
    ['legBL', [2, 8, 2], [1.5, 8, 5], [0, -4, 0], '#9a9a9e', { anim: 'legB' }],
    ['legBR', [2, 8, 2], [-1.5, 8, 5], [0, -4, 0], '#9a9a9e', { anim: 'legA' }],
    ['tail', [2, 8, 2], [0, 12, 6.5], [0, -4, 0], '#8a8a8e'],
  ],
};

// Ironguards: hulking iron golems with long arms and a little vine growth.
MODELS.ironguard = {
  parts: [
    ['legL', [6, 16, 5], [5, 16, 0], [0, -8, 0], '#b8b2a8', { anim: 'legA' }],
    ['legR', [6, 16, 5], [-5, 16, 0], [0, -8, 0], '#b8b2a8', { anim: 'legB' }],
    ['waist', [9, 6, 7], [0, 19, 0], [0, 0, 0], '#c4beb4'],
    ['body', [18, 12, 11], [0, 28, 0], [0, 0, 0], '#cfc9bf'],
    ['vine', [6, 8, 1], [0, 28, 0], [-4, -1, -5.8], '#4a7a2a'],
    ['head', [8, 10, 8], [0, 34, -2], [0, 5, -2], '#cfc9bf', { face: 'ironguard' }],
    ['nose', [2, 4, 2], [0, 34, -2], [0, 3, -7], '#b8b2a8'],
    ['armL', [4, 30, 6], [11, 33, 0], [0, -13, 0], '#c4beb4', { anim: 'armSwing' }],
    ['armR', [4, 30, 6], [-11, 33, 0], [0, -13, 0], '#c4beb4', { anim: 'armSwingB' }],
  ],
};

// Wobblers: a see-through green cube with a solid core and a face (size 1; scaled by size).
MODELS.wobbler = {
  parts: [
    ['core', [5, 5, 5], [0, 4, 0], [0, 0, 0], '#4f9a32'],
    ['eyeL', [1.4, 1.4, 1], [0, 4, 0], [1.6, 1.2, -3.3], '#1a2a10'],
    ['eyeR', [1.4, 1.4, 1], [0, 4, 0], [-1.6, 1.2, -3.3], '#1a2a10'],
    ['mouth', [1.2, 0.8, 1], [0, 4, 0], [0.5, -1.2, -3.3], '#1a2a10'],
    ['shell', [8, 8, 8], [0, 4, 0], [0, 0, 0], '#7ad05a', { alpha: 0.55 }],
  ],
};

// Gallopers: horses with a long neck, mane and tail; a saddle once saddled.
MODELS.galloper = {
  parts: [
    ['body', [10, 10, 22], [0, 18, 2], [0, 0, 0], '#8a5a32'],
    ['saddle', [10.6, 3, 8], [0, 18, 2], [0, 5.5, -1], '#5a3418'],
    ['neck', [5, 12, 7], [0, 22, -8], [0, 4, -1], '#8a5a32'],
    ['mane', [2, 12, 4], [0, 22, -8], [0, 5, 2.4], '#3a2414'],
    ['head', [6, 6, 11], [0, 29, -10], [0, 1, -3], '#8a5a32', { face: 'galloper' }],
    ['legFL', [4, 13, 4], [3, 13, -6], [0, -6.5, 0], '#8a5a32', { anim: 'legA' }],
    ['legFR', [4, 13, 4], [-3, 13, -6], [0, -6.5, 0], '#8a5a32', { anim: 'legB' }],
    ['legBL', [4, 13, 4], [3, 13, 10], [0, -6.5, 0], '#8a5a32', { anim: 'legB' }],
    ['legBR', [4, 13, 4], [-3, 13, 10], [0, -6.5, 0], '#8a5a32', { anim: 'legA' }],
    ['tail', [3, 12, 3], [0, 21, 13], [0, -6, 0], '#3a2414'],
  ],
};

// Flitters: a small furry body with two wide wings.
MODELS.flitter = {
  parts: [
    ['body', [4, 6, 4], [0, 8, 0], [0, 0, 0], '#4a3a2e'],
    ['head', [5, 5, 4], [0, 11, 0], [0, 2.5, 0], '#4a3a2e', { face: 'flitter' }],
    ['earL', [1, 2, 1], [0, 11, 0], [1.5, 6, 0], '#3a2a20'],
    ['earR', [1, 2, 1], [0, 11, 0], [-1.5, 6, 0], '#3a2a20'],
    ['wingL', [8, 6, 1], [2, 10, 0], [4, -2, 0], '#2a1e18', { anim: 'batL' }],
    ['wingR', [8, 6, 1], [-2, 10, 0], [-4, -2, 0], '#2a1e18', { anim: 'batR' }],
  ],
};

// Frostlings: two snowballs with a carved pumpkin head and stick arms.
MODELS.frostling = {
  parts: [
    ['body', [12, 12, 12], [0, 6, 0], [0, 0, 0], '#eef2f6'],
    ['chest', [10, 10, 10], [0, 17, 0], [0, 0, 0], '#e6ecf2'],
    ['head', [8, 8, 8], [0, 22, 0], [0, 4, 0], '#e8922a', { face: 'frostling' }],
    ['armL', [12, 1, 1], [5, 19, 0], [6, 0, 0], '#6a4a28'],
    ['armR', [12, 1, 1], [-5, 19, 0], [-6, 0, 0], '#6a4a28'],
  ],
};

// Hoppers: small rabbits with long ears; Frostbears: big white bears; Vixlings: orange foxes with a white-tipped tail.
MODELS.hopper = {
  parts: [
    ['body', [5, 5, 8], [0, 4, 1], [0, 0, 0], '#9a7a5a'],
    ['head', [5, 4, 5], [0, 6, -3], [0, 1, -2], '#9a7a5a', { face: 'hopper' }],
    ['earL', [1, 5, 2], [0, 6, -3], [1.2, 5, -1.5], '#b89a7a'],
    ['earR', [1, 5, 2], [0, 6, -3], [-1.2, 5, -1.5], '#b89a7a'],
    ['tail', [2, 2, 2], [0, 4, 5], [0, 1, 0], '#f0ece4'],
    ['legFL', [2, 3, 2], [1.5, 2, -2], [0, -1, 0], '#8a6a4a', { anim: 'legA' }],
    ['legFR', [2, 3, 2], [-1.5, 2, -2], [0, -1, 0], '#8a6a4a', { anim: 'legA' }],
    ['legBL', [2, 3, 3], [1.5, 2, 3], [0, -1, 0], '#8a6a4a', { anim: 'legB' }],
    ['legBR', [2, 3, 3], [-1.5, 2, 3], [0, -1, 0], '#8a6a4a', { anim: 'legB' }],
  ],
};
MODELS.frostbear = {
  parts: [
    ['body', [14, 14, 22], [0, 15, 2], [0, 0, 0], '#ecedf0'],
    ['head', [8, 8, 8], [0, 18, -10], [0, 0, -3], '#ecedf0', { face: 'frostbear' }],
    ['snout', [4, 3, 3], [0, 18, -10], [0, -2, -8], '#d8d8dc'],
    ['earL', [2, 2, 1], [0, 18, -10], [3, 5, -2], '#d8d8dc'],
    ['earR', [2, 2, 1], [0, 18, -10], [-3, 5, -2], '#d8d8dc'],
    ['legFL', [5, 10, 5], [4, 10, -6], [0, -5, 0], '#e2e3e6', { anim: 'legA' }],
    ['legFR', [5, 10, 5], [-4, 10, -6], [0, -5, 0], '#e2e3e6', { anim: 'legB' }],
    ['legBL', [5, 10, 5], [4, 10, 9], [0, -5, 0], '#e2e3e6', { anim: 'legB' }],
    ['legBR', [5, 10, 5], [-4, 10, 9], [0, -5, 0], '#e2e3e6', { anim: 'legA' }],
  ],
};
// (white parts are tinted per bird; slightly different whites keep their materials apart)
MODELS.squawklet = {
  parts: [
    ['body', [3, 6, 3], [0, 6, 0], [0, 0, 0], '#ffffff'],
    ['head', [2, 3, 2], [0, 10, -0.5], [0, 1.5, 0], '#ffffff', { face: 'squawklet' }],
    ['beak', [1, 2, 1], [0, 10, -0.5], [0, 1.6, -1.5], '#e8a020'],
    ['crest', [1, 2.6, 2], [0, 10, -0.5], [0, 3.8, 0.8], '#fdfdfd'],
    ['wingL', [1, 5, 3], [1.9, 8.5, 0], [0, -2, 0], '#fefefe', { anim: 'wingL' }],
    ['wingR', [1, 5, 3], [-1.9, 8.5, 0], [0, -2, 0], '#fefefe', { anim: 'wingR' }],
    ['tail', [2, 1, 4], [0, 4, 1.5], [0, 0, 1.6], '#fefefe'],
    ['legL', [1, 2, 1], [1, 3, 0], [0, -1, 0], '#3a3a3a'],
    ['legR', [1, 2, 1], [-1, 3, 0], [0, -1, 0], '#3a3a3a'],
  ],
};
MODELS.shellback = {
  parts: [
    ['body', [14, 4, 16], [0, 4, 0], [0, 0, 0], '#c8c8a0'],
    ['shell', [16, 4, 18], [0, 4, 0], [0, 3, 0], '#3a7a3a'],
    ['shellTop', [10, 2, 12], [0, 4, 0], [0, 5.8, 0], '#2a5a2a'],
    ['head', [6, 5, 6], [0, 4, -8], [0, 0.5, -3], '#5aa84a', { face: 'shellback' }],
    ['legFL', [6, 2, 3], [6, 3, -6], [3, 0, 0], '#5aa84a', { anim: 'flipA' }],
    ['legFR', [6, 2, 3], [-6, 3, -6], [-3, 0, 0], '#5aa84a', { anim: 'flipB' }],
    ['legBL', [4, 2, 3], [5, 3, 7], [2, 0, 1], '#5aa84a', { anim: 'flipB' }],
    ['legBR', [4, 2, 3], [-5, 3, 7], [-2, 0, 1], '#5aa84a', { anim: 'flipA' }],
  ],
};
MODELS.buzzling = {
  parts: [
    ['body', [7, 7, 10], [0, 5, 0], [0, 0, 0], '#f0c030', { face: 'buzzling' }],
    ['stripeA', [7.4, 7.4, 1.6], [0, 5, 0], [0, 0, 0.5], '#3a2410'],
    ['stripeB', [7.4, 7.4, 1.6], [0, 5, 0], [0, 0, 3.4], '#3a2410'],
    ['sting', [1, 1, 2], [0, 5, 0], [0, -0.5, 5.8], '#2a1a0a'],
    ['antL', [0.6, 3, 0.6], [0, 5, 0], [1.4, 4.5, -5], '#2a1a0a'],
    ['antR', [0.6, 3, 0.6], [0, 5, 0], [-1.4, 4.5, -5], '#2a1a0a'],
    ['wingL', [6, 0.4, 4], [1, 8.6, -1], [3, 0, 0], '#e8f4ff', { anim: 'beeL', alpha: 0.6 }],
    ['wingR', [6, 0.4, 4], [-1, 8.6, -1], [-3, 0, 0], '#e8f4ff', { anim: 'beeR', alpha: 0.6 }],
  ],
};
MODELS.cragbuck = {
  parts: [
    ['body', [9, 10, 16], [0, 15, 1], [0, 0, 0], '#e8e4da'],
    ['head', [5, 7, 10], [0, 20, -7], [0, 1, -4], '#ecebe4', { face: 'cragbuck' }],
    ['beard', [2, 4, 2], [0, 20, -7], [0, -4, -7], '#d8d0c0'],
    ['hornL', [1.6, 7, 1.6], [0, 20, -7], [1.6, 7, -2], '#b8ac90'],
    ['hornR', [1.6, 7, 1.6], [0, 20, -7], [-1.6, 7, -2], '#b8ac90'],
    ['earL', [3, 1, 2], [0, 20, -7], [3.5, 3, -2], '#d8d0c0'],
    ['earR', [3, 1, 2], [0, 20, -7], [-3.5, 3, -2], '#d8d0c0'],
    ['legFL', [3, 10, 3], [2.5, 10, -5], [0, -5, 0], '#d8d2c6', { anim: 'legA' }],
    ['legFR', [3, 10, 3], [-2.5, 10, -5], [0, -5, 0], '#d8d2c6', { anim: 'legB' }],
    ['legBL', [3, 10, 3], [2.5, 10, 7], [0, -5, 0], '#d8d2c6', { anim: 'legB' }],
    ['legBR', [3, 10, 3], [-2.5, 10, 7], [0, -5, 0], '#d8d2c6', { anim: 'legA' }],
  ],
};
MODELS.purrling = {
  parts: [
    ['body', [4, 4, 12], [0, 8, 1], [0, 0, 0], '#c8883a'],
    ['mane', [4.4, 4.4, 3], [0, 8.5, -4], [0, 0, 0], '#c8883a'],
    ['collar', [5, 1.4, 3.4], [0, 8.5, -4], [0, 1.6, -0.2], '#2a6ad8'],
    ['head', [5, 4, 5], [0, 10, -6], [0, 0, -2], '#ffffff', { face: 'purrling' }], // white: tinted with the coat
    ['snout', [3, 2, 1], [0, 10, -6], [0, -1, -5], '#e8d8c0'],
    ['nose', [1, 1, 0.6], [0, 10, -6], [0, -0.2, -5.6], '#e88a9a'],
    ['earL', [1.4, 1.6, 1], [0, 10, -6], [1.6, 2.6, -1], '#a86a2a'],
    ['earR', [1.4, 1.6, 1], [0, 10, -6], [-1.6, 2.6, -1], '#a86a2a'],
    ['legFL', [2, 6, 2], [1.1, 6, -3.5], [0, -3, 0], '#c8883a', { anim: 'legA' }],
    ['legFR', [2, 6, 2], [-1.1, 6, -3.5], [0, -3, 0], '#c8883a', { anim: 'legB' }],
    ['legBL', [2, 6, 2], [1.1, 6, 5.5], [0, -3, 0], '#c8883a', { anim: 'legB' }],
    ['legBR', [2, 6, 2], [-1.1, 6, 5.5], [0, -3, 0], '#c8883a', { anim: 'legA' }],
    ['tail', [1, 8, 1], [0, 9.5, 7], [0, -4, 0], '#a86a2a'],
  ],
};
MODELS.vixling = {
  parts: [
    ['body', [6, 6, 11], [0, 7, 1], [0, 0, 0], '#e07a2a'],
    ['head', [7, 6, 5], [0, 9, -5], [0, 0, -2], '#e07a2a', { face: 'vixling' }],
    ['snout', [3, 2, 3], [0, 9, -5], [0, -1.5, -5.5], '#f4ece0'],
    ['earL', [2, 3, 1], [0, 9, -5], [2, 4, -1.5], '#2a1a10'],
    ['earR', [2, 3, 1], [0, 9, -5], [-2, 4, -1.5], '#2a1a10'],
    ['tail', [4, 4, 9], [0, 8, 6], [0, -1, 4], '#e07a2a'],
    ['tailTip', [4.2, 4.2, 3], [0, 8, 6], [0, -1, 8.5], '#f4ece0'],
    ['legFL', [2, 5, 2], [1.5, 4, -3], [0, -2.5, 0], '#2a1a10', { anim: 'legA' }],
    ['legFR', [2, 5, 2], [-1.5, 4, -3], [0, -2.5, 0], '#2a1a10', { anim: 'legB' }],
    ['legBL', [2, 5, 2], [1.5, 4, 5], [0, -2.5, 0], '#2a1a10', { anim: 'legB' }],
    ['legBR', [2, 5, 2], [-1.5, 4, 5], [0, -2.5, 0], '#2a1a10', { anim: 'legA' }],
  ],
};

// Inklings: a dark blue body with eight tentacles that sweep with each pulse.
MODELS.inkling = {
  parts: [
    ['body', [10, 12, 10], [0, 12, 0], [0, 0, 0], '#2a3a6a', { face: 'inkling' }],
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
      const a = (k / 8) * Math.PI * 2;
      return [`t${k}`, [2, 10, 2], [Math.sin(a) * 4, 6, Math.cos(a) * 4], [0, -5, 0], '#24325c', { anim: 'tentacle', idx: k }];
    }),
  ],
};

// Deepeyes (Tide Citadel guardians): a boxy fish with one great eye, spikes that
// stand out while it holds still (scaled by oceanMobs.js) and a three-part tail.
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
      ...spikes,
      ['tail0', [8, 8, 7], [0, 7, 8], [0, 0, 1.5], body, { anim: 'tailSeg', idx: 1 }],
      ['tail1', [5, 5, 7], [0, 7, 14], [0, 0, 1.5], tail, { anim: 'tailSeg', idx: 2 }],
      ['tail2', [2, 7, 6], [0, 7, 20], [0, 0, 1.5], tail, { anim: 'tailSeg', idx: 3 }],
    ],
  };
}
MODELS.deepeye = deepeyeModel('#3f7a74', '#2d5c58', '#e6d2a4', '#c8805a');
MODELS.elder_deepeye = deepeyeModel('#c4c0cc', '#9a94a8', '#8a6aa0', '#7a6a8a');

// Marauders: grey-skinned raiders in dark coats, crossbow raised when they aim.
MODELS.marauder = {
  parts: [
    ['head', [8, 10, 8], [0, 24, 0], [0, 5, 0], '#8a908a', { face: 'marauder' }],
    ['nose', [2, 4, 2], [0, 24, 0], [0, 2, -5], '#7a807a'],
    ['body', [8, 12, 6], [0, 18, 0], [0, 0, 0], '#3a3a44'],
    ['armL', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#2e2e36', { anim: 'armAim' }],
    ['armR', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#2e2e36', { anim: 'armAim' }],
    ['bow', [1, 2, 10], [-6, 22, 0], [0, -11, -1], '#5a3a1a', { anim: 'armAim' }],
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
    ['sash', [8.4, 2, 6.4], [0, 18, 0], [0, -2, 0], '#8a3a5a'],
    ['hem', [9, 3, 7], [0, 12, 0], [0, -1, 0], '#34502f'],
    ['armL', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#3e5a3a', { anim: 'armSwingB' }],
    ['armR', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#3e5a3a', { anim: 'armSwing' }],
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
    ['body', [8, 12, 4], [0, 18, 0], [0, 0, 0], '#8a6a42'],
    ['scarf', [9, 3, 5], [0, 18, 0], [0, 4.6, 0], '#d8c49a'],
    ['armL', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#a8946a', { anim: 'armForward' }],
    ['armR', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#a8946a', { anim: 'armForward' }],
    ['legL', [4, 12, 4], [2, 12, 0], [0, -6, 0], '#5a4630', { anim: 'legA' }],
    ['legR', [4, 12, 4], [-2, 12, 0], [0, -6, 0], '#5a4630', { anim: 'legB' }],
  ],
};
// Sodden Shambler: a waterlogged teal Shambler trailing strands of weed.
MODELS.sodden_shambler = {
  parts: [
    ['head', [8, 8, 8], [0, 24, 0], [0, 4, 0], '#4a8a86', { face: 'sodden_shambler' }],
    ['body', [8, 12, 4], [0, 18, 0], [0, 0, 0], '#2e5a50'],
    ['weedA', [2, 8, 1], [0, 18, 0], [2, -7, -2.4], '#3a7a3a'],
    ['weedB', [1, 6, 1], [0, 18, 0], [-3, -6, -2.4], '#2f6a34'],
    ['weedC', [3, 1, 9], [0, 24, 0], [1, 8.5, 0], '#3a7a3a'],
    ['armL', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#4a8a86', { anim: 'armForward' }],
    ['armR', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#4a8a86', { anim: 'armForward' }],
    ['legL', [4, 12, 4], [2, 12, 0], [0, -6, 0], '#24463e', { anim: 'legA' }],
    ['legR', [4, 12, 4], [-2, 12, 0], [0, -6, 0], '#24463e', { anim: 'legB' }],
  ],
};
// Rime Rattler: a frost-blue Rattler in a ragged hood and cloak.
MODELS.rime_rattler = {
  parts: [
    ['head', [8, 8, 8], [0, 24, 0], [0, 4, 0], '#c8d8e2', { face: 'rime_rattler' }],
    ['hood', [9, 4, 9], [0, 24, 0], [0, 7, 0.4], '#5a6a7e'],
    ['body', [8, 12, 4], [0, 18, 0], [0, 0, 0], '#a8bcc8'],
    ['cloak', [9, 10, 2], [0, 18, 0], [0, -1, 2.6], '#5a6a7e'],
    ['armL', [2, 12, 2], [5, 22, 0], [0, -5, 0], '#c8d8e2', { anim: 'armAim' }],
    ['armR', [2, 12, 2], [-5, 22, 0], [0, -5, 0], '#c8d8e2', { anim: 'armAim' }],
    ['bow', [1, 14, 1], [-5, 22, 0], [0, -1, -11], '#4a3a2a', { anim: 'armAim' }],
    ['legL', [2, 12, 2], [2, 12, 0], [0, -6, 0], '#b8ccd8', { anim: 'legA' }],
    ['legR', [2, 12, 2], [-2, 12, 0], [0, -6, 0], '#b8ccd8', { anim: 'legB' }],
  ],
};

// Settlers: big-nosed villagers in a robe whose colour shows the profession.
MODELS.settler = {
  parts: [
    ['head', [8, 10, 8], [0, 24, 0], [0, 5, 0], '#b8835a', { face: 'settler' }],
    ['nose', [2, 4, 2], [0, 24, 0], [0, 2, -5], '#a87350'],
    ['robe', [8, 12, 6], [0, 18, 0], [0, 0, 0], '#8a6a3a'],
    ['arms', [8, 4, 4], [0, 20, -1], [0, -1, -3.5], '#8a6a3a'],
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
    ['armR', [4, 12, 4], [6, 22, 0], [0, -4, 0], '#3a6a9a', { anim: 'armSwing' }],
    ['armL', [4, 12, 4], [-6, 22, 0], [0, -4, 0], '#3a6a9a', { anim: 'armSwingB' }],
    ['legR', [4, 12, 4], [2, 12, 0], [0, -6, 0], '#2c2c4a', { anim: 'legB' }],
    ['legL', [4, 12, 4], [-2, 12, 0], [0, -6, 0], '#2c2c4a', { anim: 'legA' }],
  ],
};

// ---- Cinderdeep and Hollow mobs ----
// Ashwraith: a huge pale shroud with a sorrowful face and nine trailing tendrils.
MODELS.ashwraith = {
  parts: [
    ['head', [60, 52, 60], [0, 38, 0], [0, 0, 0], '#e6e1da', { face: 'ashwraith' }],
    ...[-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => [`tendril${i}${j}`, [5, 30, 5], [i * 18, 12, j * 18], [0, -15, 0], '#d4cec6', { anim: 'tendril', idx: (i + 1) * 3 + j + 1 }])),
  ],
};
// Cinder Brute: hulking fire-immune brawler, charred hide split by molten seams.
MODELS.cinder_brute = {
  parts: [
    ['head', [10, 9, 9], [0, 26, 0], [0, 4.5, -1], '#4a221c', { face: 'cinder_brute' }],
    ['tuskL', [2, 4, 2], [0, 26, 0], [3.5, 1.5, -6], '#e8d8b0'],
    ['tuskR', [2, 4, 2], [0, 26, 0], [-3.5, 1.5, -6], '#e8d8b0'],
    ['body', [12, 14, 7], [0, 19, 0], [0, 0, 0], '#5a2a22'],
    ['seam', [6, 8, 1], [0, 19, 0], [0, 1, -3.8], '#ff7a1a', { emissive: '#ff5a00' }],
    ['armL', [5, 14, 5], [8.5, 25, 0], [0, -5, 0], '#4a221c', { anim: 'armForward' }],
    ['armR', [5, 14, 5], [-8.5, 25, 0], [0, -5, 0], '#4a221c', { anim: 'armForward' }],
    ['legL', [5, 12, 5], [3, 12, 0], [0, -6, 0], '#3a1814', { anim: 'legA' }],
    ['legR', [5, 12, 5], [-3, 12, 0], [0, -6, 0], '#3a1814', { anim: 'legB' }],
  ],
};
// Ember Lord: a burning mask circled by two rings of glowing rods over a smoky core.
MODELS.ember_lord = {
  parts: [
    ['head', [8, 8, 8], [0, 22, 0], [0, 4, 0], '#e8a52a', { face: 'ember_lord', emissive: '#a05000' }],
    ['core', [4, 10, 4], [0, 10, 0], [0, 4, 0], '#3a2a24'],
    ...[0, 1, 2, 3].map((i) => [`rodA${i}`, [2, 8, 2], [0, 16, 0], [8, 0, 0], '#ffb83a', { anim: 'orbit', idx: i, emissive: '#ff8a10' }]),
    ...[0, 1, 2, 3].map((i) => [`rodB${i}`, [2, 8, 2], [0, 6, 0], [6, 0, 0], '#ffb83a', { anim: 'orbitB', idx: i, emissive: '#ff8a10' }]),
  ],
};
// Mending Crystal: a glowing core spinning inside two frames.
MODELS.void_crystal = {
  parts: [
    ['core', [8, 8, 8], [0, 14, 0], [0, 0, 0], '#ffb8f4', { anim: 'spin', emissive: '#e070d0' }],
    ['frameA', [14, 14, 1.5], [0, 14, 0], [0, 0, 0], '#c8c0ff', { anim: 'spinA', emissive: '#6050a0' }],
    ['frameB', [1.5, 14, 14], [0, 14, 0], [0, 0, 0], '#c8c0ff', { anim: 'spinB', emissive: '#6050a0' }],
  ],
};
// Void Wyrm: long dark serpent-dragon with membrane wings, a spined back and a swaying tail.
MODELS.void_wyrm = {
  parts: [
    ['body', [26, 20, 46], [0, 16, 0], [0, 0, 0], '#45375e'],
    ['belly', [20, 4, 40], [0, 6, 0], [0, 0, 0], '#7a6a98'],
    ...[-16, -6, 4, 14].map((z, i) => [`spine${i}`, [3, 7, 4], [0, 26, z], [0, 3, 0], '#b6a6de']),
    ['neck', [12, 12, 20], [0, 19, -22], [0, 0, -9], '#45375e', { anim: 'wyrmNeck' }],
    ['head', [16, 13, 22], [0, 21, -40], [0, 0, -6], '#4e3f6a', { face: 'void_wyrm' }],
    ['snout', [12, 7, 10], [0, 21, -40], [0, -2, -21], '#3e3254'],
    ['hornL', [3, 3, 12], [0, 21, -40], [5, 7.5, 3], '#ece6ff'],
    ['hornR', [3, 3, 12], [0, 21, -40], [-5, 7.5, 3], '#ece6ff'],
    ['jaw', [12, 3, 16], [0, 16, -40], [0, -1.5, -12], '#2a2038', { anim: 'jaw' }],
    ['wingL', [72, 2, 34], [13, 24, -6], [36, 0, 4], '#5a3f86', { anim: 'wyrmWingL', emissive: '#1c0c30' }],
    ['wingR', [72, 2, 34], [-13, 24, -6], [-36, 0, 4], '#5a3f86', { anim: 'wyrmWingR', emissive: '#1c0c30' }],
    ['armL', [5, 14, 5], [9, 10, -14], [0, -6, 0], '#45375e'],
    ['armR', [5, 14, 5], [-9, 10, -14], [0, -6, 0], '#45375e'],
    ['legL', [7, 14, 8], [10, 10, 16], [0, -6, 0], '#45375e'],
    ['legR', [7, 14, 8], [-10, 10, 16], [0, -6, 0], '#45375e'],
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => [`tail${i}`, [14 - i * 1.6, 12 - i * 1.3, 14], [0, 16 - i * 0.5, 30 + i * 13.5], [0, 0, 0], i % 2 ? '#3c3054' : '#45375e', { anim: 'tailSeg', idx: i }]),
  ],
};

const FACES = {
  hexwife: (c) => {
    px(c, '#1a1a12', [[2, 3, 5, 1], [9, 3, 5, 1]]); px(c, '#e8e0a0', [[3, 5, 3, 2], [10, 5, 3, 2]]); px(c, '#6a2a5a', [[4, 5, 2, 2], [11, 5, 2, 2]]);
    px(c, '#4a3a2a', [[5, 12, 6, 1], [4, 11], [11, 11]]);
  },
  dune_shambler: (c) => {
    px(c, '#3a2a14', [[3, 6, 3, 2], [10, 6, 3, 2]]); px(c, '#f0d070', [[4, 6], [11, 6]]);
    px(c, '#5a4428', [[4, 11, 8, 2]]); px(c, '#d8c49a', [[0, 0, 16, 3]]);
  },
  sodden_shambler: (c) => {
    px(c, '#103a3a', [[3, 6, 3, 2], [10, 6, 3, 2]]); px(c, '#70fff0', [[4, 6], [11, 6]]);
    px(c, '#1a3a34', [[4, 11, 8, 2]]); px(c, '#3a7a3a', [[0, 0, 5, 2], [9, 0, 7, 1]]);
  },
  rime_rattler: (c) => { px(c, '#18222e', [[3, 5, 3, 3], [10, 5, 3, 3], [7, 9, 2, 2], [4, 12, 8, 1]]); px(c, '#8ae0ff', [[4, 6], [11, 6]]); px(c, '#5a6a7e', [[0, 0, 16, 2]]); },
  settler: (c) => {
    px(c, '#3a2a1a', [[1, 3, 14, 1]]); px(c, '#ffffff', [[3, 5, 3, 2], [10, 5, 3, 2]]); px(c, '#2a6a3a', [[4, 5, 2, 2], [11, 5, 2, 2]]);
  },
  player: (c) => {
    px(c, '#4a3220', [[0, 0, 16, 3], [0, 3, 2, 3], [14, 3, 2, 3]]);
    px(c, '#ffffff', [[3, 7, 3, 2], [10, 7, 3, 2]]); px(c, '#3a5ab0', [[4, 7, 2, 2], [11, 7, 2, 2]]);
    px(c, '#9a6a4a', [[7, 10, 2, 2]]); px(c, '#7a3a2a', [[5, 12, 6, 1]]);
  },
  ironguard: (c) => { px(c, '#7a7468', [[2, 4, 12, 2]]); px(c, '#8a1a10', [[4, 6, 2, 2], [10, 6, 2, 2]]); px(c, '#a8a298', [[3, 12, 10, 1]]); },
  galloper: (c) => { px(c, '#141210', [[1, 5, 2, 2], [13, 5, 2, 2]]); px(c, '#4a3020', [[5, 12, 2, 2], [9, 12, 2, 2]]); },
  flitter: (c) => { px(c, '#1a1010', [[3, 6, 2, 2], [11, 6, 2, 2]]); px(c, '#e8d8c8', [[6, 11, 1, 2], [9, 11, 1, 2]]); },
  frostling: (c) => { px(c, '#3a1a08', [[3, 5, 3, 3], [10, 5, 3, 3], [4, 11, 8, 2], [5, 10], [10, 10]]); px(c, '#ffd040', [[4, 6], [11, 6]]); },
  hopper: (c) => { px(c, '#1a1010', [[3, 6, 2, 2], [11, 6, 2, 2]]); px(c, '#e8a0a0', [[7, 10, 2, 1]]); },
  frostbear: (c) => { px(c, '#1a1a1a', [[3, 5, 2, 2], [11, 5, 2, 2]]); },
  squawklet: (c) => { px(c, '#f0f0f0', [[1, 5, 4, 4], [11, 5, 4, 4]]); px(c, '#101010', [[2, 6, 2, 2], [12, 6, 2, 2]]); },
  shellback: (c) => { px(c, '#101010', [[2, 5, 2, 2], [12, 5, 2, 2]]); px(c, '#3a7a3a', [[5, 11, 6, 1]]); },
  buzzling: (c) => { px(c, '#1a1010', [[1, 5, 4, 5], [11, 5, 4, 5]]); px(c, '#ffffff', [[2, 6], [12, 6]]); },
  cragbuck: (c) => { px(c, '#c8a020', [[3, 5, 3, 2], [10, 5, 3, 2]]); px(c, '#101010', [[4, 5, 1, 2], [11, 5, 1, 2]]); px(c, '#b8a8a0', [[6, 12, 4, 2]]); },
  purrling: (c) => { px(c, '#a0ffa0', [[3, 6, 3, 2], [10, 6, 3, 2]]); px(c, '#0a0a0a', [[4, 6, 1, 2], [11, 6, 1, 2]]); },
  vixling: (c) => { px(c, '#1a1010', [[2, 6, 3, 2], [11, 6, 3, 2]]); px(c, '#f4ece0', [[0, 9, 4, 4], [12, 9, 4, 4]]); },
  deepeye: (c) => {
    px(c, '#f4f0e0', [[3, 3, 10, 10]]); px(c, '#e8e0c8', [[2, 5, 1, 6], [13, 5, 1, 6], [5, 2, 6, 1], [5, 13, 6, 1]]);
    px(c, '#7a3aa0', [[6, 6, 4, 4]]); px(c, '#1a0a24', [[7, 7, 2, 2]]); px(c, '#ffffff', [[6, 6]]);
  },
  inkling: (c) => { px(c, '#e8e8f0', [[3, 7, 3, 3], [10, 7, 3, 3]]); px(c, '#101018', [[4, 8, 2, 2], [11, 8, 2, 2]]); },
  marauder: (c) => { px(c, '#2a2a2a', [[1, 4, 14, 2]]); px(c, '#f0f0f0', [[3, 6, 3, 2], [10, 6, 3, 2]]); px(c, '#3a5a3a', [[4, 6, 2, 2], [11, 6, 2, 2]]); px(c, '#5a5a5a', [[5, 12, 6, 1]]); },
  howler: (c) => { px(c, '#f0f0f0', [[2, 6, 3, 2], [11, 6, 3, 2]]); px(c, '#2a2418', [[3, 6, 2, 2], [11, 6, 2, 2]]); px(c, '#7a7a80', [[2, 4, 4, 1], [10, 4, 4, 1]]); },
  bristleback: (c) => { px(c, '#1a1010', [[3, 5, 2, 2], [11, 5, 2, 2]]); px(c, '#ffffff', [[3, 5], [11, 5]]); },
  mooxen: (c) => { px(c, '#101820', [[2, 6, 2, 2], [12, 6, 2, 2]]); px(c, '#c8b8a0', [[4, 10, 8, 6]]); px(c, '#3a2a2a', [[5, 12, 2, 2], [9, 12, 2, 2]]); },
  fleecer: (c) => { px(c, '#f0e8ff', [[3, 6, 3, 2], [10, 6, 3, 2]]); px(c, '#2a1a3a', [[4, 6], [11, 6]]); px(c, '#c88aa0', [[7, 11, 2, 2]]); },
  cluckling: (c) => { px(c, '#101010', [[2, 4, 3, 3], [11, 4, 3, 3]]); px(c, '#c8302a', [[6, 12, 4, 4]]); },
  shambler: (c) => {
    px(c, '#e8e060', [[3, 6, 3, 2], [10, 6, 3, 2]]); px(c, '#1a1a10', [[4, 6], [11, 6]]);
    px(c, '#2a3a20', [[4, 11, 8, 2]]); px(c, '#4a6a3a', [[0, 0, 16, 2]]);
  },
  rattler: (c) => { px(c, '#1a1a1a', [[3, 5, 3, 3], [10, 5, 3, 3], [7, 9, 2, 2], [4, 12, 8, 1]]); px(c, '#ff4a2a', [[4, 6], [11, 6]]); },
  fizzler: (c) => {
    px(c, '#1a2a2a', [[2, 5, 4, 3], [10, 5, 4, 3]]); px(c, '#ffb03a', [[3, 6, 2, 1], [11, 6, 2, 1]]);
    px(c, '#ffb03a', [[5, 11, 6, 1], [4, 12, 1, 2], [11, 12, 1, 2], [6, 13, 4, 1]]);
  },
  skitterer: (c) => { px(c, '#ff3a2a', [[2, 5, 2, 2], [12, 5, 2, 2], [5, 4, 2, 2], [9, 4, 2, 2], [4, 8], [11, 8], [6, 7], [9, 7]]); },
  ashwraith: (c) => {
    px(c, '#3a3436', [[3, 5, 3, 1], [10, 5, 3, 1], [4, 6, 1, 3], [11, 6, 1, 3]]);
    px(c, '#9a3a3a', [[4, 8, 1, 2], [11, 8, 1, 2]]);
    px(c, '#2a2426', [[6, 11, 4, 3], [5, 12, 1, 1], [10, 12, 1, 1]]);
  },
  cinder_brute: (c) => {
    px(c, '#ffb03a', [[3, 6, 3, 2], [10, 6, 3, 2]]); px(c, '#fff0b0', [[4, 6], [11, 6]]);
    px(c, '#2a100c', [[2, 4, 5, 1], [9, 4, 5, 1], [5, 11, 6, 2]]); px(c, '#ff6a1a', [[7, 2, 2, 2]]);
  },
  ember_lord: (c) => {
    px(c, '#2a1406', [[3, 6, 3, 2], [10, 6, 3, 2], [6, 11, 4, 1]]);
    px(c, '#fff2a0', [[4, 6], [11, 6]]); px(c, '#ffd060', [[0, 0, 16, 2]]);
  },
  void_wyrm: (c) => {
    px(c, '#d070ff', [[1, 6, 4, 2], [11, 6, 4, 2]]); px(c, '#ffffff', [[2, 6, 2, 1], [12, 6, 2, 1]]);
    px(c, '#0c0812', [[3, 12, 10, 2]]);
  },
  voidwalker: (c) => {
    px(c, '#5ff0ff', [[2, 8, 4, 1], [10, 8, 4, 1]]); px(c, '#b8ffff', [[3, 8, 2, 1], [11, 8, 2, 1]]);
    px(c, '#3a2a6a', [[5, 2], [11, 3], [8, 13]]);
  },
};

export function buildModel(type) {
  const spec = MODELS[type];
  const root = new THREE.Group();
  const parts = {};
  const mats = [];
  const matCache = new Map();
  const matFor = (color, opts) => {
    const k = color + (opts.emissive || '') + (opts.glow ? 'g' : '') + (opts.alpha ? 'a' : '');
    if (matCache.has(k)) return matCache.get(k);
    const m = new THREE.MeshLambertMaterial({ map: noiseTexture(type + color), color, ...(opts.alpha ? { transparent: true, opacity: opts.alpha, depthWrite: false } : {}) });
    m.userData.base = new THREE.Color(color);
    if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.userData.emissive = m.emissive.clone(); }
    matCache.set(k, m); mats.push(m);
    return m;
  };
  for (const [name, size, pivot, offset, color, opts = {}] of spec.parts) {
    const pivotGroup = new THREE.Group();
    pivotGroup.position.set(pivot[0] / 16, pivot[1] / 16, pivot[2] / 16);
    const geo = new THREE.BoxGeometry(size[0] / 16, size[1] / 16, size[2] / 16);
    const base = matFor(color, opts);
    let material = base;
    if (opts.face) {
      const fm = new THREE.MeshLambertMaterial({ map: faceTexture(type, color, FACES[opts.face]) });
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
  root.userData.parts = parts;
  root.userData.mats = mats;
  root.userData.dispose = () => { root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const m of mats) m.dispose(); };
  return root;
}

export function animateModel(root, mob, alpha, L, sec) {
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
  if (parts.head) parts.head.rotation.x = mob.headPitch || 0;
  // fuse swelling + flashing
  let flash = 0;
  if (mob.type === 'fizzler') {
    const f = (mob.prevFuse + (mob.fuse - mob.prevFuse) * alpha) / mob.def.fuse;
    const s = 1 + f * 0.25 + Math.sin(f * 100) * f * 0.02;
    root.scale.set(s * (1 + f * 0.1), s / (1 + f * 0.1), s * (1 + f * 0.1));
    if (f > 0 && Math.floor(f * 10) % 2 === 0) flash = f;
  }
  for (const m of mats) {
    m.color.copy(m.userData.base).multiplyScalar(L);
    if (m.userData.emissive) m.emissive.copy(m.userData.emissive).multiplyScalar(0.6 + 0.4 * Math.sin(sec * 4));
    else m.emissive.setRGB(hurt ? 0.45 : flash, flash, flash);
  }
}

// Other modules (e.g. mobs/gloomshell.js) register their own models and faces here.
export { MODELS, FACES };

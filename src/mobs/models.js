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

const FACES = {
  settler: (c) => {
    px(c, '#3a2a1a', [[1, 3, 14, 1]]); px(c, '#ffffff', [[3, 5, 3, 2], [10, 5, 3, 2]]); px(c, '#2a6a3a', [[4, 5, 2, 2], [11, 5, 2, 2]]);
  },
  player: (c) => {
    px(c, '#4a3220', [[0, 0, 16, 3], [0, 3, 2, 3], [14, 3, 2, 3]]);
    px(c, '#ffffff', [[3, 7, 3, 2], [10, 7, 3, 2]]); px(c, '#3a5ab0', [[4, 7, 2, 2], [11, 7, 2, 2]]);
    px(c, '#9a6a4a', [[7, 10, 2, 2]]); px(c, '#7a3a2a', [[5, 12, 6, 1]]);
  },
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
    const k = color + (opts.emissive || '') + (opts.glow ? 'g' : '');
    if (matCache.has(k)) return matCache.get(k);
    const m = new THREE.MeshLambertMaterial({ map: noiseTexture(type + color), color });
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
    pivotGroup.userData = { anim: opts.anim, idx: opts.idx };
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
      case 'wingL': g.rotation.z = mob.body.onGround ? 0 : Math.sin(sec * 30) * 0.8; break;
      case 'wingR': g.rotation.z = mob.body.onGround ? 0 : -Math.sin(sec * 30) * 0.8; break;
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

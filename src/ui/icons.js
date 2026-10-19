// Inventory icons: isometric mini-cubes for blocks (from the block textures)
// and hand-drawn pixel templates for items.
import { BLOCKS, SHAPE } from '../world/blocks.js';
import { ITEMS, MATERIALS, ARMOR_MATERIALS } from '../world/items.js';
import { texturePixels } from '../world/textures.js';
import { COLORS, WOOL_RGB } from '../world/colors.js';

const cache = new Map();

function texCanvas(name, tint) {
  const px = texturePixels(name);
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(16, 16);
  for (let i = 0; i < px.length; i += 4) {
    img.data[i] = tint ? px[i] * tint[0] / 255 : px[i];
    img.data[i + 1] = tint ? px[i + 1] * tint[1] / 255 : px[i + 1];
    img.data[i + 2] = tint ? px[i + 2] * tint[2] / 255 : px[i + 2];
    img.data[i + 3] = px[i + 3];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const GRASS_TINT = [110, 180, 70], LEAF_TINT = [80, 150, 50];

function blockIcon(b, forceTint = null) {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const tint = (face) => (b.tint === 'grass' && face === 'top') || b.tint === 'foliage' ? (b.tint === 'grass' ? GRASS_TINT : LEAF_TINT)
    : b.tint === 'birch' ? [128, 167, 85] : b.tint === 'spruce' ? [97, 153, 97] : null;
  if (b.shape === SHAPE.FENCE || b.shape === SHAPE.GATE) {
    const col = { 'Oak Fence': '#a7834e', 'Spruce Fence': '#6b4e2e', 'Birch Fence': '#c8b27a' }[b.name] || '#a7834e';
    const tpl = b.shape === SHAPE.FENCE
      ? ['................', '..hh........hh..', '..hh........hh..', '..hhhhhhhhhhhh..', '..hhhhhhhhhhhh..', '..hh........hh..', '..hh........hh..', '..hhhhhhhhhhhh..', '..hhhhhhhhhhhh..', '..hh........hh..', '..hh........hh..', '..hh........hh..', '..hh........hh..', '................', '................', '................']
      : ['................', '.hh..........hh.', '.hh..........hh.', '.hhhhhhhhhhhhhh.', '.hhhhhhhhhhhhhh.', '.hh...hhhh...hh.', '.hh...hhhh...hh.', '.hhhhhhhhhhhhhh.', '.hhhhhhhhhhhhhh.', '.hh..........hh.', '.hh..........hh.', '................', '................', '................', '................', '................'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (tpl[y][x] === 'h') { ctx.fillStyle = (x + y) % 5 ? col : lighten(col, 0.8); ctx.fillRect(x * 2, y * 2, 2, 2); }
    return c;
  }
  if (b.shape === SHAPE.CROSS || b.shape === SHAPE.TORCH || b.shape === SHAPE.LADDER || b.shape === SHAPE.PANE) {
    ctx.drawImage(texCanvas(b.tex.side, b.tint ? GRASS_TINT : null), 0, 0, 32, 32);
    return c;
  }
  const top = texCanvas(b.tex.top, forceTint || tint('top')), side = texCanvas(b.tex.side, forceTint || tint('side'));
  const front = b.tex.front ? texCanvas(b.tex.front) : side;
  // top face
  ctx.save(); ctx.setTransform(1, 0.5, -1, 0.5, 16, 1); ctx.drawImage(top, 0, 0, 16, 16); ctx.restore();
  // left face
  ctx.save(); ctx.setTransform(1, 0.5, 0, 1, 0, 9); ctx.drawImage(front, 0, 0, 16, 16);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, 16, 16); ctx.restore();
  // right face
  ctx.save(); ctx.setTransform(1, -0.5, 0, 1, 16, 17); ctx.drawImage(side, 0, 0, 16, 16);
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, 16, 16); ctx.restore();
  return c;
}

// 16x16 templates. '.' = transparent; other chars mapped per item.
const T = {
  pickaxe: ['................', '...hhhhhhhh.....', '..hhhhhhhhhh....', '.hh....ss..hh...', '.h.....ss...h...', '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......', '................', '................'],
  axe: ['................', '......hhhh......', '.....hhhhhh.....', '.....hhhhss.....', '.....hhh.ss.....', '......h..ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '................', '................'],
  shovel: ['................', '.......hh.......', '......hhhh......', '......hhhh......', '......hhhh......', '.......hh.......', '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......', '......ssss......', '................', '................', '................'],
  sword: ['................', '.............hh.', '............hHh.', '...........hHh..', '..........hHh...', '.........hHh....', '........hHh.....', '...s...hHh......', '...ss.hHh.......', '....sshh........', '.....ss.........', '....ssss........', '...ss..ss.......', '..ss............', '................', '................'],
  stick: ['................', '............ss..', '...........ss...', '..........ss....', '.........ss.....', '........ss......', '.......ss.......', '......ss........', '.....ss.........', '....ss..........', '...ss...........', '..ss............', '................', '................', '................', '................'],
  ingot: ['................', '................', '................', '................', '.....hhhhhhh....', '....hHHHHHHhh...', '...hHHHHHHhhh...', '..hhhhhhhhhhh...', '..hhhhhhhhhh....', '..hhhhhhhhh.....', '................', '................', '................', '................', '................', '................'],
  gem: ['................', '................', '.....hhhhhh.....', '....hHHHHHHh....', '...hHHhhhhHHh...', '..hhhhhhhhhhhh..', '...hhhhhhhhhh...', '....hhhhhhhh....', '.....hhhhhh.....', '......hhhh......', '.......hh.......', '................', '................', '................', '................', '................'],
  lump: ['................', '................', '................', '.....hhhh.......', '....hHHhhhh.....', '...hHhhhhhhh....', '...hhhhhhhhhh...', '..hhhhhhhhhhh...', '..hhhhhhhhhh....', '...hhhhhhhh.....', '....hhhhh.......', '................', '................', '................', '................', '................'],
  dust: ['................', '................', '................', '................', '......h.........', '....hhh..h......', '...hhHhhhhh.....', '..hhhhhhhhhh....', '..hhhhhhhhhhh...', '...hhhhhhhhh....', '................', '................', '................', '................', '................', '................'],
  meat: ['................', '................', '.....hhhhh......', '....hHHHhhh.....', '...hHHhhhhhh....', '...hhhhhhhhhh...', '...hhhhhhhhhhw..', '....hhhhhhhhww..', '.....hhhhhhww...', '........www.....', '................', '................', '................', '................', '................', '................'],
  apple: ['................', '.......s........', '.......sl.......', '....hhhshhh.....', '...hHHhhhhhh....', '..hHHhhhhhhhh...', '..hHhhhhhhhhh...', '..hhhhhhhhhhh...', '..hhhhhhhhhhh...', '...hhhhhhhhh....', '....hhh.hhh.....', '................', '................', '................', '................', '................'],
  feather: ['................', '...........hh...', '..........hHh...', '.........hHh....', '........hHhh....', '.......hHhh.....', '......hHhh......', '.....hHhh.......', '....hHhh........', '...hhhh.........', '...s............', '..s.............', '................', '................', '................', '................'],
  string: ['................', '..........hh....', '.........h..h...', '........h.......', '.......h........', '......h.........', '.....h..........', '....hh..........', '...h..h.........', '..h....h........', '........h.......', '.........hh.....', '................', '................', '................', '................'],
  bone: ['................', '..hh............', '.hHhh...........', '..hHhh..........', '...hHhh.........', '....hHhh........', '.....hHhh.......', '......hHhh......', '.......hHhh.....', '........hHhh....', '.........hhHh...', '..........hhh...', '...........h....', '................', '................', '................'],
  arrow: ['................', '...........hhh..', '............hh..', '...........s.h..', '..........s.....', '.........s......', '........s.......', '.......s........', '......s.........', '.....s..........', '..ff............', '..ff............', '.ff.............', '................', '................', '................'],
  pearl: ['................', '................', '................', '.....hhhhh......', '....hHHhhhh.....', '...hHHhhhhhh....', '...hHhhhhhhh....', '...hhhhhhhhh....', '...hhhhhhhhh....', '....hhhhhhh.....', '.....hhhhh......', '................', '................', '................', '................', '................'],
  bucket: ['................', '................', '...hhhhhhhhhh...', '..h..........h..', '..hwwwwwwwwwwh..', '..hHwwwwwwwwhh..', '...hHhhhhhhhh...', '...hHhhhhhhhh...', '...hhhhhhhhhh...', '....hhhhhhhh....', '....hhhhhhhh....', '.....hhhhhh.....', '................', '................', '................', '................'],
  bow: ['................', '.........sss....', '.......ss..w....', '......s....w....', '.....s.....w....', '....s......w....', '....s......w....', '...s.......w....', '...s.......w....', '....s......w....', '....s......w....', '.....s.....w....', '......s....w....', '.......ss..w....', '.........sss....', '................'],
  hoe: ['................', '....hhhhhh......', '...hhhhhhss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '.........ss.....', '................', '................'],
  seeds: ['................', '................', '................', '................', '.....h....h.....', '...h...hH....h..', '......H...h.....', '..h..h...H...h..', '....H..h....h...', '...h....H..h....', '.....h.h...H....', '...H.....h......', '.......h...h....', '................', '................', '................'],
  wheat: ['................', '..........h.h...', '.........hHh....', '........hHhh.h..', '.......hHhhhh...', '......hHhhh.....', '.....hhhh.......', '....shh.........', '...ss...........', '..ss............', '.ss.............', 'ss..............', '................', '................', '................', '................'],
  bread: ['................', '................', '................', '................', '....hhhhhhhh....', '..hhHHhHHhHHhh..', '.hHHhhHhhHhhHHh.', '.hhhhhhhhhhhhhh.', '.hhhhhhhhhhhhhh.', '.wwwwwwwwwwwwww.', '..wwwwwwwwwwww..', '................', '................', '................', '................', '................'],
  door: ['................', '....wwwwwwww....', '....whhhhhhw....', '....wh.hh.hw....', '....wh.hh.hw....', '....whhhhhhw....', '....whhhhhhw....', '....whhhhhhw....', '....whhhhhhw....', '....whhhhhww....', '....whhhhhhw....', '....whhhhhhw....', '....whhhhhhw....', '....whhhhhhw....', '....wwwwwwww....', '................'],
  bed: ['................', '................', '................', '................', '................', '.........hhhhhh.', '.wwww...hhhhhhhh', 'swwwwhhhhhhhhhhs', 'shhhhhhhhhhhhhhs', 'ssssssssssssssss', 's..............s', 's..............s', '................', '................', '................', '................'],
  helmet: ['................', '................', '................', '....hhhhhhhh....', '...hHHHHHHHhh...', '...hHhhhhhhhh...', '...hh......hh...', '...hh......hh...', '...hh......hh...', '................', '................', '................', '................', '................', '................', '................'],
  chestplate: ['................', '..hhh....hhh....', '.hHHhh..hhhhh...', '.hHhhhhhhhhhh...', '.hhhhhhhhhhhh...', '..hhhHhhhhhh....', '...hhHhhhhh.....', '...hhhhhhhh.....', '...hhhhhhhh.....', '...hhhhhhhh.....', '...hhhhhhhh.....', '...hhhhhhhh.....', '................', '................', '................', '................'],
  leggings: ['................', '...hhhhhhhhh....', '...hHHHHHHHh....', '...hHhhhhhhh....', '...hhhh.hhhh....', '...hhh...hhh....', '...hhh...hhh....', '...hhh...hhh....', '...hhh...hhh....', '...hhh...hhh....', '...hhh...hhh....', '...hhh...hhh....', '................', '................', '................', '................'],
  boots: ['................', '................', '................', '................', '................', '...hhh...hhh....', '...hHh...hHh....', '...hhh...hhh....', '...hhh...hhh....', '..hhhh..hhhh....', '.hhhhh.hhhhh....', '.hhhhh.hhhhh....', '................', '................', '................', '................'],
  carrot: ['................', '...........ss...', '..........ss.s..', '.........sssss..', '........hhss....', '.......hHhh.....', '......hHhh......', '.....hhhh.......', '....hhhh........', '...hhhh.........', '..hhh...........', '.hh.............', '................', '................', '................', '................'],
  shears: ['................', '................', '..ss.......ss...', '..s.s.....s.s...', '..ss.s...s.ss...', '.....shh.s......', '.......hh.......', '......hHhh......', '.....hh..hh.....', '....hh....hh....', '...hh......hh...', '..hh........h...', '................', '................', '................', '................'],
  paper: ['................', '................', '...hhhhhhhhh....', '...hHHHHHHHh....', '...hhhhhhhhh....', '...hssssssh.....', '...hhhhhhhhh....', '...hssssssh.....', '...hhhhhhhhh....', '...hsssssh......', '...hhhhhhhhh....', '...hhhhhhhhh....', '................', '................', '................', '................'],
  book: ['................', '................', '....hhhhhhhh....', '...hHHHHHHHhw...', '...hhhhhhhhhw...', '...hhhhhhhhhw...', '...hhwwwwhhhw...', '...hhhhhhhhhw...', '...hhhhhhhhhw...', '...hhhhhhhhhw...', '...hhhhhhhhhw...', '...hhhhhhhhw....', '................', '................', '................', '................'],
  potato: ['................', '................', '................', '................', '.....hhhhh......', '....hHHhhhh.....', '...hHhhhshhh....', '...hhhhhhhhhh...', '...hhshhhhhhh...', '....hhhhhhshh...', '....hhhhhhhhh...', '.....hhhhhhh....', '.......hhh......', '................', '................', '................'],
  beetroot: ['................', '.......s.s......', '......s.s.s.....', '.......sss......', '........s.......', '.....hhhhhh.....', '....hHHhhhhh....', '....hHhhhhhh....', '....hhhhhhhh....', '.....hhhhhh.....', '......hhhh......', '.......hh.......', '.......h........', '................', '................', '................'],
  bowl: ['................', '................', '................', '................', '................', '................', '..hwwwwwwwwwwh..', '..hHwwwwwwwwwh..', '..hHhhhhhhhhhh..', '...hHhhhhhhhh...', '....hhhhhhhh....', '.....hhhhhh.....', '................', '................', '................', '................'],
  igniter: ['................', '................', '...ssss.........', '..ss..ss........', '..s....s........', '..s....s........', '..ss..ss........', '...sssshh.......', '........hh......', '........hHh.....', '.........hHhh...', '..........hhhh..', '...........hhh..', '................', '................', '................'],
  egg: ['................', '................', '......hhh.......', '.....hHhhh......', '....hHhhhhh.....', '....hhhhhhh.....', '...hhhhhhhhh....', '...hhhhhhhhh....', '...hhhhhhhhh....', '....hhhhhhh.....', '.....hhhhh......', '................', '................', '................', '................', '................'],
};

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lighten(h, f) { const [r, g, b] = hexToRgb(h); return `rgb(${Math.min(255, r * f)},${Math.min(255, g * f)},${Math.min(255, b * f)})`; }

const ITEM_STYLE = {
  stick: ['stick', { s: '#7a5a32' }],
  coal: ['lump', { h: '#2a2a2a' }],
  raw_iron: ['lump', { h: '#c9a07e' }], raw_gold: ['lump', { h: '#e8c23a' }], raw_copper: ['lump', { h: '#d27a50' }],
  iron_ingot: ['ingot', { h: '#cfcfcf' }], gold_ingot: ['ingot', { h: '#f1cc3a' }], copper_ingot: ['ingot', { h: '#e07a4f' }],
  cinnabar: ['dust', { h: '#d22a32' }], azurite: ['gem', { h: '#2a55d0' }], diamond: ['gem', { h: '#5fe6dc' }], beryl: ['gem', { h: '#2ecf5a' }],
  flint: ['lump', { h: '#4a4a4e' }], clay_ball: ['lump', { h: '#a0a6b4' }], leather: ['meat', { h: '#9a5a2a', w: '#7a4a2a' }],
  feather: ['feather', { h: '#f0f0f0', s: '#cfcfcf' }], string: ['string', { h: '#eeeeee' }], bone: ['bone', { h: '#e8e4d0' }],
  arrow: ['arrow', { h: '#9a9a9a', s: '#7a5a32', f: '#f0f0f0' }], gunpowder: ['dust', { h: '#5a5a5a' }],
  void_pearl: ['pearl', { h: '#1e6b6b' }], egg: ['egg', { h: '#efe3c8' }],
  raw_pork: ['meat', { h: '#f19a9a', w: '#fff0f0' }], cooked_pork: ['meat', { h: '#c8824a', w: '#f0d8b0' }],
  raw_beef: ['meat', { h: '#c83a3a', w: '#f0e0e0' }], steak: ['meat', { h: '#7a4a2a', w: '#c8a080' }],
  raw_chicken: ['meat', { h: '#f4cdb0', w: '#fff8f0' }], cooked_chicken: ['meat', { h: '#d29a5a', w: '#f6e0c0' }],
  raw_mutton: ['meat', { h: '#d8504a', w: '#f6e6e0' }], cooked_mutton: ['meat', { h: '#a0582e', w: '#e0c0a0' }],
  rotten_flesh: ['meat', { h: '#8a6a3a', w: '#6a8a3a' }], spider_eye: ['egg', { h: '#a01a2a' }],
  apple: ['apple', { h: '#d42a2a', s: '#5a3a1a', l: '#3a8a2a' }],
  bucket: ['bucket', { h: '#b8b8b8', w: '#b8b8b8' }], water_bucket: ['bucket', { h: '#b8b8b8', w: '#3a6ad8' }], lava_bucket: ['bucket', { h: '#b8b8b8', w: '#ff7a1a' }],
  bow: ['bow', { s: '#7a5a32', w: '#dddddd' }],
  bed: ['bed', { h: '#b02a2a', w: '#e8e6e0', s: '#7a5530' }],
  oak_door: ['door', { h: '#9c7444', H: '#b88a55', w: '#5a3d1e' }],
  wheat_seeds: ['seeds', { h: '#3e8a24', H: '#2a6a18' }], wheat: ['wheat', { h: '#d6ac44', H: '#f0d070', s: '#a88a30' }],
  bone_meal: ['dust', { h: '#f2f0e8' }],
  melon_slice: ['meat', { h: '#e84a3a', w: '#4a9a2a' }], pumpkin_pie: ['bread', { h: '#d8801e', H: '#f0a040', w: '#8a5426' }],
  paper: ['paper', { h: '#f4f0e4', H: '#ffffff', s: '#c8c0b0' }], book: ['book', { h: '#8a4a2a', H: '#a8603a', w: '#f0eadc' }],
  brick: ['ingot', { h: '#b25a3e' }],
  carrot: ['carrot', { h: '#e8862a', H: '#ffb060', s: '#3f9a2a' }],
  potato: ['potato', { h: '#c8a25a', H: '#e0c080', s: '#8a6a3a' }], baked_potato: ['potato', { h: '#d89a3a', H: '#f6d080', s: '#7a4a1e' }],
  poisonous_potato: ['potato', { h: '#a8b04a', H: '#c8d070', s: '#5a6a2a' }],
  beetroot: ['beetroot', { h: '#9a1e30', H: '#c8304a', s: '#3f8a2a' }], beetroot_seeds: ['seeds', { h: '#c8b08a', H: '#a08860' }],
  bowl: ['bowl', { h: '#8a6034', H: '#a87a48', w: '#8a6034' }], beetroot_soup: ['bowl', { h: '#8a6034', H: '#a87a48', w: '#b0203a' }],
  shears: ['shears', { h: '#d8d8d8', s: '#6a4a2a' }],
  flint_and_steel: ['igniter', { s: '#9a9a9a', h: '#4a4a4e', H: '#6a6a70' }],
  bread: ['bread', { h: '#b8783a', H: '#d89a50', w: '#8a5426' }],
};

function itemIcon(d) {
  let tpl, colors;
  if (d.tool) {
    tpl = T[d.tool.type];
    colors = { h: MATERIALS[d.tool.material].color, s: '#7a5a32' };
  } else if (d.woolColor) {
    return blockIcon(BLOCKS[d.places], WOOL_RGB[d.woolColor]);
  } else if (d.dye) {
    const [r, g, b] = COLORS[d.dye][2];
    tpl = T.dust; colors = { h: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('') };
  } else if (d.armor) {
    tpl = T[d.armor.piece];
    colors = { h: ARMOR_MATERIALS[d.armor.material].color };
  } else {
    const st = ITEM_STYLE[d.key] || ['lump', { h: '#ff00ff' }];
    tpl = T[st[0]]; colors = st[1];
  }
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const ctx = c.getContext('2d');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const ch = tpl[y][x];
    if (ch === '.') continue;
    let col;
    if (ch === 'H') col = lighten(colors.h, 1.35);
    else col = colors[ch] || colors.h;
    ctx.fillStyle = col;
    ctx.fillRect(x * 2, y * 2, 2, 2);
  }
  // dark outline pass
  const img = ctx.getImageData(0, 0, 32, 32);
  const out = ctx.createImageData(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4;
    if (img.data[i + 3]) { out.data.set(img.data.slice(i, i + 4), i); continue; }
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const xx = x + dx, yy = y + dy;
      return xx >= 0 && yy >= 0 && xx < 32 && yy < 32 && img.data[(yy * 32 + xx) * 4 + 3];
    });
    if (n) { out.data[i] = 20; out.data[i + 1] = 20; out.data[i + 2] = 20; out.data[i + 3] = 170; }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** Data URL icon for an item id */
export function iconURL(id) {
  if (cache.has(id)) return cache.get(id);
  const d = ITEMS[id];
  let url = '';
  if (d) {
    const canvas = d.block !== undefined ? blockIcon(BLOCKS[d.block]) : itemIcon(d);
    url = canvas.toDataURL();
  }
  cache.set(id, url);
  return url;
}

/** Canvas (16x16 texture-like) for 3D item rendering of non-block items. */
export function itemCanvas(id) {
  const d = ITEMS[id];
  if (!d) return null;
  return d.block !== undefined ? blockIcon(BLOCKS[d.block]) : itemIcon(d);
}

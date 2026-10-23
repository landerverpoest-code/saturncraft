// Inventory icons: isometric mini-cubes for blocks (from the block textures)
// and hand-drawn pixel templates for items.
import { BLOCKS, SHAPE } from '../world/blocks.js';
import { ITEMS, MATERIALS, ARMOR_MATERIALS } from '../world/items.js';
import { texturePixels } from '../world/textures.js';
import { COLORS, WOOL_RGB } from '../world/colors.js';
import { hasEnch, enchLines } from '../world/enchantments.js';
import { POTIONS } from '../world/potions.js';
import { EFFECTS, effectLabel, formatTicks } from '../player/effects.js';
import { TOOL_TEMPLATES, GEAR_TEMPLATES, paintTemplate, materialRamp, ramp, WOOD_HANDLE } from './toolArt.js';

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
  if (b.shape === SHAPE.TRAPDOOR) { ctx.drawImage(texCanvas(b.tex.side), 0, 0, 32, 32); return c; }
  if (b.shape === SHAPE.CIRCUIT && b.tex.top !== 'piston_top' && b.tex.top !== 'piston_top_sticky') return circuitIcon(ctx, c, b);
  if (b.shape === SHAPE.CROSS || b.shape === SHAPE.TORCH || b.shape === SHAPE.LADDER || b.shape === SHAPE.PANE || b.shape === SHAPE.PAD || b.flatIcon) {
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

/** Flat icons of the small circuit parts: lever, button, pressure plate, repeater. */
function circuitIcon(ctx, c, b) {
  const tex = (name, sx, sy, sw, sh, dx, dy, dw, dh) => ctx.drawImage(texCanvas(name), sx, sy, sw, sh, dx, dy, dw, dh);
  const outline = (x, y, w, h) => { ctx.strokeStyle = 'rgba(20,20,20,0.7)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); };
  if (b.name === 'Lever') {
    ctx.fillStyle = '#6a4a28';
    for (let k = 0; k < 9; k++) ctx.fillRect(14 + k, 22 - k * 2, 3, 3);
    ctx.fillStyle = '#a8845a'; ctx.fillRect(22, 4, 4, 4);
    tex('cobblestone', 0, 0, 16, 6, 6, 20, 20, 8); outline(6, 20, 20, 8);
  } else if (b.name === 'Stone Button') {
    tex('stone', 0, 0, 12, 8, 7, 11, 18, 10); outline(7, 11, 18, 10);
  } else if (b.name === 'Wooden Pressure Plate') {
    tex('oak_planks', 0, 0, 16, 4, 2, 18, 28, 7); outline(2, 18, 28, 7);
  } else {
    tex('repeater', 0, 0, 16, 16, 2, 2, 28, 28); outline(2, 2, 28, 28);
    ctx.fillStyle = '#e02a18'; ctx.fillRect(14, 4, 4, 4); ctx.fillRect(14, 18, 4, 4);
  }
  return c;
}

// 16x16 templates. '.' = transparent; other chars mapped per item.
const T = {
  horn: ['................', '................', '..........ss....', '.........sHHs...', '........shhhs...', '.......shhhs....', '......shhhs.....', '.....shhhs......', '....shhhs.......', '...shhhs........', '..shhhs.........', '..sHhs..........', '...ss...........', '................', '................', '................'],
  map: ['................', '.eeeeeeeeeeeeee.', '.eppppppppppppe.', '.epgggpppwwwwpe.', '.eggggggpwwwwwe.', '.epggggggpwwwpe.', '.eppgggggppwwpe.', '.epppggggggpppe.', '.eppwwpggggggpe.', '.epwwwwpgggggpe.', '.ewwwwwppggggge.', '.epwwwppppgggpe.', '.eppppppppppppe.', '.eeeeeeeeeeeeee.', '................', '................'],
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
  pearl: ['................', '................', '................', '.....hhhhh......', '....hHHhhhh.....', '...hHHhhhhhh....', '...hHhhhhhhh....', '...hhhhhhhhh....', '...hhhhhhhhh....', '....hhhhhhh.....', '.....hhhhh......', '................', '................', '................', '................', '................'],
  bucket: ['................', '................', '...hhhhhhhhhh...', '..h..........h..', '..hwwwwwwwwwwh..', '..hHwwwwwwwwhh..', '...hHhhhhhhhh...', '...hHhhhhhhhh...', '...hhhhhhhhhh...', '....hhhhhhhh....', '....hhhhhhhh....', '.....hhhhhh.....', '................', '................', '................', '................'],
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
  paper: ['................', '................', '...hhhhhhhhh....', '...hHHHHHHHh....', '...hhhhhhhhh....', '...hssssssh.....', '...hhhhhhhhh....', '...hssssssh.....', '...hhhhhhhhh....', '...hsssssh......', '...hhhhhhhhh....', '...hhhhhhhhh....', '................', '................', '................', '................'],
  book: ['................', '................', '....hhhhhhhh....', '...hHHHHHHHhw...', '...hhhhhhhhhw...', '...hhhhhhhhhw...', '...hhwwwwhhhw...', '...hhhhhhhhhw...', '...hhhhhhhhhw...', '...hhhhhhhhhw...', '...hhhhhhhhhw...', '...hhhhhhhhw....', '................', '................', '................', '................'],
  sign: ['................', '................', '..ssssssssssss..', '..sHHHHHHHHHHs..', '..shhhhhhhhhhs..', '..sHHHHHHHHHHs..', '..shhhhhhhhhhs..', '..sHHHHHHHHHHs..', '..ssssssssssss..', '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......', '................', '................'],
  frame: ['................', '................', '.ssssssssssssss.', '.shhhhhhhhhwwhs.', '.shhhhhhhhhwwhs.', '.shhhhhhhhhhhhs.', '.shhhhhhHHhhhhs.', '.shhhhhHHHHhhhs.', '.shhhhHHHHHHhhs.', '.shhhHHHHHHHHhs.', '.sHHHHHHHHHHHHs.', '.sHHHHHHHHHHHHs.', '.ssssssssssssss.', '................', '................', '................'],
  saddle: ['................', '................', '................', '.....hhhhhh.....', '...hhHHHHHHhh...', '..hHHhhhhhhHHh..', '..hhhhhhhhhhhh..', '...hhhhhhhhhh...', '....s......s....', '....s......s....', '...sss....sss...', '................', '................', '................', '................', '................'],
  shield: ['................', '..ssssssssssss..', '..shhhHhhhhhhs..', '..shhhHhhhhhhs..', '..shhhHhhhhhhs..', '..sHHHHHHHHHHs..', '..shhhHhhhhhhs..', '..shhhHhhhhhhs..', '..shhhHhhhhhhs..', '...shhHhhhhhs...', '...shhHhhhhhs...', '....shHhhhhs....', '.....shHhhs.....', '......ssss......', '................', '................'],
  cart: ['................', '................', '................', '................', '.hhhhhhhhhhhhhh.', '.hHHHHHHHHHHHHh.', '.hHhhhhhhhhhhHh.', '.hHhhhhhhhhhhHh.', '..hhhhhhhhhhhh..', '..hhhhhhhhhhhh..', '...hhhhhhhhhh...', '...ss......ss...', '..ssss....ssss..', '...ss......ss...', '................', '................'],
  fish: ['................', '................', '................', '................', '..........ss....', '...hhhhhhh.s....', '..hHHHHHhhhs.s..', '.hHsHhhhhhhhss..', '.hhhhhhhhhhhss..', '..hhhhhhhhhs.s..', '...hhhhhhh.s....', '..........ss....', '................', '................', '................', '................'],
  rod: ['................', '..............ss', '.............s.w', '............s..w', '...........s...w', '..........s....w', '.........s.....w', '........s......w', '.......s.......w', '......s........h', '.....s.........h', '....s...........', '...s............', '..s.............', '.s..............', '................'],
  potato: ['................', '................', '................', '................', '.....hhhhh......', '....hHHhhhh.....', '...hHhhhshhh....', '...hhhhhhhhhh...', '...hhshhhhhhh...', '....hhhhhhshh...', '....hhhhhhhhh...', '.....hhhhhhh....', '.......hhh......', '................', '................', '................'],
  beetroot: ['................', '.......s.s......', '......s.s.s.....', '.......sss......', '........s.......', '.....hhhhhh.....', '....hHHhhhhh....', '....hHhhhhhh....', '....hhhhhhhh....', '.....hhhhhh.....', '......hhhh......', '.......hh.......', '.......h........', '................', '................', '................'],
  bowl: ['................', '................', '................', '................', '................', '................', '..hwwwwwwwwwwh..', '..hHwwwwwwwwwh..', '..hHhhhhhhhhhh..', '...hHhhhhhhhh...', '....hhhhhhhh....', '.....hhhhhh.....', '................', '................', '................', '................'],
  vial: ['................', '......ssss......', '......sSss......', '.......gg.......', '.......gg.......', '......gwwg......', '.....gwwwwg.....', '....ghhhhhhg....', '...ghHHhhhhhg...', '...ghHhhhhhhg...', '...ghhhhhhhhg...', '...ghhhhhhhhg...', '....ghhhhhhg....', '.....gggggg.....', '................', '................'],
  splash: ['................', '........ss......', '.......ssS......', '.......gg.......', '......gwwg......', '.....gwwwwg.....', '....ghhhhhhg....', '...ghHHhhhhhg...', '...ghHhhhhhhgg..', '...ghhhhhhhhg.g.', '...ghhhhhhhhg.g.', '....ghhhhhhgg...', '.....gggggg.....', '................', '................', '................'],
  nugget: ['................', '................', '................', '................', '................', '.....hh.........', '....hHhh........', '....hhhh..hh....', '.....hh..hHhh...', '.........hhhh...', '..........hh....', '................', '................', '................', '................', '................'],
  root: ['................', '.........s......', '........s.s.....', '.......s...s....', '.......s........', '......hhh.......', '.....hHhhh......', '....hHhhhhh.....', '....hhhhhhhh....', '.....hhhhhhh....', '......hhhhh.....', '.......hhh.s....', '......s.h...s...', '.....s...s......', '................', '................'],
  tear: ['................', '................', '.......h........', '.......h........', '......hhh.......', '......hHh.......', '.....hHhhh......', '.....hHhhh......', '....hhhhhhh.....', '....hhhhhhh.....', '....hhhhhhh.....', '.....hhhhh......', '......hhh.......', '................', '................', '................'],
  alembic: ['................', '.......rr.......', '.......rR.......', '..iiiiiiiiiiii..', '..v....rr....v..', '.vwv...rr...vwv.', '.vhv...rr...vhv.', '.vhv...rr...vhv.', '..v....rr....v..', '.......rr.......', '.......rr.......', '....cccccccc....', '...cCccccccCcc..', '...cccccccccc...', '................', '................'],
  shard: ['................', '...........s....', '..........sHs...', '.........sHhs...', '........sHhhs...', '.......sHhhs....', '......sHhhs.....', '.....sHhhs......', '....sHhhs.......', '...shhhs........', '...shhs.........', '....ss..........', '................', '................', '................', '................'],
  boat: ['................', '................', '................', '................', '..........ww....', '.........ww.....', '........ww......', '.s.....ww.....s.', '.ssssssssssssss.', '.sHHHHHHHHHHHHs.', '..shhhhhhhhhhs..', '..shhhhhhhhhhs..', '...ssssssssss...', '................', '................', '................'],
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
  feather: ['feather', { h: '#f0f0f0', s: '#cfcfcf' }], string: ['string', { h: '#eeeeee' }], bone: ['bone', { h: '#e8e4d0' }], gunpowder: ['dust', { h: '#5a5a5a' }],
  void_pearl: ['pearl', { h: '#1e6b6b' }], egg: ['egg', { h: '#efe3c8' }],
  snowball: ['pearl', { h: '#f4f8ff' }],
  raw_pork: ['meat', { h: '#f19a9a', w: '#fff0f0' }], cooked_pork: ['meat', { h: '#c8824a', w: '#f0d8b0' }],
  raw_beef: ['meat', { h: '#c83a3a', w: '#f0e0e0' }], steak: ['meat', { h: '#7a4a2a', w: '#c8a080' }],
  raw_chicken: ['meat', { h: '#f4cdb0', w: '#fff8f0' }], cooked_chicken: ['meat', { h: '#d29a5a', w: '#f6e0c0' }],
  raw_mutton: ['meat', { h: '#d8504a', w: '#f6e6e0' }], cooked_mutton: ['meat', { h: '#a0582e', w: '#e0c0a0' }],
  rotten_flesh: ['meat', { h: '#8a6a3a', w: '#6a8a3a' }], spider_eye: ['egg', { h: '#a01a2a' }],
  apple: ['apple', { h: '#d42a2a', s: '#5a3a1a', l: '#3a8a2a' }],
  bucket: ['bucket', { h: '#b8b8b8', w: '#b8b8b8' }], water_bucket: ['bucket', { h: '#b8b8b8', w: '#3a6ad8' }], lava_bucket: ['bucket', { h: '#b8b8b8', w: '#ff7a1a' }],
  oak_boat: ['boat', { h: '#9c7444', H: '#c09060', s: '#5a3d1e', w: '#7a5a32' }],
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
  bowl: ['bowl', { h: '#8a6034', H: '#a87a48', w: '#8a6034' }], beetroot_soup: ['bowl', { h: '#8a6034', H: '#a87a48', w: '#b0203a' }], mushroom_stew: ['bowl', { h: '#8a6034', H: '#a87a48', w: '#b08a5a' }],
  bread: ['bread', { h: '#b8783a', H: '#d89a50', w: '#8a5426' }],
};

// Tools, weapons and gear use the hand-shaded templates from toolArt.js.
const GEAR = {
  bow: ['bow', { wood: WOOD_HANDLE, str: ramp('#ecebe4'), acc: ramp('#5a4a3a') }],
  shears: ['shears', { head: ramp('#d4d4d8', { hiMix: 0.7 }), acc: ramp('#7a4a2a') }],
  flint_and_steel: ['igniter', { head: ramp('#a4a4ac', { hiMix: 0.65 }), acc: ramp('#4a4a50', { speckle: true }) }],
  arrow: ['arrow', { head: ramp('#8e8e96', { hiMix: 0.55 }), wood: WOOD_HANDLE, acc: ramp('#f2f2ee', { hiMix: 0.6 }) }],
};

const toolGridCache = new Map();
function toolGrid(t) {
  const key = t.type + ':' + t.material;
  if (!toolGridCache.has(key)) {
    const head = materialRamp(t.material, MATERIALS[t.material].color);
    // sword guard/pommel and tool bindings use a darker take on the material
    const acc = { ...head, hi: head.mid, mid: head.lo, lo: head.out, glint: head.hi };
    toolGridCache.set(key, paintTemplate(TOOL_TEMPLATES[t.type], { head, acc, wood: WOOD_HANDLE }));
  }
  return toolGridCache.get(key);
}

/** Draw a 16x16 colour grid onto a 32x32 canvas (2x2 per texel). */
function gridCanvas(grid) {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const ctx = c.getContext('2d');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = grid[y][x];
    if (!col) continue;
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    ctx.fillRect(x * 2, y * 2, 2, 2);
  }
  return c;
}

function itemIcon(d) {
  let tpl, colors;
  if (d.dial) { const c = document.createElement('canvas'); c.width = c.height = 32; drawDial(c, d.dial, 0, 1, 2); return c; }
  if (d.tool) return gridCanvas(toolGrid(d.tool));
  if (GEAR[d.key]) return gridCanvas(paintTemplate(GEAR_TEMPLATES[GEAR[d.key][0]], GEAR[d.key][1]));
  if (d.woolColor) {
    return blockIcon(BLOCKS[d.places], WOOL_RGB[d.woolColor]);
  } else if (d.dye) {
    const [r, g, b] = COLORS[d.dye][2];
    tpl = T.dust; colors = { h: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('') };
  } else if (d.armor && !d.iconStyle) {
    tpl = T[d.armor.piece];
    colors = { h: ARMOR_MATERIALS[d.armor.material].color };
  } else {
    const st = d.iconStyle || ITEM_STYLE[d.key] || ['lump', { h: '#ff00ff' }];
    tpl = Array.isArray(st[0]) ? st[0] : T[st[0]]; colors = st[1]; // a style may bring its own template
  }
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const ctx = c.getContext('2d');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const ch = tpl[y][x];
    if (ch === '.') continue;
    let col;
    if (ch === 'H') col = colors.H || (colors.h ? lighten(colors.h, 1.35) : colors.w);
    else if (ch === 'S') col = colors.S || (colors.s ? lighten(colors.s, 1.3) : null);
    else if (ch === 'w') col = colors.w || '#e8f0f8';
    else if (ch === 's' && !colors.s) col = '#9a6a3a'; // cork
    else col = colors[ch] || colors.h;
    if (!col) continue;
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

/**
 * Enchantment glint: a purple sheen with two diagonal light bands, drawn only
 * over the icon's opaque pixels (the canvas is modified in place).
 */
export function addGlint(c) {
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  const img = ctx.getImageData(0, 0, W, H), px = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (px[i + 3] < 40) continue;
    const d = ((x + y) / (W + H)) * 3; // bands along the diagonal
    const band = Math.max(0, 1 - Math.abs((d % 1) - 0.5) * 4);
    const k = 0.16 + band * 0.46;
    px[i] = px[i] * (1 - k) + 190 * k;
    px[i + 1] = px[i + 1] * (1 - k) + 90 * k;
    px[i + 2] = px[i + 2] * (1 - k) + 255 * k;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Data URL icon for an item id (with the enchantment glint when `glint`). */
export function iconURL(id, glint = false) {
  const key = glint ? id + ':g' : id;
  if (cache.has(key)) return cache.get(key);
  const d = ITEMS[id];
  let url = '';
  if (d) url = itemCanvas(id, glint).toDataURL();
  cache.set(key, url);
  return url;
}

/** Icon of a stack: enchanted stacks glint. */
export const stackIconURL = (st) => iconURL(st.id, hasEnch(st));

/** Inner HTML of a slot holding a stack: icon (+ animated glint), count and durability bar. */
export function stackHTML(st) {
  if (!st) return '';
  const d = ITEMS[st.id];
  const url = stackIconURL(st);
  let h = `<img src="${url}">`;
  if (hasEnch(st)) h += `<div class="glint-fx" style="-webkit-mask-image:url(${url});mask-image:url(${url})"></div>`;
  if (st.count > 1) h += `<span class="count">${st.count}</span>`;
  if (d && d.durability && st.damage > 0) {
    const f = 1 - st.damage / d.durability;
    h += `<div class="dura"><div style="width:${f * 100}%;background:hsl(${f * 120},90%,50%)"></div></div>`;
  }
  return h;
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Tooltip HTML: the item name (aqua when enchanted) and one line per enchantment. */
export function tooltipHTML(st, extra = '') {
  const d = ITEMS[st.id];
  if (!d) return '';
  const lines = enchLines(st);
  let h = `<div class="tt-name${lines.length ? ' ench' : ''}">${esc(d.name)}${esc(extra)}</div>`;
  for (const l of lines) h += `<div class="tt-ench">${esc(l)}</div>`;
  const dur = d.durability;
  if (dur && st.damage > 0) h += `<div class="tt-dura">Durability: ${dur - st.damage} / ${dur}</div>`;
  if (d.potion) {
    const fx = POTIONS[d.potion.kind].effects;
    if (!fx.length) h += '<div class="tt-dura">No Effects</div>';
    for (const [type, ticks, amp] of fx) {
      const good = EFFECTS[type].good;
      h += `<div class="${good ? 'tt-good' : 'tt-bad'}">${esc(effectLabel(type, amp))}${EFFECTS[type].instant ? '' : ` (${formatTicks(ticks)})`}</div>`;
    }
    if (d.potion.splash) h += '<div class="tt-dura">Thrown: affects all within 4 blocks</div>';
  }
  if (Array.isArray(st.contents)) {
    // a Gloomshell Box lists the first few things it carries (reference: shulker box tooltip)
    const held = st.contents.filter(Boolean);
    for (const s of held.slice(0, 5)) h += `<div class="tt-dura">${esc(ITEMS[s.id] ? ITEMS[s.id].name : '?')} x${s.count}</div>`;
    if (held.length > 5) h += `<div class="tt-dura">and ${held.length - 5} more...</div>`;
  }
  return h;
}

/** Canvas (16x16 texture-like) for 3D item rendering of non-block items. */
/**
 * Compass / clock face (32x32 canvas). Compass: `a` is the needle angle
 * (0 = up). Clock: `light` is the sky brightness (0..1) and `suns` how many
 * of the three suns are up.
 */
export function drawDial(c, kind, a, light, suns) {
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 32, 32);
  ctx.imageSmoothingEnabled = false;
  const rim = kind === 'clock' ? ['#c8a020', '#f2d24b'] : ['#6a6a72', '#b8b8c0'];
  const P = (x, y, col) => { ctx.fillStyle = col; ctx.fillRect(x * 2, y * 2, 2, 2); };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const r = Math.hypot(x - 7.5, y - 7.5);
    if (r > 7.5) continue;
    if (r > 6.3) P(x, y, (x + y) % 3 ? rim[0] : rim[1]);
    else if (kind === 'clock') {
      const day = `rgb(${Math.round(70 + 150 * light)},${Math.round(110 + 120 * light)},${Math.round(200 + 40 * light)})`;
      P(x, y, y > 9 ? '#3a2a1a' : day); // a horizon line: ground below, sky above
    } else P(x, y, '#d8d4c8');
  }
  if (kind === 'clock') {
    for (let k = 0; k < suns; k++) { const sx = 4 + k * 4, sy = 6 - (k % 2); P(sx, sy, '#fff2a0'); P(sx + 1, sy, '#ffd040'); P(sx, sy + 1, '#ffd040'); P(sx + 1, sy + 1, '#ffb020'); }
    if (suns === 0) { P(6, 4, '#f0f0ff'); P(10, 6, '#f0f0ff'); P(4, 7, '#c8c8f0'); P(11, 3, '#c8c8f0'); }
    return;
  }
  // compass needle: red half points at the spawn
  for (let t = -5; t <= 5; t += 0.5) {
    const x = 7.5 + Math.sin(a) * t, y = 7.5 - Math.cos(a) * t;
    P(Math.round(x - 0.5), Math.round(y - 0.5), t > 0 ? '#d02a2a' : '#4a4a52');
  }
  P(7, 7, '#2a2a2a');
}

export function itemCanvas(id, glint = false) {
  const d = ITEMS[id];
  if (!d) return null;
  const c = d.block !== undefined ? (BLOCKS[d.block].iconStyle ? itemIcon({ iconStyle: BLOCKS[d.block].iconStyle }) : blockIcon(BLOCKS[d.block])) : itemIcon(d);
  return glint ? addGlint(c) : c;
}

// ---- status effect badges (HUD + inventory list) -------------------------------
const GLYPHS = {
  speed: '<path d="M4 5 L9 9 L4 13 M9 5 L14 9 L9 13" fill="none" stroke="#fff" stroke-width="2"/>',
  slow: '<path d="M14 5 L9 9 L14 13 M9 5 L4 9 L9 13" fill="none" stroke="#fff" stroke-width="2"/>',
  pick: '<path d="M3 6 Q9 1 15 6" fill="none" stroke="#fff" stroke-width="2"/><path d="M9 4 L9 15" stroke="#fff" stroke-width="2"/>',
  sword: '<path d="M13 3 L15 3 L15 5 L7 13 L5 11 Z" fill="#fff"/><path d="M4 10 L8 14 M3 15 L5 13" stroke="#fff" stroke-width="2"/>',
  brokensword: '<path d="M13 3 L15 3 L15 5 L12 8 L10 6 Z M9 9 L7 13 L5 11 Z" fill="#fff"/><path d="M4 10 L8 14 M3 15 L5 13" stroke="#fff" stroke-width="2"/>',
  heart: '<path d="M9 15 L3 9 Q1 6 3.5 4 Q6 2.5 9 5.5 Q12 2.5 14.5 4 Q17 6 15 9 Z" fill="#fff"/>',
  skull: '<path d="M4 9 Q4 3 9 3 Q14 3 14 9 L12 11 L12 14 L6 14 L6 11 Z" fill="#fff"/><rect x="6" y="7" width="2" height="2" fill="#000"/><rect x="10" y="7" width="2" height="2" fill="#000"/>',
  jump: '<path d="M9 2 L14 8 L11 8 L11 12 L7 12 L7 8 L4 8 Z" fill="#fff"/><rect x="3" y="14" width="12" height="2" fill="#fff"/>',
  drop: '<path d="M9 2 Q14 9 13 12 Q12 16 9 16 Q6 16 5 12 Q4 9 9 2 Z" fill="#fff"/>',
  flame: '<path d="M9 2 Q15 8 13 13 Q11 16 9 16 Q5 16 5 12 Q5 9 8 7 Q8 10 10 10 Q11 6 9 2 Z" fill="#fff"/>',
  bubble: '<circle cx="7" cy="10" r="3.5" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="12.5" cy="5.5" r="2.2" fill="none" stroke="#fff" stroke-width="1.5"/>',
  eye: '<path d="M2 9 Q9 2 16 9 Q9 16 2 9 Z" fill="#fff"/><circle cx="9" cy="9" r="2.5" fill="#000"/>',
  ghost: '<path d="M4 16 L4 8 Q4 3 9 3 Q14 3 14 8 L14 16 L12 14 L10.5 16 L9 14 L7.5 16 L6 14 Z" fill="#fff" fill-opacity=".8"/><rect x="6" y="7" width="2" height="2" fill="#000"/><rect x="10" y="7" width="2" height="2" fill="#000"/>',
  feather: '<path d="M14 2 Q6 4 5 13 L4 16 M5 13 Q12 12 14 2" fill="#fff" stroke="#fff" stroke-width="1"/>',
  food: '<rect x="4" y="7" width="10" height="8" rx="3" fill="#fff"/><rect x="6" y="3" width="6" height="4" fill="#fff"/>',
};
const effectIcons = new Map();
/** A round badge in the effect's colour with a white glyph (data URL). */
export function effectIconURL(name) {
  if (effectIcons.has(name)) return effectIcons.get(name);
  const d = EFFECTS[name] || { color: '#888', glyph: 'heart' };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8.4" fill="${d.color}" stroke="#000" stroke-width="1.2"/><circle cx="9" cy="9" r="7" fill="none" stroke="#fff" stroke-opacity=".25"/><g transform="translate(9 9) scale(.78) translate(-9 -9)">${GLYPHS[d.glyph] || ''}</g></svg>`;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  effectIcons.set(name, url);
  return url;
}

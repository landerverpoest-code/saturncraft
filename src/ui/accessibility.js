// Accessibility options: sound captions, reduced motion / flashing, and colour-blind friendly HUD
// palettes. Everything here is pure (no DOM), so game.js, hud.js and the tests share it.
import { chimeCaption } from '../world/chimes.js';

export const ACCESS_DEFAULTS = { captions: false, reduceMotion: false, reduceFlashing: false, colorBlind: 'off', highContrast: false, largeText: false };
export const COLOR_BLIND_MODES = ['off', 'redgreen', 'blueyellow'];
export const COLOR_BLIND_LABELS = { off: 'Off', redgreen: 'Red-green friendly', blueyellow: 'Blue-yellow friendly' };

/** Next mode when the button is clicked. */
export function nextColorBlind(mode) { return COLOR_BLIND_MODES[(Math.max(0, COLOR_BLIND_MODES.indexOf(mode)) + 1) % COLOR_BLIND_MODES.length]; }

// ---------------------------------------------------------------------------------------------
// Motion and flashing

/**
 * How much of each camera / screen effect to apply for the settings:
 * bob (walking head bob), tilt (the roll when hurt), sprintFov (the widening while sprinting),
 * apparitionShake (the Deepeye's trembling face), flash (lightning brightness cap, 1 = full);
 * and for the newer sky and particle effects:
 * twinkle (stars and firework sparks that blink: off with either setting), skyDrift (how fast the
 * Veilfire curtains move), streaks (falling stars and meteorite trails), sparks (how many sparks a
 * firework burst or meteorite impact throws, so fewer bright points appear in one frame), critters (how many butterflies, fireflies, leaves,
 * skimmers and birds are drawn, render/critters.js) and critterSpeed (how fast they move), sand (the
 * streaming grains of a dust storm).
 */
export function motionScales(settings) {
  const calm = !!(settings && settings.reduceMotion);
  const dim = !!(settings && settings.reduceFlashing);
  return {
    bob: calm ? 0 : 1, tilt: calm ? 0 : 1, sprintFov: calm ? 0 : 1, apparitionShake: calm ? 0 : 1, flash: dim ? 0.2 : 1,
    twinkle: calm || dim ? 0 : 1, skyDrift: calm ? 0.1 : 1, streaks: calm ? 0 : dim ? 0.4 : 1, sparks: dim ? 0.4 : 1, sand: calm ? 0.25 : 1,
    critters: calm ? 0.25 : 1, critterSpeed: calm ? 0.35 : 1,
  };
}

/** What a game without the setting gets (tests and fakes that carry no `fx`). */
export const FULL_FX = motionScales(null);
/** The effect scales of a game object: `game.fx` (kept up to date by Game.setSetting) or full effects. */
export function fxOf(game) { return (game && game.fx) || FULL_FX; }

/** `n` particles scaled by one of the motionScales (at least one while the scale is above zero). */
export function scaledCount(n, scale) { return scale <= 0 ? 0 : Math.max(1, Math.round(n * scale)); }

/**
 * The classes the page root carries for the settings (ui/style.css keys off these): `reduce-motion` stops
 * the CSS animations, `reduce-flash` calms the pulsing overlays, `high-contrast` and `large-text` restyle
 * the screens, `cb-redgreen` / `cb-blueyellow` mark the colour-blind mode. `osReduce`: the system asks for less motion.
 */
export const ACCESS_CLASSES = ['reduce-motion', 'reduce-flash', 'high-contrast', 'large-text', 'cb-redgreen', 'cb-blueyellow'];
export function accessClasses(settings, osReduce = false) {
  const s = settings || {};
  const out = [];
  if (s.reduceMotion || osReduce) out.push('reduce-motion');
  if (s.reduceFlashing) out.push('reduce-flash');
  if (s.highContrast) out.push('high-contrast');
  if (s.largeText) out.push('large-text');
  if (s.colorBlind && s.colorBlind !== 'off') out.push('cb-' + s.colorBlind);
  return out;
}

/**
 * A trade price against the usual one, with a cue that does not rely on colour: a mark, a short word, and the
 * sentence for the tooltip and screen readers. `cls` is the CSS class that also colours it.
 */
export function priceCue(now, base) {
  if (now < base) return { cls: 'discounted', mark: '▼', word: 'cheaper', text: `Cheaper than the usual ${base}` };
  if (now > base) return { cls: 'pricey', mark: '▲', word: 'dearer', text: `Dearer than the usual ${base}` };
  return { cls: '', mark: '', word: '', text: 'Usual price' };
}

// ---------------------------------------------------------------------------------------------
// Sound captions

/** What each synthesised sound is called in a caption (footsteps and block hits are left out, see prefixedCaption). */
export const CAPTION_TEXT = {
  pop: 'Item popped', eat: 'Eating', burp: 'Burp', hurt: 'Ouch', mob_hurt: 'Creature hurt', mob_death: 'Creature dies',
  squawk: 'Squawk', crack: 'Egg cracks', buzz: 'Buzzing', bleat: 'Bleating', ram: 'Ram charges', horn: 'Horn sounds',
  grunt: 'Grunt', oink: 'Oink', moo: 'Moo', baa: 'Baa', cluck: 'Cluck', rattle: 'Bones rattle', hiss: 'Hissing',
  skitter: 'Skittering', warble: 'Warbling', scream: 'Scream', teleport: 'Teleport', explode: 'Explosion', bow: 'Bow twangs',
  arrow_hit: 'Arrow hits', splash: 'Splash', bucket_fill: 'Bucket fills', fizz: 'Fizzing', click: 'Click',
  piston_out: 'Piston extends', piston_in: 'Piston retracts', burnout: 'Torch burns out', door_open: 'Door opens', door_close: 'Door closes',
  orb: 'Experience gained', enchant: 'Enchanting', anvil: 'Anvil rings', levelup: 'Level up', equip: 'Armor equipped', ignite: 'Fire lit',
  fire: 'Fire crackles', thunder: 'Thunder rumbles', lightning: 'Lightning strikes', mew: 'Mewing', squeak: 'Squeaking',
  strider: 'Dune Strider grumbles', hoverling: 'Hoverling twinkles', gust: 'Gust whooshes', neigh: 'Neigh', shield: 'Shield blocks',
  fuse: 'Fuse hisses', rail: 'Rail clacks', croak: 'Croak', squish: 'Squish', clank: 'Clank', howl: 'Howl', grind: 'Grinding',
  saw: 'Stonecutter saws', shear: 'Shears snip', hmm: 'Villager mutters', page: 'Pages turn', chest_open: 'Chest opens',
  chest_close: 'Chest closes', drink: 'Drinking', glass_break: 'Glass shatters', brew: 'Brewing', bubble: 'Bubbles', land: 'Landing',
  rocket: 'Rocket whooshes', rocket_burst: 'Rocket bursts', rocket_blast: 'Large rocket booms', rocket_twinkle: 'Sparks crackle', hush_sensor: 'Sensor trills', shriek: 'Shrieker screams',
  hush_heart: 'Heartbeat', hush_growl: 'Deep growl', hush_sniff: 'Sniffing', emerge: 'Something emerges', sonic_charge: 'Sonic charge builds',
  sonic_boom: 'Sonic boom', catalyst: 'Catalyst spreads',
  bird_trill: 'Birdsong', cricket: 'Crickets chirp', owl: 'Owl hoots', drip: 'Water drips', lava_pop: 'Lava bubbles', rift_moan: 'Deep rift moans',
  spear_throw: 'Spear thrown', spear_stick: 'Spear sticks', spear_return: 'Spear flies home', spear_surge: 'Surge rushes', stormcall: 'Stormcall crackles',
  breeze: 'Breeze sighs', meteor_boom: 'Meteorite booms', ember_snap: 'Embers snap', void_whisper: 'Void whispers',
  parry: 'Shield parries', shield_break: 'Shield knocked down',
  spore_puff: 'Spores puff', ash_hiss: 'Ash hisses', dirge_wail: 'Dirge wails',
  colossus_roar: 'Colossus roars', colossus_slam: 'Ground slams', colossus_erupt: 'Slag erupts',
  paddle: 'Boat paddles', mount_pant: 'Mount pants, tired', harness: 'Harness buckles', cart_fuel: 'Furnace cart roars',
  thistle: 'Thistlehorn lows', burrow: 'Dustmole scuffles in the sand', yowl: 'Gloamlynx yowls', plip: 'Tarnling plips',
};

/** Sounds that are only interface feedback when they have no place in the world. */
const UI_WHEN_UNPLACED = new Set(['click', 'pop', 'equip', 'page']);

/** Blocks: break_stone -> "Block broken", place_wood -> "Block placed". Footsteps and hits are not captioned. */
function prefixedCaption(name) {
  if (name.startsWith('break_')) return 'Block broken';
  if (name.startsWith('place_')) return 'Block placed';
  if (name.startsWith('chime_')) return chimeCaption(name) || 'Chime plays';
  if (name.startsWith('step_') || name.startsWith('hit_')) return null;
  return undefined;
}

/**
 * The caption for a sound name, or null when it should not be captioned. Unknown names still get a
 * readable caption made from the name ("sonic_hum" -> "Sonic hum"), so new sounds are never silent for
 * people who rely on captions.
 */
export function captionText(name, placed = true) {
  if (!name || typeof name !== 'string') return null;
  if (!placed && UI_WHEN_UNPLACED.has(name)) return null;
  const pre = prefixedCaption(name);
  if (pre !== undefined) return pre;
  if (Object.prototype.hasOwnProperty.call(CAPTION_TEXT, name)) return CAPTION_TEXT[name];
  const words = name.replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : null;
}

/**
 * Where a sound is relative to the listener ([x, y, z, yaw], yaw as in Audio.setListener):
 * 'here' (no position or very close), 'ahead', 'behind', 'left' or 'right', plus 'above' / 'below'
 * when it is mostly vertical. Forward is (-sin yaw, -cos yaw) and right is (cos yaw, -sin yaw).
 */
export function soundDirection(pos, listener) {
  if (!pos) return 'here';
  const [lx, ly, lz, yaw] = listener;
  const dx = pos[0] - lx, dy = pos[1] - ly, dz = pos[2] - lz;
  const flat = Math.hypot(dx, dz);
  if (Math.abs(dy) > 3 && Math.abs(dy) > flat) return dy > 0 ? 'above' : 'below';
  if (flat < 1.5) return 'here';
  const side = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const front = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
  const a = Math.atan2(side, front) * 180 / Math.PI; // 0 ahead, +90 right, +-180 behind
  if (Math.abs(a) <= 35) return 'ahead';
  if (Math.abs(a) >= 145) return 'behind';
  return a > 0 ? 'right' : 'left';
}

/** The arrows drawn on each side of the caption text. */
export const DIRECTION_MARKS = {
  here: ['', ''], ahead: ['▲ ', ''], behind: ['▼ ', ''], left: ['◀ ', ''], right: ['', ' ▶'], above: ['↑ ', ''], below: ['↓ ', ''],
};

/** Sounds beyond this many blocks cannot be heard (see Audio.spatial), so they are not captioned either. */
export const CAPTION_RANGE = 16;
export const CAPTION_MS = 3200;
export const CAPTION_MAX = 7;

/**
 * The list of captions currently on screen. add() takes the same arguments as Audio.play plus the
 * listener and a clock; entries for the same text merge (the newest direction wins) and fade out.
 */
export class CaptionLog {
  constructor() { this.items = []; this.version = 0; }

  add(name, pos, vol, listener, now) {
    const text = captionText(name, !!pos);
    if (!text) return null;
    if (pos) {
      const d = Math.hypot(pos[0] - listener[0], pos[1] - listener[1], pos[2] - listener[2]);
      if (Math.max(0, 1 - d / CAPTION_RANGE) * (vol ?? 1) <= 0.01) return null; // too quiet to hear
    }
    const dir = soundDirection(pos, listener);
    let item = this.items.find((c) => c.text === text);
    if (item) {
      item.dir = dir; item.at = now; item.count++;
      this.version++;
      return item;
    }
    item = { text, dir, at: now, count: 1 };
    this.items.push(item);
    if (this.items.length > CAPTION_MAX) this.items.shift();
    this.version++;
    return item;
  }

  /** Drop expired entries; true if something went away. */
  prune(now) {
    const n = this.items.length;
    this.items = this.items.filter((c) => now - c.at < CAPTION_MS);
    if (this.items.length !== n) { this.version++; return true; }
    return false;
  }

  /** What to draw: [{ text, dir, left, right, fade }], newest last; fade 1 -> 0 over the last second. */
  view(now) {
    return this.items.map((c) => {
      const [left, right] = DIRECTION_MARKS[c.dir] || ['', ''];
      return { text: c.text, dir: c.dir, left, right, fade: Math.max(0, Math.min(1, (CAPTION_MS - (now - c.at)) / 1000)) };
    });
  }

  clear() { if (this.items.length) { this.items = []; this.version++; } }
}

// ---------------------------------------------------------------------------------------------
// Colour-blind friendly HUD palettes

/**
 * Colours of the status bars. In the friendly modes the hues that clash are moved apart (poison
 * and hunger leave green), and `marks` adds a shape cue (a cross on poisoned hearts and rotten
 * food) so colour is never the only signal.
 */
export const HUD_PALETTES = {
  off: {
    heart: '#e3263a', heartShine: '#ffb3b3', heartEmpty: '#2a1414', poison: '#7a9a2a', gold: '#f2c23a', goldShine: '#fff4b0',
    food: '#d88a2a', foodTop: '#f2d48a', foodShine: '#ffd27a', foodEmpty: '#2a2214', hunger: '#6a8a2a', hungerTop: '#9aba5a',
    air: '#4a8ae8', airEdge: '#0a1a4a', airShine: '#e6f2ff', marks: false,
  },
  // protanopia / deuteranopia: red-green confusion. Hearts become magenta-pink, poison yellow, hunger blue.
  redgreen: {
    heart: '#d6336c', heartShine: '#ffd0e0', heartEmpty: '#2a1420', poison: '#f0e442', gold: '#e69f00', goldShine: '#fff0c0',
    food: '#e69f00', foodTop: '#f7d98a', foodShine: '#ffe8aa', foodEmpty: '#2a2214', hunger: '#56b4e9', hungerTop: '#a8dcf8',
    air: '#2f6fe0', airEdge: '#0a1a4a', airShine: '#e6f2ff', marks: true,
  },
  // tritanopia: blue-green and yellow-pink confusion. Air turns white-cyan, gold turns orange, poison stays green with a cross.
  blueyellow: {
    heart: '#e3263a', heartShine: '#ffb3b3', heartEmpty: '#2a1414', poison: '#33a02c', gold: '#ff8c1a', goldShine: '#ffd9a8',
    food: '#c8742a', foodTop: '#e8b98a', foodShine: '#ffd0a0', foodEmpty: '#2a2214', hunger: '#7f5ab0', hungerTop: '#b49ad6',
    air: '#f4fbff', airEdge: '#14507a', airShine: '#ffffff', marks: true,
  },
};

export function hudPalette(mode) { return HUD_PALETTES[mode] || HUD_PALETTES.off; }

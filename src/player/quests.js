// Quests: the Bounty Board's daily bounties and the Village Elders' story chains. Everything here is plain data and
// arithmetic (no game, no DOM), so it is unit-tested and works the same on a host, a guest and a single player.
//
//  * Bounties: a board offers 3 bounties a day, generated from the world seed, the day number and the village the board
//    belongs to (generateBounties), so every machine - and every visit - sees the same notices. Kinds: gather, slay,
//    deliver (to another village's board), explore (find a structure), cook, cross (a stretch of a biome), trade, craft.
//    A group (a team, or everybody without one) accepts bounties into a shared list; progress counts for the whole
//    group with each player's contribution credited by name; the group turns it in at a board for the reward.
//  * Story chains: three handcrafted chains of 3-4 steps given by village elders (CHAINS), personal to each player.
//  * The QuestBus: a tiny event bus the game's systems emit onto ('kill', 'pickup', 'craft', 'cook', 'trade',
//    'explore', 'cross'); player/questSystem.js subscribes and feeds the QuestLog.
import { mulberry32, hash4 } from '../world/noise.js';
import { I, ITEMS, CHARTS } from '../world/items.js';
import { B, BLOCKS } from '../world/blocks.js';
import { BIOMES } from '../world/biomes.js';
import { LANDMARK_BY_KEY } from '../world/landmarkKinds.js';
import { DISH_IDS } from '../world/cooking.js';
import { MOBS } from '../mobs/mobTypes.js';
import { cleanEnch, cleanLabel } from '../world/enchantments.js';

export const DAY_TICKS = 24000;
export const BOUNTIES_PER_BOARD = 3;
export const MAX_ACTIVE = 6;          // bounties a group can have accepted at once
export const MAX_PLAYERS_SEEN = 12;   // contributions kept per bounty
export const COMMONS = '*';           // the group of everybody who is not in a team
export const KINDS = ['gather', 'slay', 'deliver', 'explore', 'cook', 'cross', 'trade', 'craft'];
export const dayOf = (ticks) => Math.max(0, Math.floor((+ticks || 0) / DAY_TICKS));
const lower = (s) => String(s || '').trim().toLowerCase();
export const nameKey = lower;

// ---- the event bus ---------------------------------------------------------------------------------------------
export class QuestBus {
  constructor() { this.handlers = new Map(); }
  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(fn); return () => this.off(type, fn); }
  off(type, fn) { const l = this.handlers.get(type); if (l) this.handlers.set(type, l.filter((f) => f !== fn)); }
  emit(type, payload) {
    for (const fn of this.handlers.get(type) || []) fn(payload);
    for (const fn of this.handlers.get('*') || []) fn(type, payload);
  }
}

// ---- names ------------------------------------------------------------------------------------------------------
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const PART_A = ['Oak', 'Bram', 'Wil', 'Ash', 'Fen', 'Har', 'Lin', 'Mor', 'Thorn', 'Wick', 'Elm', 'Stone', 'Rook', 'Dun', 'Cob', 'Mill', 'Sedge', 'Brin'];
const PART_B = ['haven', 'ford', 'stead', 'wick', 'holm', 'brook', 'moor', 'gate', 'field', 'mere', 'hollow', 'cross', 'ton', 'rest'];
const ELDERS = ['Maren', 'Orsolya', 'Tamsin', 'Brann', 'Ysolde', 'Corwen', 'Halric', 'Idony', 'Perrin', 'Sorrel', 'Wystan', 'Aldith'];
/** A village's name, made up from its key ("cx,cz"). */
export function villageName(key) {
  const h = hash4(hashStr(String(key)), 11, 7, 3);
  return PART_A[h % PART_A.length] + PART_B[(h >>> 8) % PART_B.length];
}
/** The name of the elder who gives out a village's tales. */
export function elderName(key) { return ELDERS[hash4(hashStr(String(key)), 5, 9, 1) % ELDERS.length]; }
export const parseKey = (key) => { const [x, z] = String(key).split(',').map(Number); return { x: x | 0, z: z | 0 }; };

const idOf = (key) => (I[key] !== undefined ? I[key] : B[key]);
export const nameOfId = (id) => { const d = ITEMS[id] || BLOCKS[id]; return d && d.name ? d.name : 'item'; };
const mobName = (t) => (MOBS[t] && MOBS[t].name) || String(t);
const biomeName = (k) => { const b = BIOMES.find((x) => x.key === k); return b ? b.name : String(k); };
const dishName = (id) => nameOfId(id);
const plural = (name, n) => (n === 1 || /s$/i.test(name) ? name : name + 's');

// ---- what a bounty can ask for -----------------------------------------------------------------------------------
// [item key, min, max]
const GATHER = [['COAL', 12, 28], ['IRON_INGOT', 6, 14], ['WHEAT', 12, 30], ['BONE', 6, 16], ['STRING', 8, 18], ['LEATHER', 4, 10], ['CARROT', 10, 22], ['POTATO', 10, 22], ['OAK_LOG', 16, 36], ['COBBLESTONE', 32, 64], ['FEATHER', 8, 18], ['SWEET_BERRIES', 8, 18], ['GOLD_INGOT', 3, 8], ['FLINT', 4, 10], ['SLIMEBALL', 3, 8]];
const SLAY = [['shambler', 4, 10], ['rattler', 4, 9], ['skitterer', 3, 8], ['fizzler', 2, 6], ['marauder', 2, 5], ['wobbler', 3, 8]];
const CRAFT = [['BREAD', 3, 9], ['TORCH', 8, 28], ['ARROW', 8, 32], ['CHEST', 2, 5], ['FURNACE', 1, 3], ['IRON_PICKAXE', 1, 2], ['BOOK', 2, 5], ['BUCKET', 1, 3]];
const DELIVER = [['BREAD', 4, 10], ['COAL', 8, 20], ['IRON_INGOT', 3, 8], ['WHEAT', 10, 24], ['LEATHER', 3, 8], ['TORCH', 8, 24], ['CARROT', 8, 18], ['STRING', 6, 14]];
const CROSS = ['forest', 'birch_forest', 'taiga', 'snowy_plains', 'desert', 'swamp', 'jungle', 'savanna', 'badlands', 'dark_forest', 'plains', 'flower_forest'];
/** Structures a bounty may send you to (the board only offers the ones that have a site within reach). */
export const EXPLORE_KINDS = ['temple', 'igloo', 'outpost', 'hut', 'wreck', 'sunken', 'tomb', 'skywatch', 'rimekeep', 'sporehall', 'lighthouse', 'mireshrine', 'observatory', 'citadel'];
const WEIGHTS = { gather: 3, slay: 3, deliver: 2, explore: 1.5, cook: 1.5, cross: 2, trade: 1.5, craft: 2 };
/** Where a board of one village looks for structures and neighbours. */
export const BOARD_RANGE = 1600;

const between = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const tierOf = (v, lo, hi) => { const t = hi > lo ? (v - lo) / (hi - lo) : 0; return t < 0.34 ? 0 : t < 0.67 ? 1 : 2; };

/** The reward for a bounty of a tier (0..2): beryl, reputation with the board's village and now and then an item. */
function rewardFor(kind, tier, rng, ctxKind) {
  const reward = { beryl: 3 + tier * 3 + Math.floor(rng() * 3), rep: 2 + tier * 2, items: [] };
  const bonus = rng();
  if (kind === 'explore' && ctxKind) {
    const others = Object.keys(CHARTS).filter((k) => k !== ctxKind);
    if (others.length) reward.items.push({ id: CHARTS[others[Math.floor(rng() * others.length)]], count: 1 });
  } else if (bonus < 0.45 + tier * 0.15) {
    const pool = [['IRON_INGOT', 2 + tier * 2], ['BREAD', 3 + tier * 3], ['ARROW', 8 + tier * 8], ['COAL', 6 + tier * 6], ['GOLD_INGOT', 1 + tier], ['APPLE', 2 + tier * 2]].filter(([k]) => I[k] !== undefined);
    const [k, count] = pool[Math.floor(rng() * pool.length)];
    reward.items.push({ id: I[k], count });
  }
  return reward;
}

function makeBounty(kind, rng, ctx, base) {
  const b = { ...base, kind, target: null, n: 1 };
  switch (kind) {
    case 'gather': {
      const pool = GATHER.filter(([k]) => idOf(k) !== undefined), [k, lo, hi] = pool[Math.floor(rng() * pool.length)];
      b.target = idOf(k); b.n = between(rng, lo, hi); b.tier = tierOf(b.n, lo, hi); break;
    }
    case 'slay': {
      const pool = SLAY.filter(([k]) => MOBS[k]), [k, lo, hi] = pool[Math.floor(rng() * pool.length)];
      b.target = k; b.n = between(rng, lo, hi); b.tier = tierOf(b.n, lo, hi); break;
    }
    case 'craft': {
      const pool = CRAFT.filter(([k]) => idOf(k) !== undefined), [k, lo, hi] = pool[Math.floor(rng() * pool.length)];
      b.target = idOf(k); b.n = between(rng, lo, hi); b.tier = tierOf(b.n, lo, hi); break;
    }
    case 'cook': {
      b.target = DISH_IDS[Math.floor(rng() * DISH_IDS.length)]; b.n = between(rng, 1, 3); b.tier = b.n - 1; break;
    }
    case 'cross': {
      const pool = CROSS.filter((k) => BIOMES.some((x) => x.key === k) && k !== ctx.biome);
      b.target = pool[Math.floor(rng() * pool.length)]; b.n = between(rng, 60, 140); b.tier = tierOf(b.n, 60, 140); break;
    }
    case 'trade': { b.n = between(rng, 2, 6); b.tier = tierOf(b.n, 2, 6); break; }
    case 'deliver': {
      const pool = DELIVER.filter(([k]) => idOf(k) !== undefined), [k, lo, hi] = pool[Math.floor(rng() * pool.length)];
      const to = ctx.others[Math.floor(rng() * Math.min(3, ctx.others.length))];
      b.target = idOf(k); b.n = between(rng, lo, hi); b.to = to.key; b.toName = to.name || villageName(to.key);
      b.tier = Math.min(2, tierOf(b.n, lo, hi) + (to.dist > 900 ? 1 : 0)); break;
    }
    case 'explore': {
      const s = ctx.structs[Math.floor(rng() * ctx.structs.length)];
      b.target = s.kind; b.n = 1; b.tier = s.dist > 1100 ? 2 : s.dist > 550 ? 1 : 0; break;
    }
    default: break;
  }
  b.reward = rewardFor(kind, b.tier, rng, kind === 'explore' ? b.target : null);
  return b;
}

/**
 * The bounties on the board of village `vk` on day `day`: always BOUNTIES_PER_BOARD of different kinds, the same for the same
 * seed. ctx = { biome, others: [{ key, name, dist }] (other villages, nearest first), structs: [{ kind, dist }] }.
 */
export function generateBounties(seed, day, vk, ctx = {}) {
  const c = { biome: ctx.biome || null, others: ctx.others || [], structs: (ctx.structs || []).filter((s) => EXPLORE_KINDS.includes(s.kind) && LANDMARK_BY_KEY[s.kind]) };
  const rng = mulberry32(hash4(Number.isFinite(+seed) ? +seed | 0 : hashStr(String(seed)), day | 0, hashStr(String(vk)), 0x62a7));
  const kinds = KINDS.filter((k) => (k !== 'deliver' || c.others.length) && (k !== 'explore' || c.structs.length));
  const out = [];
  for (let slot = 0; slot < BOUNTIES_PER_BOARD && kinds.length; slot++) {
    const total = kinds.reduce((a, k) => a + WEIGHTS[k], 0);
    let r = rng() * total, pick = kinds[kinds.length - 1];
    for (const k of kinds) { r -= WEIGHTS[k]; if (r <= 0) { pick = k; break; } }
    kinds.splice(kinds.indexOf(pick), 1);
    out.push(makeBounty(pick, rng, c, { id: `${vk}|${day | 0}|${slot}`, vk, day: day | 0, slot }));
  }
  return out;
}

/** "Slay 6 Shamblers": the one-line name of a bounty (or a story step). */
export function bountyTitle(b) {
  const n = b.n | 0;
  switch (b.kind) {
    case 'gather': return `Gather ${n} ${nameOfId(b.target)}`;
    case 'slay': return `Slay ${n} ${plural(mobName(b.target), n)}`;
    case 'craft': return `Craft ${n} ${nameOfId(b.target)}`;
    case 'cook': return n === 1 ? `Cook a ${dishName(b.target)}` : `Cook ${n} servings of ${dishName(b.target)}`;
    case 'cross': return `Cross ${n} blocks of ${biomeName(b.target)}`;
    case 'trade': return `Make ${n} trades with settlers`;
    case 'deliver': return `Deliver ${n} ${nameOfId(b.target)} to ${b.toName || 'another village'}`;
    case 'explore': return `Find ${/^[aeiou]/i.test((LANDMARK_BY_KEY[b.target] || {}).name || '') ? 'an' : 'a'} ${(LANDMARK_BY_KEY[b.target] || { name: b.target }).name}`;
    default: return 'Odd job';
  }
}

/** The reward as words: "7 Beryl, 3 Bread, +4 reputation". */
export function rewardText(r) {
  const parts = [];
  if (r.beryl > 0) parts.push(`${r.beryl} Beryl`);
  for (const it of r.items || []) parts.push(`${it.count > 1 ? it.count + ' ' : ''}${it.label || nameOfId(it.id)}`);
  if (r.rep > 0) parts.push(`+${r.rep} reputation`);
  return parts.join(', ');
}

/** The item id that stands for a bounty in the journal and on the board (an icon). */
export function bountyIcon(b) {
  switch (b.kind) {
    case 'slay': return I.IRON_SWORD;
    case 'explore': return I.BOOK;
    case 'cross': return I.COMPASS !== undefined ? I.COMPASS : I.BOOK;
    case 'trade': return I.BERYL;
    case 'cook': return b.target;
    default: return b.target;
  }
}

// ---- matching events ----------------------------------------------------------------------------------------------
const EVENT_OF = { gather: 'pickup', slay: 'kill', craft: 'craft', cook: 'cook', cross: 'cross', trade: 'trade', explore: 'explore' };
/** How much an event moves an objective ({kind, target}); 0 when it does not. */
export function gain(o, ev) {
  if (!o || !ev || EVENT_OF[o.kind] !== ev.type) return 0;
  const n = Math.max(0, Math.min(1000, Number.isFinite(+ev.n) ? Math.floor(+ev.n) : 1));
  switch (o.kind) {
    case 'gather': case 'craft': return ev.id === o.target ? n : 0;
    case 'cook': return o.target == null || ev.id === o.target ? n : 0;
    case 'slay': return ev.mob === o.target ? Math.max(1, n) : 0;
    case 'explore': return ev.landmark === o.target ? 1 : 0;
    case 'cross': return ev.biome === o.target ? n : 0;
    case 'trade': return n;
    default: return 0;
  }
}

// ---- story chains --------------------------------------------------------------------------------------------------
const step = (kind, target, n, text) => ({ kind, target, n, text });
const ench = (o) => o;
/** Three handcrafted chains. `reward.item` is a named stack of an existing item. */
export const CHAINS = [
  {
    id: 'lamplight', title: "The Keeper's Lamp",
    intro: 'The old lighthouse on the coast has been dark since its keeper left. Light the road to it, find it, and see that the shore is safe before the great lens is lit again.',
    steps: [
      step('craft', idOf('TORCH'), 12, 'Craft 12 Torches to light the road.'),
      step('explore', 'lighthouse', 1, "Find the Hermit's Lighthouse on a beach point."),
      step('slay', 'shambler', 8, 'Clear the shore of 8 Shamblers.'),
      step('gather', idOf('COAL'), 16, 'Bring back 16 Coal to fuel the great lens.'),
    ],
    done: 'The lens burns again, and ships will find the shore. Take the keeper\'s pick.',
    reward: { beryl: 18, rep: 15, item: { id: idOf('DIAMOND_PICKAXE'), count: 1, label: "Lamplighter's Pick", ench: ench({ swiftdig: 3, steadfast: 2 }) } },
  },
  {
    id: 'sunward', title: 'Under Three Suns',
    intro: 'Travellers speak of a tomb in the dunes where the three suns align. Cross the sand, find it, and bring back proof that you were fed and fighting fit.',
    steps: [
      step('cross', 'desert', 120, 'Cross 120 blocks of Desert.'),
      step('explore', 'tomb', 1, 'Find a Sun Tomb.'),
      step('cook', null, 1, 'Cook a dish in a Cooking Pot to share a meal at the tomb.'),
      step('slay', 'skitterer', 8, 'Drive off 8 Skitterers that nest in the dunes.'),
    ],
    done: 'The tomb has been honoured. The elders give you a blade that remembers the suns.',
    reward: { beryl: 22, rep: 18, item: { id: idOf('IRON_SWORD'), count: 1, label: 'Sunsplitter', ench: ench({ hallowed: 3, emberbrand: 1, steadfast: 2 }) } },
  },
  {
    id: 'coldforge', title: 'The Long Winter',
    intro: 'A cold that does not end creeps out of the north. The old stories name a frozen keep, a forge that never cooled and a dragon over the void. Follow them to the end.',
    steps: [
      step('explore', 'rimekeep', 1, 'Find a Rimekeep in the cold.'),
      step('gather', idOf('IRON_INGOT'), 16, 'Gather 16 Iron Ingots to stoke a cold forge.'),
      step('slay', 'slag_colossus', 1, 'Defeat the Slag Colossus.'),
      step('slay', 'void_wyrm', 1, 'Defeat the Void Wyrm.'),
    ],
    done: 'The winter breaks. Carry the Colossus-Breaker, and do not forget us.',
    reward: { beryl: 40, rep: 30, item: { id: idOf('DIAMOND_AXE'), count: 1, label: 'Colossus-Breaker', ench: ench({ forgebite: 2, keen: 4, steadfast: 3 }) } },
  },
];
export const CHAIN_BY_ID = Object.fromEntries(CHAINS.map((c) => [c.id, c]));

// ---- cleaning data from saves and the wire --------------------------------------------------------------------------
const int = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.floor(+v))) : d);
const KEYRE = /^-?\d{1,8},-?\d{1,8}$/;

/** A reward, checked (from a save or a guest). */
export function cleanReward(r) {
  const out = { beryl: 0, rep: 0, items: [] };
  if (!r || typeof r !== 'object') return out;
  out.beryl = int(r.beryl, 0, 200); out.rep = int(r.rep, 0, 50);
  for (const it of Array.isArray(r.items) ? r.items.slice(0, 4) : []) {
    if (!it || !Number.isInteger(it.id) || !(ITEMS[it.id] || BLOCKS[it.id])) continue;
    const s = { id: it.id, count: int(it.count, 1, 64, 1) };
    const e = cleanEnch(it.ench); if (e) s.ench = e;
    const l = cleanLabel(it.label); if (l) s.label = l;
    out.items.push(s);
  }
  return out;
}

/** A bounty as the board offers it, checked. Returns null when it is not one. */
export function cleanBounty(b) {
  if (!b || typeof b !== 'object' || !KINDS.includes(b.kind) || typeof b.id !== 'string' || b.id.length > 60) return null;
  const o = { id: b.id, vk: typeof b.vk === 'string' && KEYRE.test(b.vk) ? b.vk : '0,0', day: int(b.day, 0, 1e7), slot: int(b.slot, 0, 9), kind: b.kind, n: int(b.n, 1, 1000, 1), tier: int(b.tier, 0, 2) };
  if (b.kind === 'slay' || b.kind === 'cross' || b.kind === 'explore') { if (typeof b.target !== 'string' || b.target.length > 32) return null; o.target = b.target; }
  else if (b.kind === 'trade') o.target = null;
  else { if (!Number.isInteger(b.target) || !(ITEMS[b.target] || BLOCKS[b.target])) return null; o.target = b.target; }
  if (b.kind === 'deliver') {
    if (typeof b.to !== 'string' || !KEYRE.test(b.to)) return null;
    o.to = b.to; o.toName = String(b.toName || '').replace(/[^\w \-']/g, '').slice(0, 24) || villageName(b.to);
  }
  o.reward = cleanReward(b.reward);
  return o;
}

/** An accepted bounty (progress and who contributed what), checked. */
export function cleanActive(a) {
  const b = cleanBounty(a);
  if (!b) return null;
  b.progress = int(a.progress, 0, b.n); b.acc = int(a.acc, 0, 1e7);
  b.contrib = {};
  if (a.contrib && typeof a.contrib === 'object' && !Array.isArray(a.contrib)) {
    for (const [k, v] of Object.entries(a.contrib).slice(0, MAX_PLAYERS_SEEN)) { const n = int(v, 0, 1000); if (n > 0 && k.length <= 24) b.contrib[k.replace(/[^\w\- .]/g, '').slice(0, 24) || 'Player'] = n; }
  }
  return b;
}

function cleanChains(c) {
  const out = {};
  if (!c || typeof c !== 'object') return out;
  for (const def of CHAINS) {
    const s = c[def.id];
    if (!s || typeof s !== 'object') continue;
    const stepNo = int(s.step, 0, def.steps.length - 1);
    out[def.id] = { step: stepNo, p: int(s.p, 0, def.steps[stepNo].n), ready: s.ready === true || s.ready === 1 };
  }
  return out;
}

/** A player's quest record (bounties finished, chains under way, chains claimed), checked. */
export function cleanPlayer(p) {
  const out = { bounties: 0, chains: {}, claimed: {} };
  if (!p || typeof p !== 'object') return out;
  out.bounties = int(p.bounties, 0, 1e6);
  out.chains = cleanChains(p.chains);
  if (p.claimed && typeof p.claimed === 'object') for (const def of CHAINS) if (p.claimed[def.id]) out.claimed[def.id] = 1;
  return out;
}

const cleanGroup = (g) => {
  const out = { active: [], turned: {}, rev: 0 };
  if (!g || typeof g !== 'object') return out;
  for (const a of (Array.isArray(g.active) ? g.active : []).slice(0, MAX_ACTIVE)) { const c = cleanActive(a); if (c) out.active.push(c); }
  if (g.turned && typeof g.turned === 'object') for (const [k, v] of Object.entries(g.turned).slice(0, 60)) if (k.length <= 60) out.turned[k] = int(v, 0, 1e7);
  return out;
};

// ---- the log --------------------------------------------------------------------------------------------------------
/** Accepted bounties by group and story progress by player. */
export class QuestLog {
  constructor() { this.groups = {}; this.players = {}; this.rev = 0; }

  group(key) { return this.groups[key] || (this.groups[key] = { active: [], turned: {}, rev: 0 }); }
  player(name) { const k = lower(name); return this.players[k] || (this.players[k] = { bounties: 0, chains: {}, claimed: {} }); }
  touch(key, name) { if (key !== null && key !== undefined) this.group(key).rev++; if (name) this.player(name).rev = (this.player(name).rev | 0) + 1; this.rev++; }

  /** Take a bounty from a board into the group's list. { ok, entry } or { ok: false, why }. */
  accept(key, bounty, day) {
    const g = this.group(key), b = cleanBounty(bounty);
    if (!b) return { ok: false, why: 'That notice is not valid.' };
    if (g.active.some((a) => a.id === b.id)) return { ok: false, why: 'Already accepted.' };
    if (g.turned[b.id] !== undefined) return { ok: false, why: 'That bounty is done for today.' };
    if (g.active.length >= MAX_ACTIVE) return { ok: false, why: `You can keep ${MAX_ACTIVE} bounties at a time.` };
    const entry = { ...b, progress: 0, contrib: {}, acc: day | 0 };
    g.active.push(entry);
    g.rev++;
    return { ok: true, entry };
  }

  abandon(key, id) {
    const g = this.group(key), n = g.active.length;
    g.active = g.active.filter((a) => a.id !== id);
    if (g.active.length !== n) g.rev++;
    return g.active.length !== n;
  }

  /** Credit `who` for an event on the group's bounties. Returns [{ entry, gained, done }] for those that moved. */
  apply(key, ev, who) {
    const g = this.groups[key], out = [];
    if (!g) return out;
    for (const e of g.active) {
      if (e.progress >= e.n || e.kind === 'deliver') continue;
      const amt = gain(e, ev);
      if (amt <= 0) continue;
      const take = Math.min(amt, e.n - e.progress);
      e.progress += take;
      const k = String(who || 'Player');
      if (e.contrib[k] !== undefined || Object.keys(e.contrib).length < MAX_PLAYERS_SEEN) e.contrib[k] = (e.contrib[k] | 0) + take;
      out.push({ entry: e, gained: take, done: e.progress >= e.n });
    }
    if (out.length) g.rev++;
    return out;
  }

  /** Hand `amount` of a delivery in (the caller has taken the items). Returns what was credited. */
  handIn(key, id, amount, who) {
    const g = this.groups[key], e = g && g.active.find((a) => a.id === id && a.kind === 'deliver');
    if (!e) return 0;
    const take = Math.max(0, Math.min(int(amount, 0, 1000), e.n - e.progress));
    if (!take) return 0;
    e.progress += take;
    const k = String(who || 'Player');
    if (e.contrib[k] !== undefined || Object.keys(e.contrib).length < MAX_PLAYERS_SEEN) e.contrib[k] = (e.contrib[k] | 0) + take;
    g.rev++;
    return take;
  }

  /** Turn in a finished bounty: removes it and remembers it as done for the day. Returns the entry or null. */
  turnIn(key, id, day) {
    const g = this.groups[key], e = g && g.active.find((a) => a.id === id);
    if (!e || e.progress < e.n) return null;
    g.active = g.active.filter((a) => a !== e);
    g.turned[e.id] = day | 0;
    g.rev++;
    return e;
  }

  /** Forget done-for-the-day marks of bounties more than two days old. */
  prune(day) {
    for (const g of Object.values(this.groups)) for (const [id, d] of Object.entries(g.turned)) if (d < day - 2) delete g.turned[id];
  }

  // ---- story chains
  chainState(name, id) { const p = this.players[lower(name)]; return p && p.chains[id] ? p.chains[id] : null; }
  startChain(name, id) {
    const def = CHAIN_BY_ID[id], p = this.player(name);
    if (!def) return { ok: false, why: 'No such tale.' };
    if (p.claimed[id]) return { ok: false, why: 'You have finished this tale.' };
    if (p.chains[id]) return { ok: false, why: 'You are already on this tale.' };
    if (Object.keys(p.chains).length >= CHAINS.length) return { ok: false, why: 'Too many tales.' };
    p.chains[id] = { step: 0, p: 0, ready: false };
    this.touch(null, name);
    return { ok: true };
  }
  /** An event moves the current step of each chain `name` is on. Returns [{ chain, step, gained, advanced, ready }]. */
  storyApply(name, ev) {
    const p = this.players[lower(name)], out = [];
    if (!p) return out;
    for (const def of CHAINS) {
      const s = p.chains[def.id];
      if (!s || s.ready) continue;
      const st = def.steps[s.step], amt = gain(st, ev);
      if (amt <= 0) continue;
      const take = Math.min(amt, st.n - s.p);
      s.p += take;
      let advanced = false, ready = false;
      if (s.p >= st.n) {
        if (s.step + 1 < def.steps.length) { s.step++; s.p = 0; advanced = true; } else { s.ready = true; ready = true; }
      }
      out.push({ chain: def, step: st, gained: take, advanced, ready });
    }
    if (out.length) this.touch(null, name);
    return out;
  }
  /** Claim a finished chain's reward. Returns the chain or null. */
  claimChain(name, id) {
    const p = this.players[lower(name)], s = p && p.chains[id];
    if (!s || !s.ready) return null;
    delete p.chains[id];
    p.claimed[id] = 1;
    this.touch(null, name);
    return CHAIN_BY_ID[id];
  }

  // ---- saving and the wire
  save() {
    return { v: 1, groups: JSON.parse(JSON.stringify(this.groups)), players: JSON.parse(JSON.stringify(this.players)) };
  }
  load(d) {
    this.groups = {}; this.players = {}; this.rev++;
    if (!d || typeof d !== 'object') return;
    if (d.groups && typeof d.groups === 'object') for (const [k, g] of Object.entries(d.groups).slice(0, 12)) if (k.length <= 16) this.groups[k] = cleanGroup(g);
    if (d.players && typeof d.players === 'object') for (const [k, p] of Object.entries(d.players).slice(0, 64)) if (k.length <= 24) this.players[lower(k)] = cleanPlayer(p);
  }

  /** What a guest is told: its group's list and its own record. */
  viewFor(name, groupKey) {
    const g = this.group(groupKey), p = this.player(name);
    return { k: groupKey, a: g.active, tn: g.turned, p: { bounties: p.bounties, chains: p.chains, claimed: p.claimed } };
  }
  /** A guest takes the host's view as its own log (one group, one player). */
  applyView(view, name) {
    if (!view || typeof view !== 'object' || typeof view.k !== 'string' || view.k.length > 16) return false;
    const g = cleanGroup({ active: view.a, turned: view.tn });
    this.groups = { [view.k]: g };
    this.players = { [lower(name)]: cleanPlayer(view.p) };
    this.rev++;
    return true;
  }
}

/** The stack a story reward item stands for. */
export function rewardStack(it) {
  const st = { id: it.id, count: it.count || 1, damage: 0 };
  const e = cleanEnch(it.ench); if (e) st.ench = e;
  const l = cleanLabel(it.label); if (l) st.label = l;
  return st;
}

/** "about 400 blocks north-east": the way from (fx, fz) to (tx, tz), for a lead in the journal. */
export function directionHint(fx, fz, tx, tz) {
  const dx = tx - fx, dz = tz - fz, d = Math.hypot(dx, dz);
  if (d < 24) return 'right here';
  const names = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']; // +x east, +z south
  const a = Math.atan2(dz, dx), i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  const r = d < 100 ? Math.round(d / 10) * 10 : Math.round(d / 50) * 50;
  return `about ${r} blocks ${names[i]}`;
}

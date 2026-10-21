// Chat commands (T or / opens the chat). Each returns a message to print.
import { ITEMS, I, maxStack } from '../world/items.js';
import { mineshaftsNear } from '../world/mineshafts.js';
import { templesNear, wrecksNear, outpostsNear } from '../world/temples.js';
import { ruinsNear } from '../world/ruinedPortals.js';
import { hutsNear } from '../world/swampHuts.js';
import { nearestMonument } from '../world/monuments.js';
import { BLOCKS } from '../world/blocks.js';
import { MOBS, MOB_KEYS } from '../mobs/mobTypes.js';
import { skyState } from '../sky/suns.js';
import { addXp } from '../player/experience.js';
import { ENCHANTS, ENCH_KEYS, canApply, compatible, enchName } from '../world/enchantments.js';
import { villageInRegion, VILLAGE_REGION } from '../world/villages.js';
import { nearestSanctum } from '../world/dimensions/sanctum.js';
import { EFFECTS, EFFECT_KEYS, effectLabel } from '../player/effects.js';

/** item lookup by key ("diamond_sword", "oak_planks", "grass_block") and by display name */
let ITEM_KEYS = null;
export function itemByName(name) {
  if (!ITEM_KEYS) {
    ITEM_KEYS = new Map();
    for (const d of ITEMS) {
      if (!d || !d.id) continue;
      const block = d.id < 256 ? BLOCKS[d.id] : null;
      const key = (block ? block.name : d.key || d.name).toLowerCase().replace(/[^a-z0-9]+/g, '_');
      ITEM_KEYS.set(key, d.id);
      ITEM_KEYS.set(d.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), d.id);
    }
  }
  return ITEM_KEYS.get(name.toLowerCase().replace(/^minecraft:|^saturncraft:/, '').replace(/[^a-z0-9]+/g, '_'));
}


/** mob lookup by key ("shambler") or by the vanilla role it fills ("zombie") */
export function mobByName(name) {
  const n = name.toLowerCase();
  if (MOBS[n]) return n;
  return MOB_KEYS.find((k) => MOBS[k].role === n || MOBS[k].name.toLowerCase() === n) || null;
}

/** Parse a coordinate that may be relative ("~", "~3") to `base`. */
function coord(s, base) {
  if (s === undefined) return NaN;
  if (s.startsWith('~')) return base + (s.length > 1 ? Number(s.slice(1)) : 0);
  return Number(s);
}

/** First time >= t0 (step 20 ticks) whose sky phase matches. */
function nextTime(t0, pred) {
  for (let t = t0; t < t0 + 2_000_000; t += 20) if (pred(skyState(t))) return t;
  return t0;
}

/** Game rules: command name -> settings key. */
export const GAME_RULES = { doDaylightCycle: 'daylightCycle', doHostileSpawning: 'hostileMobs' };

export const HELP = [
  '/gamemode <survival|creative>  (or /gm 0|1)',
  '/time set <day|night|noon|midnight|ticks>,  /time add <ticks>,  /time query',
  '/gamerule doDaylightCycle <true|false>,  /gamerule doHostileSpawning <true|false>',
  '/difficulty <peaceful|easy|normal|hard>',
  '/weather <clear|rain|thunder> [ticks]',
  '/tp <x> <y> <z>  (~ for relative)',
  '/give <item> [count]',
  '/enchant <name> [level]  (the held item; names: ' + ENCH_KEYS.join(', ') + ')',
  '/summon <mob> [x y z]',
  '/xp <amount> [levels]',
  '/locate <village|temple|outpost|shipwreck|monument|mineshaft|sanctum|bastion|hut|ruin|city|gate>',
  '/dimension <overworld|cinderdeep|hollow>',
  '/effect give <effect> [seconds] [level],  /effect clear  (effects: ' + EFFECT_KEYS.join(', ') + ')',
  '/kill,  /clear,  /spawnpoint,  /seed,  /heal',
];

export function runCommand(game, text) {
  const p = game.player;
  const args = text.trim().replace(/^\//, '').split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  switch (cmd) {
    case 'help': case '?': return HELP;
    case 'gamemode': case 'gm': {
      const m = { survival: 'survival', s: 'survival', 0: 'survival', creative: 'creative', c: 'creative', 1: 'creative' }[(args[0] || '').toLowerCase()];
      if (!m) return 'Usage: /gamemode <survival|creative>';
      p.setGamemode(m);
      return `Set own game mode to ${m[0].toUpperCase() + m.slice(1)} Mode`;
    }
    case 'time': {
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'query') return `The time is ${game.time} (${skyState(game.time).phase})`;
      if (sub === 'add') { const n = Number(args[1]); if (!Number.isFinite(n)) return 'Usage: /time add <ticks>'; game.time += Math.round(n); return `Added ${Math.round(n)} to the time`; }
      if (sub === 'set') {
        const v = (args[1] || '').toLowerCase();
        let t;
        if (v === 'day') t = nextTime(game.time, (s) => s.phase === 'day');
        else if (v === 'night') t = nextTime(game.time, (s) => s.aboveCount === 0);
        else if (v === 'noon') t = nextTime(game.time, (s) => s.combined > 0.95);
        else if (v === 'midnight') t = nextTime(nextTime(game.time, (s) => s.aboveCount === 0) + 1000, () => true);
        else if (Number.isFinite(Number(v)) && v !== '') t = Math.round(Number(v));
        else return 'Usage: /time set <day|night|noon|midnight|ticks>';
        game.time = t;
        return `Set the time to ${t}`;
      }
      return 'Usage: /time <set|add|query> ...';
    }
    case 'difficulty': {
      const v = (args[0] || '').toLowerCase();
      if (!v) return `The difficulty is ${game.difficulty}`;
      const d = ['peaceful', 'easy', 'normal', 'hard'].find((k) => k === v || k[0] === v);
      if (!d) return 'Usage: /difficulty <peaceful|easy|normal|hard>';
      game.setSetting('difficulty', d);
      return `The difficulty has been set to ${d[0].toUpperCase() + d.slice(1)}`;
    }
    case 'gamerule': {
      const usage = `Usage: /gamerule <${Object.keys(GAME_RULES).join('|')}> [true|false]`;
      const rule = Object.keys(GAME_RULES).find((k) => k.toLowerCase() === (args[0] || '').toLowerCase());
      if (!rule) return usage;
      const key = GAME_RULES[rule];
      const v = (args[1] || '').toLowerCase();
      if (v === '') return `Gamerule ${rule} is currently set to: ${game.settings[key] !== false}`;
      if (v !== 'true' && v !== 'false') return usage;
      game.setSetting(key, v === 'true');
      return `Gamerule ${rule} is now set to: ${v}`;
    }
    case 'weather': {
      const v = (args[0] || '').toLowerCase(), w = game.weather;
      const dur = Number(args[1]) || (v === 'clear' ? 12000 + Math.floor(Math.random() * 168000) : 12000 + Math.floor(Math.random() * 12000));
      if (v === 'clear') { w.raining = false; w.timer = dur; w.thundering = false; w.thunderTimer = dur; return 'Set the weather to clear'; }
      if (v === 'rain') { w.raining = true; w.timer = dur; w.thundering = false; w.thunderTimer = dur; return 'Set the weather to rain'; }
      if (v === 'thunder') { w.raining = true; w.timer = dur; w.thundering = true; w.thunderTimer = dur; return 'Set the weather to rain & thunder'; }
      return 'Usage: /weather <clear|rain|thunder> [ticks]';
    }
    case 'tp': case 'teleport': {
      const x = coord(args[0], p.x), y = coord(args[1], p.y), z = coord(args[2], p.z);
      if (![x, y, z].every(Number.isFinite)) return 'Usage: /tp <x> <y> <z>';
      p.setPosition(x, y, z);
      return `Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    }
    case 'give': {
      if (!args[0]) return 'Usage: /give <item> [count]';
      // the item name may have spaces ("/give iron chestplate 2")
      const count = args.length > 1 && /^\d+$/.test(args[args.length - 1]) ? Number(args.pop()) : 1;
      const name = args.join('_');
      const id = itemByName(name);
      if (id === undefined) return `Unknown item '${args.join(' ')}'`;
      let n = Math.max(1, Math.min(64 * 36, count));
      const total = n;
      while (n > 0) {
        const c = Math.min(n, maxStack(id));
        const left = p.inventory.add({ id, count: c, damage: 0 });
        if (left) { game.entities.spawnItem(p.x, p.y + 1, p.z, { id, count: left, damage: 0 }); }
        n -= c;
      }
      game.audio.play('pop');
      return `Gave ${total} [${ITEMS[id].name}]`;
    }
    case 'enchant': {
      const st = p.inventory.selectedStack;
      if (!args[0]) return 'Usage: /enchant <name> [level]';
      const key = ENCH_KEYS.find((k) => k === args[0].toLowerCase() || ENCHANTS[k].name.toLowerCase().replace(/ /g, '_') === args[0].toLowerCase());
      if (!key) return `Unknown enchantment ${args[0]} (${ENCH_KEYS.join(', ')})`;
      if (!st) return 'Hold the item to enchant';
      if (!canApply(key, st.id, true)) return `${enchName(key, 1)} cannot go on ${ITEMS[st.id].name}`;
      const lvl = Math.max(1, Math.min(ENCHANTS[key].max, parseInt(args[1] || '1', 10) || 1));
      const clash = Object.keys(st.ench || {}).find((k) => !compatible(k, key) && k !== key);
      if (clash) return `${enchName(key, 1)} cannot be combined with ${enchName(clash, 1)}`;
      if (st.id === I.BOOK) st.id = I.ENCHANTED_BOOK;
      st.ench = { ...(st.ench || {}), [key]: lvl };
      p.inventory.changed();
      game.hud.lastHotbarKey = null; game.hud.lastSel = -1;
      return `Enchanted ${ITEMS[st.id].name} with ${enchName(key, lvl)}`;
    }
    case 'summon': {
      if (/^lightning(_bolt)?$/i.test(args[0] || '')) {
        const [dx, , dz] = p.lookDir();
        const x = args[1] !== undefined ? coord(args[1], p.x) : p.x + dx * 6, z = args[3] !== undefined ? coord(args[3], p.z) : p.z + dz * 6;
        const y = args[2] !== undefined ? coord(args[2], p.y) : game.world.heightAt(Math.floor(x), Math.floor(z)) + 1;
        game.strikeLightning(Math.floor(x), Math.floor(y), Math.floor(z));
        return 'Summoned new Lightning Bolt';
      }
      const type = mobByName(args[0] || '');
      if (!type) return `Unknown mob '${args[0] || ''}'. Mobs: ${MOB_KEYS.join(', ')}`;
      const [dx, , dz] = p.lookDir();
      const x = args[1] !== undefined ? coord(args[1], p.x) : p.x + dx * 3;
      const y = args[2] !== undefined ? coord(args[2], p.y) : p.y;
      const z = args[3] !== undefined ? coord(args[3], p.z) : p.z + dz * 3;
      game.spawner.spawnMob(type, x, y, z);
      return `Summoned new ${MOBS[type].name}`;
    }
    case 'xp': case 'experience': {
      const n = Number(args[0]);
      if (!Number.isFinite(n) || n < 0) return 'Usage: /xp <amount> [levels]';
      if ((args[1] || '').startsWith('level')) { p.xp.level += Math.round(n); return `Gave ${Math.round(n)} experience levels`; }
      addXp(p.xp, Math.round(n));
      return `Gave ${Math.round(n)} experience points`;
    }
    case 'kill': p.hurt(Infinity, 'kill'); return 'Killed the player';
    case 'effect': {
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'clear') { p.clearEffects(); return 'Removed every effect'; }
      if (sub !== 'give' || !args[1]) return 'Usage: /effect give <effect> [seconds] [level]  or  /effect clear';
      const name = args[1].toLowerCase().replace(/^minecraft:/, '');
      if (!EFFECTS[name]) return `Unknown effect: ${name}`;
      const secs = args[2] !== undefined ? Number(args[2]) : 30, lvl = args[3] !== undefined ? Number(args[3]) : 1;
      if (!(secs > 0) || !(lvl >= 1 && lvl <= 255)) return 'Usage: /effect give <effect> [seconds] [level]';
      p.applyEffect(name, Math.round(secs * 20), Math.floor(lvl) - 1);
      return `Applied ${effectLabel(name, Math.floor(lvl) - 1)}${EFFECTS[name].instant ? '' : ` for ${secs} s`}`;
    }
    case 'heal': p.health = 20; p.hunger.food = 20; p.hunger.saturation = 5; return 'Healed';
    case 'clear': p.inventory.clear(); return 'Cleared the inventory';
    case 'spawnpoint': p.spawn = { x: p.x, y: p.y, z: p.z }; p.bed = null; return `Set spawn point to ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;
    case 'seed': return `Seed: [${game.seed}]`;
    case 'dimension': case 'dim': return game.dims ? game.dims.command(args[0]) : 'Dimensions unavailable';
    case 'locate': {
      const what = (args[0] || '').toLowerCase();
      if (what === 'sanctum') {
        if (game.world.dimension !== 'overworld') return 'Hollow Sanctums are only found in the overworld';
        const s = nearestSanctum(game.seed, p.x, p.z);
        return s ? `The nearest Hollow Sanctum is at ${s.x}, ${s.y}, ${s.z} (${Math.round(Math.hypot(s.x - p.x, s.z - p.z))} blocks away)` : 'No sanctum found nearby';
      }
      if (what === 'city' || what === 'gate') {
        if (game.world.dimension !== 'hollow') return 'Hollow Cities and the Far Gate are only found in the Hollow';
        const gen = game.world.dimGenerator;
        if (what === 'gate') { const a = gen.gatewayMain(), b = gen.gatewayExit(); return `The Far Gate stands at ${a.x}, ${a.y + 1}, ${a.z}; it leads to ${b.x}, ${b.y + 1}, ${b.z}`; }
        const c = gen.nearestCity(p.x, p.z);
        return c ? `The nearest Hollow City is at ${c.x}, ${c.y}, ${c.z} (${Math.round(Math.hypot(c.x - p.x, c.z - p.z))} blocks away)${c.ship ? ', with a ship' : ''}` : 'No Hollow City found nearby';
      }
      if (what === 'bastion') {
        if (game.world.dimension !== 'cinderdeep') return 'Ember Bastions are only found in the Cinderdeep';
        const gen = game.world.dimGenerator;
        const list = gen.bastionsNear(p.x - 1024, p.z - 1024, p.x + 1024, p.z + 1024);
        if (!list.length) return 'No bastion found nearby';
        const b = list.reduce((a, c) => (Math.hypot(c.cx - p.x, c.cz - p.z) < Math.hypot(a.cx - p.x, a.cz - p.z) ? c : a));
        return `The nearest Ember Bastion is at ${b.cx}, ${b.y + 1}, ${b.cz} (${Math.round(Math.hypot(b.cx - p.x, b.cz - p.z))} blocks away)`;
      }
      if (what === 'ruin' || what === 'ruined_portal' || what === 'portal') {
        const list = ruinsNear(game.world.gen, p.x - 1500, p.z - 1500, p.x + 1500, p.z + 1500);
        if (!list.length) return 'No ruined rift found nearby';
        const t = list.reduce((a, c) => (Math.hypot(c.cx - p.x, c.cz - p.z) < Math.hypot(a.cx - p.x, a.cz - p.z) ? c : a));
        return `The nearest ruined rift is at ${t.cx}, ${t.y}, ${t.cz} (${Math.round(Math.hypot(t.cx - p.x, t.cz - p.z))} blocks away)`;
      }
      if (what === 'outpost') {
        const list = outpostsNear(game.world.gen, p.x - 2500, p.z - 2500, p.x + 2500, p.z + 2500);
        if (!list.length) return 'No outpost found nearby';
        const t = list.reduce((a, c) => (Math.hypot(c.cx - p.x, c.cz - p.z) < Math.hypot(a.cx - p.x, a.cz - p.z) ? c : a));
        return `The nearest raider outpost is at ${t.cx}, ${t.y}, ${t.cz} (${Math.round(Math.hypot(t.cx - p.x, t.cz - p.z))} blocks away)`;
      }
      if (what === 'shipwreck') {
        const list = [];
        for (let r = 0; r < 12 && !list.length; r++) list.push(...wrecksNear(game.world.gen, p.x - 160 * r - 80, p.z - 160 * r - 80, p.x + 160 * r + 80, p.z + 160 * r + 80));
        if (!list.length) return 'No shipwreck found nearby';
        const t = list.reduce((a, c) => (Math.hypot(c.cx - p.x, c.cz - p.z) < Math.hypot(a.cx - p.x, a.cz - p.z) ? c : a));
        return `The nearest shipwreck is at ${t.cx}, ${t.y}, ${t.cz} (${Math.round(Math.hypot(t.cx - p.x, t.cz - p.z))} blocks away)`;
      }
      if (what === 'temple') {
        if (game.world.dimension !== 'overworld') return 'Desert temples are only found in the overworld';
        const list = templesNear(game.world.gen, p.x - 1500, p.z - 1500, p.x + 1500, p.z + 1500);
        if (!list.length) return 'No desert temple found nearby';
        const t = list.reduce((a, c) => (Math.hypot(c.cx - p.x, c.cz - p.z) < Math.hypot(a.cx - p.x, a.cz - p.z) ? c : a));
        return `The nearest desert temple is at ${t.cx}, ${t.y}, ${t.cz} (${Math.round(Math.hypot(t.cx - p.x, t.cz - p.z))} blocks away)`;
      }
      if (what === 'hut') {
        if (game.world.dimension !== 'overworld') return 'Swamp huts are only found in the overworld';
        const list = hutsNear(game.world.gen, p.x - 2000, p.z - 2000, p.x + 2000, p.z + 2000);
        if (!list.length) return 'No swamp hut found nearby';
        const t = list.reduce((a, c) => (Math.hypot(c.cx - p.x, c.cz - p.z) < Math.hypot(a.cx - p.x, a.cz - p.z) ? c : a));
        return `The nearest swamp hut is at ${t.cx}, ${t.y}, ${t.cz} (${Math.round(Math.hypot(t.cx - p.x, t.cz - p.z))} blocks away)`;
      }
      if (what === 'mineshaft') {
        if (game.world.dimension !== 'overworld') return 'Mineshafts are only found in the overworld';
        const list = mineshaftsNear(game.world.gen.seed, p.x - 1200, p.z - 1200, p.x + 1200, p.z + 1200);
        if (!list.length) return 'No mineshaft found nearby';
        const m = list.reduce((a, c) => (Math.hypot(c.cx - p.x, c.cz - p.z) < Math.hypot(a.cx - p.x, a.cz - p.z) ? c : a));
        return `The nearest mineshaft is at ${m.cx}, ${m.y}, ${m.cz} (${Math.round(Math.hypot(m.cx - p.x, m.cz - p.z))} blocks away)`;
      }
      if (what === 'monument' || what === 'citadel') {
        if (game.world.dimension !== 'overworld') return 'Tide Citadels are only found in the overworld';
        const m = nearestMonument(game.world.gen, p.x, p.z);
        if (!m) return 'No Tide Citadel found nearby';
        return `The nearest Tide Citadel is at ${m.cx}, ${m.y}, ${m.cz} (${Math.round(Math.hypot(m.cx - p.x, m.cz - p.z))} blocks away)`;
      }
      if (what !== 'village') return 'Usage: /locate <village|temple|outpost|shipwreck|mineshaft|sanctum|bastion|hut>';
      const R = VILLAGE_REGION, prx = Math.floor(p.x / R), prz = Math.floor(p.z / R);
      let best = null;
      // search rings of regions outwards; one ring past the first find, since a neighbour can be closer
      let stopAt = 6;
      for (let r = 0; r <= stopAt; r++) for (let rx = prx - r; rx <= prx + r; rx++) for (let rz = prz - r; rz <= prz + r; rz++) {
        if (Math.max(Math.abs(rx - prx), Math.abs(rz - prz)) !== r) continue;
        const v = villageInRegion(game.world.gen, rx, rz);
        if (v && (!best || Math.hypot(v.cx - p.x, v.cz - p.z) < Math.hypot(best.cx - p.x, best.cz - p.z))) { best = v; stopAt = Math.min(stopAt, r + 1); }
      }
      if (!best) return 'No village found nearby';
      return `The nearest village is at ${best.cx}, ${best.y}, ${best.cz} (${Math.round(Math.hypot(best.cx - p.x, best.cz - p.z))} blocks away)`;
    }
    case '': return null;
    default: return `Unknown command '/${cmd}'. Type /help for a list.`;
  }
}


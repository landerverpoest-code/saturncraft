// Chat commands (T or / opens the chat). Each returns a message to print.
import { ITEMS, I, maxStack } from '../world/items.js';
import { BLOCKS } from '../world/blocks.js';
import { MOBS, MOB_KEYS } from '../mobs/mobTypes.js';
import { skyState } from '../sky/suns.js';
import { addXp } from '../player/experience.js';
import { ENCHANTS, ENCH_KEYS, canApply, compatible, enchName } from '../world/enchantments.js';
import { villageInRegion, VILLAGE_REGION } from '../world/villages.js';
import { nearestSanctum } from '../world/dimensions/sanctum.js';

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
  '/weather <clear|rain|thunder> [ticks]',
  '/tp <x> <y> <z>  (~ for relative)',
  '/give <item> [count]',
  '/enchant <name> [level]  (the held item; names: ' + ENCH_KEYS.join(', ') + ')',
  '/summon <mob> [x y z]',
  '/xp <amount> [levels]',
  '/locate <village|sanctum|bastion>',
  '/dimension <overworld|cinderdeep|hollow>',
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
      if (what === 'bastion') {
        if (game.world.dimension !== 'cinderdeep') return 'Ember Bastions are only found in the Cinderdeep';
        const gen = game.world.dimGenerator;
        const list = gen.bastionsNear(p.x - 1024, p.z - 1024, p.x + 1024, p.z + 1024);
        if (!list.length) return 'No bastion found nearby';
        const b = list.reduce((a, c) => (Math.hypot(c.cx - p.x, c.cz - p.z) < Math.hypot(a.cx - p.x, a.cz - p.z) ? c : a));
        return `The nearest Ember Bastion is at ${b.cx}, ${b.y + 1}, ${b.cz} (${Math.round(Math.hypot(b.cx - p.x, b.cz - p.z))} blocks away)`;
      }
      if (what !== 'village') return 'Usage: /locate <village|sanctum|bastion>';
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


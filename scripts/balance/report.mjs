// Balance report: node scripts/balance/report.mjs [section...]   (sections: trade loot craft combat misc; default all)
// Prints the numbers that tests/balance.test.js keeps within bounds.
import { I, ITEMS } from '../../src/world/items.js';
import { MARKETS, arbitrageLoops, pricedOffers, PROFESSIONS, nameOf } from './trade.mjs';
import { CHEST_KINDS, chestStats, valueTable, fishingStats } from './loot.mjs';
import { naturalSources, deadRecipes, resourceLoops } from './craft.mjs';
import { armorSets, damageAfter, meleeMobs, bossTable } from './combat.mjs';
import { foods, xpTotal, yearlyGrowth, seasonalChances, maxProtection } from './misc.mjs';

const want = new Set(process.argv.slice(2));
const on = (s) => !want.size || want.has(s);
const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
const head = (t) => console.log(`\n== ${t} ==`);

if (on('trade')) {
  head('Trade: buy -> craft -> sell loops (items beryl can buy that a settler pays more beryl for)');
  for (const [name, m] of Object.entries(MARKETS)) for (const uses of [0, 11]) {
    const loops = arbitrageLoops(m, uses);
    console.log(`${name.padEnd(22)} uses ${String(uses).padStart(2)}: ${loops.length ? loops.map((l) => `${l.name} (${l.buyer}) cost ${f(l.cost, 3)} -> ${f(l.income, 3)}`).join('; ') : 'none'}`);
  }
  head('Trade: earn and spend (neutral market)');
  const offers = pricedOffers(MARKETS.neutral, 0);
  for (const p of PROFESSIONS) {
    const buys = offers.filter((o) => o.prof === p && o.kind === 'buy'), sells = offers.filter((o) => o.prof === p && o.kind === 'sell');
    console.log(`${p.padEnd(12)} earns up to ${buys.length * 12} beryl a restock from ${buys.length} offers; dearest sale ${Math.max(...sells.map((o) => o.giveN))} beryl (${nameOf(sells.sort((a, b) => b.giveN - a.giveN)[0].get)})`);
  }
}

if (on('loot')) {
  head('Loot: average chest by kind (value in beryl, diamonds, gilded apples, beryl)');
  const v = valueTable();
  for (const [name, kind] of Object.entries(CHEST_KINDS)) {
    const s = chestStats(kind, 3000, 5, v);
    console.log(`${name.padEnd(16)} value ${f(s.value).padStart(6)}  stacks ${f(s.stacks, 1)}  diamonds ${f(s.items.get(I.DIAMOND) || 0)}  gilded apples ${f(s.items.get(I.GILDED_APPLE) || 0)}  beryl ${f(s.items.get(I.BERYL) || 0)}`);
  }
  head('Loot: fishing (per cast)');
  for (const luck of [0, 3]) { const c = fishingStats(luck); console.log(`luck ${luck}: diamond ${f(c.get(I.DIAMOND) || 0, 4)}  iron ${f(c.get(I.IRON_INGOT) || 0, 4)}`); }
}

if (on('craft')) {
  head('Crafting graph');
  const src = naturalSources();
  const extra = new Set(ITEMS.filter((it) => it && (it.potion || it.splash || it.lingering)).map((i) => i.id));
  const { dead, obtainable } = deadRecipes(src, extra);
  console.log(`${src.size} items come from the world, mobs, chests, trades, fishing or digging; ${obtainable.size} are obtainable in all`);
  console.log(`recipes that can never be made: ${dead.length}${dead.length ? ' - ' + dead.map((d) => nameOf(d.result)).join(', ') : ''}`);
  console.log(`resource-creating loops: ${resourceLoops().map(nameOf).join(', ') || 'none'}`);
  for (const k of ['DIAMOND', 'GILDED_APPLE', 'CHARM_OF_UNDYING', 'VOID_PEARL', 'SADDLE', 'NAME_TAG', 'SUNCORE', 'VOIDWING', 'TIDESPEAR', 'BERYL']) {
    const s = [...(src.get(I[k]) || [])];
    console.log(`  ${k.padEnd(16)} ${s.length} sources: ${s.join(', ')}`);
  }
}

if (on('combat')) {
  head('Combat: damage taken by the player after armour (Bulwark IV x4 = 16)');
  const sets = armorSets();
  console.log('hit'.padEnd(6) + Object.keys(sets).map((k) => k.padStart(18)).join(''));
  for (const d of [2, 3, 5, 7, 10, 15, 30]) console.log(String(d).padEnd(6) + Object.values(sets).map((s) => `${f(damageAfter(d, s))}/${f(damageAfter(d, s, 16))}`.padStart(18)).join(''));
  console.log('melee monsters (attack): ' + meleeMobs().map((m) => `${m.name} ${m.attack}`).join(', '));
  head('Combat: hits to kill the bosses');
  console.log('weapon'.padEnd(22) + 'Warden (90 hp, diamond)'.padEnd(26) + 'Hushkeeper (500 hp)');
  for (const r of bossTable()) console.log(r.weapon.padEnd(22) + String(r.warden).padEnd(26) + r.hushkeeper);
}

if (on('misc')) {
  head('Food');
  for (const x of foods().sort((a, b) => b.saturation / b.hunger - a.saturation / a.hunger).slice(0, 8)) console.log(`${x.name.padEnd(20)} hunger ${x.hunger} saturation ${x.saturation} (x${f(x.saturation / x.hunger)})`);
  head('Experience');
  console.log(`total to level 15 / 30 / 50: ${xpTotal(15)} / ${xpTotal(30)} / ${xpTotal(50)}`);
  head('Seasons: crop growth');
  const y = yearlyGrowth();
  console.log(`growth multiplier over a year: mean ${f(y.mean)} min ${f(y.min)} max ${f(y.max)}`);
  console.log('stage chance per random tick (well-watered field):', Object.entries(seasonalChances()).map(([k, v]) => `${k} ${f(v, 3)}`).join(', '));
  head('Enchantments');
  console.log(`full Bulwark IV set: protection ${maxProtection()} of 20 (damage x ${f(1 - maxProtection() / 25)})`);
}

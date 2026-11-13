// The Assembler: an automatic workbench for cinnabar machines. Its nine slots are a 3 x 3 crafting grid. Lay a recipe out in
// it; on every rising cinnabar pulse it crafts that recipe once and throws the result out of its face (into a container in
// front, if there is one). It never uses the last item of a slot: that item is the pattern, so the grid keeps its shape while
// hoppers feed it. A hopper can only add to slots that already hold the same item and fills the emptiest first; nothing can
// be pulled out of it. Ingredients that do not stack (a Milk Bucket) cannot be kept as a pattern, so such recipes are made by hand.
// A Comparator reads how full the grid is, like any container.
import { craft } from '../player/crafting.js';
import { ITEMS } from './items.js';
import { containerAccess, insertOne } from './hoppers.js';

/** What the grid would make now: the result stack, or null (no recipe, or a slot is down to its pattern item). */
export function assemblerResult(slots) {
  if (!slots.some(Boolean)) return null;
  if (slots.some((s) => s && s.count < 2)) return null;
  return craft(slots.map((s) => (s ? { ...s, count: 1 } : null)), 3) || null;
}

/** The recipe the grid is laid out for, whether or not it has the items to spare (for the screen's preview). */
export function assemblerPattern(slots) {
  if (!slots.some(Boolean)) return null;
  return craft(slots.map((s) => (s ? { ...s, count: 1 } : null)), 3) || null;
}

/**
 * One pulse: craft once. `game` provides the world, entities.spawnItem, and (through world/hoppers.js) the containers.
 * Returns 'craft', 'insert' (the result went into the container in front), 'empty' (no recipe) or 'fail' (no room in front).
 */
export function assemble(game, x, y, z, slots, dir, rng = Math.random) {
  const sound = (s) => { if (game.audio) game.audio.play(s, [x + 0.5, y + 0.5, z + 0.5]); };
  const out = assemblerResult(slots);
  if (!out) { sound('click'); return 'empty'; }
  const [dx, dy, dz] = dir;
  const target = containerAccess(game, x + dx, y + dy, z + dz);
  const extras = [];
  for (const s of slots) { const rest = s && ITEMS[s.id] && ITEMS[s.id].craftRemainder; if (rest) extras.push({ id: rest, count: 1, damage: 0 }); }
  if (target) {
    // all or nothing: try on a copy of the target's stacks first
    const into = target.insert(dy < 0);
    const before = into.map((s) => { const c = s.get(); return c ? { ...c } : null; });
    let ok = true;
    for (let k = 0; k < out.count && ok; k++) ok = insertOne(into, { ...out, count: 1 });
    if (!ok) { into.forEach((s, i) => s.set(before[i])); sound('click'); return 'fail'; }
  } else {
    const sp = 0.1 + rng() * 0.1;
    game.entities.spawnItem(x + 0.5 + dx * 0.7, y + 0.5 + dy * 0.7 - (dy ? 0.125 : 0.15), z + 0.5 + dz * 0.7, { ...out }, [dx * sp, dy ? dy * sp : 0.2, dz * sp]);
  }
  for (let i = 0; i < slots.length; i++) if (slots[i]) slots[i] = { ...slots[i], count: slots[i].count - 1 };
  for (const st of extras) game.entities.spawnItem(x + 0.5 + dx * 0.7, y + 0.5 + dy * 0.7, z + 0.5 + dz * 0.7, st, [dx * 0.1, 0.2, dz * 0.1]);
  sound('pop');
  return target ? 'insert' : 'craft';
}

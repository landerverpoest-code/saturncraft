// Elixirs (potions): every kind, its effects and its colour, plus the brewing
// tree. Pure data + functions (unit tested); items.js registers one drinkable
// and one splash item per kind, brewing.js runs the Brewing Alembic.
//
// Durations and amplifiers follow the reference game: [effect, ticks, amplifier].

const M = 60 * 20; // a minute in ticks
export const POTIONS = {
  water:            { name: 'Water Vial', effects: [], color: '#385dc6' },
  murky:            { name: 'Murky Elixir', effects: [], color: '#4a62c0' },  // the base for effects (reference: awkward)
  bland:            { name: 'Bland Elixir', effects: [], color: '#4a62c0' },  // mundane
  thick:            { name: 'Thick Elixir', effects: [], color: '#4a62c0' },
  swiftness:        { name: 'Elixir of Swiftness', effects: [['speed', 3 * M, 0]] },
  long_swiftness:   { name: 'Elixir of Swiftness', effects: [['speed', 8 * M, 0]] },
  strong_swiftness: { name: 'Elixir of Swiftness', effects: [['speed', 1.5 * M, 1]] },
  slowness:         { name: 'Elixir of Slowness', effects: [['slowness', 1.5 * M, 0]] },
  long_slowness:    { name: 'Elixir of Slowness', effects: [['slowness', 4 * M, 0]] },
  strong_slowness:  { name: 'Elixir of Slowness', effects: [['slowness', 20 * 20, 3]] },
  leaping:          { name: 'Elixir of Leaping', effects: [['jump_boost', 3 * M, 0]] },
  long_leaping:     { name: 'Elixir of Leaping', effects: [['jump_boost', 8 * M, 0]] },
  strong_leaping:   { name: 'Elixir of Leaping', effects: [['jump_boost', 1.5 * M, 1]] },
  strength:         { name: 'Elixir of Strength', effects: [['strength', 3 * M, 0]] },
  long_strength:    { name: 'Elixir of Strength', effects: [['strength', 8 * M, 0]] },
  strong_strength:  { name: 'Elixir of Strength', effects: [['strength', 1.5 * M, 1]] },
  healing:          { name: 'Elixir of Healing', effects: [['instant_health', 1, 0]] },
  strong_healing:   { name: 'Elixir of Healing', effects: [['instant_health', 1, 1]] },
  harming:          { name: 'Elixir of Harming', effects: [['instant_damage', 1, 0]] },
  strong_harming:   { name: 'Elixir of Harming', effects: [['instant_damage', 1, 1]] },
  poison:           { name: 'Elixir of Poison', effects: [['poison', 45 * 20, 0]] },
  long_poison:      { name: 'Elixir of Poison', effects: [['poison', 1.5 * M, 0]] },
  strong_poison:    { name: 'Elixir of Poison', effects: [['poison', 432, 1]] },
  regeneration:     { name: 'Elixir of Regeneration', effects: [['regeneration', 45 * 20, 0]] },
  long_regeneration:   { name: 'Elixir of Regeneration', effects: [['regeneration', 1.5 * M, 0]] },
  strong_regeneration: { name: 'Elixir of Regeneration', effects: [['regeneration', 450, 1]] },
  fire_resistance:      { name: 'Elixir of Fire Resistance', effects: [['fire_resistance', 3 * M, 0]] },
  long_fire_resistance: { name: 'Elixir of Fire Resistance', effects: [['fire_resistance', 8 * M, 0]] },
  water_breathing:      { name: 'Elixir of Water Breathing', effects: [['water_breathing', 3 * M, 0]] },
  long_water_breathing: { name: 'Elixir of Water Breathing', effects: [['water_breathing', 8 * M, 0]] },
  night_vision:      { name: 'Elixir of Night Vision', effects: [['night_vision', 3 * M, 0]] },
  long_night_vision: { name: 'Elixir of Night Vision', effects: [['night_vision', 8 * M, 0]] },
  invisibility:      { name: 'Elixir of Invisibility', effects: [['invisibility', 3 * M, 0]] },
  long_invisibility: { name: 'Elixir of Invisibility', effects: [['invisibility', 8 * M, 0]] },
  weakness:          { name: 'Elixir of Weakness', effects: [['weakness', 1.5 * M, 0]] },
  long_weakness:     { name: 'Elixir of Weakness', effects: [['weakness', 4 * M, 0]] },
  slow_falling:      { name: 'Elixir of Slow Falling', effects: [['slow_falling', 1.5 * M, 0]] },
  long_slow_falling: { name: 'Elixir of Slow Falling', effects: [['slow_falling', 4 * M, 0]] },
};
export const POTION_KEYS = Object.keys(POTIONS);

/**
 * The brewing tree, by ingredient item key (see items.js). Each maps a
 * potion kind to what it turns into. Built from a few rules:
 *  - Cinderroot turns water into the Murky base; other ingredients make Bland, Glowshard Dust Thick
 *  - effect ingredients turn Murky into their elixir
 *  - Cinnabar Dust extends (long_), Glowshard Dust strengthens (strong_)
 *  - a Fermented Skitterer Eye corrupts: good effects into their bad twin
 *  - Blast Powder turns any drinkable vial into a splash one (handled in brewing.js)
 */
export const EFFECT_INGREDIENTS = {
  sugar: 'swiftness',
  gilded_melon_slice: 'healing',
  spider_eye: 'poison',            // Skitterer Eye
  ember_cream: 'fire_resistance',
  gilded_carrot: 'night_vision',
  spinefish: 'water_breathing',
  ember_powder: 'strength',
  wraith_tear: 'regeneration',
  slimeball: 'leaping',            // the reference uses a rabbit's foot; there are no rabbits here
  feather: 'slow_falling',         // reference: phantom membrane
};

const CORRUPT = {
  swiftness: 'slowness', long_swiftness: 'long_slowness',
  leaping: 'slowness', long_leaping: 'long_slowness',
  healing: 'harming', strong_healing: 'strong_harming',
  poison: 'harming', long_poison: 'harming', strong_poison: 'strong_harming',
  night_vision: 'invisibility', long_night_vision: 'long_invisibility',
  water: 'weakness',
};

/** The base effect kind of a potion kind ("long_swiftness" -> "swiftness"). */
export const baseKind = (k) => k.replace(/^(long|strong)_/, '');

/** What `kind` becomes with ingredient `ing` (item key), or null if it does not brew. */
export function brewKind(kind, ing) {
  if (!POTIONS[kind]) return null;
  if (ing === 'cinderroot') return kind === 'water' ? 'murky' : null;
  if (ing === 'fermented_spider_eye') return CORRUPT[kind] || null;
  if (ing === 'cinnabar') {
    if (kind === 'water') return 'bland';
    const b = baseKind(kind), long = 'long_' + b;
    return POTIONS[long] && kind !== long ? long : null;
  }
  if (ing === 'glowshard_dust') {
    if (kind === 'water') return 'thick';
    const b = baseKind(kind), strong = 'strong_' + b;
    return POTIONS[strong] && kind !== strong ? strong : null;
  }
  const eff = EFFECT_INGREDIENTS[ing];
  if (eff) {
    if (kind === 'murky') return eff;
    if (kind === 'water') return 'bland';
  }
  return null;
}

/** Every ingredient key the alembic accepts. */
export const BREW_INGREDIENTS = ['cinderroot', 'fermented_spider_eye', 'cinnabar', 'glowshard_dust', 'gunpowder', ...Object.keys(EFFECT_INGREDIENTS)];

/** Elixir colour: the effects' average, or the kind's own (water blue). */
export function potionColor(kind) {
  const p = POTIONS[kind];
  if (!p) return '#ff00ff';
  if (p.color) return p.color;
  return EFFECT_COLORS[p.effects[0][0]] || '#ff00ff';
}
// kept here so this module stays free of imports (workers / tests)
const EFFECT_COLORS = {
  speed: '#7cafc6', slowness: '#5a6c81', strength: '#932423', weakness: '#484d48', instant_health: '#f82423',
  instant_damage: '#430a09', jump_boost: '#22ff4c', regeneration: '#cd5cab', poison: '#4e9331', fire_resistance: '#e49a3a',
  water_breathing: '#2e5299', night_vision: '#1f1fa1', invisibility: '#7f8392', slow_falling: '#f3cfb9', haste: '#d9c043',
};

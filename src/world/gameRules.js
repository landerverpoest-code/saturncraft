// World rules beyond the first five (ui/commands.js GAME_RULES): what a death costs, which damage counts, what monsters
// and fire may do to the world, and whether things drop. A rule lives in the game's settings under its own name and is
// saved with the world (world/save.js). The simulation reads them through `rule(name)`, which looks at the settings of
// the running game (set once by the Game; tests may pass their own object or leave it unset for the defaults).
//
//   keepInventory        a death keeps items and experience              (off)
//   naturalRegeneration  a full stomach heals                            (on)
//   fallDamage / drowningDamage / fireDamage   those hurts count         (on)
//   mobGriefing          monsters' blasts break blocks                   (on)
//   doFireTick           fire spreads and burns out; lava sets fires     (on)
//   doWeatherCycle       the weather changes by itself                   (on)
//   doMobLoot            creatures drop items and experience             (on)
//   doTileDrops          broken blocks drop items                        (on)
//   blastsLightFires     explosions leave fires behind                   (off)

export const WORLD_RULES = {
  keepInventory: { def: false, desc: 'Keep items and experience on death' },
  naturalRegeneration: { def: true, desc: 'A full stomach heals' },
  fallDamage: { def: true, desc: 'Falls hurt' },
  drowningDamage: { def: true, desc: 'Running out of air hurts' },
  fireDamage: { def: true, desc: 'Fire and lava hurt' },
  mobGriefing: { def: true, desc: "Monsters' blasts break blocks" },
  doFireTick: { def: true, desc: 'Fire spreads and burns out' },
  doWeatherCycle: { def: true, desc: 'The weather changes by itself' },
  doMobLoot: { def: true, desc: 'Creatures drop items and experience' },
  doTileDrops: { def: true, desc: 'Broken blocks drop items' },
  blastsLightFires: { def: false, desc: 'Explosions leave fires behind' },
};

export const WORLD_RULE_NAMES = Object.keys(WORLD_RULES);

/** The value of a rule in a settings object (the default when it was never set or is not a boolean). */
export function ruleIn(settings, name) {
  const r = WORLD_RULES[name];
  if (!r) return false;
  const v = settings ? settings[name] : undefined;
  return typeof v === 'boolean' ? v : r.def;
}

let active = null;
/** The settings object the running game keeps its rules in (null: every rule at its default). */
export function setActiveRules(settings) { active = settings || null; }
/** Is the rule on in the running game? */
export const rule = (name) => ruleIn(active, name);

/** The rules as a plain object for a save. */
export function saveRules(settings) {
  const out = {};
  for (const n of WORLD_RULE_NAMES) out[n] = ruleIn(settings, n);
  return out;
}

/** Lay a save's rules over the settings (missing or broken ones go back to their defaults: the world owns its rules). */
export function loadRules(settings, saved) {
  for (const n of WORLD_RULE_NAMES) settings[n] = saved && typeof saved[n] === 'boolean' ? saved[n] : WORLD_RULES[n].def;
}

/** Damage sources a rule can switch off: source -> rule name. */
export const DAMAGE_RULES = { fall: 'fallDamage', stalagmite: 'fallDamage', wall: 'fallDamage', drown: 'drowningDamage', fire: 'fireDamage', lava: 'fireDamage', burn: 'fireDamage' };

/** Does this damage source count under the given settings? */
export function damageCounts(settings, source) {
  const r = DAMAGE_RULES[source];
  return !r || ruleIn(settings, r);
}

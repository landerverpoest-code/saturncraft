// Pattern rules for Dutch block / item / creature names (used by tName() in ui/i18n.js when a name is not listed in
// ui/lang/nl_names.js). Each rule is a pure function (englishName, tr) -> Dutch string, or null when it does not apply;
// `tr` translates a part of the name (dictionary, then these rules, then the English text). Order matters: NAME_RULES is
// tried top to bottom and the first rule that answers wins.
import { COLOURS, COLOUR_PRODUCTS, WOODS, WOOD_PARTS, GEAR_MATERIALS, GEAR_KINDS, EFFECT_NAMES } from './lang/nl_names.js';

/** Upper-case the first letter (the digraph "ij" counts as one letter: IJzer). */
export const cap = (s) => (/^ij/.test(s) ? 'IJ' + s.slice(2) : s.charAt(0).toUpperCase() + s.slice(1));
/** Lower-case the first letter (IJzer -> ijzer). */
export const lc = (s) => (/^IJ/.test(s) ? 'ij' + s.slice(2) : s.charAt(0).toLowerCase() + s.slice(1));
/** Lower-case the start of a translated part so it can follow an adjective; invented names (unchanged) keep their capital. */
const low = (en, nl) => (nl !== en ? lc(nl) : nl);
/**
 * Glue a Dutch word to a stem: "Keisteen" + "plaat" -> "Keisteenplaat". An invented name (Tidestone, left English) takes a
 * hyphen: "Tidestone-plaat".
 */
export function compound(stem, word, untranslated = false) {
  const last = stem.split(' ').pop();
  const proper = /^[A-Z]/.test(last) && (untranslated || stem.includes(' '));
  return proper ? `${stem}-${word}` : `${stem}${word}`;
}
const stemOf = (en, tr) => { const nl = tr(en); return { nl, untranslated: nl === en }; };

const colourOf = (name) => {
  for (const c of Object.keys(COLOURS)) if (name.startsWith(c + ' ')) return [c, name.slice(c.length + 1)];
  return null;
};

/** "Lit Red Candle" -> "Brandende rode kaars" */
export const ruleLit = (name, tr) => {
  const m = /^Lit (.+)$/.exec(name);
  return m ? `Brandende ${low(m[1], tr(m[1]))}` : null;
};
/** "Splash X" / "Lingering X": thrown and lingering elixirs */
export const ruleThrown = (name, tr) => {
  let m = /^Splash (.+)$/.exec(name);
  if (m) return `Werpbaar ${low(m[1], tr(m[1]))}`;
  m = /^Lingering (.+)$/.exec(name);
  return m ? `Nawerkend ${low(m[1], tr(m[1]))}` : null;
};
/** "Elixir of Swiftness" -> "Elixer van snelheid"; "Arrow of Decay" -> "Pijl van verval" */
export const ruleElixir = (name) => {
  const m = /^(Elixir|Arrow) of (.+)$/.exec(name);
  if (!m || !EFFECT_NAMES[m[2]]) return null;
  return `${m[1] === 'Elixir' ? 'Elixer' : 'Pijl'} van ${EFFECT_NAMES[m[2]]}`;
};
/** "Mooxen Egg" -> "Mooxen-ei"; "Cinder Brute Egg" -> "Ei van Cinder Brute" (creature part through trCreature) */
export const ruleEgg = (name, tr, trCreature = tr) => {
  const m = /^(.+) Egg$/.exec(name);
  if (!m) return null;
  const c = trCreature(m[1]);
  return c.includes(' ') ? `Ei van ${c}` : `${c}-ei`;
};
/** The 16 colours with wool, carpet, concrete, terracotta, stained glass (+ pane), candle, box, tiles, star, rocket, dye */
export const ruleColour = (name) => {
  const hit = colourOf(name);
  if (!hit) return null;
  const p = COLOUR_PRODUCTS[hit[1]];
  if (!p) return null;
  const [bare, inflected] = COLOURS[hit[0]];
  return `${p[1] === 'de' ? inflected : bare} ${p[0]}`;
};
/** Wood families: "Oak Planks" -> "Eikenhouten planken", "Birch Log" -> "Berkenstam", "Dark Oak Door" -> "Donkereikenhouten deur" */
export const ruleWood = (name) => {
  for (const w of Object.keys(WOODS)) {
    if (!name.startsWith(w + ' ')) continue;
    const part = WOOD_PARTS[name.slice(w.length + 1)];
    if (!part) continue;
    return part[1] ? `${WOODS[w]}houten ${part[0]}` : `${WOODS[w]}${part[0]}`;
  }
  return null;
};
/** Tool and armour sets by material: "Iron Pickaxe" -> "IJzeren houweel", "Golden Boots" -> "Gouden laarzen" */
export const ruleGear = (name) => {
  const m = /^(\S+) (.+)$/.exec(name);
  if (!m || !GEAR_MATERIALS[m[1]] || !GEAR_KINDS[m[2]]) return null;
  return `${GEAR_MATERIALS[m[1]]} ${GEAR_KINDS[m[2]]}`;
};
/** "Music Disc: Three Suns" -> "Muziekschijf: Three Suns"; "Inlay Stencil: Ringed" -> "Inlegsjabloon: Ringed" */
export const ruleDisc = (name) => {
  let m = /^Music Disc: (.+)$/.exec(name);
  if (m) return `Muziekschijf: ${m[1]}`;
  m = /^Inlay Stencil: (.+)$/.exec(name);
  return m ? `Inlegsjabloon: ${m[1]}` : null;
};
/** "Wyrm Sherd" -> "Wyrm-scherf" */
export const ruleSherd = (name) => {
  const m = /^(.+) Sherd$/.exec(name);
  return m ? `${m[1]}-scherf` : null;
};
/** "Raw X" / "Roast X" / "Cooked X" for creature meats and fish that are not listed */
export const ruleMeat = (name, tr) => {
  const m = /^(Raw|Roast|Cooked) (.+)$/.exec(name);
  if (!m) return null;
  const pre = { Raw: 'Rauwe', Roast: 'Gebraden', Cooked: 'Gebakken' }[m[1]];
  return `${pre} ${low(m[2], tr(m[2]))}`;
};
/** "Gold Nugget" -> "Goudklompje", "Iron Ingot" -> "IJzerstaaf" */
export const ruleMetal = (name, tr) => {
  const m = /^(.+) (Nugget|Ingot)$/.exec(name);
  if (!m) return null;
  const s = stemOf(m[1], tr);
  return compound(s.nl, m[2] === 'Nugget' ? 'klompje' : 'staaf', s.untranslated);
};
/** "Polished Granite" -> "Gepolijst graniet" */
export const rulePolished = (name, tr) => {
  const m = /^Polished (.+)$/.exec(name);
  return m ? `Gepolijst ${low(m[1], tr(m[1]))}` : null;
};
/** "Deep Iron Ore" -> "Diep ijzererts" */
export const ruleDeep = (name, tr) => {
  const m = /^Deep (.+)$/.exec(name);
  return m ? `Diep ${low(m[1], tr(m[1]))}` : null;
};
/** "Iron Ore" -> "IJzererts", "Coal Block" -> "Steenkoolblok", "Cobblestone Slab" -> "Keisteenplaat", "... Stairs", "... Wall" */
export const ruleSuffix = (name, tr) => {
  const m = /^(.+) (Ore|Block|Slab|Stairs|Wall)$/.exec(name);
  if (!m) return null;
  const word = { Ore: 'erts', Block: 'blok', Slab: 'plaat', Stairs: 'trap', Wall: 'muur' }[m[2]];
  const s = stemOf(m[1], tr);
  return compound(s.nl, word, s.untranslated);
};

/** Tried in this order; the first rule that returns a string wins. */
export const NAME_RULES = [
  ruleLit, ruleThrown, ruleElixir, ruleEgg, ruleColour, ruleWood, ruleGear, ruleDisc, ruleSherd, ruleMeat, ruleMetal,
  rulePolished, ruleDeep, ruleSuffix,
];

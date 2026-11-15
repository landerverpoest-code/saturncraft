// A small translation layer. The KEY IS THE ENGLISH TEXT, so a string without a translation simply stays English and
// the code around it needs hardly any change: `t('Respawn')`, `t("Joined {name}'s world", { name })`.
// Dictionaries live in ui/lang/<code>.js as plain objects English -> translation. Placeholders are `{name}`.
// Static HTML is translated with translateDom(root): `data-i18n` (the element's text) and
// `data-i18n-attr="placeholder,title"` (those attributes). The English original is remembered, so the language can be
// switched back and forth while the page is open. Everything here works in node (no document needed).
import nl from './lang/nl.js';
import NAMES_NL, { CREATURE_NAMES } from './lang/nl_names.js';
import { NAME_RULES } from './nameRules.js';

export const LANGUAGES = { en: 'English', nl: 'Nederlands' };
const DICTIONARIES = { en: {}, nl };

let current = 'en';

/** The language a first run starts in: Dutch for Dutch browsers, English everywhere else (and in node). */
export function detectLanguage() {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator) return 'en';
    if (typeof navigator.language === 'string' && /^nl([-_]|$)/i.test(navigator.language)) return 'nl';
  } catch { /* no navigator */ }
  return 'en';
}

/** Is this a language code we have? */
export const isLanguage = (code) => typeof code === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGES, code);

/** Switch language (an unknown code means English). Updates <html lang> when there is a document. */
export function setLanguage(code) {
  current = isLanguage(code) ? code : 'en';
  try { if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = current; } catch { /* ignore */ }
  return current;
}
export const getLanguage = () => current;

/** The next language in the list (for a cycling button). */
export function nextLanguage(code = current) {
  const codes = Object.keys(LANGUAGES);
  return codes[(codes.indexOf(code) + 1) % codes.length];
}

/** Fill `{name}` placeholders from `vars` (unknown ones stay as written). */
export function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (all, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : all));
}

/** Translate English `text` into the current language (English when there is no translation), filling `{placeholders}`. */
export function t(text, vars) {
  const s = String(text);
  const dict = DICTIONARIES[current];
  const out = dict && Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s;
  return fill(out, vars);
}

const texts = new WeakMap(); // element -> { en, out }  (the English text and what we last wrote)
const attrs = new WeakMap(); // element -> { attr: { en, out } }

function remember(map, key, now) {
  let rec = map[key];
  // someone else changed the text since we wrote it: that is the new English original
  if (!rec || (now !== rec.en && now !== rec.out)) rec = map[key] = { en: now, out: now };
  rec.out = t(rec.en);
  return rec.out;
}

/** Translate every `data-i18n` / `data-i18n-attr` element under `root` (and root itself) into the current language. */
export function translateDom(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const list = Array.from(root.querySelectorAll('[data-i18n],[data-i18n-attr]'));
  if (typeof root.hasAttribute === 'function' && (root.hasAttribute('data-i18n') || root.hasAttribute('data-i18n-attr'))) list.unshift(root);
  for (const el of list) {
    if (el.hasAttribute('data-i18n')) {
      const m = texts.get(el) || {};
      const out = remember(m, 'text', el.textContent);
      texts.set(el, m);
      if (el.textContent !== out) el.textContent = out;
    }
    const names = (el.getAttribute('data-i18n-attr') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (names.length) {
      const m = attrs.get(el) || {};
      for (const a of names) {
        const now = el.getAttribute(a);
        if (now === null || now === undefined) continue;
        const out = remember(m, a, now);
        if (now !== out) el.setAttribute(a, out);
      }
      attrs.set(el, m);
    }
  }
}

// ---- names of blocks, items and creatures (display only; the English registry names stay the identity of everything) ----
const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
const NAME_DICTIONARIES = { nl: { names: NAMES_NL, creatures: CREATURE_NAMES } };
const nameCache = { nl: new Map(), nlCreature: new Map() };

function resolveName(name, creature) {
  const book = NAME_DICTIONARIES[current];
  if (!book) return name;
  const cache = creature ? nameCache.nlCreature : nameCache.nl;
  if (cache.has(name)) return cache.get(name);
  let out = name;
  if (creature && has(book.creatures, name)) out = book.creatures[name];
  else if (has(book.names, name)) out = book.names[name];
  else {
    const tr = (n) => resolveName(n, false), trCreature = (n) => resolveName(n, true);
    for (const rule of NAME_RULES) {
      const r = rule(name, tr, trCreature);
      if (typeof r === 'string' && r) { out = r; break; }
    }
  }
  cache.set(name, out);
  return out;
}

/** The display name of a block or item in the current language: the Dutch dictionary, then the pattern rules, else English. */
export function tName(name) {
  if (typeof name !== 'string' || !name || current === 'en') return name;
  return resolveName(name, false);
}
/** The display name of a creature (creature spellings win over block/item ones: the Hopper mob vs. the Hopper block). */
export function tCreature(name) {
  if (typeof name !== 'string' || !name || current === 'en') return name;
  return resolveName(name, true);
}
/** Does the (lower-case) search text `q` match this name in English or in the current language? */
export function nameMatches(name, q) {
  if (!q) return true;
  const n = String(name);
  return n.toLowerCase().includes(q) || tName(n).toLowerCase().includes(q);
}

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { t, setLanguage, getLanguage, LANGUAGES, translateDom, detectLanguage, nextLanguage, fill } from '../src/ui/i18n.js';
import nl from '../src/ui/lang/nl.js';
import { WORLD_RULES } from '../src/world/gameRules.js';
import { HINTS, STEPS } from '../src/player/onboarding.js';

afterEach(() => setLanguage('en'));

// Dutch words that are legitimately the same as the English ones
const SAME_AS_ENGLISH = new Set(['OK', 'Shaders', 'chunks', 'seed {seed}', 'Winter', 'Volume:']);

function sourceText() {
  const files = [path.resolve('index.html')];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== 'lang') walk(p); } else if (f.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.resolve('src'));
  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

describe('i18n layer', () => {
  it('defaults to English and falls back to the English text', () => {
    expect(getLanguage()).toBe('en');
    expect(detectLanguage()).toBe('en'); // node: no browser language
    expect(t('Respawn')).toBe('Respawn');
    setLanguage('nl');
    expect(t('Respawn')).toBe('Herleven');
    expect(t('Something nobody translated')).toBe('Something nobody translated');
    setLanguage('xx');
    expect(getLanguage()).toBe('en');
  });

  it('fills placeholders and leaves unknown ones alone', () => {
    expect(t('Respawn in {n}', { n: 3 })).toBe('Respawn in 3');
    setLanguage('nl');
    expect(t('Respawn in {n}', { n: 3 })).toBe('Herleven over 3');
    expect(t('Hold {attack} now')).toBe('Hold {attack} now');
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('lists the languages and cycles through them', () => {
    expect(Object.keys(LANGUAGES)).toEqual(['en', 'nl']);
    expect(LANGUAGES.nl).toBe('Nederlands');
    expect(nextLanguage('en')).toBe('nl');
    expect(nextLanguage('nl')).toBe('en');
  });
});

describe('Dutch dictionary', () => {
  it('has no empty values and no untranslated copies', () => {
    for (const [k, v] of Object.entries(nl)) {
      expect(typeof v === 'string' && v.trim().length > 0, `empty: ${k}`).toBe(true);
      if (!SAME_AS_ENGLISH.has(k)) expect(v, `same as English: ${k}`).not.toBe(k);
    }
  });

  it('keeps the placeholders of every entry', () => {
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
    for (const [k, v] of Object.entries(nl)) expect(ph(v), k).toBe(ph(k));
  });

  it('only has keys that still appear in the English sources', () => {
    const src = sourceText();
    const gone = Object.keys(nl).filter((k) => !src.includes(k));
    expect(gone).toEqual([]);
  });

  it('covers the world rules and the onboarding texts', () => {
    for (const r of Object.values(WORLD_RULES)) expect(nl[r.desc], r.desc).toBeTruthy();
    for (const h of Object.values(HINTS)) { expect(nl[h.title], h.title).toBeTruthy(); expect(nl[h.text], h.text).toBeTruthy(); }
    for (const s of STEPS) { expect(nl[s.label], s.label).toBeTruthy(); expect(nl[s.tip], s.tip).toBeTruthy(); }
  });
});

// a tiny stand-in for DOM elements: just what translateDom touches
function fakeEl(attrs = {}, text = '', kids = []) {
  const el = {
    attrs: { ...attrs }, textContent: text, kids,
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); },
    getAttribute(n) { return this.hasAttribute(n) ? this.attrs[n] : null; },
    setAttribute(n, v) { this.attrs[n] = String(v); },
    querySelectorAll() {
      const out = [];
      const walk = (e) => { for (const k of e.kids) { if (k.hasAttribute('data-i18n') || k.hasAttribute('data-i18n-attr')) out.push(k); walk(k); } };
      walk(this);
      return out;
    },
  };
  return el;
}

describe('translateDom', () => {
  it('translates text and attributes and round-trips back to English', () => {
    const btn = fakeEl({ 'data-i18n': '' }, 'Create New World');
    const input = fakeEl({ 'data-i18n-attr': 'placeholder,title', placeholder: 'Room code', title: 'Add a world from a .saturnworld file' });
    const plain = fakeEl({}, 'Create New World');
    const root = fakeEl({}, '', [btn, input, plain]);
    setLanguage('nl');
    translateDom(root);
    expect(btn.textContent).toBe('Nieuwe wereld maken');
    expect(input.attrs.placeholder).toBe('Kamercode');
    expect(input.attrs.title).toBe('Voeg een wereld toe uit een .saturnworld-bestand');
    expect(plain.textContent).toBe('Create New World'); // no data-i18n: left alone
    translateDom(root); // idempotent
    expect(btn.textContent).toBe('Nieuwe wereld maken');
    setLanguage('en');
    translateDom(root);
    expect(btn.textContent).toBe('Create New World');
    expect(input.attrs.placeholder).toBe('Room code');
    setLanguage('nl');
    translateDom(root);
    expect(btn.textContent).toBe('Nieuwe wereld maken');
  });

  it('treats text changed by other code as the new English original', () => {
    const el = fakeEl({ 'data-i18n': '' }, 'Respawn');
    setLanguage('nl');
    translateDom(el);
    expect(el.textContent).toBe('Herleven');
    el.textContent = 'Spectate a Friend';
    translateDom(el);
    expect(el.textContent).toBe('Een vriend bekijken');
    setLanguage('en');
    translateDom(el);
    expect(el.textContent).toBe('Spectate a Friend');
  });

  it('leaves untranslated text alone and survives odd input', () => {
    const el = fakeEl({ 'data-i18n': '' }, 'Not in the dictionary');
    setLanguage('nl');
    translateDom(el);
    expect(el.textContent).toBe('Not in the dictionary');
    expect(() => translateDom(null)).not.toThrow();
    expect(() => translateDom({})).not.toThrow();
  });
});

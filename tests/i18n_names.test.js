import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BLOCKS } from '../src/world/blocks.js';
import { ITEMS } from '../src/world/items.js';
import '../src/world/dimensions/register.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { setLanguage, tName, tCreature, nameMatches } from '../src/ui/i18n.js';
import * as R from '../src/ui/nameRules.js';
import NAMES, { COLOURS } from '../src/ui/lang/nl_names.js';

afterEach(() => setLanguage('en'));

const FORBIDDEN = /minecraft|nether|redstone|tripwire/i;
const uniq = (a) => [...new Set(a)];
let blocks, items, mobs;
beforeAll(async () => {
  for (const f of fs.readdirSync(path.resolve('src/mobs')).filter((x) => x.endsWith('.js'))) { try { await import(`../src/mobs/${f}`); } catch { /* needs a browser */ } }
  blocks = uniq(BLOCKS.filter(Boolean).map((b) => b.name));
  items = uniq(ITEMS.filter(Boolean).map((b) => b.name));
  mobs = uniq(Object.values(MOBS).map((m) => m.name));
});

// words that are legitimately the same in Dutch; other invented proper names (one or more capitalised words) count as allowed too
const ALLOW = new Set(['Water', 'Lava', 'Cactus', 'Ladder', 'Bed', 'TNT', 'Terracotta', 'Mycelium', 'Jukebox', 'Azalea', 'Kelp', 'Rift']);
const proper = (n) => /^[A-Z][a-z]+(?: [A-Z][a-z]+)*$/.test(n);

describe('Dutch names', () => {
  it('resolves every block, item and creature name', () => {
    setLanguage('nl');
    const all = [...blocks.map(tName), ...items.map(tName), ...mobs.map(tCreature)];
    expect(all.length).toBeGreaterThan(1000);
    for (const n of all) { expect(n.trim().length).toBeGreaterThan(0); expect(n).not.toMatch(FORBIDDEN); }
  });
  it('translates nearly everything (the rest are allow-listed proper names)', () => {
    setLanguage('nl');
    const pairs = [...blocks.map((n) => [n, tName(n)]), ...items.map((n) => [n, tName(n)]), ...mobs.map((n) => [n, tCreature(n)])];
    const ok = pairs.filter(([en, nl]) => nl !== en || ALLOW.has(en) || proper(en));
    expect(ok.length / pairs.length).toBeGreaterThanOrEqual(0.95);
    expect(pairs.filter(([en, nl]) => nl !== en).length / pairs.length).toBeGreaterThan(0.85);
  });
  it('leaves everything unchanged in English', () => {
    for (const n of [...blocks, ...items]) expect(tName(n)).toBe(n);
    for (const n of mobs) expect(tCreature(n)).toBe(n);
    expect(nameMatches('Oak Planks', 'planken')).toBe(false);
  });
  it('applies the rules to examples', () => {
    setLanguage('nl');
    const tr = (n) => tName(n);
    expect(tName('Oak Planks')).toBe('Eikenhouten planken');
    expect(tName('Red Wool')).toBe('Rode wol');
    expect(tName('Stone Pickaxe')).toBe('Stenen houweel');
    expect(tName('Copper Ore')).toBe('Kopererts');
    expect(tName('Iron Pickaxe')).toBe('IJzeren houweel');
    expect(tName('Cobblestone Slab')).toBe('Keisteenplaat');
    expect(tName('Splash Elixir of Healing')).toBe('Werpbaar elixer van genezing');
    expect(tName('Mooxen Egg')).toBe('Mooxen-ei');
    expect(tName('Deepstone')).toBe('Diepsteen');
    expect(tCreature('Hopper')).toBe('Hopper');
    expect(tName('Hopper')).toBe('Trechter');
    expect(R.ruleColour('Light Blue Carpet')).toBe('Lichtblauw tapijt');
    expect(R.ruleWood('Dark Oak Door')).toBe('Donkereikenhouten deur');
    expect(R.ruleGear('Golden Boots')).toBe('Gouden laarzen');
    expect(R.ruleSuffix('Tidestone Wall', tr)).toBe('Tidestone-muur');
    expect(R.ruleLit('Lit Red Candle', tr)).toBe('Brandende rode kaars');
    expect(R.ruleElixir('Arrow of Luck')).toBe('Pijl van geluk');
    expect(R.ruleWood('Stone')).toBeNull();
    expect(R.cap('ijzer')).toBe('IJzer');
    expect(Object.keys(COLOURS)).toHaveLength(16);
    expect(R.NAME_RULES.every((f) => typeof f === 'function')).toBe(true);
  });
  it('matches searches in both languages', () => {
    setLanguage('nl');
    expect(nameMatches('Oak Planks', 'planken')).toBe(true);
    expect(nameMatches('Oak Planks', 'oak')).toBe(true);
    expect(nameMatches('Oak Planks', 'zzz')).toBe(false);
  });
  it('has a clean dictionary', () => {
    for (const [k, v] of Object.entries(NAMES)) { expect(v.trim().length, k).toBeGreaterThan(0); expect(v + k).not.toMatch(FORBIDDEN); }
  });
});

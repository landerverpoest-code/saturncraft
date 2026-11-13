// World management: the world list summaries, rename / duplicate / delete, rolling backups, corruption detection and repair,
// storage quota handling, export / import of a world file, the creation options, the cheats switch, and save schema
// migration against fixture saves (tests/fixtures/saves, written by the real saveGame in each format).
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  CURRENT_VERSION, LIMITS, MIGRATIONS, migrateSave, validateSave, repairSave, inspectSave, estimateBytes, formatBytes, uniqueName, cleanName,
  shouldBackup, pushBackup, quotaLevel, isQuotaError, exportBytes, importBytes, encodeContainer, crc32, cleanThumbnail, chunkProblem, exportFileName,
} from '../src/world/saveFormat.js';
import { MemoryStorage, setStorage, storageStatus } from '../src/world/storage.js';
import {
  MAX_WORLDS, slotKey, metaKey, backupsKey, backupKey, writeWorld, listWorlds, loadWorld, loadGame, deleteSave, renameWorld, duplicateWorld,
  listBackups, restoreBackup, repairWorld, exportWorld, importWorld,
} from '../src/world/worldManager.js';
import { saveGame, packStats } from '../src/world/save.js';
import { cleanOptions, defaultOptions, seedFromText, settingsForOptions, applyNewWorldOptions } from '../src/world/newWorld.js';
import { runCommand, CHEAT_COMMANDS } from '../src/ui/commands.js';
import { Seasons } from '../src/world/seasons.js';
import { mockGame } from './fixtures/mockGame.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/saves/${name}.json`, import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));
const MIN = 60 * 1000;

let st;
beforeEach(() => { st = new MemoryStorage(); setStorage(st); });

/** A saved world through the real saveGame, as the stored record. */
async function savedWorld(over = {}) {
  const g = mockGame(over);
  const d = await saveGame(g);
  await deleteSave(g.saveSlot); // (callers that want it stored write it themselves, with the save times they need)
  return d;
}

describe('schema migration with fixture saves', () => {
  it('reads the current format as is', () => {
    const r = inspectSave(fixture('v2_current'));
    expect(r.status).toBe('ok');
    expect(r.from).toBe(CURRENT_VERSION);
    expect(r.data.meta.worldType).toBe('normal');
    expect(Object.keys(r.data.chunks)).toHaveLength(2);
  });

  it('migrates a version 1 save (no meta block) to the current version without touching the input', () => {
    const raw = fixture('v1_full');
    const before = JSON.stringify(raw);
    const r = inspectSave(raw);
    expect(raw.version).toBe(1);
    expect(JSON.stringify(raw)).toBe(before);
    expect(r.status).toBe('ok');
    expect(r.from).toBe(1);
    expect(r.data.version).toBe(CURRENT_VERSION);
    expect(r.data.meta).toEqual({ createdAt: raw.savedAt, worldType: 'normal', allowCheats: true, seedText: null, thumbnail: null });
    expect(r.data.name).toBe('Old Fixture');
    expect(r.data.player.slots).toEqual(raw.player.slots);
    expect(r.data.chunks).toEqual(raw.chunks);
  });

  it('migrates a very old save with no version field and none of the optional blocks', () => {
    const raw = fixture('v1_ancient');
    expect(raw.version).toBeUndefined();
    expect(raw.gameRules).toBeUndefined();
    const r = inspectSave(raw);
    expect(r.status).toBe('ok');
    expect(r.data.version).toBe(CURRENT_VERSION);
    expect(r.data.allowCheats).toBeUndefined();
    expect(r.data.meta.allowCheats).toBe(true); // worlds from before the option keep their commands
    expect(r.data.liveMobs).toEqual([]);
  });

  it('fills in the list fields an old save lacks', () => {
    const raw = fixture('v1_ancient');
    delete raw.furnaces; delete raw.generated; delete raw.liveMobs; delete raw.savedMobs;
    const r = inspectSave(raw);
    expect(r.status).toBe('ok');
    expect(r.data.furnaces).toEqual([]);
    expect(r.data.savedMobs).toEqual({});
  });

  it('has a migration step for every version below the current one', () => {
    for (let v = 1; v < CURRENT_VERSION; v++) expect(typeof MIGRATIONS[v]).toBe('function');
  });

  it('refuses a save from a newer game and an unknown version, and says so', () => {
    const newer = { ...fixture('v2_current'), version: CURRENT_VERSION + 1 };
    const r = inspectSave(newer);
    expect(r.status).toBe('newer');
    expect(r.problems[0].msg).toMatch(/newer version/);
    for (const v of [0, -1, 1.5, 'two', null]) expect(inspectSave({ ...fixture('v2_current'), version: v }).status).toBe('damaged');
    expect(migrateSave('nope').error).toBeTruthy();
    expect(migrateSave(null).error).toBeTruthy();
  });

  it('loads a migrated fixture through a stored slot, and the next save is written in the current format', async () => {
    await st.txn('readwrite', (s) => s.put(slotKey(1), fixture('v1_full')));
    const worlds = await listWorlds();
    expect(worlds[0].name).toBe('Old Fixture');
    expect(worlds[0].version).toBe(CURRENT_VERSION);
    const r = await loadWorld(1);
    expect(r.status).toBe('ok');
    expect(r.data.version).toBe(CURRENT_VERSION);
    const rewritten = await writeWorld(1, r.data);
    expect(rewritten.version).toBe(CURRENT_VERSION);
  });
});

describe('what saveGame writes', () => {
  it('writes the current version with a meta block and a list summary', async () => {
    const g = mockGame({ name: 'Summary World', seed: 99, ticks: 24000 });
    g.seedText = 'cheese'; g.allowCheats = false; g.thumbnail = 'data:image/jpeg;base64,/9j/4AAQ';
    const d = await saveGame(g);
    expect(d.version).toBe(CURRENT_VERSION);
    expect(d.meta).toMatchObject({ worldType: 'normal', allowCheats: false, seedText: 'cheese', createdAt: 1700000000000 });
    const [w] = await listWorlds();
    expect(w).toMatchObject({ slot: 1, name: 'Summary World', seed: 99, seedText: 'cheese', playTicks: 24000, allowCheats: false, seasons: true, gamemode: 'survival', difficulty: 'normal', damaged: false });
    expect(w.savedAt).toBe(d.savedAt);
    expect(w.size).toBeGreaterThan(10000);
    expect(w.thumbnail).toBe('data:image/jpeg;base64,/9j/4AAQ');
  });

  it('only trusts a short base64 image as a thumbnail', () => {
    expect(cleanThumbnail('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    for (const bad of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'data:image/jpeg;base64,"><script>', 12, null, 'data:image/jpeg;base64,' + 'A'.repeat(200001)]) expect(cleanThumbnail(bad)).toBeNull();
  });

  it('stays cheap: the per-chunk pack cache is used and a save inside the backup interval never reads the stored world', async () => {
    const reads = [];
    const orig = st.txn.bind(st);
    st.txn = (mode, fn) => orig(mode, (s) => fn({ ...s, get: (k) => { reads.push(k); return s.get(k); } }));
    const g = mockGame();
    const p0 = packStats.packed;
    await saveGame(g);
    const packedFirst = packStats.packed - p0;
    expect(packedFirst).toBe(2);
    await saveGame(g); // (the first backup is taken as soon as there is something to back up)
    const r0 = packStats.reused;
    reads.length = 0;
    await saveGame(g);
    expect(packStats.packed - p0).toBe(packedFirst); // nothing re-encoded
    expect(packStats.reused - r0).toBe(2);
    expect(reads).not.toContain(slotKey(1)); // only the small summary and index are read
    expect(reads).toContain(metaKey(1));
    // an edited chunk is packed again
    for (const c of g.world.chunks.values()) { c.rev++; break; }
    await saveGame(g);
    expect(packStats.packed - p0).toBe(packedFirst + 1);
  });

  it('round-trips the chunks exactly', async () => {
    const d = await saveGame(mockGame());
    const r = await loadWorld(1);
    expect(r.status).toBe('ok');
    for (const k of Object.keys(d.chunks)) {
      expect(Array.from(r.data.chunks[k].blocks)).toEqual(Array.from(d.chunks[k].blocks));
      expect(chunkProblem(r.data.chunks[k])).toBeNull();
    }
  });
});

describe('the world list: rename, duplicate, delete', () => {
  it('lists every world with its summary and leaves empty slots null', async () => {
    await saveGame(mockGame({ slot: 2, name: 'Second', ticks: 100 }));
    await saveGame(mockGame({ slot: 4, name: 'Fourth', ticks: 200 }));
    const w = await listWorlds();
    expect(w).toHaveLength(MAX_WORLDS);
    expect(w.map((x) => (x ? x.name : null)).slice(0, 5)).toEqual([null, 'Second', null, 'Fourth', null]);
  });

  it('renames in both the record and the summary, and refuses empty or markup-only names', async () => {
    await saveGame(mockGame({ name: 'Before' }));
    expect(await renameWorld(1, '  <b>After</b>  ')).toBe('bAfter/b');
    expect((await listWorlds())[0].name).toBe('bAfter/b');
    expect((await loadWorld(1)).data.name).toBe('bAfter/b');
    expect(await renameWorld(1, '   ')).toBeNull();
    expect(await renameWorld(1, 'x'.repeat(80))).toHaveLength(LIMITS.nameMax);
    expect(await renameWorld(7, 'Nothing here')).toBeNull();
  });

  it('duplicates into the first free slot under a unique name, without copying backups', async () => {
    await saveGame(mockGame({ name: 'Original' }));
    const copy = await duplicateWorld(1);
    expect(copy).toMatchObject({ slot: 2, name: 'Original copy' });
    const copy2 = await duplicateWorld(1);
    expect(copy2).toMatchObject({ slot: 3, name: 'Original copy (2)' });
    const a = (await loadWorld(1)).data, b = (await loadWorld(2)).data;
    expect(b.seed).toBe(a.seed);
    expect(Array.from(b.chunks[Object.keys(a.chunks)[0]].blocks)).toEqual(Array.from(a.chunks[Object.keys(a.chunks)[0]].blocks));
    expect((await listBackups(2))).toEqual([]);
    expect(await duplicateWorld(9)).toBeNull();
  });

  it('refuses to duplicate when every slot is used', async () => {
    for (let i = 1; i <= MAX_WORLDS; i++) await saveGame(mockGame({ slot: i, name: `W${i}` }));
    expect(await duplicateWorld(1)).toBeNull();
  });

  it('deletes the world, its summary and its backups', async () => {
    const base = await savedWorld();
    await writeWorld(1, { ...base, savedAt: 1000 * MIN });
    await writeWorld(1, { ...base, savedAt: 1100 * MIN });
    expect((await listBackups(1)).length).toBe(1);
    await deleteSave(1);
    expect(await st.txn('readonly', (s) => s.keys())).toEqual([]);
    expect((await listWorlds()).every((x) => x === null)).toBe(true);
  });

  it('moves a save from before world slots into the first free slot, and builds a missing summary', async () => {
    const raw = fixture('v1_full');
    await st.txn('readwrite', (s) => s.put('current', raw));
    const w = await listWorlds();
    expect(w[0].name).toBe('Old Fixture');
    expect(await st.txn('readonly', (s) => s.get('current'))).toBeNull();
    expect(await st.txn('readonly', (s) => s.get(metaKey(1)))).toBeTruthy();
  });

  it('shows an unreadable record as damaged instead of hiding it', async () => {
    await st.txn('readwrite', (s) => s.put(slotKey(3), { name: 'Broken one', seed: 5 }));
    const w = (await listWorlds())[2];
    expect(w).toMatchObject({ name: 'Broken one', damaged: true });
  });
});

describe('rolling backups', () => {
  it('decides when to take one', () => {
    expect(shouldBackup(0, [])).toBe(false);
    expect(shouldBackup(1000, [])).toBe(true);
    expect(shouldBackup(1000 + 10 * MIN, [{ savedAt: 1000 }])).toBe(false);
    expect(shouldBackup(1000 + 15 * MIN, [{ savedAt: 1000 }])).toBe(true);
    const { kept, dropped } = pushBackup([{ id: 'b' }, { id: 'c' }, { id: 'd' }], { id: 'a' }, 3);
    expect(kept.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(dropped.map((b) => b.id)).toEqual(['d']);
  });

  it('keeps the last N snapshots and deletes the older ones', async () => {
    const base = await savedWorld();
    const T = (i) => 1000 * MIN + i * 20 * MIN;
    for (let i = 0; i < 6; i++) await writeWorld(1, { ...base, savedAt: T(i), name: `v${i}` });
    const ring = await listBackups(1);
    expect(ring.map((b) => b.savedAt)).toEqual([T(4), T(3), T(2)]); // saves 0 and 1 fell off the end
    const keys = (await st.txn('readonly', (s) => s.keys())).filter((k) => k.startsWith('backup:'));
    expect(keys.sort()).toEqual(ring.map((b) => backupKey(1, b.id)).sort());
    expect((await st.txn('readonly', (s) => s.get(backupKey(1, ring[0].id)))).name).toBe('v4');
  });

  it('does not take a new backup on every autosave', async () => {
    const base = await savedWorld();
    for (let i = 0; i < 10; i++) await writeWorld(1, { ...base, savedAt: 5000 * MIN + i * MIN }); // a minute apart
    expect(await listBackups(1)).toHaveLength(1); // the first snapshot only
    await writeWorld(1, { ...base, savedAt: 5000 * MIN + 30 * MIN });
    expect(await listBackups(1)).toHaveLength(1);
    await writeWorld(1, { ...base, savedAt: 5000 * MIN + 50 * MIN });
    expect(await listBackups(1)).toHaveLength(2);
  });

  it('honours a smaller limit and can switch backups off', async () => {
    const base = await savedWorld();
    for (let i = 0; i < 5; i++) await writeWorld(1, { ...base, savedAt: 1000 * MIN + i * 20 * MIN }, { backupLimit: 1 });
    expect(await listBackups(1)).toHaveLength(1);
    await deleteSave(1);
    for (let i = 0; i < 4; i++) await writeWorld(1, { ...base, savedAt: 1000 * MIN + i * 20 * MIN }, { backup: false });
    expect(await listBackups(1)).toHaveLength(0);
  });

  it('never copies a broken world over a good backup', async () => {
    const base = await savedWorld();
    await writeWorld(1, { ...base, savedAt: 1000 * MIN });
    await writeWorld(1, { ...base, savedAt: 1020 * MIN });
    expect(await listBackups(1)).toHaveLength(1);
    await st.txn('readwrite', async (s) => { const d = await s.get(slotKey(1)); await s.put(slotKey(1), { ...d, seed: 'garbage' }); });
    await writeWorld(1, { ...base, savedAt: 1040 * MIN });
    const ring = await listBackups(1);
    expect(ring).toHaveLength(1);
    expect(ring[0].savedAt).toBe(1000 * MIN);
  });

  it('restores a backup, keeping the world it replaces as a backup too', async () => {
    const base = await savedWorld();
    await writeWorld(1, { ...base, savedAt: 1000 * MIN, name: 'old' });
    await writeWorld(1, { ...base, savedAt: 1020 * MIN, name: 'mid' });
    await writeWorld(1, { ...base, savedAt: 1040 * MIN, name: 'new' });
    const ring = await listBackups(1);
    const oldest = ring[ring.length - 1];
    const r = await restoreBackup(1, oldest.id, { now: 2000 * MIN });
    expect(r.ok).toBe(true);
    expect((await loadWorld(1)).data.name).toBe('old');
    expect((await listWorlds())[0].name).toBe('old');
    const after = await listBackups(1);
    expect(after[0].reason).toBe('before restore');
    expect((await st.txn('readonly', (s) => s.get(backupKey(1, after[0].id)))).name).toBe('new');
    expect((await restoreBackup(1, 'nope')).ok).toBe(false);
  });

  it('rescues a damaged world from a backup', async () => {
    const base = await savedWorld({ name: 'Good' });
    await writeWorld(1, { ...base, savedAt: 1000 * MIN });
    await writeWorld(1, { ...base, savedAt: 1020 * MIN });
    await st.txn('readwrite', async (s) => { await s.put(slotKey(1), { name: 'Good', version: 2 }); });
    expect((await loadWorld(1)).status).toBe('damaged');
    const [b] = await listBackups(1);
    expect((await restoreBackup(1, b.id)).ok).toBe(true);
    expect((await loadWorld(1)).status).toBe('ok');
    // a damaged world is not itself added to the ring
    expect((await listBackups(1)).some((x) => x.reason === 'before restore')).toBe(false);
  });

  it('refuses a damaged or newer backup', async () => {
    const base = await savedWorld();
    await writeWorld(1, { ...base, savedAt: 1000 * MIN });
    await writeWorld(1, { ...base, savedAt: 1020 * MIN });
    const [b] = await listBackups(1);
    await st.txn('readwrite', (s) => s.put(backupKey(1, b.id), { version: CURRENT_VERSION + 5 }));
    expect((await restoreBackup(1, b.id))).toMatchObject({ ok: false, status: 'newer' });
    await st.txn('readwrite', (s) => s.put(backupKey(1, b.id), { version: 2, name: 'x' }));
    expect((await restoreBackup(1, b.id))).toMatchObject({ ok: false, status: 'damaged' });
  });
});

describe('corruption detection and repair', () => {
  const good = () => clone(fixture('v2_current'));

  it('accepts a sound save', () => {
    expect(validateSave(good())).toEqual([]);
  });

  it('finds damaged chunks and says which', () => {
    const d = good();
    const [k1, k2] = Object.keys(d.chunks);
    d.chunks[k1].blocks = d.chunks[k1].blocks.slice(0, 100);          // truncated run-length data
    d.chunks[k2].heightmap = [1, 2, 3];                                // wrong size
    const p = validateSave(d);
    expect(p.map((x) => x.path).sort()).toEqual([`chunks.${k1}`, `chunks.${k2}`].sort());
    expect(p.every((x) => !x.fatal)).toBe(true);
    expect(inspectSave(d).status).toBe('repairable');
  });

  it('catches run-length data that adds up to the wrong volume, and zero-length runs', () => {
    const d = good(), k = Object.keys(d.chunks)[0];
    d.chunks[k].meta = [0, 255, 0, 255];
    expect(chunkProblem(d.chunks[k])).toMatch(/covers 510 cells/);
    d.chunks[k].meta = [0, 0];
    expect(chunkProblem(d.chunks[k])).toMatch(/not run-length/);
    expect(chunkProblem(null)).toBeTruthy();
  });

  it('repairs by dropping damaged chunks (they regenerate from the seed) and keeps the rest', () => {
    const d = good();
    const [k1, k2] = Object.keys(d.chunks);
    d.chunks[k1].light = [];
    const before = JSON.stringify(d);
    const r = repairSave(d);
    expect(JSON.stringify(d)).toBe(before); // the input is untouched
    expect(r.data.chunks[k1]).toBeUndefined();
    expect(r.data.chunks[k2]).toEqual(d.chunks[k2]);
    expect(r.fixes.join()).toMatch(/dropped damaged/);
    expect(validateSave(r.data)).toEqual([]);
  });

  it('repairs broken lists, a bad time or name, and drops mobs that cannot be placed', () => {
    const d = good();
    d.furnaces = 'oops'; d.time = NaN; d.name = ''; d.savedMobs = [];
    d.liveMobs = [{ x: 1, z: 2 }, { type: 'no position' }, null];
    const r = repairSave(d);
    expect(r.data.furnaces).toEqual([]);
    expect(r.data.time).toBe(0);
    expect(r.data.name).toBe('Recovered World');
    expect(r.data.savedMobs).toEqual({});
    expect(r.data.liveMobs).toEqual([{ x: 1, z: 2 }]);
  });

  it('rebuilds a damaged player at the world spawn, but gives up when there is no spawn either', () => {
    const d = good();
    d.player = { x: 'NaN' };
    const r = repairSave(d);
    expect(r.data.player).toMatchObject({ x: d.worldSpawn.x, y: d.worldSpawn.y, health: 20, gamemode: 'survival' });
    expect(r.data.player.slots).toHaveLength(36);
    const bad = good();
    bad.player = null; delete bad.worldSpawn;
    expect(inspectSave(bad).status).toBe('damaged');
    expect(repairSave(bad).data).toBeNull();
  });

  it('treats a missing seed or a non-record as unrepairable', () => {
    const d = good(); delete d.seed;
    expect(inspectSave(d).status).toBe('damaged');
    expect(inspectSave([]).status).toBe('damaged');
    expect(validateSave('text')[0].fatal).toBe(true);
  });

  it('checks the chunks of other dimensions too', () => {
    const d = good(), k = Object.keys(d.chunks)[0];
    d.dimensions = { cinderdeep: { chunks: { 0: clone(d.chunks[k]), 1: { blocks: [] } } } };
    const p = validateSave(d);
    expect(p).toHaveLength(1);
    expect(p[0].path).toBe('dimensions.cinderdeep.chunks.1');
    const r = repairSave(d);
    expect(Object.keys(r.data.dimensions.cinderdeep.chunks)).toEqual(['0']);
    expect(d.dimensions.cinderdeep.chunks[1]).toBeTruthy();
  });

  it('refuses a save with an absurd number of chunks', () => {
    const d = good(), k = Object.keys(d.chunks)[0];
    const many = {};
    for (let i = 0; i <= LIMITS.maxChunks; i++) many[i] = d.chunks[k];
    d.chunks = many;
    expect(inspectSave(d).status).toBe('damaged');
  });

  it('loadWorld reports repairable and damaged worlds, and repairWorld fixes the first while keeping the original', async () => {
    const base = await savedWorld({ name: 'Mend me' });
    await writeWorld(1, { ...base, savedAt: 1000 * MIN });
    const k = Object.keys(base.chunks)[0];
    await st.txn('readwrite', async (s) => { const d = await s.get(slotKey(1)); await s.put(slotKey(1), { ...d, chunks: { ...d.chunks, [k]: { blocks: [1, 2] } } }); });
    const r = await loadWorld(1);
    expect(r.status).toBe('repairable');
    expect(r.problems[0].path).toBe(`chunks.${k}`);
    expect((await listWorlds())[0].damaged).toBe(false); // the summary was made when the world was sound
    expect(await loadGame(1)).toBeNull(); // the simple loader only returns sound worlds
    const fixed = await repairWorld(1, { now: 3000 * MIN });
    expect(fixed.ok).toBe(true);
    expect(fixed.fixes.length).toBe(1);
    expect((await loadWorld(1)).status).toBe('ok');
    const ring = await listBackups(1);
    expect(ring[0].reason).toBe('before repair');
    const original = await st.txn('readonly', (s) => s.get(backupKey(1, ring[0].id)));
    expect(original.chunks[k].blocks).toEqual([1, 2]);
  });

  it('repairWorld reports what it cannot fix and does not touch the record', async () => {
    await st.txn('readwrite', (s) => s.put(slotKey(1), { name: 'x', version: 2 }));
    const r = await repairWorld(1);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(await st.txn('readonly', (s) => s.get(slotKey(1)))).toEqual({ name: 'x', version: 2 });
    expect((await repairWorld(5)).ok).toBe(false);
  });

  it('reports a newer world as such and never rewrites it', async () => {
    await st.txn('readwrite', (s) => s.put(slotKey(1), { ...fixture('v2_current'), version: 99 }));
    expect((await loadWorld(1)).status).toBe('newer');
    expect((await repairWorld(1)).ok).toBe(false);
    expect((await st.txn('readonly', (s) => s.get(slotKey(1)))).version).toBe(99);
    expect((await listWorlds())[0]).toMatchObject({ damaged: true, newer: true });
  });
});

describe('storage quota', () => {
  it('classifies usage', () => {
    expect(quotaLevel(10, 100)).toBe('ok');
    expect(quotaLevel(80, 100)).toBe('warn');
    expect(quotaLevel(94, 100)).toBe('warn');
    expect(quotaLevel(95, 100)).toBe('critical');
    expect(quotaLevel(5, 0)).toBeNull();
    expect(quotaLevel(NaN, 100)).toBeNull();
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError(new Error('disk quota exceeded'))).toBe(true);
    expect(isQuotaError(new Error('other'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it('reports the status of the store', async () => {
    const small = new MemoryStorage({ quotaBytes: 1_000_000 });
    setStorage(small);
    expect((await storageStatus(small)).level).toBe('ok');
    const base = await savedWorld();
    await writeWorld(1, base);
    const s = await storageStatus(small);
    expect(s.usage).toBeGreaterThan(0);
    expect(s.ratio).toBeCloseTo(s.usage / 1_000_000);
    const tight = new MemoryStorage({ quotaBytes: Math.ceil(estimateBytes(base) * 1.1) });
    setStorage(tight);
    await writeWorld(1, base);
    expect(['warn', 'critical']).toContain((await storageStatus(tight)).level);
  });

  it('a save that does not fit fails whole and leaves the other worlds alone', async () => {
    const base = await savedWorld();
    const size = estimateBytes(base);
    const small = new MemoryStorage({ quotaBytes: Math.floor(size * 1.5) });
    setStorage(small);
    await writeWorld(1, { ...base, name: 'Keeper' });
    let err = null;
    try { await writeWorld(2, { ...base, name: 'Too big' }); } catch (e) { err = e; }
    expect(err).toBeTruthy();
    expect(isQuotaError(err)).toBe(true);
    expect(err.quota).toBe(true);
    const w = await listWorlds();
    expect(w[0].name).toBe('Keeper');
    expect(w[1]).toBeNull();
    expect((await loadWorld(1)).status).toBe('ok');
    expect((await loadWorld(2)).status).toBe('missing');
  });

  it('when a save only fails because of old backups, it frees them and retries', async () => {
    const base = await savedWorld();
    const size = estimateBytes(base);
    const small = new MemoryStorage({ quotaBytes: Math.floor(size * 2.6) });
    setStorage(small);
    await writeWorld(1, { ...base, savedAt: 1000 * MIN });
    await writeWorld(1, { ...base, savedAt: 1020 * MIN }); // backup 1: world + backup
    expect(await listBackups(1)).toHaveLength(1);
    await writeWorld(1, { ...base, savedAt: 1040 * MIN, name: 'newest' }); // a second backup would not fit: tight retry
    expect((await loadWorld(1)).data.name).toBe('newest');
    expect((await listBackups(1)).length).toBeLessThanOrEqual(1);
  });

  it('a save that cannot fit even without backups keeps the previous save', async () => {
    const base = await savedWorld();
    const size = estimateBytes(base);
    const small = new MemoryStorage({ quotaBytes: Math.floor(size * 1.2) });
    setStorage(small);
    await writeWorld(1, { ...base, name: 'Old' });
    const grown = { ...base, name: 'New', bigField: 'x'.repeat(size) };
    await expect(writeWorld(1, grown)).rejects.toMatchObject({ quota: true });
    expect((await loadWorld(1)).data.name).toBe('Old');
  });
});

describe('export and import', () => {
  it('formats sizes and file names', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(-1)).toBe('?');
    expect(exportFileName('My World/../x')).toBe('My_World_.._x.saturnworld');
    expect(exportFileName('')).toBe('world.saturnworld');
  });

  it('round-trips a world through one compressed file, typed arrays included', async () => {
    const d = await savedWorld({ name: 'Travelling' });
    const bytes = await exportBytes(d);
    expect(bytes[0]).toBe(0x1f); expect(bytes[1]).toBe(0x8b); // gzip
    expect(bytes.length).toBeLessThan(estimateBytes(d));
    const r = await importBytes(bytes);
    expect(r.status).toBe('ok');
    expect(r.info.name).toBe('Travelling');
    expect(r.data.name).toBe('Travelling');
    for (const k of Object.keys(d.chunks)) {
      expect(r.data.chunks[k].blocks).toBeInstanceOf(Uint16Array);
      expect(r.data.chunks[k].heightmap).toBeInstanceOf(Int16Array);
      expect(Array.from(r.data.chunks[k].blocks)).toEqual(Array.from(d.chunks[k].blocks));
      expect(Array.from(r.data.chunks[k].colors)).toEqual(Array.from(d.chunks[k].colors));
    }
    expect(r.data.player).toEqual(d.player);
    expect(r.data.stats).toEqual(d.stats);
  });

  it('exports a stored world and imports it into a free slot under a unique name', async () => {
    await saveGame(mockGame({ name: 'Shared', seed: 4242, ticks: 777 }));
    const { bytes, filename } = await exportWorld(1);
    expect(filename).toBe('Shared.saturnworld');
    const r = await importWorld(bytes);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatchObject({ slot: 2, name: 'Shared (2)', seed: 4242, playTicks: 777 });
    expect((await loadWorld(2)).status).toBe('ok');
    const again = await importWorld(bytes);
    expect(again.summary.name).toBe('Shared (3)');
  });

  it('imports an older-format world file by migrating it', async () => {
    const old = clone(fixture('v1_full'));
    const bytes = await exportBytes(old);
    const r = await importWorld(bytes);
    expect(r.ok).toBe(true);
    expect(r.migratedFrom).toBe(1);
    expect((await loadWorld(1)).data.version).toBe(CURRENT_VERSION);
  });

  it('repairs a world file with a damaged chunk on the way in', async () => {
    const d = clone(fixture('v2_current'));
    const k = Object.keys(d.chunks)[0];
    d.chunks[k].blocks = [];
    const r = await importWorld(await exportBytes(d));
    expect(r.ok).toBe(true);
    expect(r.fixes.length).toBe(1);
    expect(Object.keys((await loadWorld(1)).data.chunks)).toHaveLength(1);
  });

  it('refuses a damaged world and a newer world on export, and a full list on import', async () => {
    await st.txn('readwrite', (s) => s.put(slotKey(1), { name: 'x', version: 2 }));
    await expect(exportWorld(1)).rejects.toThrow(/damaged/);
    await expect(exportWorld(4)).rejects.toThrow(/no world/);
    await st.txn('readwrite', (s) => s.put(slotKey(1), { ...fixture('v2_current'), version: 50 }));
    await expect(exportWorld(1)).rejects.toThrow(/newer version/);
    const bytes = await exportBytes(clone(fixture('v2_current')));
    for (let i = 1; i <= MAX_WORLDS; i++) await saveGame(mockGame({ slot: i, name: `W${i}` }));
    const r = await importWorld(bytes);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/slots are used/);
  });

  it('refuses a world file from a newer game version', async () => {
    const d = { ...clone(fixture('v2_current')), version: CURRENT_VERSION + 1 };
    const r = await importWorld(await exportBytes(d));
    expect(r).toMatchObject({ ok: false, status: 'newer' });
    expect(r.error).toMatch(/newer version/);
    expect((await listWorlds()).every((w) => w === null)).toBe(true);
  });

  it('rejects things that are not world files', async () => {
    expect((await importBytes(new TextEncoder().encode('{"hello":"world"}'))).status).toBe('invalid');
    expect((await importBytes(new Uint8Array([]))).status).toBe('invalid');
    expect((await importBytes('text')).status).toBe('invalid');
    expect((await importBytes(new Uint8Array(gzipSync(Buffer.from('just some text'))))).status).toBe('invalid');
    expect((await importBytes(new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3]))).status).toBe('damaged');
  });

  it('detects a file that was cut short or altered', async () => {
    const bytes = await exportBytes(await savedWorld());
    expect((await importBytes(bytes.slice(0, bytes.length >> 1))).status).toBe('damaged');
    const flipped = bytes.slice();
    flipped[flipped.length >> 1] ^= 0xff;
    expect(['damaged', 'invalid']).toContain((await importBytes(flipped)).status);
    // altered inside the container: the checksum catches it even though the gzip layer is fine
    const raw = encodeContainer(await savedWorld(), {});
    raw[raw.length - 5] ^= 0x55;
    const r = await importBytes(new Uint8Array(gzipSync(Buffer.from(raw))));
    expect(r.status).toBe('damaged');
    expect(r.error).toMatch(/checksum/);
  });

  it('enforces the size limits (file size and unpacked size)', async () => {
    const bytes = await exportBytes(await savedWorld());
    const was = { ...LIMITS };
    try {
      LIMITS.maxFileBytes = bytes.length - 1;
      expect((await importBytes(bytes)).status).toBe('toolarge');
      LIMITS.maxFileBytes = was.maxFileBytes;
      LIMITS.maxUnpackedBytes = 5000; // a gzip bomb stops at the cap instead of filling memory
      const r = await importBytes(bytes);
      expect(r.status).toBe('toolarge');
      expect(r.error).toMatch(/too large/);
    } finally { Object.assign(LIMITS, was); }
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(40 * 1024 * 1024)));
    try {
      LIMITS.maxUnpackedBytes = 8 * 1024 * 1024;
      expect(bomb.length).toBeLessThan(1024 * 1024);
      expect((await importBytes(bomb)).status).toBe('toolarge');
    } finally { Object.assign(LIMITS, was); }
  });

  // hand-built container, to test what a hostile file can do
  function container(headerObj, blob = new Uint8Array(0)) {
    const header = new TextEncoder().encode(typeof headerObj === 'string' ? headerObj : JSON.stringify(headerObj));
    const out = new Uint8Array(20 + header.length + blob.length);
    out.set([0x53, 0x41, 0x54, 0x57, 0x4f, 0x52, 0x4c, 0x44], 0);
    const dv = new DataView(out.buffer);
    dv.setUint32(8, 1, true); dv.setUint32(16, header.length, true);
    out.set(header, 20); out.set(blob, 20 + header.length);
    dv.setUint32(12, crc32(out.subarray(20)), true);
    return new Uint8Array(gzipSync(Buffer.from(out)));
  }
  const worldJson = () => JSON.stringify(clone(fixture('v2_current')));

  it('accepts a hand-built container (so the tests below mean something)', async () => {
    const r = await importBytes(container(`{"format":1,"game":"saturncraft","world":${worldJson()}}`));
    expect(r.status).toBe('ok');
  });

  it('never lets file contents reach prototypes or run as code', async () => {
    const evil = worldJson().replace(/^\{/, '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}},"prototype":{"p":1},"code":"globalThis.__ran = true; process.exit(1)","fn":"function(){}",');
    const r = await importBytes(container(`{"format":1,"game":"saturncraft","world":${evil}}`));
    expect(r.status).toBe('ok');
    expect({}.polluted).toBeUndefined();
    expect({}.polluted2).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(r.data, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(r.data, 'constructor')).toBe(false);
    expect(Object.getPrototypeOf(r.data)).toBe(Object.prototype);
    expect(r.data.code).toBe('globalThis.__ran = true; process.exit(1)'); // strings stay strings
    expect(globalThis.__ran).toBeUndefined();
    // and the stored copy is the same: nothing is evaluated on the way into storage either
    const res = await importWorld(container(`{"format":1,"game":"saturncraft","world":${evil}}`));
    expect(res.ok).toBe(true);
  });

  it('rejects array references that name unknown types or run past the data', async () => {
    const w = (ref) => `{"format":1,"game":"saturncraft","world":{"version":2,"seed":1,"player":${ref}}}`;
    for (const ref of [
      '{"$ta":"Function","o":0,"n":1}', '{"$ta":"Uint16Array","o":-4,"n":1}', '{"$ta":"Uint16Array","o":0,"n":1000}',
      '{"$ta":"Uint8Array","o":1.5,"n":1}', '{"$ta":"Uint8Array","o":0,"n":"1"}',
    ]) {
      const r = await importBytes(container(w(ref)));
      expect(r.status).toBe('damaged');
    }
  });

  it('rejects wrong magic, unreadable headers and files that claim a newer export format', async () => {
    expect((await importBytes(container('not json'))).status).toBe('damaged');
    expect((await importBytes(container('{"format":1,"game":"other","world":{}}'))).status).toBe('invalid');
    expect((await importBytes(container('[1,2,3]'))).status).toBe('invalid');
    const raw = new Uint8Array(gzipSync(Buffer.from(new Uint8Array(40))));
    expect((await importBytes(raw)).status).toBe('invalid');
    const body = Buffer.from(encodeContainer(clone(fixture('v2_current'))));
    body.writeUInt32LE(9, 8); // export format 9
    const r = await importBytes(new Uint8Array(gzipSync(body)));
    expect(r.status).toBe('damaged');
    expect(r.error).toMatch(/newer export format/);
  });
});

describe('world creation options', () => {
  it('has defaults that match a plain new world', () => {
    expect(cleanOptions({})).toEqual({ ...defaultOptions(), name: '', seedText: '' });
    expect(defaultOptions()).toMatchObject({ gamemode: 'survival', difficulty: 'normal', allowCheats: true, seasons: true, worldType: 'normal' });
  });

  it('keeps valid choices and replaces invalid ones', () => {
    const o = cleanOptions({
      name: '  My   <b>World</b>  ', seedText: '  cheese\u0000  ', worldType: 'flat', gamemode: 'creative', difficulty: 'hard', allowCheats: false,
      seasons: false, startSeason: 'winter', seasonDays: 999, daylightCycle: false, hostileMobs: false, worldEvents: false, fireworksHurtPlayers: true,
    });
    expect(o).toEqual({
      name: 'My bWorld/b', seedText: 'cheese', worldType: 'normal', // flat is not offered: the generator has no flat mode
      gamemode: 'creative', difficulty: 'hard', allowCheats: false, seasons: false, startSeason: 'winter', seasonDays: 120,
      daylightCycle: false, hostileMobs: false, worldEvents: false, fireworksHurtPlayers: true,
      keepInventory: false, hardcore: false, // (world/gameRules.js, One Life worlds)
    });
    const junk = cleanOptions({ gamemode: 'spectator', difficulty: 'impossible', startSeason: 'monsoon', allowCheats: 'yes', seasonDays: 'x', name: 'y'.repeat(100) });
    expect(junk).toMatchObject({ gamemode: 'survival', difficulty: 'normal', startSeason: 'spring', allowCheats: true, seasonDays: 8 });
    expect(junk.name).toHaveLength(LIMITS.nameMax);
    expect(cleanOptions({ seedText: 'z'.repeat(500) }).seedText).toHaveLength(LIMITS.seedTextMax);
  });

  it('turns seed text into a seed: numbers literally, text hashed, blank random', () => {
    expect(seedFromText('12345')).toBe(12345);
    expect(seedFromText('-7')).toBe(-7);
    expect(seedFromText('cheese')).toBe(seedFromText(' cheese '));
    expect(seedFromText('cheese')).not.toBe(seedFromText('Cheese'));
    expect(Number.isInteger(seedFromText('cheese'))).toBe(true);
    expect(seedFromText('', () => 0.5)).toBe(2 ** 30);
    expect(seedFromText('   ', () => 0.25)).toBe(2 ** 29);
  });

  it('lays the rules over the player settings without changing them', () => {
    const settings = { fov: 90, difficulty: 'normal', seasons: true, hostileMobs: true, daylightCycle: true, worldEvents: true, fireworksHurtPlayers: false };
    const o = cleanOptions({ difficulty: 'peaceful', seasons: false, hostileMobs: false, daylightCycle: false, worldEvents: false, fireworksHurtPlayers: true });
    const s = settingsForOptions(settings, o);
    expect(s).toMatchObject({ fov: 90, difficulty: 'peaceful', seasons: false, hostileMobs: false, daylightCycle: false, worldEvents: false, fireworksHurtPlayers: true });
    expect(settings.difficulty).toBe('normal');
    expect(settings.seasons).toBe(true);
  });

  it('finishes a new world: game mode, cheats, starting season and season length', () => {
    const modes = [];
    const game = { player: { gamemode: 'survival', setGamemode(m) { modes.push(m); this.gamemode = m; } }, seasons: new Seasons(), time: 5000, settings: {}, updateSeasons() { this.seasons.update(this.time); } };
    applyNewWorldOptions(game, cleanOptions({ gamemode: 'creative', allowCheats: false, seedText: 'cheese', startSeason: 'autumn', seasonDays: 4 }));
    expect(modes).toEqual(['creative']);
    expect(game).toMatchObject({ allowCheats: false, worldType: 'normal', seedText: 'cheese' });
    expect(game.createdAt).toBeGreaterThan(0);
    expect(game.seasons.days).toBe(4);
    expect(game.seasons.state.name.toLowerCase()).toBe('autumn');
    expect(game.seasons.state.day).toBe(1);
    // survival stays survival without a call; no seed text is stored as null
    const g2 = { player: { gamemode: 'survival', setGamemode() { throw new Error('should not be called'); } }, seasons: new Seasons(), time: 0 };
    applyNewWorldOptions(g2, cleanOptions({}));
    expect(g2.seedText).toBeNull();
    expect(g2.allowCheats).toBe(true);
    expect(g2.seasons.state.name.toLowerCase()).toBe('spring');
  });

  it('what a new world was made with survives a save and shows in the list', async () => {
    const g = mockGame({ name: 'Made with options' });
    g.player.gamemode = 'creative';
    g.settings = { ...g.settings, difficulty: 'hard', seasons: false };
    g.allowCheats = false; g.seedText = 'my seed';
    await saveGame(g);
    const [w] = await listWorlds();
    expect(w).toMatchObject({ gamemode: 'creative', difficulty: 'hard', seasons: false, allowCheats: false, seedText: 'my seed' });
    const d = (await loadWorld(1)).data;
    expect(d.gameRules).toMatchObject({ difficulty: 'hard', doSeasons: false });
    expect(d.meta.allowCheats).toBe(false);
  });
});

describe('cheats switch', () => {
  const game = (allowCheats) => ({
    allowCheats, seed: 77, time: 0,
    player: { gamemode: 'survival', setGamemode(m) { this.gamemode = m; }, inventory: { clear() {} }, hunger: {}, hurt() {} },
  });

  it('refuses commands that change the game when cheats are off, but not the harmless ones', () => {
    const g = game(false);
    for (const c of ['gamemode creative', 'gm 1', 'time set day', 'give stone', 'tp 0 80 0', 'summon cow', 'difficulty hard', 'gamerule doSeasons false', 'xp 10', 'kill', 'clear', 'weather clear', 'season set winter', 'dimension hollow'])
      expect(runCommand(g, c)).toBe('Cheats are turned off in this world');
    expect(g.player.gamemode).toBe('survival');
    expect(runCommand(g, 'seed')).toBe('Seed: [77]');
    expect(Array.isArray(runCommand(g, 'help'))).toBe(true);
  });

  it('runs them when cheats are on, and in worlds from before the option existed', () => {
    for (const flag of [true, undefined]) {
      const g = game(flag);
      expect(runCommand(g, 'gamemode creative')).toMatch(/Creative/);
      expect(g.player.gamemode).toBe('creative');
    }
  });

  it('covers every command that changes the world', () => {
    for (const c of ['gamemode', 'give', 'tp', 'time', 'summon', 'gamerule', 'difficulty', 'weather', 'enchant', 'effect', 'xp']) expect(CHEAT_COMMANDS.has(c)).toBe(true);
    for (const c of ['seed', 'help', 'msg', 'list', 'locate']) expect(CHEAT_COMMANDS.has(c)).toBe(false);
  });
});

describe('small helpers', () => {
  it('makes names unique and clean', () => {
    expect(uniqueName('World', [])).toBe('World');
    expect(uniqueName('World', ['world'])).toBe('World (2)');
    expect(uniqueName('World', ['World', 'World (2)'])).toBe('World (3)');
    expect(uniqueName('World', ['World'], 'copy')).toBe('World copy');
    expect(uniqueName('World', ['World copy'], 'copy')).toBe('World copy (2)');
    const long = uniqueName('a'.repeat(40), ['a'.repeat(24)]);
    expect(long.length).toBeLessThanOrEqual(LIMITS.nameMax);
    expect(long).not.toBe('a'.repeat(24));
    expect(uniqueName('', [])).toBe('World');
    expect(cleanName('  a\tb\nc  ')).toBe('a b c');
  });

  it('estimates sizes from typed arrays and plain data', () => {
    expect(estimateBytes(new Uint16Array(100))).toBe(200);
    expect(estimateBytes({ a: new Uint8Array(50) })).toBeGreaterThanOrEqual(50);
    expect(estimateBytes('hello')).toBe(5);
    expect(estimateBytes(null)).toBeGreaterThan(0);
    expect(estimateBytes({ big: Array.from({ length: 1000 }, (_, i) => i) })).toBeGreaterThanOrEqual(8000);
  });
});

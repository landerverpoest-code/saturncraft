// Managing saved worlds: the list shown on the title screen, rename / duplicate / delete, the rolling backups, repair of
// damaged saves and the export / import of a world as a file. Storage layout (all in one key-value store, see storage.js):
//   slotN            the full world record (unchanged from the first versions, so older saves keep loading)
//   meta:slotN       a small summary (name, seed, play time, last played, size, thumbnail) so the list never loads whole worlds
//   backups:slotN    index of the backup ring, newest first: [{ id, savedAt, playTicks, size, reason }]
//   backup:slotN:ID  a full copy of an earlier save of that world
// Autosave only touches slotN and meta:slotN, plus one backup copy every BACKUP_INTERVAL_MS at most; a save is one
// transaction, so a failed write (storage full) never leaves half a world.
import {
  CURRENT_VERSION, BACKUP_INTERVAL_MS, BACKUP_LIMIT, LIMITS, inspectSave, migrateSave, repairSave, validateSave, shouldBackup, pushBackup,
  worldSummary, estimateBytes, uniqueName, cleanName, exportBytes, exportFileName, importBytes, isQuotaError,
} from './saveFormat.js';
import { getStorage } from './storage.js';

export const MAX_WORLDS = 10;
export const slotKey = (slot) => `slot${slot}`;
export const metaKey = (slot) => `meta:slot${slot}`;
export const backupsKey = (slot) => `backups:slot${slot}`;
export const backupKey = (slot, id) => `backup:slot${slot}:${id}`;
const validSlot = (slot) => Number.isInteger(slot) && slot >= 1 && slot <= MAX_WORLDS;

/**
 * Write a world into a slot (the save path used by saveGame, also by restore, repair, import and duplicate).
 * Returns the summary. `now` and the backup knobs are parameters for the tests.
 */
export async function writeWorld(slot, data, { st = getStorage(), now = Date.now(), backupLimit = BACKUP_LIMIT, backupIntervalMs = BACKUP_INTERVAL_MS, backup = true, backupReason = 'auto' } = {}) {
  if (!validSlot(slot)) throw new Error(`No world slot ${slot}`);
  const summary = worldSummary(slot, data);
  const attempt = async (tight) => st.txn('readwrite', async (s) => {
    const index = (await s.get(backupsKey(slot))) || [];
    if (tight) {
      // out of room: keep only the newest backup and write the world without taking another
      for (const b of index.slice(1)) await s.del(backupKey(slot, b.id));
      await s.put(backupsKey(slot), index.slice(0, 1));
    } else if (backup && backupLimit > 0) {
      const prevMeta = await s.get(metaKey(slot));
      if (prevMeta && shouldBackup(prevMeta.savedAt, index, backupIntervalMs)) {
        const prev = await s.get(slotKey(slot));
        // never copy a broken world over a good backup
        const m = prev ? migrateSave(prev) : null;
        if (m && m.data && !validateSave(m.data, { quick: true }).some((p) => p.fatal)) {
          const id = String(prevMeta.savedAt);
          await s.put(backupKey(slot, id), prev);
          const { kept, dropped } = pushBackup(index, { id, savedAt: prevMeta.savedAt, playTicks: prevMeta.playTicks || 0, size: prevMeta.size || 0, reason: backupReason }, backupLimit);
          for (const b of dropped) await s.del(backupKey(slot, b.id));
          await s.put(backupsKey(slot), kept);
        }
      }
    }
    await s.put(slotKey(slot), data);
    await s.put(metaKey(slot), summary);
  });
  try { await attempt(false); } catch (e) {
    if (!isQuotaError(e)) throw e;
    try { await attempt(true); } catch (e2) { e2.quota = true; throw e2; }
  }
  return summary;
}

/** Read one record from the store (null if absent). */
async function readKey(key, st) { return st.txn('readonly', (s) => s.get(key)); }

/** What the title screen shows for a record without a summary (or whose summary is unusable). */
function summaryFor(slot, raw) {
  const insp = inspectSave(raw);
  if (insp.data) {
    const s = worldSummary(slot, insp.data);
    s.damaged = insp.status === 'damaged' || insp.status === 'repairable';
    s.newer = false;
    return s;
  }
  const s = worldSummary(slot, raw && typeof raw === 'object' ? raw : {});
  s.damaged = true;
  s.newer = insp.status === 'newer';
  return s;
}

/**
 * Summaries of every slot (null where empty), repaired lazily: a save from before world slots ('current') moves into the
 * first free slot, and worlds without a summary record (saved by an older game) get one. Only summaries are loaded
 * unless one is missing.
 */
export async function listWorlds({ st = getStorage() } = {}) {
  const out = Array(MAX_WORLDS).fill(null);
  try {
    await st.txn('readwrite', async (s) => {
      const keys = new Set(await s.keys());
      if (keys.has('current')) {
        for (let i = 1; i <= MAX_WORLDS; i++) {
          if (keys.has(slotKey(i))) continue;
          await s.put(slotKey(i), await s.get('current')); await s.del('current'); keys.add(slotKey(i)); keys.delete('current');
          break;
        }
      }
      for (let i = 1; i <= MAX_WORLDS; i++) {
        if (!keys.has(slotKey(i))) continue;
        let meta = keys.has(metaKey(i)) ? await s.get(metaKey(i)) : null;
        if (!meta || meta.slot !== i || typeof meta.name !== 'string') {
          meta = summaryFor(i, await s.get(slotKey(i)));
          await s.put(metaKey(i), meta);
        }
        out[i - 1] = { ...meta, backups: ((await s.get(backupsKey(i))) || []).length };
      }
    });
  } catch { /* storage unavailable: no worlds */ }
  return out;
}

/**
 * Load a world for playing. status: 'missing' | 'ok' | 'repairable' | 'damaged' | 'newer'. `data` is the migrated save
 * for 'ok' and 'repairable' (repair it with repairWorld first), `problems` says what is wrong.
 */
export async function loadWorld(slot, { st = getStorage() } = {}) {
  let raw;
  try { raw = await readKey(slotKey(slot), st); } catch (e) { return { status: 'missing', data: null, problems: [], error: e.message }; }
  if (!raw) return { status: 'missing', data: null, problems: [] };
  const r = inspectSave(raw);
  return { status: r.status, data: r.status === 'ok' ? r.data : r.status === 'repairable' ? r.data : null, problems: r.problems, slot };
}

/** The world in a slot if it is sound, or null (the simple form of loadWorld). */
export async function loadGame(slot = 1, opts) {
  const r = await loadWorld(slot, opts);
  return r.status === 'ok' ? r.data : null;
}

export async function deleteSave(slot, { st = getStorage() } = {}) {
  try {
    await st.txn('readwrite', async (s) => {
      for (const b of (await s.get(backupsKey(slot))) || []) await s.del(backupKey(slot, b.id));
      await s.del(backupsKey(slot)); await s.del(metaKey(slot)); await s.del(slotKey(slot));
    });
  } catch { /* nothing to delete */ }
}

/** Give a saved world a new name (its summary and the record itself). Returns the new name or null. */
export async function renameWorld(slot, name, { st = getStorage() } = {}) {
  const clean = cleanName(name);
  if (!clean) return null;
  try {
    return await st.txn('readwrite', async (s) => {
      const d = await s.get(slotKey(slot));
      if (!d || typeof d !== 'object') return null;
      await s.put(slotKey(slot), { ...d, name: clean });
      const m = await s.get(metaKey(slot));
      if (m) await s.put(metaKey(slot), { ...m, name: clean });
      return clean;
    });
  } catch { return null; }
}

/** The first free slot number, or 0. */
export function freeSlot(worlds) {
  const i = worlds.indexOf(null);
  return i < 0 ? 0 : i + 1;
}

/** Copy a world into the first free slot under a new name ("X copy"). Returns the summary or null (no room / not found). */
export async function duplicateWorld(slot, { st = getStorage(), now = Date.now() } = {}) {
  const worlds = await listWorlds({ st });
  const to = freeSlot(worlds);
  if (!to || !worlds[slot - 1]) return null;
  const d = await readKey(slotKey(slot), st);
  if (!d || typeof d !== 'object') return null;
  const name = uniqueName(d.name || `World ${slot}`, worlds.filter(Boolean).map((w) => w.name), 'copy');
  const meta = { ...(d.meta || {}), createdAt: now };
  return writeWorld(to, { ...d, name, meta, savedAt: d.savedAt || now }, { st, backup: false });
}

// ---- backups ---------------------------------------------------------------------------------------------------
/** The backup ring of a world, newest first: [{ id, savedAt, playTicks, size, reason }]. */
export async function listBackups(slot, { st = getStorage() } = {}) {
  try { return (await readKey(backupsKey(slot), st)) || []; } catch { return []; }
}

/** Keep a copy of what is in the slot right now in the ring (used before a repair or a restore). */
async function backupCurrent(slot, reason, { st, now, backupLimit }) {
  await st.txn('readwrite', async (s) => {
    const prev = await s.get(slotKey(slot));
    if (!prev) return;
    const prevMeta = (await s.get(metaKey(slot))) || {};
    const index = (await s.get(backupsKey(slot))) || [];
    const id = `${now}-${index.length + 1}`;
    await s.put(backupKey(slot, id), prev);
    const { kept, dropped } = pushBackup(index, { id, savedAt: prevMeta.savedAt || (isFinite(prev.savedAt) ? prev.savedAt : now), playTicks: prevMeta.playTicks || 0, size: prevMeta.size || 0, reason }, backupLimit);
    for (const b of dropped) await s.del(backupKey(slot, b.id));
    await s.put(backupsKey(slot), kept);
  });
}

/**
 * Put a backup back as the current world. The world being replaced is itself kept in the ring first (so a restore can be
 * undone) unless it is the damaged one the player is rescuing. Returns { ok, summary, status } .
 */
export async function restoreBackup(slot, id, { st = getStorage(), now = Date.now(), backupLimit = BACKUP_LIMIT } = {}) {
  const index = await listBackups(slot, { st });
  if (!index.some((b) => b.id === id)) return { ok: false, status: 'missing' };
  const raw = await readKey(backupKey(slot, id), st);
  if (!raw) return { ok: false, status: 'missing' };
  let insp = inspectSave(raw);
  let data = insp.data;
  if (insp.status === 'repairable') { const r = repairSave(insp.data, insp.problems); data = r.data; if (!data) insp = { ...insp, status: 'damaged' }; }
  if (insp.status === 'damaged' || insp.status === 'newer' || !data) return { ok: false, status: insp.status };
  const cur = await readKey(slotKey(slot), st);
  if (cur) {
    const ci = inspectSave(cur);
    if (ci.status === 'ok') await backupCurrent(slot, 'before restore', { st, now, backupLimit });
  }
  // the restored world is the backup's own save; it becomes the newest save of the slot
  const summary = await writeWorld(slot, { ...data, savedAt: now }, { st, now, backup: false });
  return { ok: true, status: 'ok', summary };
}

/**
 * Repair a damaged world in place (the original is kept in the backup ring first). Returns { ok, fixes, data } or
 * { ok: false, error }.
 */
export async function repairWorld(slot, { st = getStorage(), now = Date.now(), backupLimit = BACKUP_LIMIT } = {}) {
  const raw = await readKey(slotKey(slot), st);
  if (!raw) return { ok: false, error: 'There is no world in that slot' };
  const insp = inspectSave(raw);
  if (insp.status === 'ok') return { ok: true, fixes: [], data: insp.data };
  if (insp.status === 'newer') return { ok: false, error: insp.problems[0].msg };
  if (!insp.data) return { ok: false, error: insp.problems[0] ? insp.problems[0].msg : 'The world cannot be repaired' };
  const r = repairSave(insp.data, insp.problems);
  if (!r.data) return { ok: false, error: r.error || 'The world cannot be repaired' };
  await backupCurrent(slot, 'before repair', { st, now, backupLimit });
  await writeWorld(slot, { ...r.data, savedAt: raw.savedAt || now }, { st, now, backup: false });
  return { ok: true, fixes: r.fixes, data: r.data };
}

// ---- export / import ---------------------------------------------------------------------------------------------
/** A world as a compressed file: { bytes, filename }. Damaged worlds cannot be exported (repair or restore first). */
export async function exportWorld(slot, { st = getStorage() } = {}) {
  const raw = await readKey(slotKey(slot), st);
  if (!raw) throw new Error('There is no world in that slot');
  const r = inspectSave(raw);
  if (r.status !== 'ok') throw new Error(r.status === 'newer' ? r.problems[0].msg : 'This world is damaged: repair it or restore a backup before exporting');
  return { bytes: await exportBytes(r.data), filename: exportFileName(r.data.name) };
}

/**
 * Import the bytes of a world file into the first free slot. Returns { ok, summary, fixes, notes } or { ok: false, error }.
 * The imported world gets a unique name; repairable files are repaired (and say so in `fixes`).
 */
export async function importWorld(bytes, { st = getStorage(), now = Date.now() } = {}) {
  const worlds = await listWorlds({ st });
  const to = freeSlot(worlds);
  if (!to) return { ok: false, error: `All ${MAX_WORLDS} world slots are used; delete one first` };
  const r = await importBytes(bytes);
  if (r.status !== 'ok' && r.status !== 'repairable') return { ok: false, status: r.status, error: r.error || 'The file cannot be imported' };
  let data = r.data, fixes = [];
  if (r.status === 'repairable') {
    const rep = repairSave(r.data, r.problems);
    if (!rep.data) return { ok: false, status: 'damaged', error: rep.error || 'The world in the file is damaged' };
    data = rep.data; fixes = rep.fixes;
  }
  const name = uniqueName(cleanName(data.name) || 'Imported World', worlds.filter(Boolean).map((w) => w.name));
  const meta = { ...(data.meta || {}), createdAt: (data.meta && data.meta.createdAt) || now };
  try {
    const summary = await writeWorld(to, { ...data, name, meta }, { st, now, backup: false });
    return { ok: true, summary, fixes, migratedFrom: r.from < CURRENT_VERSION ? r.from : null };
  } catch (e) {
    return { ok: false, error: isQuotaError(e) ? 'Not enough storage space to import this world' : `Could not store the world: ${e.message}`, quota: isQuotaError(e) };
  }
}

export { LIMITS, estimateBytes };

// The title screen's world manager: the list of saved worlds (thumbnail, name, seed, play time, last played, size) with
// rename / duplicate / export / backups / delete, import from a file, the damaged-world dialog (repair or restore a backup),
// storage warnings and the read-out of the "More world options" panel. All logic lives in world/worldManager.js and
// world/saveFormat.js; this file is DOM only. Text from saves and files is always set with textContent.
import { MAX_WORLDS, listWorlds, loadWorld, deleteSave, renameWorld, duplicateWorld, listBackups, restoreBackup, repairWorld, exportWorld, importWorld } from '../world/worldManager.js';
import { LIMITS, WORLD_TYPES, formatBytes, cleanThumbnail } from '../world/saveFormat.js';
import { getStorage, storageStatus } from '../world/storage.js';
import { cleanOptions } from '../world/newWorld.js';
import { formatTime } from '../player/stats.js';
import { t, getLanguage } from './i18n.js';

const $ = (id) => document.getElementById(id);
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const when = (ts) => (ts ? new Date(ts).toLocaleString(getLanguage()) : t('never'));

/** A modal box. `buttons`: [{ label, value, kind }]; resolves with the clicked value (null if dismissed). */
export function modal({ title, lines = [], input = null, build = null, buttons }) {
  return new Promise((resolve) => {
    const back = h('div', 'wm-dialog');
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    const box = h('div', 'wm-box');
    box.appendChild(h('h3', null, title));
    for (const l of lines) box.appendChild(h('p', null, l));
    let field = null;
    if (input) {
      field = h('input');
      field.type = 'text'; field.value = input.value || ''; field.maxLength = input.max || 24; field.spellcheck = false;
      box.appendChild(field);
    }
    const close = (value) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(value); };
    if (build) build(box, close);
    const row = h('div', 'wm-buttons');
    for (const b of buttons) {
      const btn = h('button', `btn ${b.kind === 'danger' ? 'wm-danger' : ''}`, b.label);
      btn.onclick = () => close(input && b.value !== null ? { value: b.value, text: field.value } : b.value);
      row.appendChild(btn);
    }
    box.appendChild(row);
    back.appendChild(box);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && field && document.activeElement === field) { e.preventDefault(); close({ value: buttons[0].value, text: field.value }); }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
    document.body.appendChild(back);
    (field || row.querySelector('button')).focus();
  });
}

function download(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/gzip' }));
  const a = h('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Read the "More world options" panel (plus name and seed) as a valid option set. */
export function readCreateOptions() {
  return cleanOptions({
    name: $('wname').value, seedText: $('seed').value,
    worldType: $('wo-type').value, gamemode: $('wo-mode').value, difficulty: $('wo-diff').value,
    allowCheats: $('wo-cheats').checked, seasons: $('wo-seasons').checked, startSeason: $('wo-start').value, seasonDays: +$('wo-days').value,
    daylightCycle: $('wo-daylight').checked, hostileMobs: $('wo-hostile').checked, worldEvents: $('wo-events').checked, fireworksHurtPlayers: $('wo-fwhurt').checked,
    keepInventory: $('wo-keepinv').checked, hardcore: $('wo-hardcore').checked, portalYard: $('wo-portalyard').checked,
  });
}

/**
 * Wire up the world list. `ctx.start(saveData, slot)` opens a loaded world. Returns { refresh, worlds() }.
 */
export function initWorldList(ctx) {
  let worlds = Array(MAX_WORLDS).fill(null);
  const list = $('worlds'), msg = $('wm-msg'), playBtn = $('play');
  const say = (t, bad = false) => { msg.textContent = t || ''; msg.classList.toggle('wm-bad', bad); };

  // world types: unsupported ones are shown but cannot be picked
  const typeSel = $('wo-type');
  const fillTypes = () => {
    const keep = typeSel.value;
    typeSel.innerHTML = '';
    for (const wt of WORLD_TYPES) {
      const o = h('option', null, wt.supported ? t(wt.label) : t('{label} (generator has no flat mode yet)', { label: t(wt.label) }));
      o.value = wt.key; o.disabled = !wt.supported;
      typeSel.appendChild(o);
    }
    if (keep) typeSel.value = keep;
  };
  fillTypes();
  const seasonsBox = $('wo-seasons');
  const syncSeasons = () => { $('wo-start').disabled = $('wo-days').disabled = !seasonsBox.checked; };
  seasonsBox.addEventListener('change', syncSeasons); syncSeasons();

  async function showStorage() {
    const note = $('storage-note');
    const st = getStorage();
    let text = '', q0 = null;
    if (!st.persistent) text = t('This browser blocks world storage: worlds will be lost when the page closes. Export them to keep them.');
    else {
      const q = await storageStatus(st).catch(() => null);
      q0 = q;
      if (q && q.level && q.level !== 'ok') text = `${t('Browser storage is {pct}% full ({used} of {quota}).', { pct: Math.round(q.ratio * 100), used: formatBytes(q.usage), quota: formatBytes(q.quota) })} ${q.level === 'critical' ? t('Saving may fail: export and delete worlds you do not need.') : t('Consider exporting or deleting old worlds.')}`;
    }
    note.textContent = text;
    note.classList.toggle('hidden', !text);
    note.classList.toggle('wm-bad', !!text && (!st.persistent || (q0 && q0.level === 'critical')));
  }

  async function refresh() {
    worlds = await listWorlds();
    render();
    showStorage();
  }

  function render() {
    list.innerHTML = '';
    const used = worlds.filter(Boolean).length;
    if (used) list.appendChild(h('div', 'world-head', t('Your worlds ({used}/{max})', { used, max: MAX_WORLDS })));
    for (const w of worlds) if (w) list.appendChild(card(w));
    const full = used >= MAX_WORLDS;
    playBtn.disabled = full;
    playBtn.textContent = full ? t('Max {max} worlds · delete one first', { max: MAX_WORLDS }) : t('Create New World');
    $('import-btn').disabled = full;
  }

  function card(w) {
    const el = h('div', 'world-card');
    const play = h('button', 'btn world-play');
    const thumb = cleanThumbnail(w.thumbnail);
    if (thumb) { const img = h('img', 'world-thumb'); img.src = thumb; img.alt = ''; play.appendChild(img); } else play.appendChild(h('div', 'world-thumb none', '?'));
    const text = h('div', 'world-text');
    text.appendChild(h('b', null, w.name));
    const bits = [t('seed {seed}', { seed: w.seedText || w.seed }), t('{time} played', { time: formatTime(w.playTicks) })];
    text.appendChild(h('span', null, bits.join(' · ')));
    text.appendChild(h('span', null, t('last played {when} · {size}', { when: when(w.savedAt), size: formatBytes(w.size) })));
    const tags = [w.hardcore ? (w.hardcoreOver ? t('one life (spent)') : t('one life')) : null, w.gamemode && t(w.gamemode), w.difficulty && t(w.difficulty), w.seasons ? null : t('no seasons'), w.allowCheats ? null : t('no cheats')].filter(Boolean);
    text.appendChild(h('span', 'world-tags', tags.join(' · ')));
    if (w.damaged) text.appendChild(h('span', 'wm-bad', w.newer ? t('Made by a newer version') : t('Damaged: click to repair or restore a backup')));
    play.appendChild(text);
    play.onclick = () => open(w);
    const acts = h('div', 'world-actions');
    const act = (label, title, fn, cls = '') => { const b = h('button', `btn world-act ${cls}`, label); b.title = title; b.onclick = fn; acts.appendChild(b); return b; };
    act(t('Rename'), t('Rename this world'), () => rename(w));
    act(t('Copy'), t('Duplicate this world'), () => duplicate(w));
    act(t('Export'), t('Download this world as a file'), () => exportIt(w));
    act(t('Backups ({n})', { n: w.backups || 0 }), t('Restore an earlier snapshot'), () => backups(w));
    act(t('Delete'), t('Delete this world'), () => remove(w), 'world-del');
    el.append(play, acts);
    return el;
  }

  async function open(w) {
    say('');
    const r = await loadWorld(w.slot);
    if (r.status === 'ok') { ctx.start(r.data, w.slot); return; }
    if (r.status === 'missing') { say(t('That world is gone.'), true); refresh(); return; }
    await damaged(w, r);
  }

  /** The world failed its checks: show what is wrong and the ways out. */
  async function damaged(w, r) {
    const newer = r.status === 'newer';
    const lines = newer
      ? [r.problems[0].msg, t('Update the game to open it. The world was not touched.')]
      : [t('"{name}" failed its integrity check ({problems}):', { name: w.name, problems: t(r.problems.length === 1 ? '{n} problem' : '{n} problems', { n: r.problems.length }) }), ...r.problems.slice(0, 5).map((p) => ` - ${p.msg}`), ...(r.problems.length > 5 ? [' - ' + t('and {n} more', { n: r.problems.length - 5 })] : [])];
    if (r.status === 'repairable') lines.push(t('Repair drops what is damaged (damaged terrain regenerates from the seed). The original is kept as a backup.'));
    if (r.status === 'damaged') lines.push(t('This cannot be repaired automatically.'));
    const nBackups = (await listBackups(w.slot)).length;
    const buttons = [];
    if (r.status === 'repairable') buttons.push({ label: t('Repair and open'), value: 'repair' });
    if (!newer) buttons.push({ label: nBackups ? t('Restore a backup ({n})', { n: nBackups }) : t('No backups available'), value: 'backups', disabled: !nBackups });
    buttons.push({ label: t('Cancel'), value: null });
    const pick = await modal({ title: newer ? t('Newer world') : t('Damaged world'), lines, buttons: buttons.filter((b) => !b.disabled) });
    if (pick === 'repair') {
      say(t('Repairing…'));
      const rep = await repairWorld(w.slot);
      if (!rep.ok) { say(t('Repair failed: {error}', { error: rep.error }), true); return; }
      say(t('Repaired: {fixes}.', { fixes: rep.fixes.join(', ') || t('nothing to fix') }));
      const again = await loadWorld(w.slot);
      if (again.status === 'ok') ctx.start(again.data, w.slot); else refresh();
    } else if (pick === 'backups') await backups(w);
  }

  async function backups(w) {
    const index = await listBackups(w.slot);
    if (!index.length) { await modal({ title: t('Backups of {name}', { name: w.name }), lines: [t('No backups yet. A snapshot is kept automatically while you play (about every 15 minutes, the last 3).')], buttons: [{ label: t('Close'), value: null }] }); return; }
    const id = await modal({
      title: t('Backups of {name}', { name: w.name }),
      lines: [t('Pick a snapshot to restore. The world as it is now is kept as a backup too.')],
      build: (box, close) => {
        const wrap = h('div', 'wm-backups');
        for (const b of index) {
          const row = h('div', 'wm-backup');
          row.appendChild(h('span', null, `${when(b.savedAt)} · ${t('{time} played', { time: formatTime(b.playTicks || 0) })} · ${formatBytes(b.size)}${b.reason && b.reason !== 'auto' ? ` · ${b.reason}` : ''}`));
          const btn = h('button', 'btn', t('Restore'));
          btn.onclick = () => close(b.id);
          row.appendChild(btn);
          wrap.appendChild(row);
        }
        box.appendChild(wrap);
      },
      buttons: [{ label: t('Close'), value: null }],
    });
    if (!id) return;
    const sure = await modal({ title: t('Restore this backup?'), lines: [t('"{name}" goes back to how it was on {when}. Progress since then stays available as a backup.', { name: w.name, when: when(index.find((b) => b.id === id).savedAt) })], buttons: [{ label: t('Restore'), value: 'yes', kind: 'danger' }, { label: t('Cancel'), value: null }] });
    if (sure !== 'yes') return;
    const r = await restoreBackup(w.slot, id);
    say(r.ok ? t('Restored "{name}" from the backup.', { name: w.name }) : t('Could not restore: the backup is {why}.', { why: r.status === 'newer' ? t('from a newer version') : r.status === 'missing' ? t('missing') : t('damaged') }), !r.ok);
    refresh();
  }

  async function rename(w) {
    const r = await modal({ title: t('Rename world'), input: { value: w.name, max: LIMITS.nameMax }, buttons: [{ label: t('Rename'), value: 'ok' }, { label: t('Cancel'), value: null }] });
    if (!r || !r.text.trim()) return;
    const n = await renameWorld(w.slot, r.text);
    say(n ? t('Renamed to "{name}".', { name: n }) : t('Could not rename that world.'), !n);
    refresh();
  }

  async function duplicate(w) {
    say(t('Copying…'));
    try {
      const s = await duplicateWorld(w.slot);
      say(s ? t('Copied as "{name}".', { name: s.name }) : t('Could not copy: {why}.', { why: worlds.filter(Boolean).length >= MAX_WORLDS ? t('all world slots are used') : t('the world could not be read') }), !s);
    } catch (e) { say(e && /quota/i.test(e.name + e.message) ? t('Not enough storage space to copy this world.') : t('Copy failed.'), true); }
    refresh();
  }

  async function remove(w) {
    const ok = await modal({
      title: t('Delete "{name}"?', { name: w.name }),
      lines: [t('{time} of play, {size}{backups} will be deleted for good. This cannot be undone. Export it first if you may want it back.', { time: formatTime(w.playTicks), size: formatBytes(w.size), backups: w.backups ? t(w.backups === 1 ? ', and its {n} backup' : ', and its {n} backups', { n: w.backups }) : '' })],
      buttons: [{ label: t('Delete forever'), value: 'yes', kind: 'danger' }, { label: t('Keep it'), value: null }],
    });
    if (ok !== 'yes') return;
    await deleteSave(w.slot);
    say(t('Deleted "{name}".', { name: w.name }));
    refresh();
  }

  async function exportIt(w) {
    say(t('Packing…'));
    try {
      const { bytes, filename } = await exportWorld(w.slot);
      download(bytes, filename);
      say(t('Exported {file} ({size}).', { file: filename, size: formatBytes(bytes.length) }));
    } catch (e) { say(e.message || t('Export failed.'), true); }
  }

  $('import-btn').onclick = () => $('import-file').click();
  $('import-file').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > LIMITS.maxFileBytes) { say(t('That file is larger than {size}.', { size: formatBytes(LIMITS.maxFileBytes) }), true); return; }
    say(t('Reading {file}…', { file: file.name.slice(0, 40) }));
    let bytes;
    try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { say(t('Could not read that file.'), true); return; }
    const r = await importWorld(bytes);
    if (!r.ok) say(t('Import failed: {error}', { error: r.error }), true);
    else say(`${t('Imported "{name}"', { name: r.summary.name })}${r.fixes.length ? ` ${t('(repaired: {fixes})', { fixes: r.fixes.join(', ') })}` : ''}${r.migratedFrom ? ` ${t('(upgraded from format {n})', { n: r.migratedFrom })}` : ''}.`);
    refresh();
  };

  refresh();
  /** The language changed: rebuild what this module wrote itself (the title screen's static text is translateDom's job). */
  const relang = () => { fillTypes(); render(); showStorage(); };
  return { refresh, relang, worlds: () => worlds };
}

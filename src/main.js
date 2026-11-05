// Entry point: title screen, settings persistence and game start.
import './ui/style.css';
import { Game, DEFAULT_SETTINGS } from './game.js';
import { stringToSeed } from './world/noise.js';
import { loadGame, deleteSave, listWorlds, renameWorld, MAX_WORLDS } from './world/save.js';
import { startTitleScene, SPLASHES } from './ui/titleScene.js';
import { loadPlayerName, savePlayerName, normalizeRoomCode } from './net/protocol.js';
import { takeResume, storeResume, shouldRetryJoin, RECONNECT_MAX, reconnectDelay } from './net/social.js';
import { wantTouch, readTouchEnv } from './ui/touchMath.js';
import { accessClasses, ACCESS_CLASSES } from './ui/accessibility.js';
import { resolveBindings, codeLabel } from './ui/bindings.js';

const stopTitleScene = startTitleScene(document.getElementById('title-bg'));
document.getElementById('splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem('saturncraft.settings') || '{}');
    // a first run on a system that asks for less motion starts with Reduce motion on
    if (!('reduceMotion' in stored) && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) stored.reduceMotion = true;
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) { try { localStorage.setItem('saturncraft.settings', JSON.stringify(s)); } catch { /* storage unavailable */ } }

const title = document.getElementById('title-screen');
if (wantTouch(loadSettings(), location.search, readTouchEnv())) {
  // phones and tablets: the keyboard hints on the title screen would only confuse
  document.getElementById('controls-hint').textContent = 'Left thumb moves (push far to sprint) · drag to look · hold to mine · Use / Jump / Sneak buttons · Menu for pause, settings and Help';
}
const loading = document.getElementById('loading');
const settings = loadSettings();
{ const on = new Set(accessClasses(settings)); for (const c of ACCESS_CLASSES) document.documentElement.classList.toggle(c, on.has(c)); } // the title screen honours the accessibility classes too
const rd = document.getElementById('t-rd');
const sh = document.getElementById('t-sh');
rd.value = settings.renderDistance; document.getElementById('t-rdv').textContent = settings.renderDistance;
sh.checked = settings.shadows;
const fx = document.getElementById('t-fx');
fx.checked = settings.shaders !== false;
rd.addEventListener('input', () => { document.getElementById('t-rdv').textContent = rd.value; });

let game = null;
const pname = document.getElementById('pname');
pname.value = loadPlayerName();
pname.addEventListener('change', () => { savePlayerName(pname.value); pname.value = loadPlayerName(); });
/** The title screen URL (without the join / autostart parameters). */
function titleURL() {
  const q = new URLSearchParams(location.search);
  for (const k of ['join', 'autostart', 'continue', 'seed']) q.delete(k);
  const s = q.toString();
  return location.pathname + (s ? '?' + s : '');
}

// ---- saved worlds (up to MAX_WORLDS slots) ----
let worlds = Array(MAX_WORLDS).fill(null);
const worldsEl = document.getElementById('worlds');
const playBtn = document.getElementById('play');
function renderWorlds() {
  worldsEl.innerHTML = '';
  const used = worlds.filter(Boolean).length;
  const head = document.createElement('div');
  head.className = 'world-head';
  head.textContent = `Your worlds (${used}/${MAX_WORLDS})`;
  if (used) worldsEl.appendChild(head);
  for (const w of worlds) {
    if (!w) continue;
    const row = document.createElement('div');
    row.className = 'world-row';
    const play = document.createElement('button');
    play.className = 'btn world-play';
    play.innerHTML = '<b></b><span></span>';
    play.querySelector('b').textContent = w.name;
    play.querySelector('span').textContent = `seed ${w.seed} · ${new Date(w.savedAt).toLocaleString()}`;
    play.onclick = async () => { const d = await loadGame(w.slot); if (d) start(d, null, w.slot); };
    const ren = document.createElement('button');
    ren.className = 'btn world-icon'; ren.title = 'Rename'; ren.textContent = '✎';
    ren.onclick = async () => {
      const n = prompt('New name for this world:', w.name);
      if (n === null || !n.trim()) return;
      await renameWorld(w.slot, n.trim().slice(0, 24));
      worlds = await listWorlds(); renderWorlds();
    };
    const del = document.createElement('button');
    del.className = 'btn world-icon world-del'; del.title = 'Delete'; del.textContent = '✕';
    del.onclick = async () => {
      if (!confirm(`Delete "${w.name}" for good?`)) return;
      await deleteSave(w.slot);
      worlds = await listWorlds(); renderWorlds();
    };
    row.append(play, ren, del);
    worldsEl.appendChild(row);
  }
  const full = used >= MAX_WORLDS;
  playBtn.disabled = full;
  playBtn.textContent = full ? `Max ${MAX_WORLDS} worlds · delete one first` : 'Create New World';
}
listWorlds().then((w) => { worlds = w; renderWorlds(); });

async function start(saveData = null, net = null, slot = null) {
  const seedText = document.getElementById('seed').value.trim();
  const seed = net ? net.welcome.seed : saveData ? saveData.seed : seedText ? stringToSeed(seedText) : (Math.random() * 2 ** 31) | 0;
  let worldName = saveData ? saveData.name : null;
  if (!saveData && !net) {
    // a new world takes the first free slot
    worlds = await listWorlds();
    const free = worlds.indexOf(null);
    if (free < 0) { renderWorlds(); return; }
    slot = free + 1;
    worldName = document.getElementById('wname').value.trim().slice(0, 24) || `World ${slot}`;
  }
  settings.renderDistance = +rd.value;
  settings.shadows = sh.checked;
  settings.shaders = fx.checked;
  saveSettings(settings);
  title.classList.add('hidden');
  stopTitleScene();
  loading.classList.remove('hidden');
  const canvas = document.getElementById('game');
  game = new Game(canvas, seed, settings, {
    saveSettings,
    quit: () => { if (net) location.href = titleURL(); else location.reload(); },
    // the link to the host dropped: come back with the same place and belongings (net/social.js)
    reconnect: (resume) => { storeResume(resume); location.reload(); },
  }, saveData);
  game.saveSlot = slot || 1;
  game.worldName = worldName || `World ${game.saveSlot}`;
  game.net = net; // joining a friend's world (null otherwise)
  window.__game = game;
  await game.start((f) => { loading.querySelector('.bar > div').style.width = `${Math.round(f * 100)}%`; });
  loading.classList.add('hidden');
  if (game.touch) game.hud.toast(net ? `Joined ${net.welcome.hostName}'s world` : 'Left thumb moves · drag to look · hold to mine · Menu > Help');
  else game.hud.toast(net ? `Joined ${net.welcome.hostName}'s world · click to play` : `Click to play · E for inventory · ${codeLabel(resolveBindings(settings.keys).help[0])} for help`);
}

/** Join a friend's world by room code (or join link). `resume`: coming back after a dropped link (tries a few times). */
async function join(input, resume = null) {
  const msg = document.getElementById('join-msg'), btn = document.getElementById('join');
  const code = normalizeRoomCode(input);
  if (!code) { msg.textContent = 'Enter the room code from your friend\'s pause menu'; return; }
  savePlayerName(pname.value);
  btn.disabled = true;
  let session = null;
  const { joinSession } = await import('./net/session.js');
  for (let attempt = 1; !session; attempt++) {
    try {
      session = await joinSession(code, loadPlayerName(), (s) => { msg.textContent = resume ? `Reconnecting (${attempt}/${RECONNECT_MAX})... ${s}` : s; }, undefined, { resume });
    } catch (e) {
      const why = e.message || String(e);
      if (!resume || attempt >= RECONNECT_MAX || !shouldRetryJoin(why)) { msg.textContent = why; btn.disabled = false; return; }
      msg.textContent = `${why} - trying again in ${reconnectDelay(attempt)} s (${attempt}/${RECONNECT_MAX})`;
      await new Promise((r) => setTimeout(r, reconnectDelay(attempt) * 1000));
    }
  }
  msg.textContent = '';
  start(null, session);
}
document.getElementById('join').addEventListener('click', () => join(document.getElementById('join-code').value));
document.getElementById('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(e.target.value); });

playBtn.addEventListener('click', () => start());
const params = new URLSearchParams(location.search);
const resume = takeResume(); // a dropped link: rejoin the same world and continue where we stood
if (resume) { document.getElementById('join-code').value = resume.code; join(resume.code, resume); }
else if (params.get('join')) { document.getElementById('join-code').value = params.get('join'); join(params.get('join')); }
if (params.has('autostart')) {
  if (params.get('seed')) document.getElementById('seed').value = params.get('seed');
  if (params.get('rd')) rd.value = params.get('rd');
  if (params.has('continue')) loadGame(1).then((d) => start(d, null, 1));
  else start();
}

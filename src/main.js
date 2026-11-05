// Entry point: title screen, settings persistence and game start.
import './ui/style.css';
import { Game, DEFAULT_SETTINGS } from './game.js';
import { loadGame, listWorlds } from './world/save.js';
import { seedFromText, settingsForOptions, applyNewWorldOptions } from './world/newWorld.js';
import { initWorldList, readCreateOptions } from './ui/worldList.js';
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

// ---- saved worlds: the list, backups, import / export and the creation options live in ui/worldList.js ----
const worldList = initWorldList({ start: (d, slot) => start(d, null, slot) });
const playBtn = document.getElementById('play');

/** Open a saved world (`saveData`), a friend's (`net`) or a new one made with `newOpts` (the creation options). */
async function start(saveData = null, net = null, slot = null, newOpts = null) {
  const creating = !saveData && !net;
  const opts = creating ? (newOpts || readCreateOptions()) : null;
  const seed = net ? net.welcome.seed : saveData ? saveData.seed : seedFromText(opts.seedText);
  let worldName = saveData ? saveData.name : null;
  if (creating) {
    // a new world takes the first free slot
    const worlds = await listWorlds();
    const free = worlds.indexOf(null);
    if (free < 0) { worldList.refresh(); return; }
    slot = free + 1;
    worldName = opts.name || `World ${slot}`;
  }
  settings.renderDistance = +rd.value;
  settings.shadows = sh.checked;
  settings.shaders = fx.checked;
  saveSettings(settings);
  title.classList.add('hidden');
  stopTitleScene();
  loading.classList.remove('hidden');
  const canvas = document.getElementById('game');
  game = new Game(canvas, seed, creating ? settingsForOptions(settings, opts) : settings, {
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
  if (creating) {
    applyNewWorldOptions(game, opts);
    game.save(); // the new world is in the list from the start, with its options
  }
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

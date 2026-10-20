// Entry point: title screen, settings persistence and game start.
import './ui/style.css';
import { Game, DEFAULT_SETTINGS } from './game.js';
import { stringToSeed } from './world/noise.js';
import { loadGame, deleteSave } from './world/save.js';
import { startTitleScene, SPLASHES } from './ui/titleScene.js';
import { loadPlayerName, savePlayerName, normalizeRoomCode } from './net/protocol.js';

const stopTitleScene = startTitleScene(document.getElementById('title-bg'));
document.getElementById('splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('saturncraft.settings') || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) { try { localStorage.setItem('saturncraft.settings', JSON.stringify(s)); } catch { /* storage unavailable */ } }

const title = document.getElementById('title-screen');
const loading = document.getElementById('loading');
const settings = loadSettings();
const rd = document.getElementById('t-rd');
const sh = document.getElementById('t-sh');
rd.value = settings.renderDistance; document.getElementById('t-rdv').textContent = settings.renderDistance;
sh.checked = settings.shadows;
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

let existing = null;
loadGame().then((d) => {
  existing = d;
  if (!d) return;
  const btn = document.getElementById('continue');
  btn.classList.remove('hidden');
  btn.textContent = `Continue World (seed ${d.seed}, saved ${new Date(d.savedAt).toLocaleString()})`;
});

async function start(saveData = null, net = null) {
  const seedText = document.getElementById('seed').value.trim();
  const seed = net ? net.welcome.seed : saveData ? saveData.seed : seedText ? stringToSeed(seedText) : (Math.random() * 2 ** 31) | 0;
  if (!saveData && !net) await deleteSave();
  settings.renderDistance = +rd.value;
  settings.shadows = sh.checked;
  saveSettings(settings);
  title.classList.add('hidden');
  stopTitleScene();
  loading.classList.remove('hidden');
  const canvas = document.getElementById('game');
  game = new Game(canvas, seed, settings, {
    saveSettings,
    quit: () => { if (net) location.href = titleURL(); else location.reload(); },
  }, saveData);
  game.net = net; // joining a friend's world (null otherwise)
  window.__game = game;
  await game.start((f) => { loading.querySelector('.bar > div').style.width = `${Math.round(f * 100)}%`; });
  loading.classList.add('hidden');
  game.hud.toast(net ? `Joined ${net.welcome.hostName}'s world · click to play` : 'Click to play · E for inventory · F3 debug');
}

/** Join a friend's world by room code (or join link). */
async function join(input) {
  const msg = document.getElementById('join-msg'), btn = document.getElementById('join');
  const code = normalizeRoomCode(input);
  if (!code) { msg.textContent = 'Enter the room code from your friend\'s pause menu'; return; }
  savePlayerName(pname.value);
  btn.disabled = true;
  let session;
  try {
    const { joinSession } = await import('./net/session.js');
    session = await joinSession(code, loadPlayerName(), (s) => { msg.textContent = s; });
  } catch (e) {
    msg.textContent = e.message || String(e);
    btn.disabled = false;
    return;
  }
  msg.textContent = '';
  start(null, session);
}
document.getElementById('join').addEventListener('click', () => join(document.getElementById('join-code').value));
document.getElementById('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(e.target.value); });

document.getElementById('play').addEventListener('click', () => {
  if (existing && !confirm('Creating a new world replaces your saved world. Continue?')) return;
  start();
});
document.getElementById('continue').addEventListener('click', () => start(existing));
const params = new URLSearchParams(location.search);
if (params.get('join')) { document.getElementById('join-code').value = params.get('join'); join(params.get('join')); }
if (params.has('autostart')) {
  if (params.get('seed')) document.getElementById('seed').value = params.get('seed');
  if (params.get('rd')) rd.value = params.get('rd');
  if (params.has('continue')) loadGame().then((d) => start(d));
  else start();
}

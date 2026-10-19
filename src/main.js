// Entry point: title screen, settings persistence and game start.
import './ui/style.css';
import { Game, DEFAULT_SETTINGS } from './game.js';
import { stringToSeed } from './world/noise.js';

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

async function start() {
  const seedText = document.getElementById('seed').value.trim();
  const seed = seedText ? stringToSeed(seedText) : (Math.random() * 2 ** 31) | 0;
  settings.renderDistance = +rd.value;
  settings.shadows = sh.checked;
  saveSettings(settings);
  title.classList.add('hidden');
  loading.classList.remove('hidden');
  const canvas = document.getElementById('game');
  game = new Game(canvas, seed, settings, {
    saveSettings,
    quit: () => { location.reload(); },
  });
  window.__game = game;
  await game.start((f) => { loading.querySelector('.bar > div').style.width = `${Math.round(f * 100)}%`; });
  loading.classList.add('hidden');
  game.hud.toast('Click to play · E for inventory · F3 debug');
}

document.getElementById('play').addEventListener('click', start);
const params = new URLSearchParams(location.search);
if (params.has('autostart')) {
  if (params.get('seed')) document.getElementById('seed').value = params.get('seed');
  if (params.get('rd')) rd.value = params.get('rd');
  start();
}

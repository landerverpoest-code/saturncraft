// World persistence in IndexedDB: modified chunks (run-length encoded),
// player state, world time, furnaces and persistent passive mobs.
import { chunkKey } from './world.js';

const DB_NAME = 'saturncraft';
const STORE = 'worlds';

export function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 255) n++;
    out.push(v, n);
    i += n;
  }
  return Uint8Array.from(out);
}

export function rleDecode(enc, length) {
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i < enc.length; i += 2) { out.fill(enc[i], o, o + enc[i + 1]); o += enc[i + 1]; }
  return out;
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txn(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

export function packChunk(c) {
  return {
    blocks: rleEncode(c.blocks), meta: rleEncode(c.meta), light: rleEncode(c.light),
    biomes: c.biomes.slice(), colors: c.colors.slice(), heightmap: new Int16Array(c.heightmap),
  };
}
export function unpackChunk(p) {
  const V = 16 * 16 * 384;
  return {
    blocks: rleDecode(p.blocks, V), meta: rleDecode(p.meta, V), light: rleDecode(p.light, V),
    biomes: p.biomes, colors: p.colors, heightmap: p.heightmap, modified: true,
  };
}

/** A player's own state (position, health, inventory...), also kept per name for multiplayer guests. */
export function playerSaveData(p) {
  return {
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health,
    food: p.hunger.food, saturation: p.hunger.saturation, exhaustion: p.hunger.exhaustion,
    air: p.air, spawn: p.spawn, bed: p.bed || null, slots: p.inventory.slots, armor: p.inventory.armor, xp: p.xp, gamemode: p.gamemode, flying: p.flying, selected: p.inventory.selected,
  };
}

/** Serialise the current game into the 'current' slot. */
export async function saveGame(game) {
  const w = game.world, p = game.player;
  const chunks = {};
  for (const [k, c] of w.saved) chunks[k] = packChunk(c);
  for (const c of w.chunks.values()) if (c.modified) chunks[chunkKey(c.cx, c.cz)] = packChunk(c);
  const savedMobs = {};
  for (const [k, v] of game.spawner.savedMobs) savedMobs[k] = v;
  const liveMobs = game.entities.list
    .filter((e) => e.kind === 'mob' && e.persistent && e.deathTime === 0 && !e.removed)
    .map((e) => e.saveData());
  const data = {
    version: 1,
    seed: game.seed,
    time: game.time,
    gameRules: { doDaylightCycle: game.settings.daylightCycle !== false, doHostileSpawning: game.settings.hostileMobs !== false },
    savedAt: Date.now(),
    player: playerSaveData(p),
    furnaces: [...game.furnaces.values()],
    chests: [...game.chests.values()],
    worldSpawn: game.worldSpawn,
    weather: game.weather.save(),
    milestones: game.milestones.save(),
    boats: game.entities.list.filter((e) => e.kind === 'boat' && !e.dead).map((e) => ({ x: e.x, y: e.y, z: e.z, yaw: e.yaw, cart: !!e.cart })),
    generated: [...game.spawner.generated],
    savedMobs, liveMobs, chunks,
    // which dimension the player (and the fields above) are in, plus the other dimensions' state
    ...(game.dims ? game.dims.saveData(packChunk) : {}),
    netPlayers: game.netPlayers || {}, // multiplayer guests' state by name
  };
  const db = await openDB();
  await txn(db, 'readwrite', (s) => s.put(data, 'current'));
  db.close();
  return data;
}

export async function loadGame() {
  try {
    const db = await openDB();
    const data = await txn(db, 'readonly', (s) => new Promise((res) => { const r = s.get('current'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }));
    db.close();
    return data || null;
  } catch { return null; }
}

export async function deleteSave() {
  try {
    const db = await openDB();
    await txn(db, 'readwrite', (s) => s.delete('current'));
    db.close();
  } catch { /* nothing to delete */ }
}

/** Apply loaded data to a freshly constructed (not yet started) game. */
export function applySave(game, data) {
  for (const [k, p] of Object.entries(data.chunks)) game.world.saved.set(+k, unpackChunk(p));
  if (game.dims) game.dims.loadData(data, unpackChunk);
  game.time = data.time;
  // the world remembers its own rules (older saves keep the player's settings)
  if (data.gameRules) {
    if (typeof data.gameRules.doDaylightCycle === 'boolean') game.settings.daylightCycle = data.gameRules.doDaylightCycle;
    if (typeof data.gameRules.doHostileSpawning === 'boolean') game.settings.hostileMobs = data.gameRules.doHostileSpawning;
  }
  game.netPlayers = data.netPlayers || {};
  game.weather.load(data.weather);
  game.milestones.load(data.milestones);
  for (const b of data.boats || []) game.entities.spawnBoat(b.x, b.y, b.z, b.yaw, !!b.cart);
  for (const f of data.furnaces) game.furnaces.set(`${f.x},${f.y},${f.z}`, f);
  for (const c of data.chests || []) game.chests.set(`${c.x},${c.y},${c.z}`, c);
  for (const k of data.generated) game.spawner.generated.add(k);
  for (const [k, v] of Object.entries(data.savedMobs)) game.spawner.savedMobs.set(+k, v);
  // live mobs go back into their chunk's saved list so they reappear when it loads
  for (const m of data.liveMobs) {
    const k = chunkKey(Math.floor(m.x / 16), Math.floor(m.z / 16));
    const list = game.spawner.savedMobs.get(k) || [];
    list.push(m);
    game.spawner.savedMobs.set(k, list);
  }
}

export function applyPlayerSave(game, d) {
  const p = game.player;
  p.setPosition(d.x, d.y, d.z);
  p.yaw = d.yaw; p.pitch = d.pitch; p.health = d.health;
  p.hunger.food = d.food; p.hunger.saturation = d.saturation; p.hunger.exhaustion = d.exhaustion;
  p.air = d.air; p.spawn = d.spawn; p.bed = d.bed || null;
  p.inventory.slots = d.slots.map((s) => (s ? { ...s } : null));
  if (d.armor) p.inventory.armor = d.armor.map((s) => (s ? { ...s } : null));
  if (d.xp) p.xp = { ...d.xp };
  if (d.gamemode) p.setGamemode(d.gamemode);
  p.flying = !!d.flying && p.creative;
  p.inventory.selected = d.selected;
  p.inventory.changed();
}

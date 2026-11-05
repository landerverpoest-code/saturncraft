// World persistence: modified chunks (run-length encoded), player state, world time, furnaces and persistent passive
// mobs. Where and how records are stored (IndexedDB, the world list, backups, repair, export / import) lives in
// worldManager.js and storage.js; the shape of a record, its version and migrations in saveFormat.js.
import { cleanPotFaces } from './archaeology.js';
import { cleanLectern } from './books.js';
import { cleanCamp } from './campfireCooking.js';
import { encodeMap, decodeMap } from './maps.js';
import { chunkKey } from './world.js';
import { cleanEffects } from '../player/effects.js';
import { liveStands, loadStands } from '../entities/armorStand.js';
import { saveState as saveCaravanState, loadState as loadCaravanState } from '../mobs/peddler.js';
import { saveStats, loadStats } from '../player/stats.js';
import { cleanReputation } from '../mobs/reputation.js';
import { cleanBlueprints, MAX_VOLUME_CAP } from './buildTools.js';
import { SocialState } from '../net/social.js';
import { CURRENT_VERSION, cleanThumbnail } from './saveFormat.js';
import { writeWorld } from './worldManager.js';

export { MAX_WORLDS, listWorlds, loadGame, loadWorld, deleteSave, renameWorld, duplicateWorld, listBackups, restoreBackup, repairWorld, exportWorld, importWorld, writeWorld } from './worldManager.js';

/** Run-length encoding as [value, count] pairs (16-bit values, so block ids above 255 fit). */
export function rleEncode(arr) {
  const n = arr.length, T = arr instanceof Uint16Array ? Uint16Array : Uint8Array;
  let buf = new T(4096), o = 0, i = 0;
  while (i < n) {
    const v = arr[i], lim = Math.min(n, i + 255);
    let j = i + 1;
    while (j < lim && arr[j] === v) j++;
    if (o + 2 > buf.length) { const nb = new T(buf.length * 2); nb.set(buf); buf = nb; }
    buf[o++] = v; buf[o++] = j - i;
    i = j;
  }
  return buf.slice(0, o);
}

export function rleDecode(enc, length, Type = Uint8Array) {
  const out = new Type(length);
  let o = 0;
  for (let i = 0; i < enc.length; i += 2) { out.fill(enc[i], o, o + enc[i + 1]); o += enc[i + 1]; }
  return out;
}

export const packStats = { packed: 0, reused: 0 };
/**
 * A chunk's saved form. Chunks keep the packed copy and the revision it was made at (World.setBlock and setLight bump
 * `rev`), so the minute-by-minute autosave only re-encodes chunks that changed since the last one.
 */
export function packChunk(c) {
  if (c.packCache && c.packRev === c.rev) { packStats.reused++; return c.packCache; }
  packStats.packed++;
  const p = {
    blocks: rleEncode(c.blocks), meta: rleEncode(c.meta), light: rleEncode(c.light),
    biomes: c.biomes.slice(), colors: c.colors.slice(), heightmap: new Int16Array(c.heightmap),
  };
  if (c.rev !== undefined) { c.packCache = p; c.packRev = c.rev; }
  return p;
}
export function unpackChunk(p) {
  const V = 16 * 16 * 384;
  return {
    blocks: rleDecode(p.blocks, V, Uint16Array), meta: rleDecode(p.meta, V), light: rleDecode(p.light, V),
    biomes: p.biomes, colors: p.colors, heightmap: p.heightmap, modified: true,
  };
}

/** A player's own state (position, health, inventory...), also kept per name for multiplayer guests. */
export function playerSaveData(p) {
  return {
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health,
    food: p.hunger.food, saturation: p.hunger.saturation, exhaustion: p.hunger.exhaustion,
    air: p.air, spawn: p.spawn, bed: p.bed || null, slots: p.inventory.slots, armor: p.inventory.armor, xp: p.xp, gamemode: p.gamemode, flying: p.flying, selected: p.inventory.selected, enchSeed: p.enchSeed,
    effects: p.effects,
    reputation: cleanReputation(p.reputation), // what villages think of the player (mobs/reputation.js)
    blueprints: cleanBlueprints(p.blueprints), // named building blueprints (world/buildTools.js, ui/buildCommands.js)
  };
}

/** Serialise the current game into its world slot (1..MAX_WORLDS). */
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
    version: CURRENT_VERSION,
    name: game.worldName || `World ${game.saveSlot || 1}`,
    seed: game.seed,
    time: game.time,
    gameRules: { doDaylightCycle: game.settings.daylightCycle !== false, doSeasons: game.settings.seasons !== false, doHostileSpawning: game.settings.hostileMobs !== false, fireworksHurtPlayers: game.settings.fireworksHurtPlayers === true, maxBuildVolume: Number.isFinite(game.settings.maxBuildVolume) ? game.settings.maxBuildVolume : undefined, doWorldEvents: game.settings.worldEvents !== false, difficulty: game.difficulty },
    savedAt: Date.now(),
    // what the world list shows and the options chosen when the world was made (world/saveFormat.js)
    meta: { createdAt: game.createdAt || Date.now(), worldType: game.worldType || 'normal', allowCheats: game.allowCheats !== false, seedText: game.seedText || null, thumbnail: cleanThumbnail(game.thumbnail) },
    player: playerSaveData(p),
    furnaces: [...game.furnaces.values()],
    chests: [...game.chests.values()],
    signs: [...game.signs],
    frames: [...game.frames],
    pots: [...(game.pots || new Map())], // Decorated Pots' sherds (world/archaeology.js)
    lecterns: [...(game.lecterns || new Map())], // the books on Lecterns and their open pages (world/books.js)
    campfires: [...(game.campfires || new Map())], // the foods cooking on Campfires (world/campfireCooking.js)
    proving: game.proving ? game.proving.save() : null, // Proving Spawner rests and who opened which Vault (world/provingSystem.js)
    maps: [...game.maps.values()].map(encodeMap),
    brewingStands: [...(game.brewingStands || new Map()).values()],
    hoppers: [...(game.hoppers || new Map()).values()].map((h) => ({ x: h.x, y: h.y, z: h.z, slots: h.slots })),
    dispensers: [...(game.dispensers || new Map()).values()].map((d) => ({ x: d.x, y: d.y, z: d.z, slots: d.slots })),
    worldSpawn: game.worldSpawn,
    worldEvents: game.worldEvents ? game.worldEvents.save() : undefined, // the last meteorite slot, craters, festival lanterns (world/events.js)
    seasons: game.seasons ? game.seasons.save() : undefined, // season length and the calendar offset set by /season (world/seasons.js)
    weather: game.weather.save(),
    milestones: game.milestones.save(),
    onboarding: game.onboarding ? game.onboarding.save() : undefined, // hints shown and First Steps ticked (player/onboarding.js)
    stats: saveStats(p.stats), // blocks, distances, kills, deaths, trades and play time (player/stats.js)
    raids: game.raids ? game.raids.save() : null, // patrol timer and the raid under way (mobs/raids.js)
    boats: game.entities.list.filter((e) => e.kind === 'boat' && !e.dead).map((e) => ({ x: e.x, y: e.y, z: e.z, yaw: e.yaw, cart: !!e.cart })),
    armorStands: liveStands(game),
    generated: [...game.spawner.generated],
    peddler: game.spawner.peddlerState ? saveCaravanState(game.spawner.peddlerState) : undefined, // chance of the next Roving Peddler
    inhabited: [...(game.spawner.inhabited || new Map())].filter(([, t]) => t >= 1200), // ticks players spent near each chunk (local difficulty)
    savedMobs, liveMobs, chunks,
    // which dimension the player (and the fields above) are in, plus the other dimensions' state
    ...(game.dims ? game.dims.saveData(packChunk) : {}),
    netPlayers: game.netPlayers || {}, // multiplayer guests' state by name
    guestBlueprints: Object.fromEntries(Object.entries(game.guestBlueprints || {}).map(([k, v]) => [k, cleanBlueprints(v)]).filter(([, v]) => Object.keys(v).length)), // guests' building blueprints by name
    social: game.social ? game.social.save() : undefined, // multiplayer teams, the op list, bans and who is who (net/social.js)
  };
  await writeWorld(game.saveSlot || 1, data); // one transaction: the world, its list summary and (every so often) a backup
  return data;
}

/** Apply loaded data to a freshly constructed (not yet started) game. */
export function applySave(game, data) {
  for (const [k, p] of Object.entries(data.chunks)) game.world.saved.set(+k, unpackChunk(p));
  if (game.dims) game.dims.loadData(data, unpackChunk);
  game.time = data.time;
  if (data.meta) {
    game.createdAt = data.meta.createdAt || 0;
    game.worldType = data.meta.worldType || 'normal';
    game.allowCheats = data.meta.allowCheats !== false;
    game.seedText = data.meta.seedText || null;
    game.thumbnail = cleanThumbnail(data.meta.thumbnail);
  }
  // the world remembers its own rules (older saves keep the player's settings)
  if (data.gameRules) {
    if (typeof data.gameRules.doDaylightCycle === 'boolean') game.settings.daylightCycle = data.gameRules.doDaylightCycle;
    if (typeof data.gameRules.doSeasons === 'boolean') game.settings.seasons = data.gameRules.doSeasons;
    if (typeof data.gameRules.doWorldEvents === 'boolean') game.settings.worldEvents = data.gameRules.doWorldEvents;
    if (typeof data.gameRules.doHostileSpawning === 'boolean') game.settings.hostileMobs = data.gameRules.doHostileSpawning;
    game.settings.fireworksHurtPlayers = data.gameRules.fireworksHurtPlayers === true; // (off unless the world turned it on)
    // the most blocks one building command may touch (the default when the world never set it)
    if (Number.isInteger(data.gameRules.maxBuildVolume) && data.gameRules.maxBuildVolume >= 1) game.settings.maxBuildVolume = Math.min(data.gameRules.maxBuildVolume, MAX_VOLUME_CAP);
    else delete game.settings.maxBuildVolume;
    if (['peaceful', 'easy', 'normal', 'hard'].includes(data.gameRules.difficulty)) game.settings.difficulty = data.gameRules.difficulty;
  }
  game.netPlayers = data.netPlayers || {};
  game.guestBlueprints = {};
  for (const [k, v] of Object.entries(data.guestBlueprints || {})) game.guestBlueprints[k] = cleanBlueprints(v);
  if (data.social) game.social = SocialState.from(data.social);
  game.weather.load(data.weather);
  if (game.seasons) { game.seasons.load(data.seasons); game.seasons.enabled = game.settings.seasons !== false; }
  if (game.worldEvents) game.worldEvents.load(data.worldEvents);
  game.milestones.load(data.milestones);
  if (game.onboarding) game.onboarding.load(data.onboarding);
  game.player.stats = loadStats(data.stats);
  if (game.raids) game.raids.load(data.raids);
  for (const b of data.boats || []) game.entities.spawnBoat(b.x, b.y, b.z, b.yaw, !!b.cart);
  loadStands(game, data.armorStands);
  for (const f of data.furnaces) game.furnaces.set(`${f.x},${f.y},${f.z}`, f);
  for (const c of data.chests || []) game.chests.set(`${c.x},${c.y},${c.z}`, c);
  for (const [k, l] of data.signs || []) game.signs.set(k, l);
  for (const [k, st] of data.frames || []) game.frames.set(k, st);
  for (const [k, f] of data.pots || []) { const c = cleanPotFaces(f); if (c && game.pots) game.pots.set(k, c); }
  for (const [k, l] of data.lecterns || []) { const c = cleanLectern(l); if (c && game.lecterns) game.lecterns.set(String(k), c); }
  for (const [k, c] of data.campfires || []) { const s = cleanCamp(c); if (s && game.campfires) game.campfires.set(String(k), s); }
  if (game.proving) game.proving.load(data.proving);
  for (const d of data.maps || []) { const m = decodeMap(d); if (m) game.maps.set(m.id, m); }
  for (const s of data.brewingStands || []) if (s && Array.isArray(s.slots)) game.brewingStands.set(`${s.x},${s.y},${s.z}`, s);
  for (const h of data.hoppers || []) if (h && Array.isArray(h.slots)) game.hoppers.set(`${h.x},${h.y},${h.z}`, { ...h, cooldown: 0 });
  for (const d of data.dispensers || []) if (d && Array.isArray(d.slots)) game.dispensers.set(`${d.x},${d.y},${d.z}`, { x: d.x, y: d.y, z: d.z, slots: d.slots });
  for (const k of data.generated) game.spawner.generated.add(k);
  if (data.peddler) game.spawner.peddlerState = loadCaravanState(data.peddler);
  for (const e of Array.isArray(data.inhabited) ? data.inhabited : []) if (Array.isArray(e) && Number.isFinite(e[1])) game.spawner.inhabited.set(+e[0], e[1]);
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
  if (Number.isInteger(d.enchSeed)) p.enchSeed = d.enchSeed;
  p.effects = cleanEffects(d.effects);
  p.reputation = cleanReputation(d.reputation); // (older saves have none)
  p.blueprints = cleanBlueprints(d.blueprints); // (older saves have none)
  if (d.gamemode) p.setGamemode(d.gamemode);
  p.flying = !!d.flying && p.creative;
  p.inventory.selected = d.selected;
  p.inventory.changed();
}

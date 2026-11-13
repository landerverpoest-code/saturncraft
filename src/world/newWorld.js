// The options chosen when a world is created (title screen "More world options"): seed text, world type, game mode,
// difficulty, cheats and the game rules including the seasons. Pure functions: cleanOptions turns whatever the form
// holds into a valid set, settingsForOptions builds the Game's settings from it without touching the player's saved
// settings, and applyNewWorldOptions finishes the job on the started game.
import { stringToSeed } from './noise.js';
import { GAME_MODES, DIFFICULTY_KEYS, SEASON_START, WORLD_TYPES, LIMITS, cleanName } from './saveFormat.js';
import { cleanDays, DEFAULT_DAYS } from './seasons.js';
import { WORLD_RULES, WORLD_RULE_NAMES } from './gameRules.js';

export const defaultOptions = () => ({
  name: '', seedText: '', worldType: 'normal', gamemode: 'survival', difficulty: 'normal', allowCheats: true,
  seasons: true, startSeason: 'spring', seasonDays: DEFAULT_DAYS,
  daylightCycle: true, hostileMobs: true, worldEvents: true, fireworksHurtPlayers: false,
  keepInventory: false, hardcore: false,
});

const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);

/** A valid option set from form values (anything unknown falls back to the default). */
export function cleanOptions(raw = {}) {
  const d = defaultOptions();
  const types = WORLD_TYPES.filter((t) => t.supported).map((t) => t.key);
  // One Life (hardcore): survival on Hard, no cheats, nothing kept on death - and the death is final
  const hardcore = bool(raw.hardcore, d.hardcore);
  if (hardcore) raw = { ...raw, gamemode: 'survival', difficulty: 'hard', allowCheats: false, keepInventory: false };
  return {
    hardcore,
    keepInventory: bool(raw.keepInventory, d.keepInventory),
    name: cleanName(raw.name),
    seedText: String(raw.seedText ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LIMITS.seedTextMax),
    worldType: pick(raw.worldType, types, d.worldType),
    gamemode: pick(raw.gamemode, GAME_MODES, d.gamemode),
    difficulty: pick(raw.difficulty, DIFFICULTY_KEYS, d.difficulty),
    allowCheats: bool(raw.allowCheats, d.allowCheats),
    seasons: bool(raw.seasons, d.seasons),
    startSeason: pick(raw.startSeason, SEASON_START, d.startSeason),
    seasonDays: cleanDays(raw.seasonDays ?? d.seasonDays),
    daylightCycle: bool(raw.daylightCycle, d.daylightCycle),
    hostileMobs: bool(raw.hostileMobs, d.hostileMobs),
    worldEvents: bool(raw.worldEvents, d.worldEvents),
    fireworksHurtPlayers: bool(raw.fireworksHurtPlayers, d.fireworksHurtPlayers),
  };
}

/** The numeric seed for the typed text: blank is random (`random` is injectable for tests), digits are taken literally. */
export function seedFromText(text, random = Math.random) {
  const t = String(text ?? '').trim();
  return t ? stringToSeed(t) : (random() * 2 ** 31) | 0;
}

/** The player's settings with this world's rules laid over them (the originals are not changed). */
export function settingsForOptions(settings, o) {
  return {
    ...settings,
    difficulty: o.difficulty, seasons: o.seasons, daylightCycle: o.daylightCycle,
    hostileMobs: o.hostileMobs, worldEvents: o.worldEvents, fireworksHurtPlayers: o.fireworksHurtPlayers,
    // a new world starts from the default rules (the settings may still hold the last world's), plus what the form chose
    ...Object.fromEntries(WORLD_RULE_NAMES.map((n) => [n, WORLD_RULES[n].def])), keepInventory: o.keepInventory === true,
  };
}

/** Finish a brand-new world on its started game: game mode, cheats, season calendar and what the list shows. */
export function applyNewWorldOptions(game, o) {
  game.allowCheats = o.allowCheats;
  game.hardcore = o.hardcore === true; game.hardcoreOver = false;
  game.worldType = o.worldType;
  game.seedText = o.seedText || null;
  game.createdAt = Date.now();
  if (game.player && o.gamemode !== game.player.gamemode) game.player.setGamemode(o.gamemode);
  if (game.seasons) {
    if (o.seasonDays !== game.seasons.days) game.seasons.setDays(o.seasonDays, game.time);
    game.seasons.setSeason(o.startSeason, game.time);
    if (game.updateSeasons) game.updateSeasons();
  }
}

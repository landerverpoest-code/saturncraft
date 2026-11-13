// World rules (world/gameRules.js) and One Life worlds (world/newWorld.js).
import { describe, it, expect, afterEach } from 'vitest';
import { MockWorld } from './helpers.js';
import { B } from '../src/world/blocks.js';
import { WORLD_RULES, WORLD_RULE_NAMES, ruleIn, rule, setActiveRules, saveRules, loadRules, damageCounts } from '../src/world/gameRules.js';
import { runCommand, GAME_RULES, RULES_DEFAULT_OFF, HELP } from '../src/ui/commands.js';
import { cleanOptions, settingsForOptions, applyNewWorldOptions, defaultOptions } from '../src/world/newWorld.js';
import { worldSummary } from '../src/world/saveFormat.js';
import { HungerManager } from '../src/player/survival.js';
import { explode } from '../src/entities/explosion.js';
import { Game } from '../src/game.js';

afterEach(() => setActiveRules(null));

describe('world rules', () => {
  it('have defaults, and only booleans count', () => {
    expect(ruleIn({}, 'keepInventory')).toBe(false);
    expect(ruleIn(null, 'mobGriefing')).toBe(true);
    expect(ruleIn({ mobGriefing: 'no' }, 'mobGriefing')).toBe(true);
    expect(ruleIn({ mobGriefing: false }, 'mobGriefing')).toBe(false);
    expect(ruleIn({}, 'noSuchRule')).toBe(false);
    for (const n of WORLD_RULE_NAMES) expect(typeof WORLD_RULES[n].desc).toBe('string');
  });

  it('follow the running game', () => {
    expect(rule('fallDamage')).toBe(true);
    const s = { fallDamage: false };
    setActiveRules(s);
    expect(rule('fallDamage')).toBe(false);
    s.fallDamage = true;
    expect(rule('fallDamage')).toBe(true);
  });

  it('save and load with the world, falling back to defaults', () => {
    const saved = saveRules({ keepInventory: true, doFireTick: false });
    expect(saved.keepInventory).toBe(true);
    expect(saved.doFireTick).toBe(false);
    expect(saved.doMobLoot).toBe(true);
    const s = { keepInventory: true, doMobLoot: false };
    loadRules(s, { doMobLoot: 'x', doTileDrops: false });
    expect(s.keepInventory).toBe(false); // not in the save: default
    expect(s.doMobLoot).toBe(true);
    expect(s.doTileDrops).toBe(false);
    loadRules(s, null);
    expect(s.doTileDrops).toBe(true);
  });

  it('are /gamerule commands listed in the help', () => {
    const settings = {};
    const game = { settings, setSetting: (k, v) => { settings[k] = v; } };
    for (const n of WORLD_RULE_NAMES) {
      expect(GAME_RULES[n]).toBe(n);
      expect(RULES_DEFAULT_OFF.has(n)).toBe(!WORLD_RULES[n].def);
      expect(runCommand(game, `/gamerule ${n}`)).toContain(`currently set to: ${WORLD_RULES[n].def}`);
      expect(HELP.join(' ')).toContain(n);
    }
    expect(runCommand(game, '/gamerule KEEPINVENTORY true')).toContain('now set to: true');
    expect(settings.keepInventory).toBe(true);
  });

  it('switch kinds of damage off', () => {
    expect(damageCounts({}, 'fall')).toBe(true);
    expect(damageCounts({ fallDamage: false }, 'fall')).toBe(false);
    expect(damageCounts({ fallDamage: false }, 'stalagmite')).toBe(false);
    expect(damageCounts({ fireDamage: false }, 'lava')).toBe(false);
    expect(damageCounts({ drowningDamage: false }, 'drown')).toBe(false);
    expect(damageCounts({ fallDamage: false, fireDamage: false, drowningDamage: false }, 'mob:Shambler')).toBe(true);
    expect(damageCounts({ fallDamage: false }, 'void')).toBe(true);
  });

  it('naturalRegeneration off: a full stomach no longer heals, starving still hurts', () => {
    const mk = () => ({ health: 10, difficulty: 'normal', heal(n) { this.health += n; }, hurt(n) { this.health -= n; } });
    const a = mk(), ha = new HungerManager();
    for (let i = 0; i < 200; i++) ha.tick(a);
    expect(a.health).toBeGreaterThan(10);
    setActiveRules({ naturalRegeneration: false });
    const b = mk(), hb = new HungerManager();
    for (let i = 0; i < 200; i++) hb.tick(b);
    expect(b.health).toBe(10);
    hb.food = 0; hb.saturation = 0;
    for (let i = 0; i < 100; i++) hb.tick(b);
    expect(b.health).toBeLessThan(10);
  });
});

function blastGame() {
  const w = new MockWorld(64);
  w.setBlock = (x, y, z, id, meta = 0) => w.set(x, y, z, id, meta);
  w.raycast = () => null;
  w.ticks = [];
  w.scheduleTick = (x, y, z) => w.ticks.push([x, y, z]);
  const items = [];
  return {
    world: w, items,
    entities: { list: [], spawnItem: (x, y, z, st) => { items.push(st); return {}; } },
    player: { dead: true }, particles: { smoke() {} }, audio: { play() {} }, onBlockBroken() {},
  };
}
const count = (w, id) => [...w.blocks.values()].filter((v) => v === id).length;

describe('explosions under the rules', () => {
  it("a monster's blast spares the blocks when mobGriefing is off; blast powder still digs", () => {
    setActiveRules({ mobGriefing: false });
    const g = blastGame();
    explode(g, 0.5, 64.5, 0.5, 3, { kind: 'mob' });
    expect(count(g.world, B.AIR)).toBe(0);
    explode(g, 0.5, 64.5, 0.5, 3, { kind: 'fireball', shooter: { kind: 'mob' } });
    expect(count(g.world, B.AIR)).toBe(0);
    explode(g, 0.5, 64.5, 0.5, 3, { kind: 'tnt' });
    expect(count(g.world, B.AIR)).toBeGreaterThan(5);
  });

  it('a monster digs a crater by default', () => {
    const g = blastGame();
    explode(g, 0.5, 64.5, 0.5, 3, { kind: 'mob' });
    expect(count(g.world, B.AIR)).toBeGreaterThan(5);
  });

  it('blastsLightFires leaves fires on solid ground, and only then', () => {
    const plain = blastGame();
    explode(plain, 0.5, 64.5, 0.5, 4, null);
    expect(count(plain.world, B.FIRE)).toBe(0);
    setActiveRules({ blastsLightFires: true });
    const g = blastGame();
    explode(g, 0.5, 64.5, 0.5, 4, null);
    const fires = [...g.world.blocks.entries()].filter(([, v]) => v === B.FIRE);
    expect(fires.length).toBeGreaterThan(0);
    for (const [k] of fires) {
      const [x, y, z] = k.split(',').map(Number);
      expect(g.world.getBlock(x, y - 1, z)).not.toBe(B.AIR);
    }
    expect(g.world.ticks.length).toBe(fires.length);
  });
});

describe('dying under the rules', () => {
  function dyingGame(settings = {}, extra = {}) {
    const dropped = [], xp = [];
    const slots = new Array(36).fill(null); slots[0] = { id: B.COBBLESTONE, count: 12 };
    const g = {
      settings, dropped, xp, shown: null,
      player: { x: 0, y: 70, z: 0, stats: { deaths: 0 }, xp: { level: 7, progress: 0.5, total: 100 },
        inventory: { slots, armor: [null, { id: 1, count: 1 }, null, null], trinkets: [], clear() { this.slots.fill(null); this.armor = [null, null, null, null]; } } },
      entities: { spawnItem: (x, y, z, st) => { dropped.push(st); return {}; }, spawnXp: (x, y, z, n) => xp.push(n) },
      input: { unlock() {}, lock() {} }, ui: { showDeath(c) { g.shown = c; } }, net: null, ...extra,
    };
    setActiveRules(settings);
    return g;
  }

  it('drops everything by default', () => {
    const g = dyingGame();
    Game.prototype.onDeath.call(g, 'fall');
    expect(g.dropped.length).toBe(2);
    expect(g.xp.length).toBe(1);
    expect(g.player.xp.level).toBe(0);
    expect(g.player.inventory.slots[0]).toBe(null);
    expect(g.player.stats.deaths).toBe(1);
    expect(g.shown).toBe('fall');
  });

  it('keepInventory keeps items and experience', () => {
    const g = dyingGame({ keepInventory: true });
    Game.prototype.onDeath.call(g, 'fall');
    expect(g.dropped.length).toBe(0);
    expect(g.xp.length).toBe(0);
    expect(g.player.xp.level).toBe(7);
    expect(g.player.inventory.slots[0].count).toBe(12);
  });

  it('a One Life world ignores keepInventory and ends with the death', () => {
    const g = dyingGame({ keepInventory: true }, { hardcore: true, hardcoreOver: false });
    Game.prototype.onDeath.call(g, 'lava');
    expect(g.hardcoreOver).toBe(true);
    expect(g.dropped.length).toBe(2);
  });

  it('the spent life rises as a spectator where it fell', () => {
    const calls = [];
    const g = {
      hardcoreOver: true, net: null, input: { lock() { calls.push('lock'); } }, hud: { toast: (t) => calls.push(t) },
      player: { x: 5, y: 80, z: -3, spawn: { x: 0, y: 64, z: 0 }, respawn() { this.x = 0; this.y = 64; this.z = 0; }, setPosition(x, y, z) { this.x = x; this.y = y; this.z = z; }, setGamemode(m) { this.gamemode = m; } },
    };
    Game.prototype.respawn.call(g);
    expect(g.player.gamemode).toBe('spectator');
    expect([g.player.x, g.player.y, g.player.z]).toEqual([5, 80, -3]);
    expect(calls.join(' ')).toContain('one life');
  });
});

describe('One Life worlds', () => {
  it('are survival on Hard without cheats or kept inventories', () => {
    expect(defaultOptions().hardcore).toBe(false);
    const o = cleanOptions({ hardcore: true, gamemode: 'creative', difficulty: 'peaceful', allowCheats: true, keepInventory: true });
    expect(o).toMatchObject({ hardcore: true, gamemode: 'survival', difficulty: 'hard', allowCheats: false, keepInventory: false });
    expect(cleanOptions({ keepInventory: true })).toMatchObject({ hardcore: false, keepInventory: true, difficulty: 'normal' });
  });

  it('a new world starts from the default rules, whatever the last world left in the settings', () => {
    const s = settingsForOptions({ mobGriefing: false, keepInventory: true, fov: 80 }, cleanOptions({}));
    expect(s).toMatchObject({ mobGriefing: true, keepInventory: false, fov: 80 });
    expect(settingsForOptions({}, cleanOptions({ keepInventory: true })).keepInventory).toBe(true);
  });

  it('mark the game, lock difficulty and game mode, and show in the world list', () => {
    const g = { player: { gamemode: 'survival', setGamemode() {} } };
    applyNewWorldOptions(g, cleanOptions({ hardcore: true }));
    expect(g.hardcore).toBe(true);
    expect(g.hardcoreOver).toBe(false);
    const settings = { difficulty: 'hard' };
    const game = { hardcore: true, settings, difficulty: 'hard', player: { setGamemode() { throw new Error('no'); } }, setSetting: (k, v) => Game.prototype.setSetting.call(game, k, v) };
    expect(runCommand(game, '/difficulty easy')).toContain('stays on Hard');
    expect(runCommand(game, '/gamemode creative')).toContain('keeps its game mode');
    game.setSetting('difficulty', 'easy'); game.setSetting('keepInventory', true);
    expect(settings).toEqual({ difficulty: 'hard' });
    expect(worldSummary(1, { meta: { hardcore: true, hardcoreOver: true } })).toMatchObject({ hardcore: true, hardcoreOver: true });
    expect(worldSummary(1, { meta: { hardcoreOver: true } })).toMatchObject({ hardcore: false, hardcoreOver: false });
  });
});

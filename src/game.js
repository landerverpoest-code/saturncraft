// Game orchestrator: fixed 20 TPS simulation with interpolated rendering.
import { Mob } from './mobs/mob.js';
import { newHopper, hopperStep, HOPPER_COOLDOWN } from './world/hoppers.js';
import { powerInto } from './world/circuits.js';
import { newMap, updateMap, MAP_SIZE } from './world/maps.js';
import { KEEP_BITS, unpairAfterBreak } from './world/chests.js';
import * as THREE from 'three';
import { World } from './world/world.js';
import { B, BLOCKS } from './world/blocks.js';
import { ITEMS, I, toolOf, heldLightLevel } from './world/items.js';
import { heldLights } from './net/remotePlayer.js';
import { blockDrops } from './world/mining.js';
import { withExtras, cleanContents } from './world/enchantments.js';
import { runRandomTicks } from './world/randomTicks.js';
import { biomeName, BIOMES } from './world/biomes.js';
import { foliageColor } from './world/textures.js';
import { LEAVES } from './world/trees.js';
import { MIN_Y, TICK_MS } from './world/constants.js';
import { ChunkRenderer } from './render/chunkRenderer.js';
import { terrainUniforms, createTextureArray } from './render/terrainMaterial.js';
import { Particles } from './render/particles.js';
import { HeldItem, BlockOverlay } from './render/overlays.js';
import { PlayerModel } from './render/playerModel.js';
import { Sky } from './sky/sky.js';
import { Clouds } from './sky/clouds.js';
import { Weather, WeatherRenderer } from './sky/weather.js';
import { SignRenderer } from './render/signs.js';
import { FrameRenderer } from './render/frames.js';
import { Lightning } from './sky/lightning.js';
import { snowfall } from './world/randomTicks.js';
import { igniteTNT } from './entities/tnt.js';
import { canLight, FIRE_DELAY } from './world/fire.js';
import { Chat } from './ui/chat.js';
import { Music } from './audio/music.js';
import { Milestones } from './player/milestones.js';
import { effectiveSkyLight, skyState } from './sky/suns.js';
import { SIDE_DIRS, BED_HEAD } from './world/shapes.js';
import { CATEGORY } from './mobs/mobTypes.js';
import { SpawnerBlocks, dungeonLoot } from './mobs/spawnerBlocks.js';
import { newXp, deathXp } from './player/experience.js';
import { Player } from './player/player.js';
import { Interaction } from './player/interaction.js';
import { SMELTING, SMELT_TIME } from './player/crafting.js';
import { EntityManager } from './entities/entities.js';
import { MobSpawner } from './mobs/spawner.js';
import { HUD } from './ui/hud.js';
import { UI } from './ui/screens.js';
import { Input } from './ui/input.js';
import { Audio } from './audio/audio.js';
import { explode } from './entities/explosion.js';
import { saveGame, applySave, applyPlayerSave } from './world/save.js';
import { DimensionManager } from './world/dimensions/manager.js';
import { DIMENSIONS } from './world/dimensions/dims.js';
import { EnchantBooks } from './render/enchantBooks.js';
import { newStand, tickStand } from './world/brewing.js';
import { effectsColor } from './player/effects.js';
import { changeSound, CIRCUIT_BLOCK } from './world/circuits.js';
import { FACING6 } from './world/circuitShapes.js';
import { findStormRod, lightningCleanCopper } from './world/caves.js';
import { PostFX } from './render/postfx.js';

// Spherical (radial distance) fog instead of view-depth fog, so chunk edges never show at screen corners
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = length(mvPosition.xyz);
#endif`;
// Skip the 17-tap shadow lookup for suns that are down and for surfaces
// facing away from a sun: the light contributes nothing there anyway.
{
  const from = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow(';
  if (!THREE.ShaderChunk.lights_fragment_begin.includes(from)) throw new Error('lights_fragment_begin changed');
  // Materials may define SUN_MASK (terrain: "has sky light") to skip it too.
  THREE.ShaderChunk.lights_fragment_begin = '#ifndef SUN_MASK\n#define SUN_MASK true\n#endif\n' + THREE.ShaderChunk.lights_fragment_begin.replace(from,
    'directLight.color *= ( directLight.visible && receiveShadow && SUN_MASK && dot( directLight.color, vec3( 1.0 ) ) > 0.0 && dot( geometryNormal, directLight.direction ) > 0.0 ) ? getShadow(');
}

const CAVE_FOG = new THREE.Color(0.012, 0.012, 0.018);
export const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'];
const FIREFLY_BIOMES = new Set(['swamp', 'forest', 'flower_forest', 'dark_forest', 'jungle', 'birch_forest']);

export const DEFAULT_SETTINGS = { renderDistance: 8, fov: 75, sensitivity: 100, volume: 0.5, music: 0.5, shadows: true, shaders: true, shadowMapSize: 1024, pixelRatioCap: 1.25, daylightCycle: true, hostileMobs: true, difficulty: 'normal', showCoords: false };

export class Game {
  constructor(canvas, seed, settings, hooks = {}, saveData = null) {
    this.canvas = canvas;
    this.saveData = saveData;
    this.seed = seed;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.hooks = hooks;
    this.ticks = 0;
    this.time = 0;            // world time in ticks (drives the suns)
    this.running = false;
    this.paused = false;
    this.furnaces = new Map();
    this.chests = new Map();      // "x,y,z" -> { x, y, z, slots: 27 stacks }
    this.signs = new Map();       // "x,y,z" -> four lines of text
    this.frames = new Map();      // "x,y,z" -> the item stack in an item frame
    this.maps = new Map();        // map id -> filled map (world/maps.js)
    this.brewingStands = new Map(); // "x,y,z" -> Brewing Alembic state (see world/brewing.js)
    this.hoppers = new Map();     // "x,y,z" -> hopper slots (see world/hoppers.js)
    this.fps = 0; this.frameCount = 0; this.fpsTime = 0;
    this.net = null;              // multiplayer session (src/net/session.js), null in single-player
  }

  async start(onProgress) {
    const s = this.settings;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.postfx = new PostFX(this.renderer);
    this.postfx.enabled = s.shaders !== false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(s.fov, window.innerWidth / window.innerHeight, 0.05, 1200);
    this.scene.add(this.camera);
    this.scene.fog = new THREE.Fog(0x88aaff, 50, 120);
    createTextureArray();

    this.world = new World(this.seed, (this.saveData && this.saveData.dimension) || (this.net && this.net.dimension) || 'overworld');
    this.chunks = new ChunkRenderer(this.world, this.scene, this.seed, { renderDistance: s.renderDistance });
    this.sky = new Sky(this.scene, this.renderer, { shadowMapSize: s.shadowMapSize });
    this.sky.setShadowsEnabled(s.shadows);
    this.clouds = new Clouds(this.scene, this.seed);
    this.weather = new Weather();
    // fire checks this: rain puts out (and stops) fires that are open to the sky
    this.world.onTNT = (x, y, z) => igniteTNT(this, x, y, z);
    // Shellback eggs crack at night (rarely by day) and hatch after the third crack
    this.world.onEggTick = (x, y, z) => {
      if (this.net && this.net.isClient) return;
      if (this.sky.state.combined > 0.35 && Math.random() > 1 / 500) return;
      const m = this.world.getMeta(x, y, z), stage = (m >> 2) & 3;
      if (stage < 2) { this.world.setBlockUrgent(x, y, z, B.TURTLE_EGG, m + 4); this.audio.play('crack', [x + 0.5, y, z + 0.5]); return; }
      this.world.setBlockUrgent(x, y, z, B.AIR);
      this.audio.play('crack', [x + 0.5, y, z + 0.5]);
      for (let k = 0; k <= (m & 3); k++) {
        const t = this.spawner.spawnMob('shellback', x + 0.3 + Math.random() * 0.4, y, z + 0.3 + Math.random() * 0.4);
        if (t) { t.setBaby(true); t.beach = { x, y, z }; t.persistent = true; }
      }
    };
    this.world.rainingAt = (x, y, z) => this.world.dimension === 'overworld' && this.weather.level >= 0.2 && Weather.precipitation(this.world.biomeAt(x, z)) === 'rain' && this.world.heightAt(x, z) <= y;
    this.chat = this.chat || new Chat(this);
    this.weatherFx = new WeatherRenderer(this.scene);
    this.lightning = new Lightning(this.scene);
    this.particles = new Particles(this.scene);
    this.signRenderer = new SignRenderer(this);
    this.frameRenderer = new FrameRenderer(this);
    this.playerModel = new PlayerModel(this.scene);
    this.perspective = 0; // 0 first person, 1 behind, 2 in front (F5)
    this.player = new Player();
    this.player.isPlayer = true;
    this.localPlayer = this.player; // (mob AI swaps game.player for the nearest player in multiplayer)
    this.entities = new EntityManager(this);
    this.spawner = new MobSpawner(this);
    this.spawnerBlocks = new SpawnerBlocks(this);
    this.milestones = new Milestones(this);
    this.player.inventory.listeners.push(() => this.milestones.checkInventory());
    this.interaction = new Interaction(this);
    this.input = new Input(this.canvas);
    this.input.sensitivity = 0.0022 * s.sensitivity / 100;
    this.audio = new Audio();
    this.audio.setVolume(s.volume);
    this.music = new Music(this.audio);
    this.music.setVolume(s.music ?? 0.5);
    this.hud = new HUD(this);
    this.ui = new UI(this);
    this.held = new HeldItem(this);
    this.overlay = new BlockOverlay(this.scene);
    this.enchantBooks = new EnchantBooks(this.scene); // floating books over enchanting tables
    this.dims = new DimensionManager(this); // the Cinderdeep and the Hollow (world/dimensions/)
    this.dims.applyLook();

    this.world.on('fallingBlock', (x, y, z, id) => this.entities.spawnFallingBlock(x, y, z, id));
    // caves content (world/caves.js): Storm Rods are looked up per chunk; hanging spikes fall as one, the tip hurts
    this.world.on('blockChanged', (x, y, z, old, id) => {
      if (old !== B.STORM_ROD && id !== B.STORM_ROD) return;
      const c = this.world.getChunk(x >> 4, z >> 4);
      if (c) c.stormRods = null;
    });
    this.world.onStalactiteFall = (parts) => parts.forEach(([x, y, z, m], k) => {
      const e = this.entities.spawnFallingBlock(x, y, z, B.SEEPSTONE_SPIKE);
      if (!e) return;
      e.meta = m; e.shatters = true;
      if (k === parts.length - 1) e.hurtLength = parts.length;
    });
    this.world.on('blockChanged', (x, y, z, old, id) => { if (id === B.HOPPER) this.getHopper(x, y, z); }); // a new hopper starts working
    this.world.on('fireCrackle', (x, y, z) => this.audio.play('fire', [x + 0.5, y + 0.5, z + 0.5]));
    this.initCircuits();
    this.world.on('dropItems', (x, y, z, id, meta) => {
      if (this.net && this.net.applyingRemote) return; // the player who made the edit gets the drops
      for (const st of blockDrops(id, toolOf(null), Math.random, meta)) this.entities.spawnItem(x + 0.5, y + 0.3, z + 0.5, st);
    });
    this.chunks.onChunkLoaded = (cx, cz) => this.spawner.onChunkLoaded(cx, cz);
    this.chunks.onChunkUnloaded = (cx, cz) => this.spawner.onChunkUnloaded(cx, cz);
    this.player.listeners.hurt.push(() => this.audio.play('hurt'));
    // a blocked hit wears the shield and pushes melee attackers back
    this.player.listeners.blocked = [(amount, attacker) => {
      const p = this.player;
      this.audio.play('shield', [p.x, p.y + 1, p.z]);
      if (!p.creative && amount >= 3) p.inventory.damageSelected(1 + Math.floor(amount));
      if (attacker && attacker.body && attacker.kind === 'mob') {
        const dx = attacker.x - p.x, dz = attacker.z - p.z, d = Math.hypot(dx, dz) || 1;
        attacker.body.vx += dx / d * 0.5; attacker.body.vz += dz / d * 0.5;
      }
    }];
    this.player.listeners.death.push((cause) => this.onDeath(cause));

    if (this.saveData) {
      applySave(this, this.saveData);
      applyPlayerSave(this, this.saveData.player);
    }
    // Spawn point
    const sp = this.saveData ? this.saveData.player.spawn : this.world.gen.findSpawn();
    if (!this.saveData) {
      this.player.spawn = { x: sp.x, y: sp.y + 1, z: sp.z };
      this.player.setPosition(sp.x, sp.y + 1, sp.z);
      this.player.yaw = Math.PI * 0.75;
    }
    if (this.net) this.net.attach(this); // joining a friend: their world, time and our position

    // the chat opens on the key press itself, so nothing typed right after T or / reaches the game
    this.input.onKey = (e) => {
      if (this.running && !this.ui.blocking && (e.code === 'KeyT' || e.code === 'Slash')) {
        e.preventDefault();
        this.input.down.clear(); this.input.pressed.clear();
        this.ui.openChat(e.code === 'Slash' ? '/' : '');
      }
    };
    this.input.onLockChange = (locked) => {
      if (!locked && !this.ui.blocking && this.running) { this.ui.showPause(); }
    };
    this.canvas.addEventListener('click', () => {
      this.audio.ensure();
      if (this.audio.ctx && this.audio.ctx.state === 'suspended') this.audio.ctx.resume();
      if (!this.ui.blocking) this.input.lock();
    });
    this._onResize = () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.held.resize();
    };
    window.addEventListener('resize', this._onResize);

    // Pre-load chunks around spawn
    const need = (2 * 2 + 1) ** 2;
    await new Promise((resolve) => {
      const step = () => {
        this.chunks.update(this.player.x, this.player.z, 30);
        let ready = 0;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          const c = this.world.getChunk(Math.floor(this.player.x / 16) + dx, Math.floor(this.player.z / 16) + dz);
          if (c && c.meshed) ready++;
        }
        if (onProgress) onProgress(ready / need);
        if (ready >= need) resolve(); else setTimeout(step, 16);
      };
      step();
    });
    if (!this.saveData && !this.net) {
      // Put the player on the surface
      const px = Math.floor(this.player.x), pz = Math.floor(this.player.z);
      let y = this.world.heightAt(px, pz) + 1;
      while (y < 300 && (this.world.getBlock(px, y, pz) || this.world.getBlock(px, y + 1, pz))) y++;
      this.player.spawn = { x: px + 0.5, y, z: pz + 0.5 };
      this.player.setPosition(px + 0.5, y, pz + 0.5);
    }
    // the world spawn (used again when the home bed is gone)
    this.worldSpawn = (this.saveData && this.saveData.worldSpawn) || this.worldSpawn || { ...this.player.spawn };

    this.running = true;
    this.lastTime = performance.now();
    this.acc = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  setSetting(k, v) {
    this.settings[k] = v;
    if (k === 'renderDistance') this.chunks.setRenderDistance(v);
    if (k === 'fov') { this.camera.fov = v; this.camera.updateProjectionMatrix(); }
    if (k === 'sensitivity') this.input.sensitivity = 0.0022 * v / 100;
    if (k === 'volume') this.audio.setVolume(v);
    if (k === 'music') this.music.setVolume(v);
    if (k === 'shadows') this.sky.setShadowsEnabled(v && (this.quality || 0) < 2);
    if (k === 'pixelRatioCap') { this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, v)); this.renderer.setSize(window.innerWidth, window.innerHeight, false); }
    if (k === 'shaders') this.postfx.enabled = v !== false && (this.quality || 0) < 3;
    if ((k === 'hostileMobs' && !v) || (k === 'difficulty' && v === 'peaceful')) this.removeHostileMobs();
    if (k === 'difficulty') this.player.difficulty = v;
    if (k === 'daylightCycle' && !v) this.freezeAtDay();
    if (this.hooks.saveSettings) this.hooks.saveSettings(this.settings);
  }

  /** peaceful | easy | normal | hard (saved per world). */
  get difficulty() { return DIFFICULTIES.includes(this.settings.difficulty) ? this.settings.difficulty : 'normal'; }

  /** Is the day/night cycle running (time advancing)? */
  get daylightCycle() { return this.settings.daylightCycle !== false; }

  /** Hostile mobs switched off: clear the monsters that are already around (like peaceful). */
  /**
   * Switching the day/night cycle off means "always day": if it is not
   * broad daylight yet, skip ahead to the next noon and clear the night's
   * monsters that stand under the open sky (cave monsters stay).
   */
  freezeAtDay() {
    if (this.world.dimension && this.world.dimension !== 'overworld') return;
    if (skyState(this.time).combined > 0.6) return;
    let t = this.time;
    while (skyState(t).combined < 0.95 && t < this.time + 400000) t += 20;
    this.time = t;
    if (this.net && this.net.isHost && this.net.broadcastTime) this.net.broadcastTime();
    if (!this.entities) return;
    for (const e of this.entities.list) {
      if (e.kind !== 'mob' || e.dead || e.def.category !== CATEGORY.MONSTER) continue;
      if (this.world.heightAt(Math.floor(e.x), Math.floor(e.z)) <= Math.floor(e.y) + 1) { e.removed = true; e.dead = true; }
    }
  }

  removeHostileMobs() {
    if (!this.entities) return;
    for (const e of this.entities.list) {
      if (e.kind === 'mob' && !e.dead && e.def.category === CATEGORY.MONSTER) { e.removed = true; e.dead = true; }
    }
  }

  onUIClosed() { this.input.lock(); }

  async save() {
    if (this.net && this.net.isClient) return false; // a friend's world is saved by its host
    try { await saveGame(this); return true; } catch (e) { console.warn('save failed', e); return false; }
  }

  async quitToTitle() {
    this.running = false;
    await this.save();
    if (this.net) this.net.close();
    this.input.unlock();
    this.chunks.dispose();
    window.removeEventListener('resize', this._onResize);
    if (this.hooks.quit) this.hooks.quit();
  }

  onDeath(cause) {
    const p = this.player;
    for (let i = 0; i < p.inventory.slots.length; i++) {
      const st = p.inventory.slots[i];
      if (st) this.entities.spawnItem(p.x, p.y + 1, p.z, st, [(Math.random() - 0.5) * 0.5, 0.2, (Math.random() - 0.5) * 0.5]);
    }
    for (const st of p.inventory.armor) if (st) this.entities.spawnItem(p.x, p.y + 1, p.z, st, [(Math.random() - 0.5) * 0.5, 0.2, (Math.random() - 0.5) * 0.5]);
    this.entities.spawnXp(p.x, p.y + 0.5, p.z, deathXp(p.xp.level));
    p.xp = newXp();
    p.inventory.clear();
    this.input.unlock();
    this.ui.showDeath(cause);
  }

  respawn() {
    const p = this.player;
    // dying away from the overworld sends you home first
    if (this.world.dimension !== 'overworld') {
      // a multiplayer guest stays with the group (the host decides where everybody is)
      if (this.net && this.net.isClient) { p.respawn(); this.net.respawnNearHost(); this.input.lock(); return; }
      this.dims.switchTo('overworld', { mode: 'spawn', x: p.spawn.x, y: p.spawn.y, z: p.spawn.z });
    }
    // the bed must still be there (when its chunk is loaded we can check)
    if (p.bed && this.world.isLoaded(p.bed.x, p.bed.z) && this.world.getBlock(p.bed.x, p.bed.y, p.bed.z) !== B.BED) {
      p.bed = null;
      p.spawn = { ...this.worldSpawn };
      this.hud.toast('You have no home bed, or it was obstructed');
    }
    this.player.respawn();
    this.input.lock();
  }

  /** Rain on the ground: splashes near the player; puts out burning things. */
  /** Swirls of the active effects' colours around the player (fewer while invisible). */
  effectParticles() {
    const p = this.player;
    // (not in first person: points that close to the eyes would cover the view)
    if (p.dead || this.perspective === 0 || this.ticks % (p.effects.invisibility ? 6 : 2) !== 0) return;
    const list = [];
    for (const k in p.effects) list.push([k, p.effects[k].amp]);
    const col = effectsColor(list);
    if (!col) return;
    const a = (this.ticks * 0.37) % (Math.PI * 2) + Math.random() * 0.6, r = 0.45 + Math.random() * 0.15;
    const h = 0.1 + Math.random() * 1.6;
    // tangential drift makes them circle and rise around the body
    this.particles.emit(p.x + Math.cos(a) * r, p.y + h, p.z + Math.sin(a) * r, -Math.sin(a) * 0.035, 0.03, Math.cos(a) * 0.035, col[0], col[1], col[2], 22, -0.0015);
  }

  tickRain() {
    const wth = this.weather, p = this.player;
    if (wth.level < 0.2) return;
    if (p.fireTicks > 0 && wth.rainingAt(this.world, p.x, p.y + 1, p.z)) p.fireTicks = 0;
    if (!this.net || this.net.isHost) snowfall(this.world, p.x, p.z);
    for (let k = 0; k < Math.round(wth.level * 6); k++) {
      const x = Math.floor(p.x + (Math.random() - 0.5) * 16), z = Math.floor(p.z + (Math.random() - 0.5) * 16);
      if (Weather.precipitation(this.world.biomeAt(x, z)) !== 'rain') continue;
      const y = this.world.heightAt(x, z) + 1;
      if (Math.abs(y - p.y) > 12) continue;
      this.particles.emit(x + Math.random(), y + 0.02, z + Math.random(), 0, 0.06, 0, 0.45, 0.55, 0.75, 4, 0.03);
    }
  }

  // ---- boats --------------------------------------------------------------------
  mount(boat) {
    const p = this.player;
    boat.rider = p; p.riding = boat;
    if (boat.netProxy && this.net) this.net.ride(boat, true); // a shared boat: tell the host we steer it
    this.seatPlayer();
  }

  dismount() {
    const p = this.player, boat = p.riding;
    if (!boat) return;
    boat.rider = null; p.riding = null;
    if (boat.netProxy && this.net) this.net.ride(boat, false);
    const bx = Math.floor(boat.x), by = Math.floor(boat.y + 0.5), bz = Math.floor(boat.z);
    const spot = this.standNextTo(bx, by, bz);
    if (spot) p.setPosition(spot.x, spot.y, spot.z);
    else p.setPosition(boat.x, boat.y + 0.6, boat.z);
  }

  /** Keep the rider on the seat. */
  seatPlayer() {
    const p = this.player, b = p.riding.body;
    p.body.setPos(b.x, b.y + (p.riding.seatY ?? -0.3), b.z);
    p.body.vx = p.body.vy = p.body.vz = 0;
    p.body.fallDistance = 0;
  }

  // ---- beds & sleeping -------------------------------------------------------
  /** Right-click on a bed: set the respawn point and sleep if it is night and safe. */
  trySleep(x, y, z) {
    const w = this.world, p = this.player;
    if (w.dimension !== 'overworld') { this.dims.bedExplodes(x, y, z); return; } // beds blow up outside the overworld
    const m = w.getMeta(x, y, z);
    const [dx, , dz] = SIDE_DIRS[m & 3];
    const head = m & BED_HEAD ? [x, z] : [x + dx, z + dz];
    if (skyState(this.time).aboveCount > 0) { this.hud.toast('You can only sleep at night (when all three suns are down)'); return; }
    if (Math.hypot(p.x - (head[0] + 0.5), p.z - (head[1] + 0.5)) > 3.5) { this.hud.toast('You may not rest now; the bed is too far away'); return; }
    for (const e of this.entities.mobs) {
      if (e.dead || e.def.category !== CATEGORY.MONSTER) continue;
      if (Math.abs(e.x - (head[0] + 0.5)) < 8 && Math.abs(e.z - (head[1] + 0.5)) < 8 && Math.abs(e.y - y) < 5) { this.hud.toast('You may not rest now; there are monsters nearby'); return; }
    }
    p.bed = { x: head[0], y, z: head[1] };
    const stand = this.standNextTo(head[0], y, head[1]) || { x: head[0] + 0.5, y: y + 0.5625, z: head[1] + 0.5 };
    p.spawn = stand;
    this.hud.toast('Respawn point set');
    // lie down on the bed
    p.sleeping = { x: head[0], y, z: head[1], ticks: 0 };
    p.setPosition(head[0] + 0.5, y + 0.5625, head[1] + 0.5);
    p.yaw = Math.atan2(dx, dz); // feet towards the foot of the bed
    p.pitch = 0;
    this.input.unlock();
    this.ui.showSleep();
  }

  /** A free spot (feet position) next to a block, or null. */
  standNextTo(x, y, z) {
    const w = this.world;
    for (const dy of [0, -1, 1]) {
      for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const cx = x + dx, cy = y + dy, cz = z + dz;
        const free = (yy) => { const id = w.getBlock(cx, yy, cz); return !BLOCKS[id].solid && !BLOCKS[id].fluid; };
        if (BLOCKS[w.getBlock(cx, cy - 1, cz)].solid && free(cy) && free(cy + 1)) return { x: cx + 0.5, y: cy, z: cz + 0.5 };
      }
    }
    return null;
  }

  /** Get up: skip to sunrise if the player slept long enough. */
  wakeUp(skipNight) {
    const p = this.player, s = p.sleeping;
    if (!s) return;
    p.sleeping = null;
    if (skipNight) {
      let t = this.time;
      while (skyState(t).aboveCount === 0 && t < this.time + 200000) t += 20;
      this.time = t;
      this.milestones.event('sleep');
    }
    const stand = this.world.getBlock(s.x, s.y, s.z) === B.BED ? this.standNextTo(s.x, s.y, s.z) : null;
    if (stand) p.setPosition(stand.x, stand.y, stand.z);
    else p.setPosition(p.x, s.y + 1, p.z);
    if (this.ui.open === 'sleep') { this.ui.open = null; this.ui.clear(); this.onUIClosed(); }
  }

  tickSleep() {
    const p = this.player, s = p.sleeping;
    if (!s) return;
    if (p.dead || this.world.getBlock(s.x, s.y, s.z) !== B.BED || p.hurtTime > 0) { this.wakeUp(false); return; }
    p.setPosition(s.x + 0.5, s.y + 0.5625, s.z + 0.5);
    p.body.vx = p.body.vy = p.body.vz = 0;
    if (++s.ticks >= 100 && !this.net) this.wakeUp(true); // 5 seconds of sleep skips the night (multiplayer: once everyone sleeps)
  }

  getFurnace(x, y, z) {
    const k = `${x},${y},${z}`; // (a multiplayer guest keeps copies of the host's furnaces here)
    let f = this.furnaces.get(k);
    if (!f) { f = { x, y, z, input: null, fuel: null, output: null, burnTime: 0, burnTotal: 0, cookTime: 0 }; this.furnaces.set(k, f); }
    return f;
  }

  getBrewingStand(x, y, z) {
    const k = `${x},${y},${z}`; // (a multiplayer guest keeps copies of the host's stands here)
    let s = this.brewingStands.get(k);
    if (!s) { s = newStand(x, y, z); this.brewingStands.set(k, s); }
    return s;
  }

  /** A new filled map of the square around x,z (ids are random so players' maps never clash). */
  createMap(x, z) {
    let id;
    do id = 1 + Math.floor(Math.random() * 0x7ffffffe); while (this.maps.has(id));
    const m = newMap(id, x, z, this.world.dimension);
    this.maps.set(id, m);
    updateMap(m, this.world, x, z, MAP_SIZE * MAP_SIZE);
    return m;
  }

  /** The map behind a filled-map stack (a blank one is made for a map from another player). */
  mapOf(st) {
    if (!st || !Number.isInteger(st.map)) return null;
    let m = this.maps.get(st.map);
    if (!m) { m = newMap(st.map, (st.mapX | 0) * 128 + 64, (st.mapZ | 0) * 128 + 64, this.world.dimension); this.maps.set(st.map, m); }
    return m;
  }

  /** A held map keeps drawing what is around its holder. */
  tickMaps() {
    const st = this.player.inventory.selectedStack;
    if (!st || st.id !== I.FILLED_MAP || this.player.dead) return;
    const m = this.mapOf(st);
    if (m && m.dimension === this.world.dimension && this.ticks % 2 === 0) { updateMap(m, this.world, this.player.x, this.player.z, 600); m.dirty = true; }
  }

  getHopper(x, y, z) {
    const k = `${x},${y},${z}`;
    let h = this.hoppers.get(k);
    if (!h) { h = newHopper(x, y, z); this.hoppers.set(k, h); }
    return h;
  }

  /** Hoppers pass items along (host / single player only). */
  tickHoppers() {
    if (!this.hoppers.size) return;
    const items = this.entities.list.filter((e) => e.kind === 'item');
    for (const [k, h] of this.hoppers) {
      if (this.world.getBlock(h.x, h.y, h.z) !== B.HOPPER) { if (this.world.getChunk(h.x >> 4, h.z >> 4)) this.hoppers.delete(k); continue; }
      if (h.cooldown > 0) { h.cooldown--; continue; }
      const powered = this.world.circuits ? powerInto(this.world, h.x, h.y, h.z) > 0 : false;
      if (hopperStep(this, h, powered, items)) h.cooldown = HOPPER_COOLDOWN;
    }
  }

  tickBrewing() {
    for (const s of this.brewingStands.values()) {
      if (!this.world.isLoaded(s.x, s.z)) continue;
      if (this.world.getBlock(s.x, s.y, s.z) !== B.BREWING_STAND) continue;
      const r = tickStand(s);
      if (r === 'done') this.audio.play('brew', [s.x + 0.5, s.y + 0.5, s.z + 0.5]);
      if (s.brewTime > 0 && Math.random() < 0.15) this.particles.emit(s.x + 0.5 + (Math.random() - 0.5) * 0.3, s.y + 0.85, s.z + 0.5 + (Math.random() - 0.5) * 0.3, 0, 0.02, 0, 0.85, 0.75, 0.95, 20, -0.001);
    }
  }

  getChest(x, y, z, metaHint) {
    const k = `${x},${y},${z}`;
    let c = this.chests.get(k);
    if (!c) {
      c = { x, y, z, slots: new Array(27).fill(null) };
      this.chests.set(k, c);
      if (this.net && this.net.isClient) return c; // a copy of the host's chest (loot is rolled there)
      // dungeon chests roll their loot the first time they are opened or broken
      const meta = metaHint ?? this.world.getMeta(x, y, z);
      if (meta & 8) {
        c.slots = dungeonLoot(Math.random, (meta >> 4) & 15);
        if (this.world.getBlock(x, y, z) === B.CHEST) this.world.setBlockUrgent(x, y, z, B.CHEST, meta & KEEP_BITS, false);
      }
    }
    return c;
  }

  onBlockBroken(x, y, z, id, meta = 0) {
    if ((id === B.BEE_NEST || id === B.BEEHIVE) && (!this.net || !this.net.isClient)) Mob.angerBees(this, x, y, z); // the bees defend their home
    if (id === B.SPAWNER) this.milestones.event('spawner');
    if (id === B.ITEM_FRAME) {
      // a broken frame drops what it held
      const st = this.frames.get(`${x},${y},${z}`);
      if (st && this.net && this.net.isClient) this.setFrameItem(x, y, z, null, true); // the host drops it when it sees the edit
      else if (st) { this.setFrameItem(x, y, z, null); if (!this.player.creative) this.entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, st); }
    }
    if (id === B.CHEST) {
      // the other half of a double chest becomes a single chest again
      const u = unpairAfterBreak(this.world, x, y, z, meta);
      if (u) this.world.setBlockUrgent(u.x, u.y, u.z, B.CHEST, u.meta);
    }
    const showing = (c) => c && this.ui.chest && (this.ui.chest === c || (this.ui.chest.halves && this.ui.chest.halves.includes(c)));
    if (this.net && this.net.isClient) {
      // the host spills the contents of its own chest / furnace
      const k = `${x},${y},${z}`;
      if (showing(this.chests.get(k))) this.ui.close();
      if (this.ui.furnace && this.ui.furnace === this.furnaces.get(k)) this.ui.close();
      if (this.ui.brewing && this.ui.brewing === this.brewingStands.get(k)) this.ui.close();
      if (showing(this.hoppers.get(k))) this.ui.close();
      this.chests.delete(k); this.furnaces.delete(k); this.brewingStands.delete(k); this.hoppers.delete(k);
      return;
    }
    if (id === B.GLOOMSHELL_BOX) this.dropBox(x, y, z);
    if (id === B.HOPPER) {
      const k = `${x},${y},${z}`, h = this.hoppers.get(k);
      if (h) { for (const st of h.slots) if (st) this.entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, st); this.hoppers.delete(k); if (showing(h)) this.ui.close(); }
    }
    if (id === B.CHEST || id === B.BARREL) {
      const k = `${x},${y},${z}`;
      const c = (meta & 8) ? this.getChest(x, y, z, meta) : this.chests.get(k);
      if (c) {
        for (const st of c.slots) if (st) this.entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, st);
        this.chests.delete(k);
        if (showing(c)) this.ui.close();
      }
    }
    if (id === B.BREWING_STAND) this.spillBrewing(x, y, z);
    if (id === B.FURNACE || id === B.FURNACE_LIT) {
      const k = `${x},${y},${z}`;
      const f = this.furnaces.get(k);
      if (f) {
        for (const st of [f.input, f.fuel, f.output]) if (st) this.entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, st);
        this.furnaces.delete(k);
        if (this.ui.furnace === f) this.ui.close();
      }
    }
  }

  /** A broken Gloomshell Box drops itself with everything inside it kept in the item (stack.contents). */
  dropBox(x, y, z) {
    const k = `${x},${y},${z}`, c = this.chests.get(k);
    const st = withExtras({ id: B.GLOOMSHELL_BOX, count: 1, damage: 0 }, { contents: c ? c.slots : null });
    if (c) { this.chests.delete(k); if (this.ui.chest === c) this.ui.close(); }
    if (st.contents || !this.player.creative) this.entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, st);
  }

  /** A Gloomshell Box was placed: it unpacks what it carried (a guest's box: on the host). */
  onBoxPlaced(x, y, z, st, fromGuest = false) {
    const contents = st && cleanContents(st.contents);
    if (!contents) return;
    if (this.net && this.net.isClient) { this.net.sendBoxContents(x, y, z, contents); return; }
    if (fromGuest && this.chests.get(`${x},${y},${z}`)) return; // never overwrite a box that is already there
    this.getChest(x, y, z).slots = contents;
  }

  /** Spill a broken Brewing Alembic's vials, ingredient and fuel. */
  spillBrewing(x, y, z) {
    const k = `${x},${y},${z}`, s = this.brewingStands.get(k);
    if (!s) return;
    for (const st of s.slots) if (st) this.entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, st);
    this.brewingStands.delete(k);
    if (this.ui.brewing === s) this.ui.close();
  }

  tickFurnaces() {
    for (const f of this.furnaces.values()) {
      if (!this.world.isLoaded(f.x, f.z)) continue;
      const result = f.input ? SMELTING[f.input.id] : undefined;
      const canSmelt = result !== undefined && (!f.output || (f.output.id === result && f.output.count < 64));
      const wasLit = f.burnTime > 0;
      if (f.burnTime > 0) f.burnTime--;
      if (f.burnTime === 0 && canSmelt && f.fuel && ITEMS[f.fuel.id].fuel) {
        f.burnTotal = f.burnTime = ITEMS[f.fuel.id].fuel;
        if (f.fuel.id === I.LAVA_BUCKET) f.fuel = { id: I.BUCKET, count: 1 };
        else { f.fuel.count--; if (f.fuel.count <= 0) f.fuel = null; }
      }
      if (f.burnTime > 0 && canSmelt) {
        if (++f.cookTime >= SMELT_TIME) {
          f.cookTime = 0;
          if (f.output) f.output.count++; else f.output = { id: result, count: 1 };
          f.input.count--; if (f.input.count <= 0) f.input = null;
        }
      } else if (f.cookTime > 0) f.cookTime = Math.max(0, f.cookTime - 2);
      const lit = f.burnTime > 0;
      if (lit !== wasLit) {
        const meta = this.world.getMeta(f.x, f.y, f.z);
        const cur = this.world.getBlock(f.x, f.y, f.z);
        if (cur === B.FURNACE || cur === B.FURNACE_LIT) this.world.setBlock(f.x, f.y, f.z, lit ? B.FURNACE_LIT : B.FURNACE, meta, false);
      }
      if (lit && Math.random() < 0.1) this.particles.flame(f.x + 0.5, f.y + 0.4, f.z + 0.5);
    }
  }

  /** Put an item in a frame, or take it out (null); shared in multiplayer. */
  setFrameItem(x, y, z, st, fromNet = false) {
    const k = `${x},${y},${z}`;
    if (st) this.frames.set(k, { id: st.id, count: 1, damage: st.damage | 0, ...(st.ench ? { ench: st.ench } : {}) }); else this.frames.delete(k);
    if (!fromNet && this.net && this.net.sendFrame) this.net.sendFrame(x, y, z, st ? this.frames.get(k) : null);
  }

  /** Write on a sign (shared with everyone in multiplayer). */
  setSignText(x, y, z, lines, fromNet = false) {
    const clean = [0, 1, 2, 3].map((i) => String((lines && lines[i]) || '').slice(0, 15));
    this.signs.set(`${x},${y},${z}`, clean);
    if (!fromNet && this.net) this.net.sendSign ? this.net.sendSign(x, y, z, clean) : null;
  }

  /** Ambient block effects near the player: smoke from campfires and torches, embers over lava. */
  displayTick() {
    const p = this.player, w = this.world;
    for (let k = 0; k < 120; k++) {
      const x = Math.floor(p.x + (Math.random() - 0.5) * 24), y = Math.floor(p.y + (Math.random() - 0.5) * 16), z = Math.floor(p.z + (Math.random() - 0.5) * 24);
      const id = w.getBlock(x, y, z);
      if (id === B.CAMPFIRE) {
        for (let n = 0; n < 3; n++) this.particles.emit(x + 0.3 + Math.random() * 0.4, y + 0.6, z + 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.01, 0.05 + Math.random() * 0.03, (Math.random() - 0.5) * 0.01, 0.55, 0.55, 0.58, 60 + Math.random() * 40, -0.0005);
        if (Math.random() < 0.3) this.audio.play('fire', [x + 0.5, y + 0.5, z + 0.5], 0.4);
      } else if (id === B.TORCH && Math.random() < 0.5) {
        const m = w.getMeta(x, y, z), off = m ? 0.27 : 0, s = m ? [[0, -1], [1, 0], [0, 1], [-1, 0]][(m - 1) & 3] : [0, 0];
        this.particles.emit(x + 0.5 + s[0] * off, y + (m ? 0.92 : 0.72), z + 0.5 + s[1] * off, 0, 0.01, 0, 0.45, 0.45, 0.45, 20, -0.001);
      } else if (id === B.LAVA && !w.getBlock(x, y + 1, z) && Math.random() < 0.05) {
        this.particles.emit(x + Math.random(), y + 1, z + Math.random(), (Math.random() - 0.5) * 0.1, 0.15, (Math.random() - 0.5) * 0.1, 1, 0.55, 0.15, 30, 0.02);
      } else if (LEAVES.has(id) && Math.random() < 0.04 && !w.getBlock(x, y - 1, z)) {
        // a leaf drifts down from the canopy, sideways with the wind
        const c = this.leafColor(id, x, z), L = this.ambientLight(x + 0.5, y - 0.5, z + 0.5), wind = terrainUniforms.uWind.value;
        this.particles.emit(x + Math.random(), y - 0.05, z + Math.random(), 0.02 * wind, -0.02, 0.012 * wind, c[0] * L, c[1] * L, c[2] * L, 90, 0.0004);
      }
    }
    if (w.dimension !== 'overworld') return;
    const night = 1 - Math.min(1, this.sky.state.combined * 1.6);
    // fireflies over swamps, forests and jungles on warm dry nights
    if (night > 0.5 && this.weather.level < 0.2 && Math.random() < 0.5 * night) {
      const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 12; // not right in front of the eyes
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const key = BIOMES[w.biomeAt(Math.floor(x), Math.floor(z))]?.key;
      if (FIREFLY_BIOMES.has(key)) {
        const y = w.heightAt(Math.floor(x), Math.floor(z)) + 1 + Math.random() * 3;
        if (!w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))) {
          const glow = this.postfx.enabled ? 1.8 : 1; // above white: the bloom pass haloes them
          this.particles.emit(x, y, z, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.04, 0.75 * glow, 1.3 * glow, 0.12 * glow, 50 + Math.random() * 70, 0);
        }
      }
    }
    // dust hanging in the air of caves
    if (this.caveDark > 0.5 && Math.random() < 0.6) {
      const x = p.x + (Math.random() - 0.5) * 12, y = p.y + Math.random() * 4 - 1, z = p.z + (Math.random() - 0.5) * 12;
      if (!w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))) {
        const L = this.ambientLight(x, y, z) * 0.7;
        this.particles.emit(x, y, z, (Math.random() - 0.5) * 0.004, -0.001, (Math.random() - 0.5) * 0.004, 0.75 * L, 0.72 * L, 0.68 * L, 120, 0);
      }
    }
  }

  /** How bright an ambient particle at x,y,z looks: its light, with sky light dimmed at night. */
  ambientLight(x, y, z) {
    const day = 0.2 + 0.8 * Math.min(1, this.sky.state.combined);
    const l = this.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
    return Math.max(((l >> 4) / 15) * day, (l & 15) / 15 * 0.9, 0.06);
  }

  /** Linear-light colour of a falling leaf: the biome's foliage tint (fixed for birch and spruce). */
  leafColor(id, x, z) {
    const lin = (v) => Math.pow(v / 255, 2.2);
    if (id === B.BIRCH_LEAVES) return [lin(128), lin(167), lin(85)];
    if (id === B.SPRUCE_LEAVES) return [lin(97), lin(153), lin(97)];
    const b = BIOMES[this.world.biomeAt(x, z)] || BIOMES[3], c = b.foliage || foliageColor(b.temp, b.humid);
    return [lin(c[0] * 0.8), lin(c[1] * 0.8), lin(c[2] * 0.8)];
  }

  /** Thunderstorms: every ~20 s a bolt hits a random rainy spot within 64 blocks. */
  tickThunder() {
    if (this.weather.storm < 0.9 || Math.random() >= 1 / 400) return;
    const p = this.player;
    const x = Math.floor(p.x + (Math.random() - 0.5) * 128), z = Math.floor(p.z + (Math.random() - 0.5) * 128);
    if (!this.world.isLoaded(x, z) || Weather.precipitation(this.world.biomeAt(x, z)) !== 'rain') return;
    const rod = findStormRod(this.world, x, z); // a Storm Rod within 128 blocks draws the bolt
    if (rod) { this.strikeLightning(rod[0], rod[1] + 1, rod[2]); return; }
    this.strikeLightning(x, this.world.heightAt(x, z) + 1, z);
  }

  /** A lightning bolt at block x,y,z: flash, thunder, fire, and 5 damage + burning within 3 blocks. */
  strikeLightning(x, y, z) {
    const w = this.world, p = this.player;
    this.lightning.strike(x + 0.5, y, z + 0.5);
    const dist = Math.hypot(p.x - x, p.z - z);
    this.audio.play('thunder', null, Math.max(0.25, 1 - dist / 160));
    if (dist < 40) this.audio.play('lightning', [x + 0.5, y, z + 0.5]);
    const light = (fx, fy, fz) => { if (canLight(w, fx, fy, fz)) { w.setBlockUrgent(fx, fy, fz, B.FIRE); w.scheduleTick(fx, fy, fz, FIRE_DELAY); } };
    lightningCleanCopper(w, x, y - 1, z); // struck copper (or the copper under a Storm Rod) is scraped clean
    light(x, y, z);
    for (let k = 0; k < 4; k++) light(x + Math.floor(Math.random() * 3) - 1, y + Math.floor(Math.random() * 3) - 1, z + Math.floor(Math.random() * 3) - 1);
    const near = (e) => Math.hypot(e.x - (x + 0.5), e.y - y, e.z - (z + 0.5)) < 3;
    for (const e of this.entities.list) if (e.kind === 'mob' && e.deathTime === 0 && near(e)) { e.fireTicks = Math.max(e.fireTicks, 160); e.hurt(5, 'lightning', null, 0); }
    if (!p.dead && near(p) && !p.creative) { p.fireTicks = Math.max(p.fireTicks, 160); p.hurt(5, 'lightning'); }
  }

  explode(x, y, z, power, source) {
    if (this.net && this.net.isClient) { this.net.requestExplosion(x, y, z, power); return; } // the host's world blows up
    explode(this, x, y, z, power, source);
  }

  /** Open this world to friends (peer-to-peer); resolves to the host session with its room code. */
  async openToFriends(name) {
    if (this.net) return this.net;
    const { hostSession } = await import('./net/session.js');
    this.net = await hostSession(this, name);
    return this.net;
  }

  /** Advance the simulation without rendering (a multiplayer tab in the background gets no frames). */
  backgroundTick(now) {
    if (!this.mouseLatch) this.mouseLatch = { left: false, right: false, middle: false };
    const dt = Math.min(now - this.lastTime, 1000);
    this.lastTime = now;
    this.acc += dt;
    while (this.acc >= TICK_MS) { this.tick(); this.acc -= TICK_MS; }
  }

  // ---- Cinnabar circuitry (world/circuits.js) ------------------------------
  initCircuits() {
    const w = this.world, ci = w.circuits;
    ci.entitiesOn = (x, y, z) => this.feetPositions().some(([ex, ey, ez]) => Math.floor(ex) === x && Math.floor(ey + 0.05) === y && Math.floor(ez) === z);
    // sounds of changes made by the circuits (here, or on the host when we are a guest)
    const OPENABLE = new Set([B.DOOR, B.OAK_TRAPDOOR, B.OAK_FENCE_GATE]);
    w.on('blockChanged', (x, y, z, old, id) => {
      if (!(CIRCUIT_BLOCK[old] || CIRCUIT_BLOCK[id] || OPENABLE.has(id))) return;
      if (!ci.acting && !(this.net && this.net.applyingRemote)) return;
      const s = changeSound(w, x, y, z, old, id);
      if (s) this.audio.play(s, [x + 0.5, y + 0.5, z + 0.5]);
    });
    w.on('circuitFx', (x, y, z, kind) => {
      if (kind === 'burnout') { this.particles.smoke(x + 0.5, y + 0.7, z + 0.5, 6, 0.3); this.audio.play('burnout', [x + 0.5, y + 0.5, z + 0.5]); }
    });
    // an extending piston shoves whoever stands where the blocks go
    w.on('pistonMoved', (x, y, z, f, n, out) => {
      if (!out) return;
      const [dx, dy, dz] = FACING6[f];
      const bodies = [this.player.body, ...this.entities.list.filter((e) => e.body && !e.dead).map((e) => e.body)];
      for (const b of bodies) {
        const [x0, y0, z0, x1, y1, z1] = b.aabb ? b.aabb() : [b.x - b.width / 2, b.y, b.z - b.width / 2, b.x + b.width / 2, b.y + b.height, b.z + b.width / 2];
        for (let i = 1; i <= n + 1; i++) {
          const cx = x + dx * i, cy = y + dy * i, cz = z + dz * i;
          if (x1 > cx && x0 < cx + 1 && y1 > cy && y0 < cy + 1 && z1 > cz && z0 < cz + 1) {
            b.setPos(b.x + dx, b.y + dy * 1.01, b.z + dz);
            if (dy > 0) b.vy = Math.max(b.vy || 0, 0);
            break;
          }
        }
      }
    });
  }

  /** Feet of everyone who can press a plate: the player, mobs, items, other players. */
  feetPositions() {
    const out = [];
    const p = this.player;
    if (!p.dead && !p.spectator) out.push([p.x, p.y, p.z]);
    for (const e of this.entities.list) if (!e.dead && e.body) out.push([e.x, e.y, e.z]);
    if (this.net && this.net.isHost) for (const rp of this.net.remotes.values()) if (rp.state) out.push([rp.state.x, rp.state.y, rp.state.z]);
    return out;
  }

  tickCircuits() {
    const w = this.world, ci = w.circuits;
    ci.enabled = !(this.net && this.net.isClient); // guests apply the host's results
    if (!ci.enabled) { if (ci.queue.size) ci.queue.clear(); return; }
    for (const [ex, ey, ez] of this.feetPositions()) {
      const bx = Math.floor(ex), by = Math.floor(ey + 0.05), bz = Math.floor(ez);
      if (w.getBlock(bx, by, bz) === B.WOODEN_PRESSURE_PLATE) ci.press(bx, by, bz);
    }
  }

  // -------------------------------------------------------------------------
  tick() {
    this.ticks++;
    if (this.daylightCycle) this.time++;
    // keep the sun state current for game logic (spawning, burning) even when no frame is rendered
    this.sky.state = skyState(this.time);
    const inp = this.input;
    const blocking = this.ui.blocking;
    const mv = blocking ? { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false } : inp.movement();
    this.tickCircuits();
    this.world.tick();
    this.weather.tick();
    const overworld = this.world.dimension === 'overworld';
    if (overworld) this.tickRain();
    this.lightning.tick();
    this.displayTick();
    if (overworld && (!this.net || this.net.isHost)) this.tickThunder(); // clients see the host's lightning
    if (!this.net || this.net.localRandomTicks) runRandomTicks(this.world, Math.floor(this.player.x / 16), Math.floor(this.player.z / 16), Math.min(this.chunks.renderDistance, 6));
    // Hold the player in place until the terrain under them has loaded (spawn, respawn, teleports)
    const p = this.player;
    if (p.sleeping) this.tickSleep();
    if (p.riding && (mv.sneak || p.riding.dead || p.dead)) this.dismount();
    this.boatInput = p.riding ? mv : null;
    const still = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    this.dims.tick(); // portals, arrivals, the Hollow's boss
    p.difficulty = this.difficulty;
    if (!this.dims.pending && this.chunks.isAreaReady(p.x, p.z, 0)) this.player.tick(this.world, p.sleeping || p.riding ? still : mv);
    else p.prev = { x: p.x, y: p.y, z: p.z };
    if (!blocking) {
      this.interaction.tick({
        left: inp.mouse.left, right: inp.mouse.right,
        leftPressed: this.mouseLatch.left, rightPressed: this.mouseLatch.right, middlePressed: this.mouseLatch.middle,
      });
    } else this.interaction.breaking = null;
    this.mouseLatch = { left: false, right: false, middle: false };
    this.entities.tick();
    if (p.riding) this.seatPlayer();
    this.spawner.tick();
    if (!this.net || this.net.isHost) this.spawnerBlocks.tick();
    this.tickMaps();
    if (!this.net || this.net.isHost) { this.tickFurnaces(); this.tickBrewing(); this.tickHoppers(); } // guests see the host's furnaces and alembics
    this.effectParticles();
    this.particles.tick();
    if (this.net) this.net.tick();
    if (this.ticks % 1200 === 0) this.save(); // autosave every minute
    if (this.ticks % 100 === 0) this.milestones.tick();
    if (this.ticks % 20 === 0) {
      // music mood: underground, night (all suns down) or day
      const px = Math.floor(p.x), py = Math.floor(p.y + 1), pz = Math.floor(p.z);
      const sky = this.world.skyLight(px, py, pz), under = sky === 0 && py < this.world.heightAt(px, pz) - 4;
      const mood = under ? 'cave' : this.sky.state.aboveCount === 0 ? 'night' : 'day';
      this.music.update(1, mood, under && this.world.blockLight(px, py, pz) < 4);
    }
    // footsteps
    const b = this.player.body;
    if (b.onGround && (Math.abs(b.vx) + Math.abs(b.vz)) > 0.05 && this.ticks % (this.player.sprinting ? 6 : 8) === 0) {
      const id = this.world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.2), Math.floor(b.z));
      if (id) this.audio.play('step_' + BLOCKS[id].sound);
    }
    if (this.player.landedFrom > 1.5) { this.audio.play('land'); }
    // landing on farmland can trample it back to dirt (chance = fall distance - 0.5)
    if (this.player.landedFrom > 0.5) {
      const p = this.player, fx = Math.floor(p.x), fy = Math.floor(p.y - 0.2), fz = Math.floor(p.z);
      if (this.world.getBlock(fx, fy, fz) === B.FARMLAND && Math.random() < this.player.landedFrom - 0.5) this.world.setBlockUrgent(fx, fy, fz, B.DIRT);
    }
    this.player.landedFrom = 0;
  }

  handleFrameInput() {
    const inp = this.input, p = this.player;
    // latch clicks for the next tick
    if (!this.mouseLatch) this.mouseLatch = { left: false, right: false, middle: false };
    if (inp.mouse.leftPressed) this.mouseLatch.left = true;
    if (inp.mouse.rightPressed) this.mouseLatch.right = true;
    if (inp.mouse.middlePressed) this.mouseLatch.middle = true;

    if (this.ui.open === 'death' || this.ui.open === 'chat') { inp.consumeMouse(); inp.endFrame(); return; }
    if (inp.flyToggle) { inp.flyToggle = false; if (p.creative && !this.ui.blocking) { p.flying = !p.flying; p.flyGrace = 10; } }
    if (inp.wasPressed('inventory')) {
      if (['inventory', 'workbench', 'furnace', 'chest', 'creative', 'trade', 'brewing'].includes(this.ui.open)) this.ui.close();
      else if (!this.ui.blocking) { this.input.unlock(); if (p.creative) this.ui.openCreative(); else this.ui.openInventory(); }
    }
    if (inp.wasPressed('pause') && this.ui.blocking) {
      if (this.ui.open === 'pause') { this.ui.open = null; this.ui.clear(); this.onUIClosed(); }
      else this.ui.close();
    }
    if (inp.wasPressed('debug')) { this.hud.showDebug = !this.hud.showDebug; this.hud.debugEl.classList.toggle('hidden', !this.hud.showDebug); }
    if (inp.wasPressed('hud')) this.hud.setVisible(!this.hud.visible);
    if (inp.wasPressed('shaders')) { const on = this.settings.shaders === false; this.setSetting('shaders', on); this.hud.toast(`Shaders ${on ? 'on' : 'off'} (F7)`); }
    if (inp.wasPressed('perspective')) { this.perspective = (this.perspective + 1) % 3; document.getElementById('crosshair').style.visibility = this.perspective === 2 ? 'hidden' : ''; }
    if (!this.ui.blocking) {
      const m = inp.consumeMouse();
      const sens = inp.sensitivity * (p.zooming && this.perspective === 0 ? 0.15 : 1); // steadier aim through a Farglass
      p.yaw -= m.dx * sens;
      p.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, p.pitch - m.dy * sens));
      if (m.wheel) p.inventory.selected = (p.inventory.selected + m.wheel + 9) % 9;
      for (let i = 1; i <= 9; i++) if (inp.codePressed('Digit' + i)) p.inventory.selected = i - 1;
      if (inp.wasPressed('drop') && p.inventory.selectedStack && !p.dead) {
        const all = inp.down.has('ControlLeft');
        const st = p.inventory.removeFromSlot(p.inventory.selected, all ? 64 : 1);
        const [dx, dy, dz] = p.lookDir();
        const e = this.entities.spawnItem(p.x, p.y + p.eyeHeight - 0.3, p.z, st, [dx * 0.3, dy * 0.3 + 0.1, dz * 0.3]);
        if (e) e.pickupDelay = 40;
      }
    } else inp.consumeMouse();
    inp.endFrame();
  }

  frame(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.frame(t));
    let dt = now - this.lastTime;
    this.lastTime = now;
    this.governQuality(dt);
    if (dt > 250) dt = 250;
    this.handleFrameInput();
    const pauseSim = this.ui.open === 'pause' && !this.net; // a shared world keeps running
    if (!pauseSim) {
      this.acc += dt;
      // after a hitch, catch up a few ticks at most instead of stalling again on a burst of them
      if (this.acc > TICK_MS * 4) this.acc = TICK_MS * 4;
      while (this.acc >= TICK_MS) { this.tick(); this.acc -= TICK_MS; }
    }
    const alpha = pauseSim ? 1 : this.acc / TICK_MS;
    this.render(alpha, now / 1000);
    this.frameCount++;
    if (now - this.fpsTime > 1000) { this.fps = this.frameCount; this.frameCount = 0; this.fpsTime = now; }
  }

  /**
   * Smoothness: when frames keep coming in slow (below about 22 fps for two seconds), trade
   * quality for frame rate, first pixel density, then sun shadows. Quality comes back
   * once frames have been fast for fifteen seconds. Only the renderer changes; settings stay.
   */
  governQuality(dt) {
    if (dt > 2000) return; // loading, or a background tab: not a sign of a slow machine
    if (dt > 45) { this.slowMs = (this.slowMs || 0) + dt; this.fastMs = 0; }
    else if (dt < 22) { this.fastMs = (this.fastMs || 0) + dt; this.slowMs = 0; }
    const level = this.quality || 0;
    if (this.slowMs > 2000 && level < 3) { this.setQuality(level + 1); this.slowMs = 0; }
    else if (this.fastMs > 15000 && level > 0) { this.setQuality(level - 1); this.fastMs = 0; }
  }

  setQuality(level) {
    this.quality = level;
    this.renderer.setPixelRatio(level >= 1 ? 1 : Math.min(window.devicePixelRatio, this.settings.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.sky.setShadowsEnabled(this.settings.shadows && level < 2);
    this.postfx.enabled = this.settings.shaders !== false && level < 3;
    const names = ['', 'pixel density lowered', 'sun shadows off', 'shaders off'];
    if (level > 0 && level <= 3) this.hud.toast(`Smoothing the picture: ${names[level]}`);
    if (level === 0) this.hud.toast('Picture quality restored');
  }

  render(alpha, sec) {
    const p = this.player, b = p.body;
    const x = p.prev.x + (b.x - p.prev.x) * alpha;
    const y = p.prev.y + (b.y - p.prev.y) * alpha;
    const z = p.prev.z + (b.z - p.prev.z) * alpha;
    const eye = p.sleeping ? 0.3 : p.eyeHeight;
    // view bobbing while walking
    const speed = Math.hypot(b.vx, b.vz);
    const bob = b.onGround ? Math.sin(sec * 9) * Math.min(0.06, speed * 0.25) : 0;
    this.camera.position.set(x, y + eye + Math.abs(bob) * 0.6, z);
    this.camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    if (this.perspective && !p.dead) {
      // third person: 4 blocks behind (or in front of) the eyes, pulled in where blocks are in the way
      const [ldx, ldy, ldz] = p.lookDir(), s = this.perspective === 1 ? -1 : 1;
      const c = this.camera.position;
      const hit = this.world.raycast(c.x, c.y, c.z, ldx * s, ldy * s, ldz * s, 4);
      const dist = hit ? Math.max(0.3, hit.dist - 0.3) : 4;
      this.cameraDist = dist;
      c.set(c.x + ldx * s * dist, c.y + ldy * s * dist, c.z + ldz * s * dist);
      if (this.perspective === 2) this.camera.rotation.set(-p.pitch, p.yaw + Math.PI, 0, 'YXZ');
    }
    if (p.hurtTime > 0) this.camera.rotation.z = Math.sin(p.hurtTime * 0.6) * 0.04;
    // looking through a Farglass narrows the view to a tenth (at once, like the reference); the arm and item are hidden
    const zoom = p.zooming && this.perspective === 0 && !p.dead;
    const targetFov = this.settings.fov * (zoom ? 0.1 : p.sprinting ? 1.1 : 1);
    this.camera.fov = zoom || this.camera.fov < this.settings.fov * 0.5 ? targetFov : this.camera.fov + (targetFov - this.camera.fov) * 0.2;
    this.camera.updateProjectionMatrix();

    this.chunks.update(x, z, 6);
    if (this.chunks.edited) { this.chunks.edited = false; this.sky.refreshShadows(); }
    const smoothTime = this.time + (this.daylightCycle ? alpha : 0);
    this.sky.rain = this.weather.level;
    this.sky.thunder = this.weather.storm;
    this.sky.flash = this.lightning.flash;
    const st = this.dims.updateSky(smoothTime, sec, this.camera, new THREE.Vector3(x, y, z));
    const wlevel = this.world.dimension === 'overworld' ? this.weather.level : 0; // no weather in the Cinderdeep or the Hollow
    this.weatherFx.update(this.world, this.camera, p.yaw, wlevel, sec, Math.min(1, st.combined) * 0.85 + 0.15);
    this.audio.setRain(wlevel * (Weather.precipitation(this.world.biomeAt(Math.floor(x), Math.floor(z))) === 'rain' ? 1 : 0),
      this.world.heightAt(Math.floor(x), Math.floor(z)) > y + eye);
    terrainUniforms.uTime.value = sec;
    // Night Vision lifts the darkest light to near daylight (flickering in its last 10 seconds)
    const nv = p.effects.night_vision;
    this.nightVision = !nv ? 0 : nv.ticks > 200 ? 1 : 0.7 + Math.sin((nv.ticks - alpha) * Math.PI * 0.2) * 0.3;
    terrainUniforms.uMinLight.value = Math.max(this.dims.baseLight(), this.nightVision * 0.75);
    // a torch (or any light-giving block) in the hand lights up the area around the player
    const held = p.dead ? null : p.inventory.selectedStack;
    this.handLight = held ? heldLightLevel(held.id) : 0;
    terrainUniforms.uHand.value = this.handLight;
    const ss = this.shaftSun(st, 0);
    if (ss) { terrainUniforms.uSunDir.value.set(ss.dir[0], ss.dir[1], ss.dir[2]); terrainUniforms.uSunCol.value.copy(ss.color).multiplyScalar(Math.min(1, ss.strength * 1.6)); }
    else terrainUniforms.uSunCol.value.setRGB(0, 0, 0);
    terrainUniforms.uWet.value = this.world.dimension === 'overworld' && Weather.precipitation(this.world.biomeAt(Math.floor(x), Math.floor(z))) === 'rain' ? this.weather.level : 0;
    this.weatherFx.uniforms.uAlpha.value = this.postfx.enabled ? 0.55 : 1;
    terrainUniforms.uGlow.value = this.postfx.enabled ? 1 : 0;
    terrainUniforms.uSkyTop.value.copy(this.sky.zenith); terrainUniforms.uSkyLow.value.copy(this.sky.horizon);
    // torches and lanterns carried by the other players light the terrain around them too
    this.remoteLights = this.net ? heldLights(this.net.remotes) : [];
    const rl = terrainUniforms.uRemoteLights.value;
    for (let i = 0; i < rl.length; i++) {
      const s = this.remoteLights[i];
      rl[i].set(s ? s.x : 0, s ? s.y : 0, s ? s.z : 0, s ? s.level : 0);
    }
    terrainUniforms.uWind.value = 1 + wlevel * 1.2 + (this.weather.storm || 0) * 1.2; // plants sway harder in rain and storms
    const R = this.chunks.renderDistance * 16;
    this.clouds.update(this.camera, smoothTime, this.sky, Math.max(192, R * 1.8));
    if (this.signRenderer) this.signRenderer.update();
    if (this.frameRenderer) this.frameRenderer.update();
    const fogCol = this.sky.horizon;
    this.scene.fog.color.copy(fogCol);
    // deep in caves the fog and the sky fade to black, so holes into unloaded land look like dark depths
    const ex = Math.floor(x), ez = Math.floor(z), ey = Math.floor(y + eye);
    const under = this.world.dimension === 'overworld' && this.world.skyLight(ex, ey, ez) < 4 ? Math.max(0, Math.min(1, (this.world.heightAt(ex, ez) - ey - 3) / 10)) : 0;
    this.caveDark = (this.caveDark || 0) + (under - (this.caveDark || 0)) * 0.05;
    const cd = this.caveDark * (1 - this.nightVision * 0.5);
    if (cd > 0.001) this.scene.fog.color.lerp(CAVE_FOG, cd);
    this.sky.uniforms.uCave.value = cd;
    if (this.world.dimension === 'overworld') this.clouds.visible = cd < 0.6;
    if (this.world.dimension === 'overworld' && this.sky.rings) for (const k of ['ring', 'particles']) if (this.sky.rings[k]) this.sky.rings[k].visible = cd < 0.6;
    if (b.eyeInWater) { this.scene.fog.color.setRGB(0.03, 0.1, 0.3); this.scene.fog.near = 1; this.scene.fog.far = 18; }
    else if (b.eyeInLava) { this.scene.fog.color.setRGB(0.6, 0.15, 0.02); this.scene.fog.near = 0; this.scene.fog.far = 2; }
    else { this.scene.fog.near = R * (0.65 - cd * 0.45); this.scene.fog.far = R * (1 - cd * 0.25); this.dims.adjustFog(this.scene.fog, R); }
    this.sky.uniforms.uUnderwater.value = b.eyeInWater ? 1 : 0;
    this.audio.setListener(x, y + eye, z, p.yaw);

    this.chunks.updateVisibility(this.camera.position);
    this.entities.render(alpha, sec);
    this.enchantBooks.update(this, sec);
    this.playerModel.update(this, this.perspective !== 0 && this.cameraDist > 0.8, alpha, sec); // no model when the camera is squeezed into the head
    if (this.net) this.net.render(sec);
    this.overlay.update(this.interaction, p.dead);
    const fx = this.postfx.enabled;
    if (fx) this.postfx.begin(); else this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.perspective === 0 && !zoom) this.held.render(this.renderer, alpha, sec);
    if (fx) {
      let warm = 0;
      if (this.world.dimension === 'overworld') for (const su of st.suns) if (su.elevation > -0.05) warm = Math.max(warm, su.factor * Math.exp(-Math.max(0, su.elevation) * 6));
      const night = this.world.dimension === 'overworld' ? (1 - Math.min(1, st.combined)) * (1 - cd) : 0;
      const hp = p.health / 20;
      this.postfx.grade(warm * (1 - cd), night * (1 - this.nightVision), Math.min(1, (p.hurtTime > 0 ? p.hurtTime / 10 : 0) * 0.6 + (hp < 0.3 && !p.creative && !p.dead ? (0.3 - hp) * 1.2 * (0.6 + 0.4 * Math.sin(sec * 5)) : 0)));
    }
    if (fx) this.postfx.end(this.camera, sec, this.shaftSun(st, cd), b.eyeInWater);
    this.hud.setScope(zoom);
    this.hud.update();
    this.ui.tickOpen();
    this.lastSkyState = st;
  }

  /** The sun the light shafts stream from: the brightest one up, fading in rain and underground. */
  shaftSun(st, cave) {
    if (this.world.dimension !== 'overworld' || !st || !st.suns) return null;
    let best = null;
    for (const s of st.suns) if (s.elevation > 0 && (!best || s.factor > best.factor)) best = s;
    if (!best) return null;
    const c = (this.shaftColor = this.shaftColor || new THREE.Color());
    c.setRGB(best.color[0], best.color[1], best.color[2]);
    const low = Math.exp(-best.elevation * 3); // long golden shafts when the sun is low
    return { dir: best.dir, color: c, strength: best.factor * (0.55 + 0.45 * low) * (1 - this.weather.level * 0.85) * (1 - cave) };
  }

  debugText() {
    const p = this.player, w = this.world;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const st = this.sky.state;
    const sky = w.skyLight(bx, by, bz), bl = w.blockLight(bx, by, bz);
    const ri = this.renderer.info.render;
    const t = this.interaction.target;
    return [
      `Saturncraft  ${this.fps} fps  draw calls ${ri.calls}  tris ${(ri.triangles / 1000).toFixed(0)}k`,
      `XYZ ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}   chunk ${bx >> 4}, ${bz >> 4}`,
      `Facing yaw ${(((p.yaw * 180 / Math.PI) % 360 + 360) % 360).toFixed(0)}°  pitch ${(p.pitch * 180 / Math.PI).toFixed(0)}°`,
      `${w.dimension === 'overworld' ? `Biome ${biomeName(w.biomeAt(bx, bz))}` : `Dimension ${DIMENSIONS[w.dimension].name}`}   chunks ${w.chunks.size}`,
      `Light: sky ${sky} (effective ${effectiveSkyLight(sky, st.skyDarken)})  block ${bl}`,
      `Time ${this.time}  phase ${st.phase}  suns up ${st.aboveCount}  combined ${st.combined.toFixed(2)}  darken ${st.skyDarken}`,
      ...st.suns.map((s) => `  ${s.sun.name.padEnd(12)} elev ${(Math.asin(s.elevation) * 180 / Math.PI).toFixed(1).padStart(6)}°  light ${s.factor.toFixed(2)}`),
      `Mobs ${this.spawner.counts()}`,
      `Food ${p.hunger.food} sat ${p.hunger.saturation.toFixed(1)} exh ${p.hunger.exhaustion.toFixed(2)}  air ${p.air}`,
      t ? `Target ${BLOCKS[t.id].name} @ ${t.x}, ${t.y}, ${t.z}` : 'Target -',
      `Seed ${this.seed}`,
    ].join('\n');
  }
}

export { MIN_Y };

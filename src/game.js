// Game orchestrator: fixed 20 TPS simulation with interpolated rendering.
import * as THREE from 'three';
import { World } from './world/world.js';
import { B, BLOCKS } from './world/blocks.js';
import { ITEMS, I, toolOf } from './world/items.js';
import { blockDrops } from './world/mining.js';
import { runRandomTicks } from './world/randomTicks.js';
import { biomeName } from './world/biomes.js';
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

export const DEFAULT_SETTINGS = { renderDistance: 8, fov: 75, sensitivity: 100, volume: 0.5, music: 0.5, shadows: true, shadowMapSize: 1024, pixelRatioCap: 1.25, daylightCycle: true, hostileMobs: true };

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
    this.world.on('fireCrackle', (x, y, z) => this.audio.play('fire', [x + 0.5, y + 0.5, z + 0.5]));
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
    if (k === 'shadows') this.sky.setShadowsEnabled(v);
    if (k === 'hostileMobs' && !v) this.removeHostileMobs();
    if (k === 'daylightCycle' && !v) this.freezeAtDay();
    if (this.hooks.saveSettings) this.hooks.saveSettings(this.settings);
  }

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
        if (this.world.getBlock(x, y, z) === B.CHEST) this.world.setBlockUrgent(x, y, z, B.CHEST, meta & 3, false);
      }
    }
    return c;
  }

  onBlockBroken(x, y, z, id, meta = 0) {
    if (id === B.SPAWNER) this.milestones.event('spawner');
    if (id === B.ITEM_FRAME) {
      // a broken frame drops what it held
      const st = this.frames.get(`${x},${y},${z}`);
      if (st && this.net && this.net.isClient) this.setFrameItem(x, y, z, null, true); // the host drops it when it sees the edit
      else if (st) { this.setFrameItem(x, y, z, null); if (!this.player.creative) this.entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, st); }
    }
    if (this.net && this.net.isClient) {
      // the host spills the contents of its own chest / furnace
      const k = `${x},${y},${z}`;
      if (this.ui.chest && this.ui.chest === this.chests.get(k)) this.ui.close();
      if (this.ui.furnace && this.ui.furnace === this.furnaces.get(k)) this.ui.close();
      this.chests.delete(k); this.furnaces.delete(k);
      return;
    }
    if (id === B.CHEST) {
      const k = `${x},${y},${z}`;
      const c = (meta & 8) ? this.getChest(x, y, z, meta) : this.chests.get(k);
      if (c) {
        for (const st of c.slots) if (st) this.entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, st);
        this.chests.delete(k);
        if (this.ui.chest === c) this.ui.close();
      }
    }
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
      }
    }
  }

  /** Thunderstorms: every ~20 s a bolt hits a random rainy spot within 64 blocks. */
  tickThunder() {
    if (this.weather.storm < 0.9 || Math.random() >= 1 / 400) return;
    const p = this.player;
    const x = Math.floor(p.x + (Math.random() - 0.5) * 128), z = Math.floor(p.z + (Math.random() - 0.5) * 128);
    if (!this.world.isLoaded(x, z) || Weather.precipitation(this.world.biomeAt(x, z)) !== 'rain') return;
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

  // -------------------------------------------------------------------------
  tick() {
    this.ticks++;
    if (this.daylightCycle) this.time++;
    // keep the sun state current for game logic (spawning, burning) even when no frame is rendered
    this.sky.state = skyState(this.time);
    const inp = this.input;
    const blocking = this.ui.blocking;
    const mv = blocking ? { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false } : inp.movement();
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
    if (!this.net || this.net.isHost) this.tickFurnaces(); // guests see the host's furnaces
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
      if (['inventory', 'workbench', 'furnace', 'chest', 'creative', 'trade'].includes(this.ui.open)) this.ui.close();
      else if (!this.ui.blocking) { this.input.unlock(); if (p.creative) this.ui.openCreative(); else this.ui.openInventory(); }
    }
    if (inp.wasPressed('pause') && this.ui.blocking) {
      if (this.ui.open === 'pause') { this.ui.open = null; this.ui.clear(); this.onUIClosed(); }
      else this.ui.close();
    }
    if (inp.wasPressed('debug')) { this.hud.showDebug = !this.hud.showDebug; this.hud.debugEl.classList.toggle('hidden', !this.hud.showDebug); }
    if (inp.wasPressed('hud')) this.hud.setVisible(!this.hud.visible);
    if (inp.wasPressed('perspective')) { this.perspective = (this.perspective + 1) % 3; document.getElementById('crosshair').style.visibility = this.perspective === 2 ? 'hidden' : ''; }
    if (!this.ui.blocking) {
      const m = inp.consumeMouse();
      p.yaw -= m.dx * inp.sensitivity;
      p.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, p.pitch - m.dy * inp.sensitivity));
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
    if (dt > 250) dt = 250;
    this.handleFrameInput();
    const pauseSim = this.ui.open === 'pause' && !this.net; // a shared world keeps running
    if (!pauseSim) {
      this.acc += dt;
      while (this.acc >= TICK_MS) { this.tick(); this.acc -= TICK_MS; }
    }
    const alpha = pauseSim ? 1 : this.acc / TICK_MS;
    this.render(alpha, now / 1000);
    this.frameCount++;
    if (now - this.fpsTime > 1000) { this.fps = this.frameCount; this.frameCount = 0; this.fpsTime = now; }
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
    const targetFov = this.settings.fov * (p.sprinting ? 1.1 : 1);
    this.camera.fov += (targetFov - this.camera.fov) * 0.2;
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
    const R = this.chunks.renderDistance * 16;
    this.clouds.update(this.camera, smoothTime, this.sky, Math.max(192, R * 1.8));
    if (this.signRenderer) this.signRenderer.update();
    if (this.frameRenderer) this.frameRenderer.update();
    const fogCol = this.sky.horizon;
    this.scene.fog.color.copy(fogCol);
    if (b.eyeInWater) { this.scene.fog.color.setRGB(0.03, 0.1, 0.3); this.scene.fog.near = 1; this.scene.fog.far = 18; }
    else if (b.eyeInLava) { this.scene.fog.color.setRGB(0.6, 0.15, 0.02); this.scene.fog.near = 0; this.scene.fog.far = 2; }
    else { this.scene.fog.near = R * 0.65; this.scene.fog.far = R; this.dims.adjustFog(this.scene.fog, R); }
    this.sky.uniforms.uUnderwater.value = b.eyeInWater ? 1 : 0;
    this.audio.setListener(x, y + eye, z, p.yaw);

    this.chunks.updateVisibility(this.camera.position);
    this.entities.render(alpha, sec);
    this.enchantBooks.update(this, sec);
    this.playerModel.update(this, this.perspective !== 0 && this.cameraDist > 0.8, alpha, sec); // no model when the camera is squeezed into the head
    if (this.net) this.net.render(sec);
    this.overlay.update(this.interaction, p.dead);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.perspective === 0) this.held.render(this.renderer, alpha, sec);
    this.hud.update();
    this.ui.tickOpen();
    this.lastSkyState = st;
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

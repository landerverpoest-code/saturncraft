// Game orchestrator: fixed 20 TPS simulation with interpolated rendering.
import * as THREE from 'three';
import { World } from './world/world.js';
import { B, BLOCKS } from './world/blocks.js';
import { ITEMS, I } from './world/items.js';
import { biomeName } from './world/biomes.js';
import { MIN_Y, TICK_MS } from './world/constants.js';
import { ChunkRenderer } from './render/chunkRenderer.js';
import { terrainUniforms, createTextureArray } from './render/terrainMaterial.js';
import { Particles } from './render/particles.js';
import { HeldItem, BlockOverlay } from './render/overlays.js';
import { Sky } from './sky/sky.js';
import { effectiveSkyLight } from './sky/suns.js';
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

export const DEFAULT_SETTINGS = { renderDistance: 8, fov: 75, sensitivity: 100, volume: 0.5, shadows: true, shadowMapSize: 1024, pixelRatioCap: 1.25 };

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
    this.fps = 0; this.frameCount = 0; this.fpsTime = 0;
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

    this.world = new World(this.seed);
    this.chunks = new ChunkRenderer(this.world, this.scene, this.seed, { renderDistance: s.renderDistance });
    this.sky = new Sky(this.scene, this.renderer, { shadowMapSize: s.shadowMapSize });
    this.sky.setShadowsEnabled(s.shadows);
    this.particles = new Particles(this.scene);
    this.player = new Player();
    this.player.isPlayer = true;
    this.entities = new EntityManager(this);
    this.spawner = new MobSpawner(this);
    this.interaction = new Interaction(this);
    this.input = new Input(this.canvas);
    this.input.sensitivity = 0.0022 * s.sensitivity / 100;
    this.audio = new Audio();
    this.audio.setVolume(s.volume);
    this.hud = new HUD(this);
    this.ui = new UI(this);
    this.held = new HeldItem(this);
    this.overlay = new BlockOverlay(this.scene);

    this.world.on('fallingBlock', (x, y, z, id) => this.entities.spawnFallingBlock(x, y, z, id));
    this.world.on('dropItems', (x, y, z, id) => {
      const d = BLOCKS[id];
      const drop = d.drops === 'self' ? id : typeof d.drops === 'number' ? d.drops : null;
      if (drop !== null && id !== B.TALL_GRASS) this.entities.spawnItem(x + 0.5, y + 0.3, z + 0.5, { id: drop, count: 1 });
    });
    this.chunks.onChunkLoaded = (cx, cz) => this.spawner.onChunkLoaded(cx, cz);
    this.chunks.onChunkUnloaded = (cx, cz) => this.spawner.onChunkUnloaded(cx, cz);
    this.player.listeners.hurt.push(() => this.audio.play('hurt'));
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
    if (!this.saveData) {
      // Put the player on the surface
      const px = Math.floor(this.player.x), pz = Math.floor(this.player.z);
      let y = this.world.heightAt(px, pz) + 1;
      while (y < 300 && (this.world.getBlock(px, y, pz) || this.world.getBlock(px, y + 1, pz))) y++;
      this.player.spawn = { x: px + 0.5, y, z: pz + 0.5 };
      this.player.setPosition(px + 0.5, y, pz + 0.5);
    }

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
    if (k === 'shadows') this.sky.setShadowsEnabled(v);
    if (this.hooks.saveSettings) this.hooks.saveSettings(this.settings);
  }

  onUIClosed() { this.input.lock(); }

  async save() {
    try { await saveGame(this); return true; } catch (e) { console.warn('save failed', e); return false; }
  }

  async quitToTitle() {
    this.running = false;
    await this.save();
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
    p.inventory.clear();
    this.input.unlock();
    this.ui.showDeath(cause);
  }

  respawn() {
    this.player.respawn();
    this.input.lock();
  }

  getFurnace(x, y, z) {
    const k = `${x},${y},${z}`;
    let f = this.furnaces.get(k);
    if (!f) { f = { x, y, z, input: null, fuel: null, output: null, burnTime: 0, burnTotal: 0, cookTime: 0 }; this.furnaces.set(k, f); }
    return f;
  }

  onBlockBroken(x, y, z, id) {
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

  explode(x, y, z, power, source) { explode(this, x, y, z, power, source); }

  // -------------------------------------------------------------------------
  tick() {
    this.ticks++;
    this.time++;
    const inp = this.input;
    const blocking = this.ui.blocking;
    const mv = blocking ? { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false } : inp.movement();
    this.world.tick();
    // Hold the player in place until the terrain under them has loaded (spawn, respawn, teleports)
    const p = this.player;
    if (this.chunks.isAreaReady(p.x, p.z, 0)) this.player.tick(this.world, mv);
    else p.prev = { x: p.x, y: p.y, z: p.z };
    if (!blocking) {
      this.interaction.tick({
        left: inp.mouse.left, right: inp.mouse.right,
        leftPressed: this.mouseLatch.left, rightPressed: this.mouseLatch.right, middlePressed: this.mouseLatch.middle,
      });
    } else this.interaction.breaking = null;
    this.mouseLatch = { left: false, right: false, middle: false };
    this.entities.tick();
    this.spawner.tick();
    this.tickFurnaces();
    this.particles.tick();
    if (this.ticks % 1200 === 0) this.save(); // autosave every minute
    // footsteps
    const b = this.player.body;
    if (b.onGround && (Math.abs(b.vx) + Math.abs(b.vz)) > 0.05 && this.ticks % (this.player.sprinting ? 6 : 8) === 0) {
      const id = this.world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.2), Math.floor(b.z));
      if (id) this.audio.play('step_' + BLOCKS[id].sound);
    }
    if (this.player.landedFrom > 1.5) { this.audio.play('land'); }
    this.player.landedFrom = 0;
  }

  handleFrameInput() {
    const inp = this.input, p = this.player;
    // latch clicks for the next tick
    if (!this.mouseLatch) this.mouseLatch = { left: false, right: false, middle: false };
    if (inp.mouse.leftPressed) this.mouseLatch.left = true;
    if (inp.mouse.rightPressed) this.mouseLatch.right = true;
    if (inp.mouse.middlePressed) this.mouseLatch.middle = true;

    if (this.ui.open === 'death') { inp.endFrame(); return; }
    if (inp.wasPressed('inventory')) {
      if (this.ui.open === 'inventory' || this.ui.open === 'workbench' || this.ui.open === 'furnace') this.ui.close();
      else if (!this.ui.blocking) { this.input.unlock(); this.ui.openInventory(); }
    }
    if (inp.wasPressed('pause') && this.ui.blocking) {
      if (this.ui.open === 'pause') { this.ui.open = null; this.ui.clear(); this.onUIClosed(); }
      else this.ui.close();
    }
    if (inp.wasPressed('debug')) { this.hud.showDebug = !this.hud.showDebug; this.hud.debugEl.classList.toggle('hidden', !this.hud.showDebug); }
    if (inp.wasPressed('hud')) this.hud.setVisible(!this.hud.visible);
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
    const pauseSim = this.ui.open === 'pause';
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
    const eye = p.eyeHeight;
    // view bobbing while walking
    const speed = Math.hypot(b.vx, b.vz);
    const bob = b.onGround ? Math.sin(sec * 9) * Math.min(0.06, speed * 0.25) : 0;
    this.camera.position.set(x, y + eye + Math.abs(bob) * 0.6, z);
    this.camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    if (p.hurtTime > 0) this.camera.rotation.z = Math.sin(p.hurtTime * 0.6) * 0.04;
    const targetFov = this.settings.fov * (p.sprinting ? 1.1 : 1);
    this.camera.fov += (targetFov - this.camera.fov) * 0.2;
    this.camera.updateProjectionMatrix();

    this.chunks.update(x, z, 6);
    if (this.chunks.edited) { this.chunks.edited = false; this.sky.refreshShadows(); }
    const smoothTime = this.time + alpha;
    const st = this.sky.update(smoothTime, sec, this.camera, new THREE.Vector3(x, y, z));
    terrainUniforms.uTime.value = sec;
    const R = this.chunks.renderDistance * 16;
    const fogCol = this.sky.horizon;
    this.scene.fog.color.copy(fogCol);
    if (b.eyeInWater) { this.scene.fog.color.setRGB(0.03, 0.1, 0.3); this.scene.fog.near = 1; this.scene.fog.far = 18; }
    else if (b.eyeInLava) { this.scene.fog.color.setRGB(0.6, 0.15, 0.02); this.scene.fog.near = 0; this.scene.fog.far = 2; }
    else { this.scene.fog.near = R * 0.65; this.scene.fog.far = R; }
    this.sky.uniforms.uUnderwater.value = b.eyeInWater ? 1 : 0;
    this.audio.setListener(x, y + eye, z, p.yaw);

    this.chunks.updateVisibility(this.camera.position);
    this.entities.render(alpha, sec);
    this.overlay.update(this.interaction, p.dead);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.held.render(this.renderer, alpha, sec);
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
      `Biome ${biomeName(w.biomeAt(bx, bz))}   chunks ${w.chunks.size}`,
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

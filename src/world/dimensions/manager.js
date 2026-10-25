// Game-side dimension handling: travelling between the overworld, the
// Cinderdeep and the Hollow (each with its own chunks, saves, containers and
// mobs), portal timers, arrival portals, the Hollow's boss fight, the sky and
// fog per dimension, and saving which dimension the player is in.
import * as THREE from 'three';
import { B, SOLID } from '../blocks.js';
import { cidx, MIN_Y } from '../constants.js';
import { DIMENSIONS, DIM, scaleCoord, clampPortalY, dimensionByName } from './dims.js';
import { nearestRift, findPortalSite, buildRiftPortal } from './portal.js';
import { HOLLOW_ARRIVAL } from './hollow.js';
import { nearestSanctum } from './sanctum.js';
import { DimensionSky } from '../../sky/dimensionSky.js';
import { terrainUniforms } from '../../render/terrainMaterial.js';
import { VoidEye } from '../../entities/voidEye.js';
import { liveStands, loadStands } from '../../entities/armorStand.js';
import { canLight, FIRE_DELAY } from '../fire.js';
import { SIDE_DIRS, BED_HEAD } from '../shapes.js';
import './register.js';
import '../../mobs/gloomshell.js'; // the Hollow Cities' Gloomshells

export const PORTAL_TICKS = 80; // 4 s standing in a Rift (instant in creative)
const WYRM_MAX = 200;

export class DimensionManager {
  constructor(game) {
    this.game = game;
    this.stores = {};      // dimension -> state stashed while the player is elsewhere
    this.pending = null;   // arrival waiting for its chunks
    this.portalTicks = 0;
    this.portalCooldown = 0;
    this.links = [];       // Rift portal pairs: { a: {dim, x, y, z}, b: {...} }
    this.hollow = { defeated: false, gateOpen: false, farGateOpen: false, wyrmHealth: WYRM_MAX, crystals: new Array(10).fill(true) };
    this.sky = new DimensionSky(game.scene);
    this.baseMinLight = terrainUniforms.uMinLight.value;
    this.beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xff90f0 }));
    this.beam.frustumCulled = false; this.beam.visible = false;
    game.scene.add(this.beam);
    if (typeof document !== 'undefined') this.buildUI();
  }

  get current() { return this.game.world.dimension; }

  buildUI() {
    const mk = (css, parent) => { const d = document.createElement('div'); d.style.cssText = css; parent.appendChild(d); return d; };
    const hud = document.getElementById('hud') || document.body;
    this.portalEl = mk('position:fixed;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(170,80,255,.3) 0%,rgba(90,20,190,.9) 100%);z-index:4', hud);
    this.bossEl = mk('position:fixed;top:12px;left:50%;transform:translateX(-50%);width:min(60vw,500px);display:none;text-align:center;color:#f2e6ff;font:600 14px/1.5 system-ui,sans-serif;text-shadow:0 1px 2px #000;pointer-events:none;z-index:6', hud);
    this.bossEl.innerHTML = '<div>Void Wyrm</div><div style="height:9px;border:1px solid #000;background:#2a1030;box-shadow:0 0 0 1px #6a4a8a"><div style="height:100%;width:100%;background:linear-gradient(#f08aff,#9a2ad0)"></div></div>';
    this.bossFill = this.bossEl.lastChild.firstChild;
    this.loadEl = mk('position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:#0c0612;color:#e8dcff;font:600 22px system-ui,sans-serif;z-index:30;pointer-events:none', document.body);
  }

  // ---- looks ---------------------------------------------------------------------
  /** The terrain's darkest light in a dimension (before Night Vision). */
  baseLight(dim = this.current) { return dim === DIM.OVERWORLD ? this.baseMinLight : DIMENSIONS[dim].ambient; }

  applyLook(dim = this.current) {
    const g = this.game;
    this.sky.apply(g, dim);
    terrainUniforms.uMinLight.value = this.baseLight(dim);
    g.minEntityLight = DIMENSIONS[dim].entityLight || 0;
    const si = typeof document !== 'undefined' && document.getElementById('skyinfo');
    if (si) si.style.display = dim === DIM.OVERWORLD ? '' : 'none';
    if (dim !== 'hollow') { this.beam.visible = false; if (this.bossEl) this.bossEl.style.display = 'none'; }
  }

  /** Replaces Sky.update while away from the overworld. */
  updateSky(t, seconds, camera, focus) {
    const g = this.game;
    if (this.current === DIM.OVERWORLD) return g.sky.update(t, seconds, camera, focus);
    return this.sky.update(g, this.current, t, seconds, camera);
  }

  /** Thicker (Cinderdeep) or looser (Hollow) fog than the overworld. */
  adjustFog(fog, R) {
    const d = DIMENSIONS[this.current];
    if (this.current === DIM.OVERWORLD || !d.fogFar) return;
    fog.near = R * d.fogNear; fog.far = R * d.fogFar;
  }

  // ---- travelling ----------------------------------------------------------------
  /** Leave the current dimension and start arriving in `dim` (arrival: {mode, x, y, z, axis}). */
  switchTo(dim, arrival) {
    const g = this.game, w = g.world, p = g.player, old = w.dimension;
    if (!DIMENSIONS[dim]) return false;
    // multiplayer: the group travels together; a guest asks the host, who takes everyone along
    if (g.net && g.net.isClient && !this.netFollow) {
      g.net.requestTravel(dim, arrival);
      this.portalTicks = 0; this.portalCooldown = 100;
      return false;
    }
    if (p.riding) g.dismount();
    if (p.sleeping) p.sleeping = null;
    // unload every chunk (modified ones go to world.saved, persistent mobs to the spawner)
    for (const c of [...w.chunks.values()]) {
      g.chunks.disposeChunk(c);
      w.removeChunk(c.cx, c.cz);
      g.spawner.onChunkUnloaded(c.cx, c.cz);
    }
    const stands = liveStands(g); // armour stands stay where they were put
    for (const e of g.entities.list) g.entities.removeMesh(e);
    g.entities.list = [];
    this.stores[old] = { stands, saved: w.saved, furnaces: g.furnaces, chests: g.chests, brewingStands: g.brewingStands, hoppers: g.hoppers, dispensers: g.dispensers, savedMobs: g.spawner.savedMobs, generated: g.spawner.generated, spawnerState: g.spawnerBlocks.state };
    const s = this.stores[dim] || {};
    delete this.stores[dim];
    w.setDimension(dim, s.saved || new Map());
    g.furnaces = s.furnaces || new Map();
    g.chests = s.chests || new Map();
    g.brewingStands = s.brewingStands || new Map();
    g.hoppers = s.hoppers || new Map();
    g.dispensers = s.dispensers || new Map();
    g.spawner.savedMobs = s.savedMobs || new Map();
    g.spawner.generated = s.generated || new Set();
    g.spawnerBlocks.state = s.spawnerState || new Map();
    loadStands(g, s.stands);
    g.chunks.resetDimension(dim);
    g.interaction.breaking = null;
    if (g.ui && g.ui.open && g.ui.open !== 'death' && g.ui.close) g.ui.close();
    this.applyLook(dim);
    const target = { ...arrival };
    if (target.mode === 'hollowArrival') { target.x = HOLLOW_ARRIVAL.x + 0.5; target.y = HOLLOW_ARRIVAL.y + 1; target.z = HOLLOW_ARRIVAL.z + 0.5; }
    this.pending = { dim, ...target, t: 0, radius: target.mode === 'rift' ? (dim === DIM.CINDERDEEP ? 2 : 3) : 2 };
    p.setPosition(this.pending.x, this.pending.y, this.pending.z);
    this.portalTicks = 0;
    this.portalCooldown = 60;
    if (this.loadEl) {
      this.loadEl.innerHTML = `<div>Entering ${DIMENSIONS[dim].name}…</div><div style="font-size:13px;opacity:.6">generating terrain</div>`;
      const f = DIMENSIONS[dim].fog;
      this.loadEl.style.background = f ? `rgb(${f.map((v) => Math.round(v * 120)).join(',')})` : '#0c1220';
      this.loadEl.style.display = 'flex';
    }
    if (g.milestones) g.milestones.event(dim === DIM.CINDERDEEP ? 'enter_cinderdeep' : dim === DIM.HOLLOW ? 'enter_hollow' : 'enter_overworld');
    if (g.net && g.net.isHost) g.net.onSwitchDimension(dim, this.pending, old);
    return true;
  }

  tickPending() {
    const pd = this.pending, g = this.game, w = g.world, p = g.player;
    pd.t++;
    p.setPosition(pd.x, pd.y, pd.z);
    const r = Math.min(pd.radius, g.chunks.renderDistance), cx = Math.floor(pd.x / 16), cz = Math.floor(pd.z / 16);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (!w.isChunkLoaded(cx + dx, cz + dz)) return;
    this.pending = null;
    this.arrive(pd);
    if (this.loadEl) this.loadEl.style.display = 'none';
    g.hud.toast(`Entered ${DIMENSIONS[pd.dim].name[0].toUpperCase() + DIMENSIONS[pd.dim].name.slice(1)}`);
  }

  /** Place the player once the destination chunks are loaded. */
  arrive(pd) {
    const g = this.game, w = g.world, p = g.player;
    const set = (x, y, z, id, m = 0) => w.setBlockUrgent(x, y, z, id, m, false);
    let x = pd.x, y = pd.y, z = pd.z;
    if (pd.mode === 'rift') {
      const cinder = pd.dim === DIM.CINDERDEEP;
      const found = nearestRift(w.chunks.values(), cidx, x, y, z, cinder ? 16 : 128, cinder ? 1 : MIN_Y + 1, cinder ? 126 : 318);
      if (found) {
        const ax = w.getMeta(found.x, found.y, found.z) & 1;
        x = found.x + 0.5; y = found.y; z = found.z + 0.5;
        // step to the middle of a 2-wide sheet
        if (w.getBlock(found.x + (ax ? 0 : 1), found.y, found.z + (ax ? 1 : 0)) === B.RIFT) { x += ax ? 0 : 0.5; z += ax ? 0.5 : 0; }
      } else {
        const site = findPortalSite(w, Math.floor(x), Math.round(y), Math.floor(z), 16, cinder ? 33 : MIN_Y + 6, cinder ? 116 : 250);
        let f;
        if (site) f = buildRiftPortal(w, site.x, site.y, site.z, site.axis, false, set);
        else f = buildRiftPortal(w, Math.floor(x), clampPortalY(y, pd.dim), Math.floor(z), pd.axis || 0, true, set);
        x = f.x + (f.axis ? 0.5 : 1.0); y = f.y; z = f.z + (f.axis ? 1.0 : 0.5);
      }
      this.portalCooldown = 60;
      if (pd.src) this.linkPortals(pd.src, { dim: pd.dim, x, y, z });
    } else if (pd.mode === 'hollowArrival') {
      // the obsidian platform sits on the island's rim (or floats at y 48 if the rim is missing)
      const top = w.heightAt(HOLLOW_ARRIVAL.x, HOLLOW_ARRIVAL.z);
      const a = { ...HOLLOW_ARRIVAL, y: top > 30 && top < 80 ? top : HOLLOW_ARRIVAL.y };
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        set(a.x + dx, a.y, a.z + dz, B.OBSIDIAN);
        for (let dy = 1; dy <= 3; dy++) set(a.x + dx, a.y + dy, a.z + dz, B.AIR);
      }
      x = a.x + 0.5; y = a.y + 1; z = a.z + 0.5;
      p.yaw = Math.PI / 2; p.pitch = 0.15; // facing the island centre
    } else if (pd.mode === 'safe') {
      const spot = this.findSafeSpot(Math.floor(x), Math.round(y), Math.floor(z), pd.dim);
      if (spot) ({ x, y, z } = spot);
      else {
        const by = pd.dim === DIM.CINDERDEEP ? 64 : Math.round(y);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          set(Math.floor(x) + dx, by - 1, Math.floor(z) + dz, B.OBSIDIAN);
          for (let dy = 0; dy < 3; dy++) set(Math.floor(x) + dx, by + dy, Math.floor(z) + dz, B.AIR);
        }
        x = Math.floor(x) + 0.5; y = by; z = Math.floor(z) + 0.5;
      }
    } else {
      // exact spot (respawn, leaving the Hollow): move up out of any blocks
      const bx = Math.floor(x), bz = Math.floor(z);
      let yy = Math.floor(y);
      while (yy < 318 && (BLOCKS_SOLID(w, bx, yy, bz) || BLOCKS_SOLID(w, bx, yy + 1, bz))) yy++;
      y = Math.max(y, yy);
    }
    p.setPosition(x, y, z);
    if (g.net && g.net.isHost) g.net.onArrived(x, y, z); // the guests land next to us
  }

  /** An open standing spot near (x, z): solid (non-lava) ground and two free blocks. */
  findSafeSpot(x, y, z, dim) {
    const w = this.game.world;
    const y0 = dim === DIM.CINDERDEEP ? 33 : dim === DIM.HOLLOW ? 20 : MIN_Y + 6, y1 = dim === DIM.CINDERDEEP ? 118 : 300;
    let best = null, bd = Infinity;
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
      if (!w.isLoaded(x + dx, z + dz)) continue;
      for (let yy = y0; yy <= y1; yy++) {
        const below = w.getBlock(x + dx, yy - 1, z + dz);
        if (!BLOCKS_SOLID(w, x + dx, yy - 1, z + dz) || below === B.BEDROCK) continue;
        if (BLOCKS_SOLID(w, x + dx, yy, z + dz) || BLOCKS_SOLID(w, x + dx, yy + 1, z + dz)) continue;
        const a = w.getBlock(x + dx, yy, z + dz), b = w.getBlock(x + dx, yy + 1, z + dz);
        if (a !== B.AIR || b !== B.AIR) continue;
        const d = dx * dx + dz * dz + (dim === DIM.OVERWORLD ? 0 : (yy - y) ** 2 * 0.3) - (dim === DIM.OVERWORLD ? yy * 4 : 0);
        if (d < bd) { bd = d; best = { x: x + dx + 0.5, y: yy, z: z + dz + 0.5 }; }
      }
    }
    return best;
  }

  /** Step through a Rift: overworld <-> Cinderdeep at 8:1. */
  useRift() {
    const g = this.game, p = g.player, w = g.world, from = this.current;
    if (from === DIM.HOLLOW) return;
    const to = from === DIM.CINDERDEEP ? DIM.OVERWORLD : DIM.CINDERDEEP;
    const axis = w.getMeta(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z)) & 1;
    g.audio.play('teleport');
    const src = { dim: from, x: p.x, y: p.y, z: p.z };
    // a portal pair used before leads back to the same portal (the 1:8 scale alone can land 60+ blocks off)
    const link = this.links.find((l) => l.a.dim === from && Math.abs(l.a.x - p.x) < 4 && Math.abs(l.a.y - p.y) < 5 && Math.abs(l.a.z - p.z) < 4);
    const dest = link ? { x: link.b.x, y: link.b.y, z: link.b.z } : { x: scaleCoord(p.x, from, to), y: clampPortalY(p.y, to), z: scaleCoord(p.z, from, to) };
    this.switchTo(to, { mode: 'rift', ...dest, axis, src });
  }

  /** Remember that two Rift portals lead to each other (both directions). */
  linkPortals(a, b) {
    const near = (p, q) => p.dim === q.dim && Math.abs(p.x - q.x) < 4 && Math.abs(p.y - q.y) < 5 && Math.abs(p.z - q.z) < 4;
    this.links = this.links.filter((l) => !near(l.a, a) && !near(l.a, b));
    this.links.push({ a, b }, { a: b, b: a });
    if (this.links.length > 200) this.links.splice(0, this.links.length - 200);
  }

  /** Fall into a Hollow Gate: to the Hollow, or (from the Hollow) home to the spawn point. */
  useGate() {
    const g = this.game, p = g.player;
    g.audio.play('teleport');
    if (this.current === DIM.HOLLOW) this.switchTo(DIM.OVERWORLD, { mode: 'spawn', x: p.spawn.x, y: p.spawn.y, z: p.spawn.z });
    else this.switchTo(DIM.HOLLOW, { mode: 'hollowArrival' });
  }

  /** /dimension <name> */
  command(name) {
    const dim = dimensionByName(name);
    if (!dim) return `Usage: /dimension <${Object.keys(DIMENSIONS).join('|')}>`;
    if (dim === this.current) return `You are already in ${DIMENSIONS[dim].name}`;
    const p = this.game.player, from = this.current;
    if (dim === DIM.HOLLOW) this.switchTo(dim, { mode: 'hollowArrival' });
    else if (from === DIM.HOLLOW) this.switchTo(dim, dim === DIM.OVERWORLD ? { mode: 'spawn', x: p.spawn.x, y: p.spawn.y, z: p.spawn.z } : { mode: 'safe', x: p.spawn.x / 8, y: 64, z: p.spawn.z / 8 });
    else this.switchTo(dim, { mode: 'safe', x: scaleCoord(p.x, from, dim), y: dim === DIM.CINDERDEEP ? 64 : 80, z: scaleCoord(p.z, from, dim) });
    return `Travelling to ${DIMENSIONS[dim].name}`;
  }

  // ---- per tick ------------------------------------------------------------------
  tick() {
    const g = this.game, p = g.player, w = g.world;
    if (this.pending) { this.tickPending(); return; }
    if (this.portalEl) this.portalEl.style.opacity = (Math.min(1, this.portalTicks / PORTAL_TICKS) * 0.85).toFixed(3);
    if (this.current === DIM.HOLLOW && !(g.net && g.net.isClient)) this.tickHollow(); // the host runs the boss fight
    this.ambience();
    if (p.dead) { this.portalTicks = 0; return; }
    const box = p.body.box();
    const inRift = p.touches(w, box, B.RIFT), inGate = p.touches(w, box, B.HOLLOW_GATE);
    const inFar = this.current === DIM.HOLLOW && p.touches(w, box, B.FAR_GATE);
    if (this.current === DIM.HOLLOW && g.ticks % 40 === 0 && g.milestones && Math.hypot(p.x, p.z) > 600 && w.dimGenerator.cityAt(p.x, p.y, p.z)) g.milestones.event('hollow_city');
    if (inFar) {
      if (this.portalCooldown === 0) { this.useFarGate(); return; }
      this.portalCooldown = 40;
    } else if (inGate) {
      if (this.portalCooldown === 0) { this.useGate(); return; }
      this.portalCooldown = 40;
    } else if (inRift) {
      if (this.portalCooldown > 0) this.portalCooldown = 40; // step out before it works again
      else if (++this.portalTicks >= (p.creative ? 1 : PORTAL_TICKS)) { this.useRift(); return; }
      else if (this.portalTicks % 20 === 1) g.audio.play('warble', null, 0.3);
    } else {
      this.portalTicks = Math.max(0, this.portalTicks - 4);
      if (this.portalCooldown > 0) this.portalCooldown--;
    }
  }

  ambience() {
    const g = this.game, p = g.player, w = g.world;
    for (let k = 0; k < 6; k++) {
      const x = Math.floor(p.x + (Math.random() - 0.5) * 12), y = Math.floor(p.y + (Math.random() - 0.5) * 8), z = Math.floor(p.z + (Math.random() - 0.5) * 12);
      if (w.getBlock(x, y, z) === B.RIFT) g.particles.emit(x + Math.random(), y + Math.random(), z + Math.random(), (Math.random() - 0.5) * 0.03, 0.02, (Math.random() - 0.5) * 0.03, 0.7, 0.3, 1, 30, -0.001);
    }
    if (this.current === DIM.CINDERDEEP) {
      for (let k = 0; k < 2; k++) {
        g.particles.emit(p.x + (Math.random() - 0.5) * 20, p.y + (Math.random() - 0.3) * 10, p.z + (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 0.01, -0.005, (Math.random() - 0.5) * 0.01, 1, 0.45 + Math.random() * 0.3, 0.2, 60, 0);
      }
    }
  }

  // ---- the Hollow and its Wyrm ---------------------------------------------------
  wyrmCircleY() { return this.game.world.dimGenerator.fountainY() + 24; }

  tickHollow() {
    const g = this.game, w = g.world, gen = w.dimGenerator, p = g.player, h = this.hollow;
    if (h.defeated) {
      if (this.bossEl) this.bossEl.style.display = 'none';
      this.beam.visible = false;
      if (!h.gateOpen && w.isChunkLoaded(0, 0) && w.isChunkLoaded(-1, -1)) this.openExitGate();
      if (!h.farGateOpen) {
        const fg = gen.gatewayMain();
        if (w.isChunkLoaded(fg.x >> 4, fg.z >> 4)) this.openFarGate();
      }
      return;
    }
    let wyrm = null;
    const crystals = [];
    for (const e of g.entities.list) {
      if (e.kind !== 'mob' || e.dead || e.removed) continue;
      if (e.type === 'void_wyrm' && e.deathTime === 0) wyrm = e;
      if (e.type === 'void_crystal' && e.crystalIndex !== undefined) crystals[e.crystalIndex] = e;
    }
    this.crystalList = crystals;
    if (g.ticks % 20 === 0) {
      gen.pillars().forEach((pl, i) => {
        if (!h.crystals[i] || crystals[i] || !w.isLoaded(pl.x, pl.z)) return;
        const c = g.spawner.spawnMob('void_crystal', pl.x + 0.5, pl.h + 2, pl.z + 0.5);
        c.crystalIndex = i; c.noFreeze = true;
      });
      if (!wyrm && Math.hypot(p.x, p.z) < 260) {
        wyrm = g.spawner.spawnMob('void_wyrm', 0.5, this.wyrmCircleY() + 20, -40.5);
        wyrm.health = Math.max(1, h.wyrmHealth);
        wyrm.noFreeze = true;
      }
    }
    if (wyrm) {
      h.wyrmHealth = wyrm.health;
      const near = Math.hypot(p.x - wyrm.x, p.z - wyrm.z) < 220;
      if (this.bossEl) {
        this.bossEl.style.display = near ? 'block' : 'none';
        this.bossFill.style.width = `${Math.max(0, wyrm.health / WYRM_MAX * 100).toFixed(1)}%`;
      }
    }
  }

  /** Called from the Wyrm's AI: Mending Crystals within 48 blocks heal it. */
  wyrmTick(m) {
    let best = null, bd = 48 * 48;
    for (const c of this.crystalList || []) {
      if (!c || c.dead || c.removed) continue;
      const d = (c.x - m.x) ** 2 + (c.y - m.y) ** 2 + (c.z - m.z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (best && m.health < WYRM_MAX) {
      m.health = Math.min(WYRM_MAX, m.health + 0.1);
      const a = this.beam.geometry.attributes.position;
      a.setXYZ(0, best.x, best.y + 0.9, best.z); a.setXYZ(1, m.x, m.y + 1, m.z); a.needsUpdate = true;
      this.beam.visible = true;
    } else this.beam.visible = false;
  }

  onCrystalDestroyed(m) {
    if (m.crystalIndex !== undefined) this.hollow.crystals[m.crystalIndex] = false;
  }

  onWyrmSlain() {
    const g = this.game;
    this.hollow.defeated = true;
    this.hollow.wyrmHealth = 0;
    this.beam.visible = false;
    if (this.bossEl) this.bossEl.style.display = 'none';
    if (g.milestones) g.milestones.event('wyrm');
    g.hud.toast('The Void Wyrm is slain! The exit gate at the island centre has opened.', 6000);
    if (g.world.isChunkLoaded(0, 0) && g.world.isChunkLoaded(-1, -1)) this.openExitGate();
  }

  /** Fill the fountain with Hollow Gate blocks, crown it with the egg and drop the reward. */
  openExitGate() {
    const g = this.game, w = g.world, gen = w.dimGenerator, fy = gen.fountainY();
    for (const [x, y, z] of gen.gateCells()) w.setBlockUrgent(x, y, z, B.HOLLOW_GATE, 0, false);
    w.setBlockUrgent(0, fy + 4, 0, B.WYRM_EGG, 0, false);
    g.entities.spawnXp(0.5, fy + 6, 0.5, 12000);
    this.hollow.gateOpen = true;
  }

  /** The Far Gate (reference: the void-island gateway) on the main island's rim, opened with the Wyrm's death. */
  openFarGate() {
    const w = this.game.world, { x, y, z } = w.dimGenerator.gatewayMain();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 1; dy <= 4; dy++) w.setBlockUrgent(x + dx, y + dy, z + dz, B.AIR, 0, false);
    w.setBlockUrgent(x, y, z, B.BEDROCK, 0, false);
    w.setBlockUrgent(x, y + 1, z, B.FAR_GATE, 0, false);
    w.setBlockUrgent(x, y + 2, z, B.FAR_GATE, 0, false);
    w.setBlockUrgent(x, y + 3, z, B.BEDROCK, 0, false);
    this.hollow.farGateOpen = true;
    this.game.audio.play('teleport', [x + 0.5, y + 2, z + 0.5]);
  }

  /** Step into a Far Gate: from the main island out to the outer islands, or back. */
  useFarGate() {
    const g = this.game, p = g.player, gen = g.world.dimGenerator;
    const out = Math.hypot(p.x, p.z) < 400;
    const gate = out ? gen.gatewayExit() : gen.gatewayMain();
    // land three blocks from the gate, on the island side (out: towards the island's middle, back: towards the centre)
    const cx = out && gate.island ? gate.island.x : 0, cz = out && gate.island ? gate.island.z : 0;
    const d = Math.hypot(cx - gate.x, cz - gate.z) || 1;
    const tx = Math.floor(gate.x + (cx - gate.x) / d * 3), tz = Math.floor(gate.z + (cz - gate.z) / d * 3);
    const ground = gen.groundAt(tx, tz);
    g.particles.smoke(p.x, p.y + 1, p.z, 12, 0.8);
    p.setPosition(tx + 0.5, (ground ?? gate.y) + 1, tz + 0.5);
    p.gliding = false;
    p.yaw = Math.atan2(-(cx - gate.x), -(cz - gate.z)); // facing away from the gate
    this.portalCooldown = 60;
    g.audio.play('teleport');
    if (out && g.milestones) g.milestones.event('far_gate');
  }

  // ---- items and blocks ----------------------------------------------------------
  /** Throw an Eye of the Void towards the nearest Hollow Sanctum. */
  throwEye() {
    const g = this.game, p = g.player;
    if (this.current !== DIM.OVERWORLD) return false;
    const s = nearestSanctum(g.seed, p.x, p.z);
    if (!s) { g.hud.toast('The eye stares blankly: no sanctum nearby'); return false; }
    const [ex, ey, ez] = p.eyePos();
    g.entities.add(new VoidEye(ex, ey, ez, s.x + 0.5, s.z + 0.5));
    g.audio.play('teleport', null, 0.5);
    return true;
  }

  /** Beds cannot be slept in away from the overworld: they blow up. */
  bedExplodes(x, y, z) {
    const g = this.game, w = g.world;
    const m = w.getMeta(x, y, z), [dx, , dz] = SIDE_DIRS[m & 3], s = (m & BED_HEAD) ? -1 : 1;
    w.setBlockUrgent(x, y, z, B.AIR, 0, false);
    if (w.getBlock(x + dx * s, y, z + dz * s) === B.BED) w.setBlockUrgent(x + dx * s, y, z + dz * s, B.AIR, 0, false);
    g.explode(x + 0.5, y + 0.5, z + 0.5, 5, null);
    for (let k = 0; k < 14; k++) {
      const fx = x + Math.floor((Math.random() - 0.5) * 7), fy = y + Math.floor((Math.random() - 0.5) * 4), fz = z + Math.floor((Math.random() - 0.5) * 7);
      if (canLight(w, fx, fy, fz)) { w.setBlockUrgent(fx, fy, fz, B.FIRE); w.scheduleTick(fx, fy, fz, FIRE_DELAY); }
    }
  }

  // ---- saving --------------------------------------------------------------------
  saveData(pack) {
    const dims = {};
    for (const [dim, s] of Object.entries(this.stores)) {
      const chunks = {};
      for (const [k, c] of s.saved) chunks[k] = pack(c);
      const savedMobs = {};
      for (const [k, v] of s.savedMobs) savedMobs[k] = v;
      dims[dim] = { chunks, armorStands: s.stands || [], furnaces: [...s.furnaces.values()], chests: [...s.chests.values()], brewingStands: [...(s.brewingStands || new Map()).values()], hoppers: [...(s.hoppers || new Map()).values()].map((h) => ({ x: h.x, y: h.y, z: h.z, slots: h.slots })), dispensers: [...(s.dispensers || new Map()).values()].map((d) => ({ x: d.x, y: d.y, z: d.z, slots: d.slots })), savedMobs, generated: [...s.generated] };
    }
    return { dimension: this.current, dimensions: dims, dimState: { hollow: { ...this.hollow, crystals: [...this.hollow.crystals] }, links: this.links } };
  }

  loadData(data, unpack) {
    if (data.dimState && data.dimState.hollow) Object.assign(this.hollow, data.dimState.hollow);
    if (data.dimState && data.dimState.links) this.links = data.dimState.links;
    for (const [dim, d] of Object.entries(data.dimensions || {})) {
      if (dim === this.current || !DIMENSIONS[dim]) continue;
      const saved = new Map();
      for (const [k, c] of Object.entries(d.chunks || {})) saved.set(+k, unpack(c));
      const savedMobs = new Map();
      for (const [k, v] of Object.entries(d.savedMobs || {})) savedMobs.set(+k, v);
      this.stores[dim] = {
        saved, savedMobs, stands: d.armorStands || [],
        furnaces: new Map((d.furnaces || []).map((f) => [`${f.x},${f.y},${f.z}`, f])),
        chests: new Map((d.chests || []).map((c) => [`${c.x},${c.y},${c.z}`, c])),
        brewingStands: new Map((d.brewingStands || []).map((c) => [`${c.x},${c.y},${c.z}`, c])),
        hoppers: new Map((d.hoppers || []).map((h) => [`${h.x},${h.y},${h.z}`, { ...h, cooldown: 0 }])),
        dispensers: new Map((d.dispensers || []).map((c) => [`${c.x},${c.y},${c.z}`, c])),
        generated: new Set(d.generated || []),
      };
    }
  }
}

function BLOCKS_SOLID(w, x, y, z) { return !!SOLID[w.getBlock(x, y, z)]; }

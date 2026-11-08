// Fishing: the rod casts a bobber that floats on water. After 5-30 s (a
// fifth faster in the rain) a fish bites: the bobber dips and splashes for
// about a second; reeling in then lands a catch from the reference loot
// split (85 % fish, 10 % junk, 5 % treasure) and 1-6 XP.
import * as THREE from 'three';
import { B, SOLID } from '../world/blocks.js';
import { I, ITEMS } from '../world/items.js';
import { BIOMES } from '../world/biomes.js';
import { luckOf } from '../player/effects.js';
import { enchLevel } from '../world/enchantments.js';

let nextId = 7_000_000;

/** Share of each catch group that is replaced by a local one, by biome key (the depths of the sea). */
export const DEEP_CATCH = { deep_ocean: { fish: 0.45, junk: 0.4, treasure: 0.5 }, kelp_forest: { fish: 0.1, junk: 0.5, treasure: 0.2 } };

/** Biomes with a fish of their own: the Bogcarp lives in the bogs, the Dunefin in the water holes of dry lands (share of the fish catches). */
export const LOCAL_FISH = { swamp: 'RAW_BOGCARP', mangrove_swamp: 'RAW_BOGCARP', desert: 'RAW_DUNEFIN', badlands: 'RAW_DUNEFIN', savanna: 'RAW_DUNEFIN', beach: 'RAW_DUNEFIN' };
export const LOCAL_FISH_SHARE = 0.4;
/** A Gilded Perch comes up with a Haul-enchanted rod: this share of the fish for each level. */
export const PERCH_PER_HAUL = 0.05;
/** Rod enchantments (the held rod's stack): { lure, haul }. */
export const rodEnchants = (st) => ({ lure: enchLevel(st, 'lure'), haul: enchLevel(st, 'haul') });
/** The wait for a bite in ticks (5 to 30 s, a fifth less in rain), shortened by 5 s for each level of Lure (never under 2 s). */
export function biteWait(rng = Math.random, rain = false, lure = 0) {
  return Math.max(40, Math.floor((100 + rng() * 500) * (rain ? 0.8 : 1)) - lure * 100);
}
/** Do fish-bearing catches double? Each level of Haul gives a fifth of a chance of one more of the same fish. */
export const haulExtra = (rng, haul) => haul > 0 && rng() < 0.2 * haul;

/**
 * Weights of the three catch groups at a luck (reference: fish 85 - luck, junk 10 - 2 luck,
 * treasure 5 + 2 luck; never below 0). Luck comes from the Luck / Bad Luck effects.
 */
export function catchWeights(luck = 0) {
  return { fish: Math.max(0, 85 - luck), junk: Math.max(0, 10 - 2 * luck), treasure: Math.max(0, 5 + 2 * luck) };
}

/**
 * Weighted loot: fish (silverfin 60, redfin 25, spinefish 13, glimmerfin 2; in a bog, in dry lands and on a beach 40 % are the local fish; with
 * Haul a few are Gilded Perch), junk and treasure. `haul` is the rod's Haul level: one level of luck each, and the Gilded Perch.
 */
export function rollCatch(rng = Math.random, luck = 0, biomeKey = '', haul = 0) {
  luck += haul;
  const w = catchWeights(luck), total = w.fish + w.junk + w.treasure;
  const r = rng();
  const fishCut = w.fish / total, junkCut = (w.fish + w.junk) / total;
  const deep = DEEP_CATCH[biomeKey]; // the ocean depths add their own catches (Lanternfins, Gleamkelp, Lantern Glands, Tide Shards)
  if (r < fishCut) {
    if (deep && rng() < deep.fish) return { id: I.RAW_LANTERNFIN, count: 1 };
    if (LOCAL_FISH[biomeKey] && rng() < LOCAL_FISH_SHARE) return { id: I[LOCAL_FISH[biomeKey]], count: 1 };
    if (haul > 0 && rng() < PERCH_PER_HAUL * haul) return { id: I.GILDED_PERCH, count: 1 };
    const f = rng() * 100;
    return { id: f < 60 ? I.RAW_SILVERFIN : f < 85 ? I.RAW_REDFIN : f < 98 ? I.SPINEFISH : I.GLIMMERFIN, count: 1 };
  }
  if (r < junkCut) {
    if (deep && rng() < deep.junk) return { id: rng() < 0.5 ? B.GLEAMKELP : B.KELP, count: 1 };
    const junk = [[I.STICK, 1], [I.BONE, 1], [I.STRING, 1], [I.BOWL, 1], [I.ROTTEN_FLESH, 1], [I.LEATHER, 1], [B.LILY_PAD ?? I.STICK, 1], [I.LEATHER_BOOTS, 1]];
    const [id, count] = junk[Math.floor(rng() * junk.length)];
    return { id, count, damage: id === I.LEATHER_BOOTS ? Math.floor(rng() * 40) : 0 };
  }
  if (deep && rng() < deep.treasure) { const t = [[I.LANTERN_GLAND, 2], [I.TIDE_SHARD, 3], [I.DIVERS_LAMP, 1], [I.TIDE_CRYSTAL, 1], [I.SKYBEAN, 1]]; const [id, count] = t[Math.floor(rng() * t.length)]; return { id, count, damage: 0 }; }
  const treasure = [[I.BOW, 1], [I.FISHING_ROD, 1], [I.DIAMOND, 1], [I.IRON_INGOT, 3], [I.BOOK, 1]];
  const [id, count] = treasure[Math.floor(rng() * treasure.length)];
  return { id, count, damage: id === I.BOW || id === I.FISHING_ROD ? Math.floor(rng() * 40) : 0 };
}

export class Bobber {
  constructor(x, y, z, vx, vy, vz, owner) {
    this.id = nextId++;
    this.kind = 'bobber';
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.prev = [x, y, z];
    this.owner = owner;
    this.inWater = false;
    this.wait = 0;      // ticks until a fish bites
    this.bite = 0;      // ticks the fish stays hooked
    this.age = 0;
    this.dead = false;
    const st = owner && owner.inventory ? owner.inventory.selectedStack : null;
    const en = rodEnchants(st);
    this.lure = en.lure; this.haul = en.haul; // the rod's enchantments, as it was when cast
  }

  resetWait(game) {
    const rain = game.weather && game.weather.rainingAt(game.world, this.x, this.y + 1, this.z);
    this.wait = biteWait(Math.random, !!rain, this.lure | 0);
  }

  tick(game) {
    this.prev = [this.x, this.y, this.z];
    this.age++;
    const p = game.player, w = game.world;
    if (p.dead || Math.hypot(p.x - this.x, p.y - this.y, p.z - this.z) > 32 || !game.interaction.holdingRod()) { this.remove(game); return; }
    const water = w.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) === B.WATER;
    if (water || this.inWater) {
      if (!this.inWater) { this.inWater = true; this.resetWait(game); game.audio.play('splash', [this.x, this.y, this.z], 0.5); }
      // float on the surface of the water column
      let top = Math.floor(this.y);
      while (w.getBlock(Math.floor(this.x), top + 1, Math.floor(this.z)) === B.WATER) top++;
      const surface = top + 0.9 - (this.bite > 0 ? 0.25 : 0);
      this.vy += (surface - this.y) * 0.2; this.vy *= 0.6;
      this.vx *= 0.8; this.vz *= 0.8;
      if (w.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z)) !== B.WATER && !water) this.inWater = false;
      if (this.bite > 0) {
        if (--this.bite === 0) this.resetWait(game); // got away
      } else if (--this.wait <= 0) {
        this.bite = 20 + Math.floor(Math.random() * 20) + (this.lure | 0) * 6; // (a lured fish bites a little longer)
        game.audio.play('splash', [this.x, this.y, this.z], 0.8);
        for (let k = 0; k < 10; k++) game.particles.emit(this.x + (Math.random() - 0.5) * 0.6, this.y + 0.1, this.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.08, 0.12, (Math.random() - 0.5) * 0.08, 0.6, 0.75, 1, 12, 0.03);
      } else if (this.wait < 40 && Math.random() < 0.3) {
        // a fish approaching: little wakes moving in
        const a = Math.random() * Math.PI * 2, d = this.wait / 40 * 2;
        game.particles.emit(this.x + Math.cos(a) * d, this.y + 0.1, this.z + Math.sin(a) * d, 0, 0.02, 0, 0.75, 0.85, 1, 8, 0);
      }
    } else {
      this.vy -= 0.04;
      this.vx *= 0.92; this.vy *= 0.92; this.vz *= 0.92;
    }
    // stop on solid ground
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    const b = w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
    if (SOLID[b]) {
      this.vx = this.vy = this.vz = 0;
    } else { this.x = nx; this.y = ny; this.z = nz; }
    if (this.y < -128) this.remove(game);
  }

  /** Reel in: a hooked fish becomes a catch flying to the player. Returns the rod damage. */
  reel(game) {
    const p = game.player;
    let dmg = 0;
    if (this.bite > 0) {
      const bk = BIOMES[game.world.biomeAt(Math.floor(this.x), Math.floor(this.z))]; const st = rollCatch(Math.random, luckOf(p.effects), bk ? bk.key : '', this.haul | 0);
      if (ITEMS[st.id] && ITEMS[st.id].food && haulExtra(Math.random, this.haul | 0)) st.count += 1; // Haul: a second fish on the line
      const dx = p.x - this.x, dy = p.y + 1 - this.y, dz = p.z - this.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      game.entities.spawnItem(this.x, this.y + 0.3, this.z, st, [dx * 0.1, dy * 0.1 + Math.sqrt(d) * 0.08, dz * 0.1]);
      game.entities.spawnXp(p.x, p.y + 0.5, p.z, 1 + Math.floor(Math.random() * 6));
      if (game.milestones) game.milestones.event('fish');
      dmg = 1;
    }
    this.remove(game);
    return dmg;
  }

  remove(game) {
    this.dead = true;
    if (game.interaction.bobber === this) game.interaction.bobber = null;
  }

  createMesh() {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), new THREE.MeshLambertMaterial({ color: 0xd8302a }));
    top.position.y = 0.06;
    const bot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 17), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x222222 }));
    line.frustumCulled = false;
    g.add(top, bot, line);
    g.userData.line = line;
    g.userData.mats = [top.material, bot.material];
    return g;
  }

  renderUpdate(m, px, py, pz, alpha, L) {
    m.position.set(px, py, pz);
    // fishing line: a sagging curve from the rod tip to the bobber (in the bobber's local space)
    const p = this.owner, [ex, ey, ez] = p.eyePos(), [lx, , lz] = p.lookDir();
    const tx = ex + lx * 0.6 - lz * 0.35 - px, ty = ey - 0.25 - py, tz = ez + lz * 0.6 + lx * 0.35 - pz;
    const pos = m.userData.line.geometry.attributes.position;
    for (let k = 0; k <= 16; k++) {
      const t = k / 16, sag = Math.sin(t * Math.PI) * Math.min(1.5, Math.hypot(tx, tz) * 0.12);
      pos.setXYZ(k, tx * t, ty * t - sag + 0.08 * (1 - t), tz * t);
    }
    pos.needsUpdate = true;
  }
}

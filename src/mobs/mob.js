// Mob entity: physics, damage, death/drops and goal-based AI for passive
// animals, melee/ranged/explosive hostiles, a wall-climber and a neutral
// teleporter.
import { Body } from '../physics/body.js';
import { fallDamage } from '../physics/constants.js';
import { isStalagmiteTip, stalagmiteFallDamage } from '../world/caves.js';
import { B, SOLID, CROPS, isWaterish, CROAKLIGHTS } from '../world/blocks.js';
import { I } from '../world/items.js';
import { MOBS, CATEGORY } from './mobTypes.js';
import { BIOMES } from '../world/biomes.js';
import { rollDrops } from './drops.js';
import { findPath } from './pathfinding.js';
import { shouldDespawn, shouldBurnInSun } from './spawnRules.js';
import { buildModel, animateModel } from './models.js';
import { entityGlow } from '../render/entityLight.js';
import { randomSheepColor, WOOL_RGB } from '../world/colors.js';
import { WOOL_ITEMS } from '../world/items.js';
import { RESTOCK_TICKS, makeTrades } from './trades.js';
import { villagesNear, PROFESSIONS } from '../world/villages.js';
import { conversionStep, newConversion } from './hostileVariants.js'; // registers the Hexwife and the Shambler / Rattler variants
import { EFFECTS, addEffect, tickEffects, speedFactor, periodicActions, instantAmount, effectsColor, visibilityFactor } from '../player/effects.js';

let nextMobId = 1_000_000;
const TAU = Math.PI * 2;

function armorPieces(p) { const a = p.inventory && p.inventory.armor; return a ? a.filter(Boolean).length : 0; }
function angleTo(dx, dz) { return Math.atan2(-dx, -dz); }
function wrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
function gaussian() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }

/** Purrling coats: [fur, ears and tail] (ginger, tabby grey, black, white, calico-ish brown, siamese cream). */
const CAT_COATS = [['#c8883a', '#a86a2a'], ['#8a8a86', '#5a5a56'], ['#2a2626', '#141212'], ['#ecebe6', '#c8c6c0'], ['#8a6040', '#3a2a1e'], ['#e8dcc0', '#5a4636']];

/** Blocks that knock a horn off a charging Cragbuck. */
const HORN_BREAKERS = new Set([B.STONE, B.COBBLESTONE, B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.JUNGLE_LOG, B.ACACIA_LOG, B.DARK_OAK_LOG, B.BLOSSOM_LOG, B.MANGROVE_LOG, B.COAL_ORE, B.IRON_ORE, B.GOLD_ORE, B.DIAMOND_ORE, B.ICE, B.GRANITE].filter((id) => id !== undefined));

const HIVES = new Set([B.BEE_NEST, B.BEEHIVE]);
const BEE_FLOWERS = new Set([B.SUNPETAL, B.REDBLOOM, B.SKYBELL, B.ROSETTE]);

/** Gillnewt colours: [body, gills and crest] (pink, wild brown, gold, cyan; the blue one is rare). */
export const NEWT_COLORS = [['#f0a8c0', '#d0406a'], ['#7a5a3a', '#4a3020'], ['#e8c040', '#c88a20'], ['#d8f0f4', '#e870a0'], ['#4a5ad8', '#2a3aa8']];
/** Croaker colours: [skin, legs and eyes] (amber, pearl, moss) and the Croaklight each leaves. */
export const CROAKER_COLORS = [['#d89a4a', '#b87a30'], ['#e8dcd0', '#c8b0a0'], ['#6a9a4a', '#4a7a30']];
/** Squawklet plumage: [body and head, wings and tail, crest] (red, blue, green, cyan, grey). */
const PARROT_COLORS = [['#d8282a', '#2a5ad8', '#f0c020'], ['#2a4ad8', '#1a2a8a', '#f0d040'], ['#4ab82a', '#2a7a1a', '#d83a2a'], ['#3ac8d8', '#f0d040', '#2a6ad8'], ['#b8b8b8', '#7a7a7a', '#e8e8e8']];

export class Mob {
  constructor(type, x, y, z) {
    this.id = nextMobId++;
    this.kind = 'mob';
    this.type = type;
    this.def = MOBS[type];
    this.body = new Body(this.def.width, this.def.height);
    this.body.setPos(x, y, z);
    this.health = this.def.health;
    this.yaw = Math.random() * TAU;
    this.prevYaw = this.yaw;
    this.headPitch = 0;
    this.prev = [x, y, z];
    this.hurtTime = 0; this.invulnerable = 0; this.lastHurt = 0;
    this.deathTime = 0; this.removed = false; this.dead = false;
    this.fireTicks = 0; this.air = 300; this.noActionTime = 0;
    this.target = null; this.path = null; this.pathTimer = 0; this.pathGoal = null;
    this.wander = null; this.panicTicks = 0; this.attackCooldown = 0;
    this.fuse = 0; this.prevFuse = 0; this.angry = false; this.stare = 0; this.seeTime = 0; this.bowCharge = 0;
    this.limbSwing = 0; this.limbAmount = 0;
    this.lastHurtByPlayer = 0;
    this.effects = {};          // status effects from splash elixirs (see player/effects.js)
    this.persistent = this.def.category === CATEGORY.CREATURE;
    this.eggTime = 6000 + Math.floor(Math.random() * 6000);
    this.move = null;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    // breeding: age < 0 is a baby growing up, age > 0 a breeding cooldown
    this.age = 0; this.loveTicks = 0; this.breedTime = 0;
    this.sheared = false; this.eatTimer = 0;
    this.woolColor = type === 'fleecer' ? randomSheepColor() : type === 'purrling' ? Math.floor(Math.random() * CAT_COATS.length) : type === 'squawklet' ? Math.floor(Math.random() * PARROT_COLORS.length) : type === 'gillnewt' ? (Math.random() < 1 / 120 ? 4 : Math.floor(Math.random() * 4)) : 0; // (Purrlings keep their coat here)
    // settlers: profession, trade offers and the house they live in
    this.profession = null; this.trades = []; this.home = null; this.lastRestock = 0;
    // Howlers: tamed by the player (owner), sitting, current enemy
    this.tamed = false; this.sitting = false; this.enemy = null;
    // Gallopers: coat colour, temper (rises with every failed ride), saddle
    if (type === 'galloper') { this.coat = Math.floor(Math.random() * 5); this.temper = 0; this.saddled = false; this.health = 15 + Math.floor(Math.random() * 16); this.maxHp = this.health; this.jumpPower = 0.5 + Math.random() * 0.2; this.seatY = 0.85; }
    // Wobblers (slimes) come in three sizes
    if (type === 'wobbler') this.setSize([1, 2, 4][Math.floor(Math.random() * 3)]);
  }

  setSize(n) {
    this.size = n;
    this.body.width = this.def.width * n; this.body.height = this.def.height * n;
    this.health = n * n;
    this.jumpDelay = 10 + Math.floor(Math.random() * 20);
    this.squish = 0;
  }

  get maxHealth() { return this.maxHp || (this.tamed ? this.def.tamedHealth : this.def.health); }

  tame(g) {
    this.tamed = true; this.sitting = true; this.enemy = null; this.target = null; this.path = null; this.wander = null;
    if (g.player && g.player.netName) this.ownerName = g.player.netName; // multiplayer: it follows this player
    this.health = this.def.tamedHealth;
    this.persistent = true;
    this.hearts(g, 7);
    if (g.milestones) g.milestones.event('tame');
  }

  get baby() { return this.age < 0; }

  setBaby(on) {
    this.age = on ? -24000 : 0;
    const k = on ? 0.5 : 1;
    this.body.width = this.def.width * k; this.body.height = this.def.height * k;
  }

  /** State kept when the mob is saved with its chunk. */
  saveData() { return { type: this.type, x: this.x, y: this.y, z: this.z, health: this.health, yaw: this.yaw, age: this.age, sheared: this.sheared, woolColor: this.woolColor, profession: this.profession, trades: this.trades, home: this.home, lastRestock: this.lastRestock, size: this.size, coat: this.coat, temper: this.temper, saddled: this.saddled, maxHp: this.maxHp, playerMade: this.playerMade, tamed: this.tamed, sitting: this.sitting, ownerName: this.ownerName, horns: this.horns, hive: this.hive, nectar: this.nectar, beach: this.beach, pregnant: this.pregnant }; }
  loadData(s) {
    this.health = s.health; this.yaw = s.yaw;
    if (s.age < 0) { this.setBaby(true); this.age = s.age; } else { if (this.age < 0) this.setBaby(false); this.age = s.age || 0; }
    this.sheared = !!s.sheared;
    if (s.woolColor !== undefined) this.woolColor = s.woolColor;
    if (s.horns !== undefined) this.horns = s.horns;
    if (s.hive) { this.hive = s.hive; this.nectar = !!s.nectar; }
    if (s.beach) { this.beach = s.beach; this.pregnant = !!s.pregnant; }
    if (s.playerMade) this.playerMade = true;
    if (s.size) { this.setSize(s.size); this.health = s.health; }
    if (this.type === 'galloper') { if (s.coat !== undefined) this.coat = s.coat; this.temper = s.temper || 0; this.saddled = !!s.saddled; if (s.maxHp) this.maxHp = s.maxHp; }
    if (s.tamed) { this.tamed = true; this.sitting = !!s.sitting; if (s.ownerName) this.ownerName = s.ownerName; }
    if (s.profession) { this.profession = s.profession; this.trades = s.trades || []; this.home = s.home || null; this.lastRestock = s.lastRestock || 0; }
  }

  /** Settlers flee Shamblers, keep near their house (inside it at night), restock, and watch nearby players. */
  settlerAI(g, p, pdist) {
    if (this.age < 0) { if (++this.age === 0) { this.setBaby(false); this.growUp(g); } }
    else if (this.age > 0) this.age--;
    // now and then two adults by day make a child, if the village has a free bed
    if (this.age === 0 && this.home && g.ticks % 200 === this.id % 200 && Math.random() < 0.05 && g.sky.state.aboveCount > 0) this.trySettlerBreed(g);
    if (g.time - this.lastRestock > RESTOCK_TICKS) { this.lastRestock = g.time; for (const o of this.trades) o.uses = 0; }
    if (this.panicTicks > 0) return this.passiveAI(g);
    // flee from Shamblers within 8 blocks
    for (const e of g.entities.list) {
      if (e.kind !== 'mob' || !e.def.shamblerKin || e.dead) continue;
      const dx = this.x - e.x, dz = this.z - e.z;
      if (dx * dx + dz * dz < 64) { this.steer(this.x + dx * 4, this.z + dz * 4, this.def.panicSpeed); return; }
    }
    const h = this.home;
    const night = g.sky.state.aboveCount === 0;
    if (h) {
      const dh = Math.hypot(h.x - this.x, h.z - this.z);
      if (dh > (night ? 1.5 : 24)) {
        if (!this.path || g.ticks % 40 === 0) this.pathTo(g, Math.floor(h.x), Math.floor(h.y), Math.floor(h.z));
        if (!this.followPath(g, 1)) this.steer(h.x, h.z, 1);
        return;
      }
      if (night) return;
    }
    if (pdist < 4 && !p.dead) {
      this.yaw = Math.atan2(-(p.x - this.x), -(p.z - this.z));
      this.headPitch = Math.atan2(p.y + p.eyeHeight - this.eyeY, Math.max(0.5, pdist)) * 0.8;
      return;
    }
    this.headPitch = 0;
    this.wanderAI(g, 0.8);
  }

  trySettlerBreed(g) {
    const mate = g.entities.list.find((e) => e !== this && e.def && e.def.villager && !e.dead && e.age === 0 && Math.hypot(e.x - this.x, e.z - this.z) < 8);
    if (!mate) return;
    const vs = villagesNear(g.world.gen, this.x, this.z, this.x, this.z);
    if (!vs.length) return;
    const beds = vs[0].pieces.filter((pc) => pc.type === 'house').length;
    const settlers = g.entities.list.filter((e) => e.def && e.def.villager && !e.dead && Math.hypot(e.x - vs[0].cx, e.z - vs[0].cz) < 64).length;
    if (settlers >= beds) return;
    const baby = g.spawner.spawnMob('settler', (this.x + mate.x) / 2, this.y, (this.z + mate.z) / 2);
    if (!baby) return;
    baby.setBaby(true);
    baby.home = this.home;
    this.age = mate.age = 6000;
    this.hearts(g, 6);
  }

  /** A settler child takes up a trade when it grows up. */
  growUp(g) {
    if (!this.def.villager || this.profession) return;
    this.profession = PROFESSIONS[Math.floor(Math.random() * PROFESSIONS.length)];
    this.trades = makeTrades(this.profession);
    this.lastRestock = g.time;
  }

  /** Fed its breeding food: babies grow 10 % faster, adults fall in love. */
  feed(g) {
    if (this.age < 0) { this.age += Math.floor(-this.age * 0.1); this.hearts(g, 2, true); return true; }
    if (this.age === 0 && this.loveTicks === 0) { this.loveTicks = 600; this.hearts(g, 7); return true; }
    return false;
  }

  hearts(g, n, green = false) {
    for (let k = 0; k < n; k++) {
      g.particles.emit(this.x + (Math.random() - 0.5) * this.width, this.y + this.height + Math.random() * 0.4, this.z + (Math.random() - 0.5) * this.width,
        (Math.random() - 0.5) * 0.02, 0.02, (Math.random() - 0.5) * 0.02, green ? 0.3 : 1, green ? 1 : 0.15, green ? 0.3 : 0.3, 20, -0.002);
    }
  }

  /** Nearest adult of the same kind that is also in love, within 8 blocks. */
  findMate(g) {
    let best = null, bd = 64;
    for (const e of g.entities.list) {
      if (e === this || e.kind !== 'mob' || e.type !== this.type || e.loveTicks <= 0 || e.age !== 0 || e.deathTime > 0) continue;
      const d2 = (e.x - this.x) ** 2 + (e.y - this.y) ** 2 + (e.z - this.z) ** 2;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }

  breed(g, mate) {
    if (this.def.turtle) {
      // Shellbacks carry eggs back to their home beach instead
      for (const m of [this, mate]) { m.loveTicks = 0; m.age = 6000; m.breedTime = 0; }
      this.pregnant = true; this.hearts(g, 7);
      g.entities.spawnXp(this.x, this.y + 0.5, this.z, 1 + Math.floor(Math.random() * 7));
      if (g.milestones) g.milestones.event('breed');
      return;
    }
    const baby = g.spawner.spawnMob(this.type, (this.x + mate.x) / 2, Math.max(this.y, mate.y), (this.z + mate.z) / 2);
    baby.setBaby(true);
    baby.woolColor = Math.random() < 0.5 ? this.woolColor : mate.woolColor; // (the reference blends dye colours)
    baby.yaw = this.yaw;
    if (this.tamed) { baby.tamed = true; baby.health = baby.def.tamedHealth; baby.persistent = true; } // pups of tame Howlers are tame
    for (const m of [this, mate]) { m.loveTicks = 0; m.age = 6000; m.breedTime = 0; }
    this.hearts(g, 7);
    g.entities.spawnXp(this.x, this.y + 0.5, this.z, 1 + Math.floor(Math.random() * 7));
    if (g.milestones) g.milestones.event('breed');
  }

  /** Is the player holding this animal's food within 10 blocks? */
  tempted(g) {
    const p = g.player, st = p.inventory.selectedStack;
    if (p.dead || !st || !this.def.food || !this.def.food.includes(st.id)) return false;
    return (p.x - this.x) ** 2 + (p.y - this.y) ** 2 + (p.z - this.z) ** 2 < 100;
  }

  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }
  get width() { return this.body.width; } get height() { return this.body.height; }
  get eyeY() { return this.body.y + this.height * 0.85; }

  hurt(dmg, source, attacker = null, knockback = 0.4, projectile = null) {
    if (this.deathTime > 0 || this.removed) return false;
    if ((this.def.fireImmune || this.effects.fire_resistance) && (source === 'fire' || source === 'lava' || source === 'fireball')) return false;
    if (this.def.onHurt) { dmg = this.def.onHurt(this, dmg, source, attacker); if (dmg <= 0) return false; }
    if (this.type === 'voidwalker' && projectile) {
      // Voidwalkers dodge projectiles by teleporting
      this.teleportRandom(this._game);
      return false;
    }
    if (this.def.armor) {
      const a = this.def.armor;
      dmg *= 1 - Math.min(20, Math.max(a / 5, a - dmg / 2)) / 25;
    }
    if (this.invulnerable > 10) {
      if (dmg <= this.lastHurt) return false;
      const extra = dmg - this.lastHurt; this.lastHurt = dmg; dmg = extra;
    } else { this.lastHurt = dmg; this.invulnerable = 20; this.hurtTime = 10; }
    this.health -= dmg;
    this.noActionTime = 0;
    this.lastSource = source;
    if (attacker && (attacker.isPlayer || attacker.tamed)) this.lastHurtByPlayer = 100;
    if (attacker && knockback > 0) {
      const dx = this.x - attacker.x, dz = this.z - attacker.z;
      const d = Math.hypot(dx, dz) || 1;
      const b = this.body;
      b.vx = b.vx / 2 + (dx / d) * knockback;
      b.vz = b.vz / 2 + (dz / d) * knockback;
      if (b.onGround) b.vy = Math.min(0.4, b.vy / 2 + knockback);
    }
    const g = this._game;
    if (this.def.villager && attacker && attacker.isPlayer && g) {
      // hurting a Settler angers the village's Ironguards
      for (const e of g.entities.list) if (e.def && e.def.guard && !e.dead && Math.hypot(e.x - this.x, e.z - this.z) < 32) { e.lastSettlerAttacker = 'player'; e.enemy = 'player'; }
    }
    if (this.def.guard) {
      // Ironguards shrug off knockback and go after whoever hit them (players they made, never)
      this.body.vx *= 0.2; this.body.vz *= 0.2;
      if (attacker && attacker !== this && !(attacker.isPlayer && this.playerMade)) this.enemy = attacker.isPlayer ? 'player' : attacker;
    } else if (this.def.neutralBeast) {
      // Frostbears fight back, and the others nearby join in
      const foe = attacker && attacker.isPlayer ? 'player' : attacker;
      if (foe && attacker !== this && g) for (const e of g.entities.list) if (e.type === this.type && !e.dead && Math.hypot(e.x - this.x, e.z - this.z) < 16) e.enemy = foe;
    } else if (this.def.aquatic) {
      // a squirt of ink and a dash away
      if (g) for (let k = 0; k < 20; k++) g.particles.emit(this.x, this.y + 0.4, this.z, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 0.05, 0.05, 0.08, 40, 0);
      this.panicTicks = 40;
      if (attacker) { const dx = this.x - attacker.x, dz = this.z - attacker.z, d = Math.hypot(dx, dz) || 1; this.swimDir = [dx / d, 0.2, dz / d]; }
    } else if (this.def.newt) {
      // a hurt Gillnewt may play dead for a while (hunters lose interest) and goes after what hit it, unless that was a player
      if (this.health > 0 && this.health <= 8 && !this.playDead && Math.random() < 0.33) this.playDead = 200;
      if (attacker && !attacker.isPlayer && attacker !== this) this.enemy = this.grudge = attacker;
    } else if (this.def.parrot) {
      this.sitting = false; this.perched = 0; this.panicTicks = 60;
    } else if (this.def.bee) {
      // one stung bee calls the others nearby
      const foe = attacker && attacker.isPlayer ? 'player' : attacker;
      if (foe && foe !== this && g && !this.stung) Mob.angerBees(g, this.x, this.y, this.z, foe);
    } else if (this.def.feline) {
      this.sitting = false; this.panicTicks = 60 + Math.floor(Math.random() * 40);
    } else if (this.def.tameable) {
      // a hurt Howler stands up and fights back; a wild one calls its pack
      this.sitting = false;
      const foe = attacker && attacker.isPlayer ? (this.tamed ? null : 'player') : attacker;
      if (foe && attacker !== this) {
        this.enemy = foe;
        if (!this.tamed && g) for (const e of g.entities.list) if (e !== this && e.type === this.type && !e.tamed && !e.dead && Math.hypot(e.x - this.x, e.z - this.z) < 16) e.enemy = foe;
      }
    } else if (this.def.category === CATEGORY.CREATURE) this.panicTicks = 60 + Math.floor(Math.random() * 40);
    else if (attacker && attacker.isPlayer) { this.target = 'player'; if (this.type === 'voidwalker') this.angry = true; }
    if (g) g.audio.play(this.health <= 0 ? 'mob_death' : 'mob_hurt', [this.x, this.y + 1, this.z]);
    if (this.health <= 0) this.die(g, source);
    return true;
  }

  die(g, source) {
    if (this.deathTime > 0) return;
    this.deathTime = 1;
    this.health = 0;
    if (this.type === 'wobbler' && this.size > 1 && g && (!g.net || g.net.isHost)) {
      // splits into 2-4 Wobblers of half the size
      const n = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const c = g.spawner.spawnMob('wobbler', this.x + (Math.random() - 0.5) * this.size * 0.5, this.y + 0.3, this.z + (Math.random() - 0.5) * this.size * 0.5);
        if (c) { c.setSize(this.size / 2); c.yaw = Math.random() * Math.PI * 2; }
      }
      if (this.lastHurtByPlayer > 0) g.player.stats.kills++;
      return; // only the smallest drop slimeballs
    }
    if (!g) return;
    const killedByPlayer = this.lastHurtByPlayer > 0;
    this.killedByPlayer = killedByPlayer;
    if (killedByPlayer) g.player.stats.kills++;
    if (killedByPlayer && this.def.category === CATEGORY.MONSTER && g.milestones) g.milestones.event('kill');
    if (this.def.onDeath) this.def.onDeath(this, g, killedByPlayer);
    if (this.age < 0 && this.def.category !== CATEGORY.MONSTER) { this.killedByPlayer = false; return; } // baby animals drop nothing
    const plunder = source === 'player' ? this.plunder | 0 : 0; // set by the player's melee hit
    for (const d of rollDrops(this.type, { killedByPlayer, onFire: this.fireTicks > 0, sheared: this.sheared, plunder })) {
      if (d.id === B.WOOL) d.id = WOOL_ITEMS[this.woolColor || 0];
      g.entities.spawnItem(this.x, this.y + 0.5, this.z, d);
    }
  }

  canSee(g, tx, ty, tz) {
    const ex = this.x, ey = this.eyeY, ez = this.z;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const hit = g.world.raycast(ex, ey, ez, dx / d, dy / d, dz / d, d);
    return !hit || hit.dist >= d - 0.1;
  }

  /** Steer towards a point. */
  steer(tx, tz, speedMod, ty = null) {
    const dx = tx - this.x, dz = tz - this.z;
    const want = angleTo(dx, dz);
    this.yaw += Math.max(-0.5, Math.min(0.5, wrap(want - this.yaw)));
    const sp = this.speed() * speedMod;
    let jump = false;
    if (this.body.horizontalCollision && this.body.onGround) jump = true;
    if (ty !== null && ty > this.y + 0.5 && Math.hypot(dx, dz) < 1.5) jump = true;
    this.move = { forward: sp, jump, mod: speedMod };
  }

  speed() {
    let s = this.def.speed;
    if (this.type === 'voidwalker' && this.angry) s += 0.15;
    if (this.age < 0 && this.def.babyChance) s *= 1.5; // baby Shamblers are half again as fast
    return s * speedFactor(this.effects);
  }

  /** Undead mobs are hurt by Instant Health, healed by Instant Damage and ignore poison / regeneration. */
  get undead() { return !!(this.def.undead || this.def.burnsInSun); }

  /** An elixir effect (from a splash) on this mob; factor scales it by the distance from the splash. */
  applyEffect(type, ticks, amp = 0, factor = 1, attacker = null) {
    if (this.deathTime > 0 || !EFFECTS[type]) return;
    if (EFFECTS[type].instant) {
      const n = instantAmount(type, amp, factor);
      const heals = (type === 'instant_health') !== this.undead;
      if (heals) this.health = Math.min(this.maxHealth, this.health + n);
      else if (n > 0) { this.invulnerable = 0; this.hurt(n, 'magic', attacker, 0); }
      return;
    }
    if (this.undead && (type === 'poison' || type === 'regeneration')) return;
    const t = Math.floor(ticks * factor + 0.5);
    if (t > 20) addEffect(this.effects, type, t, amp);
  }

  tickEffects(g) {
    for (const a of periodicActions(this.effects, { health: this.health, undead: this.undead })) {
      if (a.type === 'heal') this.health = Math.min(this.maxHealth, this.health + a.amount);
      else { this.invulnerable = Math.min(this.invulnerable, 10); this.hurt(a.amount, a.source, null, 0); }
    }
    tickEffects(this.effects);
    if (g.ticks % 3 === 0 && g.particles) {
      const col = effectsColor(Object.entries(this.effects).map(([k, e]) => [k, e.amp]));
      if (col) g.particles.emit(this.x + (Math.random() - 0.5) * this.width, this.y + Math.random() * this.height, this.z + (Math.random() - 0.5) * this.width, 0, 0.03, 0, col[0], col[1], col[2], 18, -0.001);
    }
  }

  followPath(g, speedMod) {
    if (!this.path || !this.path.length) return false;
    const [wx, wy, wz] = this.path[0];
    const cx = wx + 0.5, cz = wz + 0.5;
    const dx = cx - this.x, dz = cz - this.z;
    if (dx * dx + dz * dz < 0.35 * 0.35 + (this.width > 1 ? 0.3 : 0) && Math.abs(this.y - wy) < 1.5) {
      this.path.shift();
      if (!this.path.length) return false;
    }
    const [nx, ny, nz] = this.path[0];
    this.steer(nx + 0.5, nz + 0.5, speedMod, ny);
    return true;
  }

  pathTo(g, tx, ty, tz) {
    this.path = findPath(g.world, Math.floor(this.x), Math.floor(this.y + 0.01), Math.floor(this.z),
      Math.floor(tx), Math.floor(ty), Math.floor(tz), { height: this.height, maxNodes: 250, climbs: this.def.climbs });
    this.pathGoal = [tx, ty, tz];
  }

  tick(g) {
    this._game = g;
    const b = this.body;
    this.prev = [b.x, b.y, b.z];
    this.prevYaw = this.yaw;
    this.prevFuse = this.fuse;
    if (this.deathTime > 0) {
      this.deathTime++;
      b.vx *= 0.5; b.vz *= 0.5; b.vy -= 0.08;
      b.move(g.world, b.vx, b.vy, b.vz);
      if (this.deathTime >= 20) {
        this.removed = true; this.dead = true;
        // experience when killed by the player: monsters 5, animals 1-3
        if (this.killedByPlayer) g.entities.spawnXp(this.x, this.y + 0.3, this.z, this.def.xp || (this.def.category === 'monster' ? (this.age < 0 ? 12 : 5) : 1 + Math.floor(Math.random() * 3)));
        g.particles.smoke(this.x, this.y + this.height / 2, this.z, 14, this.width);
      }
      return;
    }
    if (this.invulnerable > 0) this.invulnerable--;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.lastHurtByPlayer > 0) this.lastHurtByPlayer--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.swingTime > 0) this.swingTime--;
    this.noActionTime++;
    for (const _ in this.effects) { this.tickEffects(g); break; }
    if (this.deathTime > 0) return;

    const p = g.player;
    const pdx = p.x - this.x, pdy = p.y - this.y, pdz = p.z - this.z;
    const pdist = Math.hypot(pdx, pdy, pdz);
    if (!this.persistent && !this.def.noDespawn) {
      if (pdist < 32) this.noActionTime = 0;
      if (shouldDespawn(pdist, this.noActionTime)) { this.removed = true; this.dead = true; return; }
    }

    b.updateFluidState(g.world, this.height * 0.85);
    this.move = null;
    if (this.rider && this.def.rideable) this.riddenAI(g);
    else this.ai(g, p, pdist);

    const mv = this.move || { forward: 0, jump: false };
    const jump = mv.jump || (this.def.hops && mv.forward && b.onGround) || (b.inWater && !this.def.sinks && b.y + this.height * 0.4 < Math.floor(b.y) + 1.2) || (b.inLava);
    if (this.def.flying) this.flyMove(g);
    else b.travel(g.world, { forward: mv.forward, strafe: mv.strafe || 0, yaw: this.yaw, jump, speed: mv.forward ? this.speed() * (mv.mod || 1) : this.speed(), climbing: this.def.climbs && b.horizontalCollision && !!this.move, levitation: this.effects.levitation ? this.effects.levitation.amp + 1 : 0 });
    if (this.type === 'cluckling' && !b.onGround && b.vy < 0) { b.vy *= 0.6; b.fallDistance = 0; }

    // Limb animation
    const moved = Math.hypot(b.x - this.prev[0], b.z - this.prev[2]);
    this.limbAmount += (Math.min(1, moved * 4) - this.limbAmount) * 0.4;
    this.limbSwing += moved * 4;

    this.environment(g);
    // Shamblers kept under water turn into Sodden Shamblers (Dune Shamblers into Shamblers)
    if (this.def.convertsTo && this.deathTime === 0 && !this.removed) {
      if (!this.conv) this.conv = newConversion();
      if (conversionStep(this.conv, b.eyeInWater)) this.convert(g, this.def.convertsTo);
      else this.special = this.conv.converting;
    }
  }

  /** Replace this mob by a fresh one of `type` (full health), keeping its place, age and persistence. */
  convert(g, type) {
    const m = g.spawner.spawnMob(type, this.x, this.y, this.z);
    if (!m) return null;
    m.setBaby(this.age < 0);
    m.yaw = m.prevYaw = this.yaw;
    m.persistent = this.persistent;
    m.target = this.target;
    this.removed = true; this.dead = true;
    g.audio.play('grunt', [this.x, this.y + 1, this.z]);
    return m;
  }

  /** Flying mobs: no gravity, velocity set by their AI, air drag (noclip ones ignore blocks). */
  flyMove(g) {
    const b = this.body;
    if (this.def.noclip) b.setPos(b.x + b.vx, b.y + b.vy, b.z + b.vz);
    else b.move(g.world, b.vx, b.vy, b.vz);
    const drag = this.def.noclip ? 1 : 0.91;
    b.vx *= drag; b.vy *= drag; b.vz *= drag;
    b.fallDistance = 0;
  }

  environment(g) {
    const b = this.body, w = g.world;
    if (this.def.fireImmune) { this.fireTicks = 0; if (b.inLava) b.vy = Math.max(b.vy, 0.06); }
    if (b.onGround) {
      if (b.fallDistance > 0 && !this.def.noFallDamage) {
        const dmg = isStalagmiteTip(w, Math.floor(b.x), Math.floor(b.y - 0.01), Math.floor(b.z)) ? stalagmiteFallDamage(b.fallDistance) : fallDamage(b.fallDistance);
        if (dmg > 0) this.hurt(dmg, 'fall');
      }
      b.fallDistance = 0;
    }
    if (b.inWater) { b.fallDistance = 0; this.fireTicks = 0; }
    if (b.inLava && !this.def.fireImmune) { this.fireTicks = Math.max(this.fireTicks, 300); this.hurt(4, 'lava'); }
    if (b.inFire && !b.inWater && !this.def.fireImmune) { this.fireTicks = Math.max(this.fireTicks, 160); this.hurt(1, 'fire'); }
    // Undead burn in combined sunlight from the three suns
    if (this.def.burnsInSun && g.ticks % 2 === 0) {
      const st = g.sky.state;
      const bx = Math.floor(this.x), by = Math.floor(this.eyeY), bz = Math.floor(this.z);
      const raw = w.skyLight(bx, by, bz), blk = w.blockLight(bx, by, bz);
      const effective = Math.max(raw - st.skyDarken, blk);
      const inRain = g.weather && g.weather.rainingAt(w, this.x, this.y + this.height, this.z);
      if (inRain) this.fireTicks = 0;
      if (!inRain && shouldBurnInSun({ sunlit: st.sunlit, effectiveLevel: effective, canSeeSky: raw === 15 && w.heightAt(bx, bz) < by, inWater: b.inWater })) {
        this.fireTicks = Math.max(this.fireTicks, 160);
      }
    }
    // Daybreak: monsters out in the open (enough sky light, also in the shade of trees) fade away in a puff
    // of smoke within a few seconds once it is broad daylight; cave monsters and structure guards stay.
    if (this.def.category === CATEGORY.MONSTER && !this.persistent && this.deathTime === 0 && g.ticks % 10 === this.id % 10
      && (!w.dimension || w.dimension === 'overworld') && !this.def.aquatic && !this.def.breathesWater && g.sky.state.combined >= 0.6
      && w.skyLight(Math.floor(this.x), Math.floor(this.eyeY), Math.floor(this.z)) >= 10 && Math.random() < 0.15) {
      g.particles.smoke(this.x, this.y + this.height / 2, this.z, 14, Math.max(0.5, this.width));
      g.audio.play('fizz', [this.x, this.y + 0.5, this.z], 0.4);
      this.removed = true; this.dead = true;
      return;
    }
    if (this.fireTicks > 0) {
      if (this.fireTicks % 20 === 0) this.hurt(1, 'fire');
      this.fireTicks--;
      if (Math.random() < 0.3) g.particles.flame(this.x + (Math.random() - 0.5) * this.width, this.y + Math.random() * this.height, this.z + (Math.random() - 0.5) * this.width);
    }
    if (b.eyeInWater && this.type !== 'voidwalker' && !this.def.aquatic && !this.def.breathesWater && !this.undead && !this.effects.water_breathing) {
      if (--this.air <= -20) { this.air = 0; this.hurt(2, 'drown'); }
    } else this.air = 300;
    if (this.type === 'voidwalker' && b.inWater) {
      this.hurt(1, 'water');
      this.teleportRandom(g);
    }
    if (b.y < -128) { this.removed = true; this.dead = true; }
    // ambient sounds
    if (Math.random() < 1 / 160) g.audio.play(this.def.sound, [this.x, this.y + 1, this.z], 0.7);
  }

  // ---------------------------------------------------------------------------
  ai(g, p, pdist) {
    if (this.def.villager) return this.settlerAI(g, p, pdist);
    if (this.def.parrot) return this.parrotAI(g, p, pdist);
    if (this.def.feline) return this.catAI(g, p, pdist);
    if (this.def.goat) return this.goatAI(g, p, pdist);
    if (this.def.turtle) return this.turtleAI(g, p, pdist);
    if (this.def.tameable) return this.howlerAI(g, p, pdist);
    if (this.def.neutralBeast) return this.bearAI(g, p, pdist);
    if (this.def.fox) return this.foxAI(g, p, pdist);
    if (this.def.newt) return this.newtAI(g, p, pdist);
    if (this.def.frog) return this.croakerAI(g, p, pdist);
    if (this.def.dolphin) return this.dolphinAI(g, p, pdist);
    if (this.def.fish) return this.fishAI(g, p, pdist);
    if (this.def.aquatic) return this.inklingAI(g);
    if (this.type === 'flitter') return this.flitterAI(g, p, pdist);
    if (this.def.bee) return this.beeAI(g, p, pdist);
    if (this.def.snowGolem) return this.frostlingAI(g, p, pdist);
    if (this.def.guard) return this.guardAI(g, p, pdist);
    if (this.def.category === CATEGORY.CREATURE) return this.passiveAI(g);
    if (this.def.customAI) return this.def.customAI(this, g, p, pdist); // Cinderdeep / Hollow mobs (dimensionMobs.js)
    switch (this.type) {
      case 'shambler': return this.meleeAI(g, p, pdist);
      case 'skitterer': return this.spiderAI(g, p, pdist);
      case 'rattler': case 'marauder': return this.rangedAI(g, p, pdist);
      case 'fizzler': return this.fizzlerAI(g, p, pdist);
      case 'voidwalker': return this.voidwalkerAI(g, p, pdist);
      case 'wobbler': return this.wobblerAI(g, p, pdist);
    }
  }

  wanderAI(g, mod = 1) {
    if (!this.wander && Math.random() < 1 / 120) {
      const tx = Math.floor(this.x + (Math.random() - 0.5) * 20), tz = Math.floor(this.z + (Math.random() - 0.5) * 20);
      let ty = Math.floor(this.y) + 3;
      while (ty > this.y - 5 && !SOLID[g.world.getBlock(tx, ty - 1, tz)]) ty--;
      if (g.world.getBlock(tx, ty, tz) !== B.WATER && !SOLID[g.world.getBlock(tx, ty, tz)]) {
        this.wander = { x: tx + 0.5, y: ty, z: tz + 0.5, t: 200 };
        this.pathTo(g, tx, ty, tz);
      }
    }
    if (this.wander) {
      if (--this.wander.t <= 0 || !this.followPath(g, mod)) { this.wander = null; this.path = null; }
    }
    if (!this.move && Math.random() < 0.02) this.yaw += (Math.random() - 0.5) * 1.2;
  }

  passiveAI(g) {
    if (this.panicTicks > 0) {
      this.panicTicks--;
      if (!this.wander || Math.random() < 0.05) {
        const a = Math.random() * TAU;
        this.wander = { x: this.x + Math.sin(a) * 8, y: this.y, z: this.z + Math.cos(a) * 8, t: 40 };
        this.path = null;
      }
      this.steer(this.wander.x, this.wander.z, this.def.panicSpeed);
      if (this.panicTicks === 0) this.wander = null;
      return;
    }
    if (this.age < 0) { if (++this.age === 0) this.setBaby(false); } else if (this.age > 0) this.age--;
    // breeding: walk to the partner, a baby after 3 s close together
    if (this.loveTicks > 0) {
      this.loveTicks--;
      if (g.ticks % 10 === 0) this.hearts(g, 1);
      const mate = this.findMate(g);
      if (mate) {
        const d = Math.hypot(mate.x - this.x, mate.z - this.z);
        this.yaw = Math.atan2(-(mate.x - this.x), -(mate.z - this.z));
        if (d > 1.2) this.steer(mate.x, mate.z, 1);
        if (d < 3 && ++this.breedTime >= 60 && this.id < mate.id) this.breed(g, mate);
        return;
      }
    }
    // follow a player holding food
    if (this.tempted(g)) {
      const p = g.player, d = Math.hypot(p.x - this.x, p.z - this.z);
      this.yaw = Math.atan2(-(p.x - this.x), -(p.z - this.z));
      this.headPitch = -0.3;
      if (d > 2.5) this.steer(p.x, p.z, 1.1);
      this.wander = null; this.path = null;
      return;
    }
    this.headPitch = 0;
    // sheep graze: grass under them turns to dirt and their wool grows back
    if (this.type === 'fleecer') {
      if (this.eatTimer > 0) {
        this.headPitch = 1.0;
        if (--this.eatTimer === 0) this.graze(g);
        return;
      }
      if (Math.random() < (this.baby ? 1 / 50 : 1 / 1000)) {
        const bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
        const w = g.world;
        if (w.getBlock(bx, by, bz) === B.TALL_GRASS || w.getBlock(bx, by - 1, bz) === B.GRASS) { this.eatTimer = 40; this.wander = null; this.path = null; return; }
      }
    }
    this.wanderAI(g, 1);
    if (this.type === 'cluckling' && --this.eggTime <= 0) {
      g.entities.spawnItem(this.x, this.y + 0.3, this.z, { id: I.EGG, count: 1 });
      this.eggTime = 6000 + Math.floor(Math.random() * 6000);
    }
  }

  /** Howlers: wild packs roam and hunt Fleecers/Clucklings; tamed ones sit, follow and defend their owner. */
  howlerAI(g, p, pdist) {
    if (this.age < 0) { if (++this.age === 0) this.setBaby(false); } else if (this.age > 0) this.age--;
    const alive = (e) => e && (e === 'player' ? !p.dead && !p.creative && pdist < 24 : !e.dead && e.deathTime === 0 && Math.hypot(e.x - this.x, e.z - this.z) < 24);
    if (this.enemy && !alive(this.enemy)) this.enemy = null;
    this.headPitch = 0;
    if (this.tamed) {
      // help the owner: attack whatever hurt them or whatever they hit (not Fizzlers, not other pets)
      for (const e of [p.lastHurtBy, p.lastAttacked]) {
        if (!this.enemy && e && e !== this && !e.tamed && e.type !== 'fizzler' && alive(e)) this.enemy = e;
      }
      p.lastHurtBy = p.lastHurtBy && alive(p.lastHurtBy) ? p.lastHurtBy : null;
      if (this.sitting) { this.enemy = null; this.move = null; this.headPitch = pdist < 8 ? -0.2 : 0; return; }
    }
    const foe = this.enemy;
    if (foe) {
      const t = foe === 'player' ? p : foe;
      this.chase(g, t, 1.2);
      this.howlerBite(g, t);
      return;
    }
    if (this.loveTicks > 0) {
      this.loveTicks--;
      if (g.ticks % 10 === 0) this.hearts(g, 1);
      const mate = this.findMate(g);
      if (mate) {
        const d = Math.hypot(mate.x - this.x, mate.z - this.z);
        if (d > 1.2) this.steer(mate.x, mate.z, 1);
        if (d < 3 && ++this.breedTime >= 60 && this.id < mate.id) this.breed(g, mate);
        return;
      }
    }
    if (this.tamed && !p.dead) {
      if (pdist > 12) { if (this.teleportTo(g, p.x + (Math.random() - 0.5) * 3, p.z + (Math.random() - 0.5) * 3, p.y + 2)) return; }
      if (pdist > 6) { this.chase(g, p, 1.3); return; }
      if (this.tempted(g)) { this.yaw = Math.atan2(-(p.x - this.x), -(p.z - this.z)); this.headPitch = -0.4; return; }
      if (pdist < 2.5) { this.wander = null; this.path = null; return; }
      this.wanderAI(g, 0.8);
      return;
    }
    // wild: now and then pick a Fleecer or Cluckling to hunt
    if (g.ticks % 40 === this.id % 40 && Math.random() < 0.05) {
      for (const e of g.entities.list) {
        if (e.kind === 'mob' && (e.type === 'fleecer' || e.type === 'cluckling') && e.deathTime === 0 && Math.hypot(e.x - this.x, e.z - this.z) < 12) { this.enemy = e; break; }
      }
    }
    this.wanderAI(g, 1);
  }

  /**
   * Cragbucks leap about the peaks and now and then (every 30-300 s) ram a
   * player or another animal within 16 blocks: they lower their head, charge
   * and send the target flying. Ramming a log, stone or ore can knock off a
   * horn (each goat has two).
   */
  goatAI(g, p, pdist) {
    const b = this.body;
    if (this.ramCooldown === undefined) { this.ramCooldown = 600 + Math.floor(Math.random() * 5400); this.horns = this.horns ?? 2; }
    if (this.panicTicks > 0) { this.ram = null; return this.passiveAI(g); }
    const r = this.ram;
    if (r) {
      const t = r.target === 'player' ? p : r.target;
      if (!t || t.dead || (t.deathTime | 0) > 0 || r.ticks++ > 90 || (r.target === 'player' && (p.creative || p.dead))) { this.endRam(); return; }
      this.yaw = Math.atan2(-(t.x - this.x), -(t.z - this.z));
      if (r.ticks < 30) { this.move = null; this.headPitch = 0.5; return; } // head down, then go
      this.headPitch = 0.6;
      this.move = { forward: 1, mod: 2.6 };
      const dx = t.x - this.x, dz = t.z - this.z, d = Math.hypot(dx, dz) || 1;
      if (d < this.width / 2 + 0.8 && Math.abs(t.y - this.y) < 1.5) {
        const k = this.age < 0 ? 1 : 2.2, dmg = this.age < 0 ? 1 : 2;
        if (r.target === 'player') { p.hurt(dmg, 'mob:' + this.def.name, this); p.body.vx += (dx / d) * k * 0.6; p.body.vz += (dz / d) * k * 0.6; p.body.vy = Math.max(p.body.vy, 0.45); }
        else { t.hurt(dmg, 'mob:' + this.def.name, this, k * 0.5); }
        g.audio.play('ram', [this.x, this.y + 1, this.z]);
        this.endRam();
        return;
      }
      if (b.horizontalCollision && r.ticks > 36) {
        // straight into a wall: hard blocks may knock off a horn
        const fx = Math.floor(this.x - Math.sin(this.yaw) * (this.width / 2 + 0.3)), fz = Math.floor(this.z - Math.cos(this.yaw) * (this.width / 2 + 0.3));
        const hit = g.world.getBlock(fx, Math.floor(this.y), fz);
        if (this.horns > 0 && HORN_BREAKERS.has(hit)) {
          this.horns--;
          g.entities.spawnItem(this.x, this.y + 1, this.z, { id: I.CRAG_HORN, count: 1, damage: 0 });
        }
        g.audio.play('ram', [this.x, this.y + 1, this.z]);
        this.endRam();
      }
      return;
    }
    this.headPitch = 0;
    if (--this.ramCooldown <= 0 && b.onGround) {
      this.ramCooldown = 200;
      let target = null;
      if (!p.dead && !p.creative && !p.sneaking && pdist < 16) target = 'player';
      else for (const e of g.entities.list) {
        if (e.kind === 'mob' && e !== this && e.type !== 'cragbuck' && e.deathTime === 0 && !e.def.flying && (e.x - this.x) ** 2 + (e.z - this.z) ** 2 < 256) { target = e; break; }
      }
      if (target) { this.ram = { target, ticks: 0 }; return; }
    }
    // a big leap now and then
    if (b.onGround && this.wander && Math.random() < 0.006) {
      b.vy = 0.62; const a = this.yaw; b.vx -= Math.sin(a) * 0.35; b.vz -= Math.cos(a) * 0.35;
      if (Math.random() < 0.3) g.audio.play('bleat', [this.x, this.y + 1, this.z]);
    }
    this.passiveAI(g);
  }

  /**
   * Buzzlings fly from their nest to flowers within 22 blocks, gather nectar
   * (dusting crops they pass over) and bring it home: each delivery adds a
   * level of honey (5 = full). They stay by the nest at night and in the rain.
   * Angered ones chase their attacker and sting once (2 damage + Poison),
   * losing the sting and dying soon after.
   */
  beeAI(g, p, pdist) {
    const b = this.body, w = g.world;
    const fly = (tx, ty, tz, sp = 0.09) => {
      const dx = tx - this.x, dy = ty - this.y, dz = tz - this.z, d = Math.hypot(dx, dy, dz) || 1;
      b.vx += ((dx / d) * sp - b.vx) * 0.2; b.vy += ((dy / d) * sp - b.vy) * 0.2 + Math.sin(g.ticks * 0.3 + this.id) * 0.004; b.vz += ((dz / d) * sp - b.vz) * 0.2;
      this.yaw = Math.atan2(-dx, -dz);
      return d;
    };
    if (this.stung && --this.stung <= 0) { this.hurt(100, 'generic'); return; }
    if (this.hive && !HIVES.has(w.getBlock(this.hive.x, this.hive.y, this.hive.z))) this.hive = null;
    if (!this.hive && g.ticks % 200 === this.id % 200) {
      // a homeless bee moves into a nest or hive within 8 blocks
      const bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
      for (let y = by - 4; y <= by + 4 && !this.hive; y++) for (let z = bz - 8; z <= bz + 8 && !this.hive; z++) for (let x = bx - 8; x <= bx + 8; x++) if (HIVES.has(w.getBlock(x, y, z))) { this.hive = { x, y, z }; this.persistent = true; break; }
    }
    // angry: chase and sting
    if (this.angryTicks > 0) {
      this.angryTicks--;
      const t = this.enemy === 'player' ? p : this.enemy;
      if (!t || t.dead || (t.deathTime | 0) > 0 || (this.enemy === 'player' && (p.creative || pdist > 24))) { this.angryTicks = 0; this.enemy = null; }
      else if (!this.stung) {
        const d = fly(t.x, t.y + (t.height || 1.8) * 0.5, t.z, 0.16);
        if (d < 1.2 && this.attackCooldown <= 0) {
          this.attackCooldown = 20;
          if (this.enemy === 'player') { if (p.hurt(2, 'mob:' + this.def.name, this)) p.addEffect('poison', 200); }
          else t.hurt(2, 'mob:' + this.def.name, this, 0.3);
          this.stung = 600 + Math.floor(Math.random() * 600); this.angryTicks = 0; this.enemy = null;
        }
        return;
      }
    }
    const h = this.hive, sheltering = !g.sky || g.sky.state.aboveCount < 2 || (w.rainingAt && w.rainingAt(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)));
    if (h && (this.nectar || sheltering || (this.restTicks | 0) > 0)) {
      // home: hover at the entrance; deliver nectar
      const [fx, fz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][w.getMeta(h.x, h.y, h.z) & 3];
      const d = fly(h.x + 0.5 + fx * 0.9, h.y + 0.3, h.z + 0.5 + fz * 0.9, 0.08);
      if (this.restTicks > 0) this.restTicks--;
      if (this.nectar && d < 1.2) {
        this.nectar = false; this.restTicks = 200 + Math.floor(Math.random() * 200);
        const m = w.getMeta(h.x, h.y, h.z), lvl = (m >> 2) & 7;
        if (lvl < 5) w.setBlockUrgent(h.x, h.y, h.z, w.getBlock(h.x, h.y, h.z), (m & 3) | ((lvl + 1) << 2));
      }
      return;
    }
    // looking for a flower
    if (!this.flower && g.ticks % 20 === this.id % 20) {
      const cx = h ? h.x : Math.floor(this.x), cy = h ? h.y : Math.floor(this.y), cz = h ? h.z : Math.floor(this.z);
      for (let k = 0; k < 24 && !this.flower; k++) {
        const x = cx + Math.floor(Math.random() * 45) - 22, z = cz + Math.floor(Math.random() * 45) - 22;
        const y = w.heightAt(x, z) + 1;
        if (Math.abs(y - cy) < 12 && BEE_FLOWERS.has(w.getBlock(x, y, z))) this.flower = { x, y, z, t: 0 };
      }
    }
    const f = this.flower;
    if (f) {
      if (!BEE_FLOWERS.has(w.getBlock(f.x, f.y, f.z)) || ++f.t > 1200) { this.flower = null; return; }
      const d = fly(f.x + 0.5, f.y + 0.7, f.z + 0.5, 0.08);
      if (d < 0.6 && (f.sip = (f.sip | 0) + 1) > 100 + (this.id % 80)) { this.nectar = true; this.flower = null; }
      return;
    }
    if (this.nectar && g.ticks % 10 === 0) {
      // dust the crops below on the way
      const x = Math.floor(this.x), z = Math.floor(this.z);
      for (let y = Math.floor(this.y); y > Math.floor(this.y) - 3; y--) {
        const id = w.getBlock(x, y, z);
        if (CROPS.has(id) && Math.random() < 0.1) { const m = w.getMeta(x, y, z); if (m < 7) w.setBlockUrgent(x, y, z, id, m + 1); break; }
        if (id) break;
      }
    }
    if (!this.target3 || Math.random() < 0.02 || Math.hypot(this.target3[0] - this.x, this.target3[2] - this.z) < 1) {
      const cx = h ? h.x : this.x, cz = h ? h.z : this.z;
      this.target3 = [cx + (Math.random() - 0.5) * 12, (h ? h.y : this.y) + (Math.random() - 0.3) * 3, cz + (Math.random() - 0.5) * 12];
    }
    fly(...this.target3, 0.06);
    if (Math.random() < 1 / 300) g.audio.play('buzz', [this.x, this.y, this.z], 0.5);
  }

  /**
   * Shellbacks plod slowly on land and swim fast; each remembers the beach it
   * was born on (or first seen on). After breeding, one goes home and lays
   * 1-4 eggs on the sand. A hatchling drops a scute when it grows up.
   */
  turtleAI(g, p, pdist) {
    const b = this.body, w = g.world;
    if (!this.beach) this.beach = { x: Math.floor(this.x), y: Math.floor(this.y), z: Math.floor(this.z) };
    if (this.age === -1) g.entities.spawnItem(this.x, this.y + 0.3, this.z, { id: I.SCUTE, count: 1, damage: 0 }); // grows up this tick
    const swim = b.inWater ? 3.5 : 1;
    if (this.pregnant) {
      const h = this.beach, d = Math.hypot(h.x + 0.5 - this.x, h.z + 0.5 - this.z);
      if (d > 2) { this.steer(h.x + 0.5, h.z + 0.5, swim); if (this.move) this.move.jump = this.move.jump || b.inWater; return; }
      const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
      if (b.onGround && w.getBlock(x, y - 1, z) === B.SAND && !w.getBlock(x, y, z)) {
        w.setBlockUrgent(x, y, z, B.TURTLE_EGG, Math.floor(Math.random() * 4));
        g.audio.play('place_stone', [x + 0.5, y, z + 0.5]);
        this.pregnant = false;
      } else this.wanderAI(g, 1);
      return;
    }
    if (this.panicTicks > 0 || this.loveTicks > 0 || this.tempted(g)) return this.passiveAI(g);
    if (this.age < 0) { if (++this.age === 0) this.setBaby(false); } else if (this.age > 0) this.age--;
    this.wanderAI(g, swim);
  }

  /**
   * Squawklets flutter about the jungle and now and then settle on the ground
   * for a while. Tamed with seeds (1 in 3), they follow their owner or sit on
   * command. Every so often one mimics a monster that is nearby.
   */
  parrotAI(g, p, pdist) {
    const b = this.body;
    const fly = (tx, ty, tz, sp = 0.1) => {
      const dx = tx - this.x, dy = ty - this.y, dz = tz - this.z, d = Math.hypot(dx, dy, dz) || 1;
      b.vx += ((dx / d) * sp - b.vx) * 0.15; b.vy += ((dy / d) * sp - b.vy) * 0.15; b.vz += ((dz / d) * sp - b.vz) * 0.15;
      if (Math.hypot(dx, dz) > 0.2) this.yaw = Math.atan2(-dx, -dz);
      return d;
    };
    const land = () => { b.vx *= 0.5; b.vz *= 0.5; b.vy = Math.max(-0.3, b.vy - 0.04); };
    // mimicry: a squawk in the voice of a monster within 20 blocks
    if (g.ticks % 200 === this.id % 200 && Math.random() < 0.3) {
      for (const e of g.entities.list) {
        if (e.kind === 'mob' && e.def.category === CATEGORY.MONSTER && e.deathTime === 0 && (e.x - this.x) ** 2 + (e.z - this.z) ** 2 < 400 && e.def.sound) { g.audio.play(e.def.sound, [this.x, this.y + 0.5, this.z], 0.6); break; }
      }
    }
    if (this.panicTicks > 0) { this.panicTicks--; fly(this.x + (Math.random() - 0.5) * 8, this.y + 2, this.z + (Math.random() - 0.5) * 8, 0.2); return; }
    if (this.tamed) {
      if (this.sitting) { land(); return; }
      if (!p.dead) {
        if (pdist > 14) { if (this.teleportTo(g, p.x + (Math.random() - 0.5) * 2, p.z + (Math.random() - 0.5) * 2, p.y + 2)) return; }
        if (pdist > 3) { fly(p.x, p.y + 1.8, p.z, 0.16); return; }
        land();
        return;
      }
    }
    if (this.perched > 0) { this.perched--; land(); if (this.tempted(g)) this.yaw = Math.atan2(-(p.x - this.x), -(p.z - this.z)); return; }
    if (b.onGround && Math.random() < 0.004) { this.perched = 100 + Math.floor(Math.random() * 300); return; }
    if (!this.target3 || Math.random() < 0.015 || Math.hypot(this.target3[0] - this.x, this.target3[2] - this.z) < 1) {
      const gy = g.world.heightAt(Math.floor(this.x), Math.floor(this.z));
      this.target3 = [this.x + (Math.random() - 0.5) * 16, gy + 1 + Math.random() * 6, this.z + (Math.random() - 0.5) * 16];
    }
    fly(...this.target3, 0.08);
    if (Math.random() < 1 / 400) g.audio.play('squawk', [this.x, this.y + 0.5, this.z], 0.5);
  }

  /** Bees of a nest (or near a spot) turn on whoever disturbed it. */
  static angerBees(g, x, y, z, foe = 'player') {
    for (const e of g.entities.list) {
      if (!e.def || !e.def.bee || e.dead || e.stung) continue;
      const home = e.hive && e.hive.x === x && e.hive.y === y && e.hive.z === z;
      if (home || (e.x - x) ** 2 + (e.y - y) ** 2 + (e.z - z) ** 2 < 100) { e.angryTicks = 500 + Math.floor(Math.random() * 300); e.enemy = foe; }
    }
  }

  endRam() { this.ram = null; this.headPitch = 0; this.ramCooldown = 600 + Math.floor(Math.random() * 5400); }

  /** Purrlings: strays roam villages and shy away from players unless tempted with fish; tame ones sit or follow their owner. */
  catAI(g, p, pdist) {
    if (this.age < 0) { if (++this.age === 0) this.setBaby(false); } else if (this.age > 0) this.age--;
    this.headPitch = 0;
    if (this.panicTicks > 0) return this.passiveAI(g);
    if (this.tamed && this.sitting) { this.move = null; this.headPitch = pdist < 6 ? -0.2 : 0; return; }
    if (this.loveTicks > 0) {
      this.loveTicks--;
      if (g.ticks % 10 === 0) this.hearts(g, 1);
      const mate = this.findMate(g);
      if (mate) {
        const d = Math.hypot(mate.x - this.x, mate.z - this.z);
        if (d > 1.2) this.steer(mate.x, mate.z, 1);
        if (d < 3 && ++this.breedTime >= 60 && this.id < mate.id) this.breed(g, mate);
        return;
      }
    }
    if (this.tamed && !p.dead) {
      if (pdist > 12) { if (this.teleportTo(g, p.x + (Math.random() - 0.5) * 3, p.z + (Math.random() - 0.5) * 3, p.y + 2)) return; }
      if (pdist > 5) { this.chase(g, p, 1.3); return; }
      if (pdist < 2) { this.wander = null; this.path = null; return; }
      this.wanderAI(g, 0.7);
      return;
    }
    if (this.tempted(g)) {
      // a stray creeps closer to a player holding fish, but only while they stand still
      const still = Math.hypot(p.body.vx, p.body.vz) < 0.02;
      if (still && pdist > 2) this.steer(p.x, p.z, 0.6); else this.move = null;
      this.yaw = Math.atan2(-(p.x - this.x), -(p.z - this.z));
      return;
    }
    if (!p.dead && !p.creative && pdist < 4 && !p.sneaking) { this.steer(this.x + (this.x - p.x) * 3, this.z + (this.z - p.z) * 3, 1.4); return; }
    this.wanderAI(g, 0.8);
  }

  /** Frostlings throw snowballs at monsters within 10 blocks, leave a trail of snow and melt in warm places and rain. */
  frostlingAI(g, p, pdist) {
    if (typeof this.enemy === 'string') this.enemy = null; // Frostlings never turn on players
    const w = g.world, bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
    const biome = BIOMES[w.biomeAt(bx, bz)];
    if ((biome && biome.temp > 1) || (g.weather && g.weather.rainingAt(w, this.x, this.y + 1, this.z))) { if (g.ticks % 20 === 0) this.hurt(1, 'melt'); }
    else if (biome && biome.temp < 0.8 && !w.getBlock(bx, by, bz) && SOLID[w.getBlock(bx, by - 1, bz)] && g.ticks % 4 === 0) w.setBlock(bx, by, bz, B.SNOW_LAYER, 0);
    if (!this.enemy || this.enemy.dead || this.enemy.deathTime > 0 || Math.hypot(this.enemy.x - this.x, this.enemy.z - this.z) > 12) {
      this.enemy = null;
      if (g.ticks % 10 === this.id % 10) for (const e of g.entities.list) {
        if (e.kind === 'mob' && e.deathTime === 0 && e.def.category === CATEGORY.MONSTER && Math.hypot(e.x - this.x, e.z - this.z) < 10 && this.canSee(g, e.x, e.eyeY, e.z)) { this.enemy = e; break; }
      }
    }
    if (this.enemy) {
      const t = this.enemy, dx = t.x - this.x, dz = t.z - this.z, d = Math.hypot(dx, dz) || 1;
      this.yaw = Math.atan2(-dx, -dz);
      if (this.attackCooldown <= 0) {
        this.attackCooldown = 20;
        const sy = this.y + 1.6, dy = t.y + t.height * 0.6 - sy + d * 0.08;
        const l = Math.hypot(dx, dy, dz);
        g.entities.spawnArrow(this.x + dx / d * 0.5, sy, this.z + dz / d * 0.5, dx / l * 1.4, dy / l * 1.4, dz / l * 1.4, this, false, 'snowball');
        g.audio.play('bow', [this.x, sy, this.z], 0.4);
      }
      if (d > 6) this.steer(t.x, t.z, 1);
      return;
    }
    this.wanderAI(g, 0.6);
  }

  /** Ironguards patrol near where they were made and smash hostile mobs (not Fizzlers) within 16 blocks. */
  guardAI(g, p, pdist) {
    const alive = (e) => e && (e === 'player' ? !p.dead && !p.creative && pdist < 24 : !e.dead && e.deathTime === 0 && Math.hypot(e.x - this.x, e.z - this.z) < 24);
    if (this.enemy && !alive(this.enemy)) this.enemy = null;
    if (!this.enemy && g.ticks % 10 === this.id % 10) {
      let best = null, bd = 16 * 16;
      for (const e of g.entities.list) {
        if (e.kind !== 'mob' || e.deathTime > 0 || e.def.category !== CATEGORY.MONSTER || e.type === 'fizzler') continue;
        const d2 = (e.x - this.x) ** 2 + (e.z - this.z) ** 2;
        if (d2 < bd && Math.abs(e.y - this.y) < 8) { bd = d2; best = e; }
      }
      // players who hurt a Settler become a target too
      if (!best && this.lastSettlerAttacker === 'player' && !p.dead && !p.creative && pdist < 16) best = 'player';
      this.enemy = best;
    }
    if (!this.home) this.home = { x: this.x, y: this.y, z: this.z };
    this.headPitch = 0;
    if (this.enemy) {
      const t = this.enemy === 'player' ? p : this.enemy;
      this.chase(g, t, 0.9);
      const dx = t.x - this.x, dz = t.z - this.z;
      if (dx * dx + dz * dz <= (this.width / 2 + (t.width || 0.6) / 2 + 1.2) ** 2 && Math.abs(t.y - this.y) < 2.5 && this.attackCooldown <= 0) {
        // the reference golem hits for 7-21 and flings its target into the air
        this.attackCooldown = 20; this.swingTime = 10;
        const dmg = 7 + Math.floor(Math.random() * 15);
        if (t === p) { p.hurt(dmg, 'mob:' + this.def.name, this); p.body.vy += 0.6; }
        else { t.hurt(dmg, 'mob:' + this.def.name, this, 0.4); t.body.vy += 0.6; }
        g.audio.play('clank', [this.x, this.y + 1.5, this.z]);
      }
      return;
    }
    const h = this.home;
    if (Math.hypot(h.x - this.x, h.z - this.z) > 20) { if (!this.path || g.ticks % 40 === 0) this.pathTo(g, h.x, h.y, h.z); if (!this.followPath(g, 0.6)) this.steer(h.x, h.z, 0.6); return; }
    this.wanderAI(g, 0.5);
  }

  /** Flitters flutter about at random; now and then one hangs from a ceiling until a player comes close. */
  flitterAI(g, p, pdist) {
    const b = this.body, w = g.world;
    const above = w.getBlock(Math.floor(this.x), Math.floor(this.y + this.height + 0.1), Math.floor(this.z));
    if (this.roosting) {
      b.vx = b.vy = b.vz = 0;
      if (!SOLID[above] || (pdist < 4 && !p.creative) || Math.random() < 1 / 2000) this.roosting = false;
      return;
    }
    if (!this.target3 || Math.random() < 0.02 || Math.hypot(this.target3[0] - this.x, this.target3[1] - this.y, this.target3[2] - this.z) < 1) {
      this.target3 = [this.x + (Math.random() - 0.5) * 14, this.y + (Math.random() - 0.4) * 6, this.z + (Math.random() - 0.5) * 14];
    }
    const [tx, ty, tz] = this.target3;
    b.vx += (Math.sign(tx - this.x) * 0.5 - b.vx) * 0.1;
    b.vy += (Math.sign(ty - this.y) * 0.7 - b.vy) * 0.1;
    b.vz += (Math.sign(tz - this.z) * 0.5 - b.vz) * 0.1;
    b.vx *= 0.3; b.vy *= 0.3; b.vz *= 0.3; // short, fluttery steps
    this.yaw = Math.atan2(-b.vx, -b.vz);
    if (SOLID[above] && Math.random() < 0.01) { this.roosting = true; b.setPos(this.x, Math.floor(this.y + this.height + 0.1) - this.height, this.z); }
    if (Math.random() < 1 / 120) g.audio.play('squeak', [this.x, this.y, this.z], 0.5);
  }

  /** Frostbears amble about; once angry they charge and maul (6 damage). */
  bearAI(g, p, pdist) {
    if (this.age < 0) { if (++this.age === 0) this.setBaby(false); } else if (this.age > 0) this.age--;
    const alive = (e) => e && (e === 'player' ? !p.dead && !p.creative && pdist < 24 : !e.dead && e.deathTime === 0);
    if (this.enemy && !alive(this.enemy)) this.enemy = null;
    if (this.enemy) { const t = this.enemy === 'player' ? p : this.enemy; this.chase(g, t, 1.4); this.howlerBite(g, t); return; }
    this.wanderAI(g, 0.8);
  }

  /** Vixlings sleep through the day, hunt Clucklings and Hoppers at dusk and night, and keep away from players. */
  foxAI(g, p, pdist) {
    if (this.age < 0) { if (++this.age === 0) this.setBaby(false); } else if (this.age > 0) this.age--;
    if (this.panicTicks > 0) { this.sleeping = false; return this.passiveAI(g); }
    const day = g.sky.state.aboveCount >= 2;
    if (pdist < 6 && !p.sneaking && !p.creative && !p.dead) { this.sleeping = false; this.steer(this.x + (this.x - p.x) * 3, this.z + (this.z - p.z) * 3, 1.6); return; }
    if (this.enemy && (this.enemy.dead || this.enemy.deathTime > 0 || Math.hypot(this.enemy.x - this.x, this.enemy.z - this.z) > 16)) this.enemy = null;
    if (this.enemy) { this.sleeping = false; this.chase(g, this.enemy, 1.3); this.howlerBite(g, this.enemy); return; }
    if (day) { if (!this.sleeping && Math.random() < 0.01) this.sleeping = true; if (this.sleeping) { this.move = null; return; } }
    else {
      this.sleeping = false;
      if (g.ticks % 40 === this.id % 40 && Math.random() < 0.1) for (const e of g.entities.list) {
        if (e.kind === 'mob' && (e.type === 'cluckling' || e.type === 'hopper') && e.deathTime === 0 && Math.hypot(e.x - this.x, e.z - this.z) < 12) { this.enemy = e; break; }
      }
    }
    this.wanderAI(g, 1);
  }

  /** Inklings drift through the water in pulses; out of water they flop and suffocate. Hurt, they squirt ink and dart away. */
  /** Dolphins swim fast after nearby players (and ahead of their boats), leaping at the surface. */
  dolphinAI(g, p, pdist) {
    const b = this.body, w = g.world;
    if (!b.inWater) { this.move = null; if (g.ticks % 40 === 0 && b.onGround) this.hurt(1, 'drown'); return; }
    if (!this.swimDir || Math.random() < 0.01 || b.horizontalCollision) { const a = Math.random() * Math.PI * 2; this.swimDir = [Math.sin(a), 0, Math.cos(a)]; }
    let k = 0.02;
    if (pdist < 24 && pdist > 3 && !p.dead) {
      const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz) || 1;
      this.swimDir = [dx / d, (p.y - this.y) * 0.05, dz / d]; k = 0.045; // keep up with a swimmer or a boat
    }
    const surface = !isWaterish(w.getBlock(Math.floor(this.x), Math.floor(this.y + this.height + 0.5), Math.floor(this.z)));
    if (surface) {
      this.swimDir[1] = Math.min(this.swimDir[1], 0);
      if (Math.hypot(b.vx, b.vz) > 0.18 && Math.random() < 0.04) { b.vy = 0.55; g.particles.splashAt && g.particles.splashAt(this.x, this.y + 0.5, this.z); } // a leap
    } else this.swimDir[1] += 0.01; // back up towards the air
    if (SOLID[w.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z))]) this.swimDir[1] = Math.abs(this.swimDir[1]) + 0.1;
    b.vx += this.swimDir[0] * k; b.vy += this.swimDir[1] * k * 0.6 + 0.005; b.vz += this.swimDir[2] * k;
    this.yaw += wrap(Math.atan2(-b.vx, -b.vz) - this.yaw) * 0.2;
    this.move = null;
  }

  /**
   * Croakers: their colour comes from the climate they live in; they wander
   * with long leaps now and then, croak, and catch small Wobblers within 10
   * blocks with their tongue, leaving a Croaklight of their colour behind.
   */
  croakerAI(g, p, pdist) {
    const b = this.body, w = g.world;
    if (!this.colourSet) {
      this.colourSet = true;
      const bm = BIOMES[w.biomeAt(Math.floor(this.x), Math.floor(this.z))], t = bm ? bm.temp : 0.8;
      this.woolColor = t >= 0.9 ? 1 : t < 0.3 ? 2 : 0;
    }
    if (this.tongue > 0) this.tongue--;
    if (this.croakTicks > 0) this.croakTicks--;
    else if (Math.random() < 1 / 300) { this.croakTicks = 30; g.audio.play('croak', [this.x, this.y, this.z], 0.6); }
    if (this.attackCooldown > 0) this.attackCooldown--;
    const prey = this.prey;
    if (prey && (prey.dead || prey.removed || prey.deathTime > 0 || Math.hypot(prey.x - this.x, prey.y - this.y, prey.z - this.z) > 14)) this.prey = null;
    if (!this.prey && this.age >= 0 && g.ticks % 30 === this.id % 30) {
      for (const e of g.entities.list) if (e.kind === 'mob' && e.type === 'wobbler' && e.size === 1 && !e.dead && e.deathTime === 0 && Math.hypot(e.x - this.x, e.y - this.y, e.z - this.z) < 10) { this.prey = e; break; }
    }
    if (this.prey) {
      const e = this.prey, d = Math.hypot(e.x - this.x, e.y - this.y, e.z - this.z);
      this.yaw = Math.atan2(-(e.x - this.x), -(e.z - this.z));
      if (d > 2.2) { this.chase(g, e, 1.2); return; }
      this.move = null;
      if (this.attackCooldown <= 0 && (!g.net || g.net.isHost)) {
        // the tongue shoots out and the Wobbler is gone, leaving a Croaklight
        this.attackCooldown = 40; this.tongue = 8;
        e.removed = true; e.dead = true;
        g.entities.spawnItem(e.x, e.y + 0.2, e.z, { id: CROAKLIGHTS[this.woolColor % CROAKLIGHTS.length], count: 1 });
        g.audio.play('squish', [e.x, e.y, e.z]);
        this.prey = null;
      }
      return;
    }
    this.passiveAI(g);
    // now and then a long leap in the direction it is heading
    if (b.onGround && this.move && this.move.forward > 0 && Math.random() < 0.04) {
      b.vy = 0.5;
      b.vx += -Math.sin(this.yaw) * 0.25; b.vz += -Math.cos(this.yaw) * 0.25;
    }
  }

  /**
   * Gillnewts paddle about their pools and walk slowly on land (drying out
   * after five minutes there), hunt fish and hostile swimmers within 8 blocks
   * (2 damage a bite) and, after playing dead, heal up.
   */
  newtAI(g, p, pdist) {
    const b = this.body, w = g.world;
    if (b.inWater) this.dry = 0;
    else if ((this.dry = (this.dry || 0) + 1) > 6000 && g.ticks % 20 === 0) this.hurt(1, 'drown');
    if (this.playDead > 0) {
      this.playDead--; this.move = null; b.vx *= 0.5; b.vz *= 0.5;
      if (g.ticks % 20 === 0 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 1);
      return;
    }
    if (this.attackCooldown > 0) this.attackCooldown--;
    const prey = (e) => e && e.kind === 'mob' && !e.dead && e.deathTime === 0 && (e.def.fish && !e.def.newt && !e.def.dolphin || e.def.deepeye || e.type === 'sodden_shambler' || e === this.grudge);
    if (this.enemy && (!prey(this.enemy) || Math.hypot(this.enemy.x - this.x, this.enemy.y - this.y, this.enemy.z - this.z) > 12 || this.enemy.playDead > 0)) this.enemy = null;
    if (!this.enemy && g.ticks % 40 === this.id % 40 && b.inWater) {
      for (const e of g.entities.list) if (e !== this && prey(e) && isWaterish(w.getBlock(Math.floor(e.x), Math.floor(e.y + 0.2), Math.floor(e.z))) && Math.hypot(e.x - this.x, e.y - this.y, e.z - this.z) < 8) { this.enemy = e; break; }
    }
    if (!b.inWater) {
      // on land: a slow waddle, back towards water if any is near
      this.wanderAI(g, 0.6);
      return;
    }
    let k = 0.012;
    if (this.enemy) {
      const t = this.enemy, dx = t.x - this.x, dy = t.y + t.height / 2 - (this.y + 0.2), dz = t.z - this.z, d = Math.hypot(dx, dy, dz) || 1;
      this.swimDir = [dx / d, dy / d, dz / d]; k = 0.03;
      if (d < this.width / 2 + t.width / 2 + 0.5 && this.attackCooldown <= 0) {
        this.attackCooldown = 20;
        t.hurt(this.def.attack, 'mob:' + this.def.name, this, 0.2);
      }
    } else if (!this.swimDir || Math.random() < 0.012 || b.horizontalCollision) {
      const a = Math.random() * Math.PI * 2;
      this.swimDir = [Math.sin(a), (Math.random() - 0.6) * 0.4, Math.cos(a)];
    }
    if (!this.enemy && !isWaterish(w.getBlock(Math.floor(this.x), Math.floor(this.y + this.height + 0.3), Math.floor(this.z)))) this.swimDir[1] = -Math.abs(this.swimDir[1]) - 0.1;
    // climb out over the rim now and then
    if (b.horizontalCollision && !this.enemy && Math.random() < 0.05) b.vy = 0.3;
    b.vx += this.swimDir[0] * k; b.vy += this.swimDir[1] * k * 0.6 + 0.002; b.vz += this.swimDir[2] * k;
    this.yaw += wrap(Math.atan2(-this.swimDir[0], -this.swimDir[2]) - this.yaw) * 0.15;
    this.move = null;
  }

  /** Fish swim steadily, keep together with their school, dart away from players and flop on land. */
  fishAI(g, p, pdist) {
    const b = this.body;
    if (!b.inWater) {
      this.move = null;
      if (b.onGround && Math.random() < 0.08) { b.vy = 0.25; b.vx += (Math.random() - 0.5) * 0.2; b.vz += (Math.random() - 0.5) * 0.2; }
      if (g.ticks % 20 === 0) this.hurt(1, 'drown');
      return;
    }
    if (!this.swimDir || Math.random() < 0.015 || b.horizontalCollision) {
      const a = Math.random() * Math.PI * 2;
      this.swimDir = [Math.sin(a), (Math.random() - 0.5) * 0.3, Math.cos(a)];
    }
    if (g.ticks % 10 === this.id % 10) {
      // school: steer towards the middle and heading of the others nearby
      let n = 0, cx = 0, cy = 0, cz = 0, hx = 0, hz = 0;
      for (const e of g.entities.list) {
        if (e === this || e.kind !== 'mob' || e.type !== this.type || !e.swimDir) continue;
        const d = Math.hypot(e.x - this.x, e.y - this.y, e.z - this.z);
        if (d > 6) continue;
        n++; cx += e.x; cy += e.y; cz += e.z; hx += e.swimDir[0]; hz += e.swimDir[2];
      }
      if (n) {
        const tx = cx / n - this.x, ty = cy / n - this.y, tz = cz / n - this.z;
        this.swimDir[0] = this.swimDir[0] * 0.5 + hx / n * 0.3 + tx * 0.08;
        this.swimDir[1] = this.swimDir[1] * 0.5 + ty * 0.08;
        this.swimDir[2] = this.swimDir[2] * 0.5 + hz / n * 0.3 + tz * 0.08;
        const l = Math.hypot(this.swimDir[0], this.swimDir[2]) || 1;
        this.swimDir[0] /= l; this.swimDir[2] /= l;
      }
    }
    let k = 0.012;
    if (pdist < 4 && !p.dead) { // dart away
      const dx = this.x - p.x, dz = this.z - p.z, d = Math.hypot(dx, dz) || 1;
      this.swimDir = [dx / d, 0.1, dz / d]; k = 0.035;
    }
    const w = g.world;
    if (!isWaterish(w.getBlock(Math.floor(this.x), Math.floor(this.y + this.height + 0.4), Math.floor(this.z)))) this.swimDir[1] = -Math.abs(this.swimDir[1]) - 0.15;
    if (SOLID[w.getBlock(Math.floor(this.x), Math.floor(this.y - 0.4), Math.floor(this.z))]) this.swimDir[1] = Math.abs(this.swimDir[1]) + 0.1;
    b.vx += this.swimDir[0] * k; b.vy += this.swimDir[1] * k * 0.6 + 0.004; b.vz += this.swimDir[2] * k;
    this.yaw += wrap(Math.atan2(-this.swimDir[0], -this.swimDir[2]) - this.yaw) * 0.15;
    this.move = null;
  }

  inklingAI(g) {
    const b = this.body;
    this.pulse = (this.pulse || 0) + 1;
    if (!b.inWater) { this.move = null; if (g.ticks % 20 === 0) this.hurt(1, 'drown'); return; }
    if (!this.swimDir || this.pulse % 60 === 0 || b.horizontalCollision) {
      const a = Math.random() * Math.PI * 2;
      this.swimDir = [Math.sin(a), (Math.random() - 0.5) * 0.6, Math.cos(a)];
    }
    const k = this.panicTicks > 0 ? 0.06 : (this.pulse % 30 < 8 ? 0.02 : 0); // a push at the start of each pulse
    if (this.panicTicks > 0) this.panicTicks--;
    // stay under the surface
    if (g.world.getBlock(Math.floor(this.x), Math.floor(this.y + this.height + 0.3), Math.floor(this.z)) !== B.WATER) this.swimDir[1] = -Math.abs(this.swimDir[1]) - 0.2;
    b.vx += this.swimDir[0] * k; b.vy += this.swimDir[1] * k + 0.005; b.vz += this.swimDir[2] * k;
    this.yaw += wrap(Math.atan2(-this.swimDir[0], -this.swimDir[2]) - this.yaw) * 0.1;
    this.move = null;
  }

  /** Wobblers hop: a jump every 10-30 ticks (three times as often when chasing), steering only in the air; big ones hurt on contact. */
  wobblerAI(g, p, pdist) {
    const b = this.body, has = this.acquire(g, p, pdist, this.def.followRange);
    if (has) this.yaw += wrap(angleTo(p.x - this.x, p.z - this.z) - this.yaw) * 0.3;
    else if (b.onGround && Math.random() < 0.02) this.yaw += (Math.random() - 0.5) * 2;
    if (b.onGround) {
      this.squish *= 0.6;
      if (this.wasAirborne) { this.squish = -0.5; this.wasAirborne = false; g.audio.play('squish', [this.x, this.y, this.z], 0.4 + this.size * 0.15); }
      if (--this.jumpDelay <= 0) {
        this.jumpDelay = Math.floor((10 + Math.random() * 20) / (has ? 3 : 1));
        b.vy = 0.42; this.squish = 1; this.wasAirborne = true;
      }
    } else this.squish *= 0.85;
    if (!b.onGround) this.move = { forward: this.speed() * (0.6 + this.size * 0.2), jump: false, mod: 1 };
    if (has && this.size > 1) {
      const dx = p.x - this.x, dz = p.z - this.z, r = this.width / 2 + 0.6;
      if (dx * dx + dz * dz < r * r && Math.abs(p.y - this.y) < this.height && this.attackCooldown <= 0) {
        this.attackCooldown = 10;
        p.hurt(this.size, 'mob:' + this.def.name, this);
      }
    }
  }

  /**
   * A ridden Galloper: wild ones buck their rider off after a few seconds
   * (a chance to be tamed each time, growing with temper); tamed and saddled
   * ones follow WASD and jump with Space.
   */
  riddenAI(g) {
    const input = g.boatInput, b = this.body;
    if (!this.tamed) {
      if (this.buck === undefined) this.buck = 40 + Math.floor(Math.random() * 40);
      this.yaw += (Math.random() - 0.5) * 0.4;
      this.move = { forward: this.speed() * 0.5, jump: Math.random() < 0.05 && b.onGround, mod: 1 };
      if (--this.buck <= 0) {
        this.buck = undefined;
        if (Math.random() * 100 < this.temper) { this.tamed = true; this.persistent = true; this.ownerName = g.player.netName || null; this.hearts(g, 7); if (g.milestones) g.milestones.event('tame_horse'); }
        else { this.temper = Math.min(100, this.temper + 5); g.audio.play('neigh', [this.x, this.y + 1.5, this.z]); g.particles.smoke(this.x, this.y + this.height, this.z, 7, 0.6); g.dismount(); }
      }
      return;
    }
    if (!this.saddled || !input) { this.move = null; return; }
    this.yaw = this.rider.yaw;
    const sp = this.speed() * (input.sprint ? 1.25 : 1);
    this.move = { forward: input.forward > 0 ? sp : input.forward < 0 ? -sp * 0.25 : 0, strafe: (input.strafe || 0) * sp * 0.5, jump: false, mod: 1 };
    if (input.jump && b.onGround) { b.vy = this.jumpPower; this.jumped = true; }
    b.stepHeight = 1.1;
  }

  howlerBite(g, t) {
    const dx = t.x - this.x, dz = t.z - this.z;
    if (dx * dx + dz * dz <= (this.width + (t.width || 0.6)) ** 2 + 0.6 && Math.abs(t.y - this.y) < 1.5 && this.attackCooldown <= 0) {
      this.attackCooldown = 20;
      const dmg = this.tamed ? this.def.tamedAttack : this.def.attack;
      if (t.isPlayer || t === g.player) g.player.hurt(dmg, 'mob:' + this.def.name, this);
      else t.hurt(dmg, 'mob:' + this.def.name, this, 0.4);
      this.body.vy = this.body.onGround ? 0.3 : this.body.vy; // the pounce
    }
  }

  graze(g) {
    const w = g.world, bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
    if (w.getBlock(bx, by, bz) === B.TALL_GRASS) w.setBlock(bx, by, bz, B.AIR);
    else if (w.getBlock(bx, by - 1, bz) === B.GRASS) w.setBlock(bx, by - 1, bz, B.DIRT);
    else return;
    g.audio.play('step_grass', [this.x, this.y, this.z]);
    this.sheared = false;
    if (this.age < 0) this.age = Math.min(0, this.age + 1200);
  }

  /** Acquire the player as target if in range and visible. */
  acquire(g, p, pdist, range) {
    if (p.dead || p.creative) { this.target = null; return false; }
    // an invisible player is only noticed close up (more so the more armour shows)
    if (p.effects ? p.effects.invisibility : p.invisible) range *= visibilityFactor({ invisibility: { amp: 0 } }, armorPieces(p));
    if (this.target === 'player') {
      if (pdist > range * 1.5 || p.dead) this.target = null;
      return !!this.target;
    }
    if (pdist < range && g.ticks % 10 === this.id % 10 && this.canSee(g, p.x, p.y + p.eyeHeight, p.z)) this.target = 'player';
    return this.target === 'player';
  }

  chase(g, p, mod = 1) {
    const close = Math.hypot(p.x - this.x, p.z - this.z) < 2.5 && Math.abs(p.y - this.y) < 1.2;
    if (close) { this.path = null; this.steer(p.x, p.z, mod); return; }
    if (--this.pathTimer <= 0 || !this.path || !this.path.length ||
      (this.pathGoal && Math.hypot(this.pathGoal[0] - p.x, this.pathGoal[2] - p.z) > 2)) {
      this.pathTimer = 15 + Math.floor(Math.random() * 10);
      this.pathTo(g, p.x, p.y + 0.01, p.z);
    }
    if (!this.followPath(g, mod)) this.steer(p.x, p.z, mod);
  }

  meleeReachSq(p) { const w = this.width * 2; return w * w + 0.6; }

  tryMelee(g, p) {
    const dx = p.x - this.x, dz = p.z - this.z, dy = p.y - this.y;
    const d2 = dx * dx + dz * dz;
    if (d2 <= this.meleeReachSq(p) && Math.abs(dy) < this.height && this.attackCooldown <= 0) {
      this.attackCooldown = 20;
      const hit = p.hurt(this.def.attack, 'mob:' + this.def.name, this);
      const fx = this.def.hitEffect; // Dune Shamblers: Hunger
      if (hit && fx && p.applyEffect) p.applyEffect(fx[0], fx[1], fx[2]);
    }
  }

  meleeAI(g, p, pdist) {
    if (this.acquire(g, p, pdist, this.def.followRange)) {
      this.chase(g, p, 1);
      this.tryMelee(g, p);
      this.headPitch = 0;
      return;
    }
    // Shamblers (and their kin) also hunt settlers within 16 blocks
    if (this.def.shamblerKin) {
      if (this.prey && (this.prey.dead || this.prey.deathTime > 0 || Math.hypot(this.prey.x - this.x, this.prey.z - this.z) > 24)) this.prey = null;
      if (!this.prey && g.ticks % 20 === this.id % 20) {
        for (const e of g.entities.list) {
          if (e.kind === 'mob' && e.def.villager && !e.dead && e.deathTime === 0 && Math.hypot(e.x - this.x, e.z - this.z) < 16 && this.canSee(g, e.x, e.eyeY, e.z)) { this.prey = e; break; }
        }
      }
      if (this.prey) { this.chase(g, this.prey, 1); this.tryMelee(g, this.prey); return; }
    }
    this.wanderAI(g, 1);
  }

  spiderAI(g, p, pdist) {
    const bx = Math.floor(this.x), by = Math.floor(this.y + 0.5), bz = Math.floor(this.z);
    const st = g.sky.state;
    const lvl = Math.max(g.world.skyLight(bx, by, bz) - st.skyDarken, g.world.blockLight(bx, by, bz)) / 15;
    const bright = lvl / (4 - 3 * lvl) >= 0.5;
    if (this.target === 'player' && bright && this.lastHurtByPlayer === 0 && Math.random() < 0.01) this.target = null;
    if (!this.target && bright) { this.wanderAI(g, 1); return; }
    if (this.acquire(g, p, pdist, this.def.followRange)) {
      this.chase(g, p, 1);
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (this.body.onGround && d > 2 && d < 4 && Math.random() < 0.2) {
        this.body.vy = 0.4;
        this.body.vx += (p.x - this.x) / d * 0.4 + this.body.vx * 0.2;
        this.body.vz += (p.z - this.z) / d * 0.4 + this.body.vz * 0.2;
      }
      this.tryMelee(g, p);
    } else this.wanderAI(g, 1);
  }

  rangedAI(g, p, pdist) {
    if (!this.acquire(g, p, pdist, this.def.followRange)) { this.bowCharge = 0; this.wanderAI(g, 1); return; }
    const see = this.canSee(g, p.x, p.y + p.eyeHeight, p.z);
    this.seeTime = see ? Math.max(0, this.seeTime) + 1 : Math.min(0, this.seeTime) - 1;
    const d = Math.hypot(p.x - this.x, p.z - this.z);
    this.yaw += wrap(angleTo(p.x - this.x, p.z - this.z) - this.yaw) * 0.5;
    if (d <= 15 && this.seeTime >= 20) {
      this.path = null;
      // strafe around the target, backing off when too close
      if (Math.random() < 0.01) this.strafeDir *= -1;
      this.move = { forward: d < 11.25 ? -this.speed() * 0.5 : this.speed() * 0.5, strafe: this.strafeDir * this.speed() * 0.5, jump: this.body.horizontalCollision && this.body.onGround, mod: 0.5 };
    } else this.chase(g, p, 1);
    if (see) {
      this.bowCharge++;
      if (this.bowCharge >= 20 && this.attackCooldown <= 0) {
        this.shoot(g, p);
        this.bowCharge = 0;
        this.attackCooldown = 40; // Normal difficulty interval
      }
    } else if (this.seeTime < -60) this.bowCharge = 0;
  }

  shoot(g, p) {
    const sx = this.x, sy = this.eyeY - 0.1, sz = this.z;
    const tx = p.x, ty = p.y + p.body.height / 3, tz = p.z;
    const dx = tx - sx, dz = tz - sz;
    const dy = ty - sy + Math.hypot(dx, dz) * 0.2;
    const l = Math.hypot(dx, dy, dz);
    const inacc = 6 * 0.0075; // 14 - difficulty*4 on Normal
    const vx = dx / l + gaussian() * inacc, vy = dy / l + gaussian() * inacc, vz = dz / l + gaussian() * inacc;
    const vl = Math.hypot(vx, vy, vz);
    const a = g.entities.spawnArrow(sx, sy, sz, vx / vl * 1.6, vy / vl * 1.6, vz / vl * 1.6, this, false);
    if (a && this.def.arrowEffect) a.effect = this.def.arrowEffect; // Rime Rattlers: Slowness
    g.audio.play('bow', [sx, sy, sz]);
  }

  fizzlerAI(g, p, pdist) {
    // Fizzlers are afraid of Purrlings: they back off and their fuse goes out
    if (this.fearOf === undefined || g.ticks % 10 === this.id % 10) {
      this.fearOf = null;
      for (const e of g.entities.list) if (e.type === 'purrling' && !e.dead && (e.x - this.x) ** 2 + (e.z - this.z) ** 2 < 36 && Math.abs(e.y - this.y) < 4) { this.fearOf = e; break; }
    }
    if (this.fearOf) {
      this.fuse = Math.max(0, this.fuse - 1);
      this.steer(this.x + (this.x - this.fearOf.x) * 4, this.z + (this.z - this.fearOf.z) * 4, 1.3);
      return;
    }
    const has = this.acquire(g, p, pdist, this.def.followRange);
    const d2 = (p.x - this.x) ** 2 + (p.y - this.y) ** 2 + (p.z - this.z) ** 2;
    let dir = -1;
    if (has && (this.fuse > 0 || d2 < 9)) {
      dir = (d2 > 49 || !this.canSee(g, p.x, p.y + 1, p.z)) ? -1 : 1;
    }
    if (dir > 0 && this.fuse === 0) g.audio.play('hiss', [this.x, this.y + 1, this.z]);
    this.fuse = Math.max(0, this.fuse + dir);
    if (this.fuse >= this.def.fuse) {
      g.explode(this.x, this.y + this.height / 2, this.z, this.def.explosionPower, this);
      this.removed = true; this.dead = true;
      return;
    }
    if (this.fuse > 0) { this.yaw += wrap(angleTo(p.x - this.x, p.z - this.z) - this.yaw) * 0.5; return; }
    if (has) this.chase(g, p, 1); else this.wanderAI(g, 1);
  }

  voidwalkerAI(g, p, pdist) {
    // Becomes hostile when the player looks at its head
    if (!this.angry && !p.dead && pdist < 64) {
      const [ex, ey, ez] = p.eyePos();
      const [lx, ly, lz] = p.lookDir();
      const vx = this.x - ex, vy = this.eyeY - ey, vz = this.z - ez;
      const d = Math.hypot(vx, vy, vz);
      const dot = (vx * lx + vy * ly + vz * lz) / d;
      if (dot > 1 - 0.025 / d && this.canSee(g, ex, ey, ez)) {
        if (++this.stare > 5) { this.angry = true; this.target = 'player'; g.audio.play('scream', [this.x, this.eyeY, this.z]); }
      } else this.stare = 0;
    }
    if (this.angry && (p.dead || pdist > 64)) { this.angry = false; this.target = null; }
    // Daylight makes them teleport away
    const st = g.sky.state;
    if (st.sunlit && g.ticks % 10 === 0) {
      const bx = Math.floor(this.x), by = Math.floor(this.eyeY), bz = Math.floor(this.z);
      const raw = g.world.skyLight(bx, by, bz);
      const f = Math.max(raw - st.skyDarken, 0) / 15, br = f / (4 - 3 * f);
      if (raw === 15 && br > 0.5 && Math.random() * 30 < (br - 0.4) * 2 * 10) { this.angry = false; this.target = null; this.teleportRandom(g); return; }
    }
    if (this.angry) {
      if (pdist > 16 && Math.random() < 0.05) this.teleportTowards(g, p);
      this.chase(g, p, 1);
      this.tryMelee(g, p);
    } else this.wanderAI(g, 1);
  }

  teleportTo(g, x, z, yHint) {
    const w = g.world;
    const bx = Math.floor(x), bz = Math.floor(z);
    if (!w.isLoaded(bx, bz)) return false;
    let y = Math.floor(yHint);
    while (y > yHint - 32 && !SOLID[w.getBlock(bx, y - 1, bz)]) y--;
    for (let k = 0; k < 3; k++) if (SOLID[w.getBlock(bx, y + k, bz)] || w.getBlock(bx, y + k, bz) === B.WATER || w.getBlock(bx, y + k, bz) === B.LAVA) return false;
    if (!SOLID[w.getBlock(bx, y - 1, bz)]) return false;
    g.particles.smoke(this.x, this.y + 1.4, this.z, 16, 1);
    this.body.setPos(bx + 0.5, y, bz + 0.5);
    this.prev = [this.x, this.y, this.z];
    this.path = null;
    g.audio.play('teleport', [this.x, this.y + 1, this.z]);
    return true;
  }
  teleportRandom(g) {
    if (!g) return;
    for (let i = 0; i < 16; i++) {
      if (this.teleportTo(g, this.x + (Math.random() - 0.5) * 64, this.z + (Math.random() - 0.5) * 64, this.y + (Math.random() - 0.5) * 64)) return;
    }
  }
  teleportTowards(g, p) {
    const dx = this.x - p.x, dz = this.z - p.z, d = Math.hypot(dx, dz) || 1;
    for (let i = 0; i < 8; i++) {
      const x = this.x + (Math.random() - 0.5) * 8 - dx / d * 16, z = this.z + (Math.random() - 0.5) * 8 - dz / d * 16;
      if (this.teleportTo(g, x, z, this.y + 8)) return;
    }
  }

  // ---------------------------------------------------------------------------
  createMesh() { return buildModel(this.type); }

  renderUpdate(m, px, py, pz, alpha, L, sec) {
    m.position.set(px, py, pz);
    m.scale.setScalar(this.age < 0 ? 0.5 : 1);
    if (this.size) { const q = this.squish || 0; m.scale.set(this.size * (1 - q * 0.15), this.size * (1 + q * 0.3), this.size * (1 - q * 0.15)); }
    const parts = m.userData.parts;
    if (parts && parts.robe && this.profession && m.userData.prof !== this.profession) {
      m.userData.prof = this.profession;
      const col = { farmer: '#8a6a3a', librarian: '#e4dccb', smith: '#34343a', shepherd: '#9a9a88', butcher: '#c8c4b4', fletcher: '#6a7a3a', cleric: '#7a3a8a' }[this.profession];
      parts.robe.children[0].material.userData.base.set(col);
    }
    if (parts && parts.wool) {
      parts.wool.visible = !this.sheared; parts.tuft.visible = !this.sheared;
      const rgb = WOOL_RGB[this.woolColor || 0], mat = parts.wool.children[0].material;
      if (mat.userData.color !== this.woolColor) {
        mat.userData.color = this.woolColor;
        mat.userData.base.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255).convertSRGBToLinear();
      }
    }
    const yaw = this.prevYaw + wrap(this.yaw - this.prevYaw) * alpha;
    m.rotation.set(0, yaw, 0);
    if (this.deathTime > 0) m.rotation.z = Math.min(1, (this.deathTime + alpha) / 10) * Math.PI / 2;
    else if (this.special && this.def.convertsTo) m.rotation.y += Math.sin(sec * 40) * 0.12; // shaking: about to convert
    animateModel(m, this, alpha, L, sec, this._game ? entityGlow(this._game, this.x, this.y + this.height * 0.6, this.z) : null);
    if (this.roosting) { m.rotation.z = Math.PI; m.position.y += this.height; } // hanging upside down
    if (parts && parts.armL && this.def.guard && this.swingTime > 0) parts.armL.rotation.x = parts.armR.rotation.x = -2 * Math.sin((this.swingTime - alpha) / 10 * Math.PI);
    if (this.def.customRender) this.def.customRender(this, m, alpha, sec);
    if (parts && parts.saddle) {
      if (m.userData.coat !== this.coat) {
        m.userData.coat = this.coat;
        const [body, mane] = [['#8a5a32', '#3a2414'], ['#e8e2d8', '#b8b0a4'], ['#2a2420', '#141210'], ['#a8682e', '#5a3418'], ['#7a7470', '#4a4440']][this.coat || 0];
        const tint = (k, col) => { const mm = parts[k].children[0].material; (Array.isArray(mm) ? mm[0] : mm).userData.base.set(col); };
        for (const k of ['body', 'neck', 'head', 'legFL', 'legFR', 'legBL', 'legBR']) tint(k, body);
        for (const k of ['mane', 'tail']) tint(k, mane);
      }
      parts.saddle.visible = !!this.saddled;
      parts.tail.rotation.x = 0.5 + Math.sin(sec * 3 + this.id) * 0.1;
    }
    if (parts && this.type === 'squawklet' && m.userData.coat !== this.woolColor) {
      m.userData.coat = this.woolColor;
      const [main, wing, crest] = PARROT_COLORS[this.woolColor % PARROT_COLORS.length];
      const tint = (k, col) => { const mm = parts[k].children[0].material; for (const x of Array.isArray(mm) ? [mm[0], mm[5]] : [mm]) x.userData.base.set(col); };
      for (const k of ['body', 'head']) tint(k, main);
      for (const k of ['wingL', 'wingR', 'tail']) tint(k, wing);
      tint('crest', crest);
    }
    if (parts && this.type === 'croaker' && m.userData.coat !== this.woolColor) {
      m.userData.coat = this.woolColor;
      const [skin, legs] = CROAKER_COLORS[this.woolColor % CROAKER_COLORS.length];
      const tint = (k, col) => { const mm = parts[k].children[0].material; for (const x of Array.isArray(mm) ? mm : [mm]) x.userData.base && x.userData.base.set(col); };
      for (const k of ['body', 'head']) tint(k, skin);
      for (const k of ['legFL', 'legFR', 'legBL', 'legBR']) tint(k, legs);
    }
    if (parts && this.type === 'gillnewt' && m.userData.coat !== this.woolColor) {
      m.userData.coat = this.woolColor;
      const [main, frill] = NEWT_COLORS[this.woolColor % NEWT_COLORS.length];
      const tint = (k, col) => { const mm = parts[k].children[0].material; for (const x of Array.isArray(mm) ? mm : [mm]) x.userData.base && x.userData.base.set(col); };
      for (const k of ['body', 'head', 'tail', 'legFL', 'legFR', 'legBL', 'legBR']) tint(k, main);
      for (const k of ['gillL', 'gillR', 'crest']) tint(k, frill);
    }
    if (parts && this.type === 'cragbuck') {
      for (const k of ['beard', 'hornL', 'hornR', 'earL', 'earR']) parts[k].rotation.x = parts.head.rotation.x;
      parts.hornL.visible = (this.horns ?? 2) >= 1; parts.hornR.visible = (this.horns ?? 2) >= 2;
    }
    if (parts && parts.collar) {
      parts.collar.visible = this.tamed;
      if (this.type === 'purrling' && m.userData.coat !== this.woolColor) {
        m.userData.coat = this.woolColor;
        const [fur, dark] = CAT_COATS[this.woolColor % CAT_COATS.length];
        const tint = (k, col) => { const mm = parts[k].children[0].material; for (const x of Array.isArray(mm) ? [mm[0], mm[5]] : [mm]) x.userData.base.set(col); };
        for (const k of ['body', 'mane', 'head', 'legFL', 'legFR', 'legBL', 'legBR']) tint(k, fur);
        for (const k of ['earL', 'earR', 'tail']) tint(k, dark);
      }
      for (const k of ['snout', 'nose', 'earL', 'earR']) parts[k].rotation.x = parts.head.rotation.x;
      // sitting: hindquarters down, chest up, tail on the ground
      const sit = this.sitting && this.deathTime === 0;
      m.position.y = py - (sit ? 0.18 * m.scale.y : 0);
      for (const k of ['body', 'mane', 'collar']) parts[k].rotation.x = sit ? 0.55 : 0;
      if (sit) {
        parts.legBL.rotation.x = parts.legBR.rotation.x = 1.4;
        parts.legFL.rotation.x = parts.legFR.rotation.x = -0.3;
        parts.tail.rotation.x = 1.2;
      } else parts.tail.rotation.x = this.enemy ? 0.4 : 0.6 + Math.sin(sec * 8) * (this.tamed ? 0.25 : 0.05);
      parts.tail.rotation.z = !sit && this.tamed ? Math.sin(sec * 10) * 0.35 : 0;
    }
  }
}

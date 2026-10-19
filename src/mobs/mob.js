// Mob entity: physics, damage, death/drops and goal-based AI for passive
// animals, melee/ranged/explosive hostiles, a wall-climber and a neutral
// teleporter.
import { Body } from '../physics/body.js';
import { fallDamage } from '../physics/constants.js';
import { B, SOLID } from '../world/blocks.js';
import { I } from '../world/items.js';
import { MOBS, CATEGORY } from './mobTypes.js';
import { rollDrops } from './drops.js';
import { findPath } from './pathfinding.js';
import { shouldDespawn, shouldBurnInSun } from './spawnRules.js';
import { buildModel, animateModel } from './models.js';
import { randomSheepColor, WOOL_RGB } from '../world/colors.js';
import { WOOL_ITEMS } from '../world/items.js';

let nextMobId = 1_000_000;
const TAU = Math.PI * 2;

function angleTo(dx, dz) { return Math.atan2(-dx, -dz); }
function wrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
function gaussian() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }

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
    this.persistent = this.def.category === CATEGORY.CREATURE;
    this.eggTime = 6000 + Math.floor(Math.random() * 6000);
    this.move = null;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    // breeding: age < 0 is a baby growing up, age > 0 a breeding cooldown
    this.age = 0; this.loveTicks = 0; this.breedTime = 0;
    this.sheared = false; this.eatTimer = 0;
    this.woolColor = type === 'fleecer' ? randomSheepColor() : 0;
  }

  get baby() { return this.age < 0; }

  setBaby(on) {
    this.age = on ? -24000 : 0;
    const k = on ? 0.5 : 1;
    this.body.width = this.def.width * k; this.body.height = this.def.height * k;
  }

  /** State kept when the mob is saved with its chunk. */
  saveData() { return { type: this.type, x: this.x, y: this.y, z: this.z, health: this.health, yaw: this.yaw, age: this.age, sheared: this.sheared, woolColor: this.woolColor }; }
  loadData(s) {
    this.health = s.health; this.yaw = s.yaw;
    if (s.age < 0) { this.setBaby(true); this.age = s.age; } else this.age = s.age || 0;
    this.sheared = !!s.sheared;
    if (s.woolColor !== undefined) this.woolColor = s.woolColor;
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
    const baby = g.spawner.spawnMob(this.type, (this.x + mate.x) / 2, Math.max(this.y, mate.y), (this.z + mate.z) / 2);
    baby.setBaby(true);
    baby.woolColor = Math.random() < 0.5 ? this.woolColor : mate.woolColor; // (the reference blends dye colours)
    baby.yaw = this.yaw;
    for (const m of [this, mate]) { m.loveTicks = 0; m.age = 6000; m.breedTime = 0; }
    this.hearts(g, 7);
    g.entities.spawnXp(this.x, this.y + 0.5, this.z, 1 + Math.floor(Math.random() * 7));
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
    if (attacker && attacker.isPlayer) this.lastHurtByPlayer = 100;
    if (attacker && knockback > 0) {
      const dx = this.x - attacker.x, dz = this.z - attacker.z;
      const d = Math.hypot(dx, dz) || 1;
      const b = this.body;
      b.vx = b.vx / 2 + (dx / d) * knockback;
      b.vz = b.vz / 2 + (dz / d) * knockback;
      if (b.onGround) b.vy = Math.min(0.4, b.vy / 2 + knockback);
    }
    const g = this._game;
    if (this.def.category === CATEGORY.CREATURE) this.panicTicks = 60 + Math.floor(Math.random() * 40);
    else if (attacker && attacker.isPlayer) { this.target = 'player'; if (this.type === 'voidwalker') this.angry = true; }
    if (g) g.audio.play(this.health <= 0 ? 'mob_death' : 'mob_hurt', [this.x, this.y + 1, this.z]);
    if (this.health <= 0) this.die(g, source);
    return true;
  }

  die(g, source) {
    if (this.deathTime > 0) return;
    this.deathTime = 1;
    this.health = 0;
    if (!g) return;
    const killedByPlayer = this.lastHurtByPlayer > 0;
    this.killedByPlayer = killedByPlayer;
    if (killedByPlayer) g.player.stats.kills++;
    if (this.age < 0) { this.killedByPlayer = false; return; } // babies drop nothing
    for (const d of rollDrops(this.type, { killedByPlayer, onFire: this.fireTicks > 0, sheared: this.sheared })) {
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
    return s;
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
        if (this.killedByPlayer) g.entities.spawnXp(this.x, this.y + 0.3, this.z, this.def.category === 'monster' ? 5 : 1 + Math.floor(Math.random() * 3));
        g.particles.smoke(this.x, this.y + this.height / 2, this.z, 14, this.width);
      }
      return;
    }
    if (this.invulnerable > 0) this.invulnerable--;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.lastHurtByPlayer > 0) this.lastHurtByPlayer--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    this.noActionTime++;

    const p = g.player;
    const pdx = p.x - this.x, pdy = p.y - this.y, pdz = p.z - this.z;
    const pdist = Math.hypot(pdx, pdy, pdz);
    if (!this.persistent) {
      if (pdist < 32) this.noActionTime = 0;
      if (shouldDespawn(pdist, this.noActionTime)) { this.removed = true; this.dead = true; return; }
    }

    b.updateFluidState(g.world, this.height * 0.85);
    this.move = null;
    this.ai(g, p, pdist);

    const mv = this.move || { forward: 0, jump: false };
    const jump = mv.jump || (b.inWater && b.y + this.height * 0.4 < Math.floor(b.y) + 1.2) || (b.inLava);
    b.travel(g.world, { forward: mv.forward, strafe: mv.strafe || 0, yaw: this.yaw, jump, speed: mv.forward ? this.speed() * (mv.mod || 1) : this.speed(), climbing: this.def.climbs && b.horizontalCollision && !!this.move });
    if (this.type === 'cluckling' && !b.onGround && b.vy < 0) { b.vy *= 0.6; b.fallDistance = 0; }

    // Limb animation
    const moved = Math.hypot(b.x - this.prev[0], b.z - this.prev[2]);
    this.limbAmount += (Math.min(1, moved * 4) - this.limbAmount) * 0.4;
    this.limbSwing += moved * 4;

    this.environment(g);
  }

  environment(g) {
    const b = this.body, w = g.world;
    if (b.onGround) {
      if (b.fallDistance > 0 && !this.def.noFallDamage) {
        const dmg = fallDamage(b.fallDistance);
        if (dmg > 0) this.hurt(dmg, 'fall');
      }
      b.fallDistance = 0;
    }
    if (b.inWater) { b.fallDistance = 0; this.fireTicks = 0; }
    if (b.inLava) { this.fireTicks = Math.max(this.fireTicks, 300); this.hurt(4, 'lava'); }
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
    if (this.fireTicks > 0) {
      if (this.fireTicks % 20 === 0) this.hurt(1, 'fire');
      this.fireTicks--;
      if (Math.random() < 0.3) g.particles.flame(this.x + (Math.random() - 0.5) * this.width, this.y + Math.random() * this.height, this.z + (Math.random() - 0.5) * this.width);
    }
    if (b.eyeInWater && this.type !== 'voidwalker') {
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
    if (this.def.category === CATEGORY.CREATURE) return this.passiveAI(g);
    switch (this.type) {
      case 'shambler': return this.meleeAI(g, p, pdist);
      case 'skitterer': return this.spiderAI(g, p, pdist);
      case 'rattler': return this.rangedAI(g, p, pdist);
      case 'fizzler': return this.fizzlerAI(g, p, pdist);
      case 'voidwalker': return this.voidwalkerAI(g, p, pdist);
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
      p.hurt(this.def.attack, 'mob:' + this.def.name, this);
    }
  }

  meleeAI(g, p, pdist) {
    if (this.acquire(g, p, pdist, this.def.followRange)) {
      this.chase(g, p, 1);
      this.tryMelee(g, p);
      this.headPitch = 0;
    } else this.wanderAI(g, 1);
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
    g.entities.spawnArrow(sx, sy, sz, vx / vl * 1.6, vy / vl * 1.6, vz / vl * 1.6, this, false);
    g.audio.play('bow', [sx, sy, sz]);
  }

  fizzlerAI(g, p, pdist) {
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
    const parts = m.userData.parts;
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
    animateModel(m, this, alpha, L, sec);
  }
}

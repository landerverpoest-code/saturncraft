// The player: physics body, survival stats and environmental damage.
import { Body } from '../physics/body.js';
import { PHYS, fallDamage } from '../physics/constants.js';
import { HungerManager, EXHAUSTION, MAX_HEALTH, MAX_AIR, SPRINT_MIN_FOOD } from './survival.js';
import { Inventory } from './inventory.js';
import { B, SOLID } from '../world/blocks.js';
import { MIN_Y } from '../world/constants.js';
import { armorReduce, armorTotals, wearArmor, BYPASSES_ARMOR } from './armor.js';
import { newXp } from './experience.js';
import { protectionFactor, protectionReduce } from '../world/enchantments.js';
import { gliderUsable, canStartGliding, glideStep, rocketBoost, wallDamage, wearsThisTick } from './glider.js';
import { EFFECTS, addEffect as stackEffect, tickEffects, effectLevel, speedFactor, jumpBonus, fallDamageWithEffects, periodicActions, instantAmount } from './effects.js';

const FIRE_SOURCES = new Set(['fire', 'lava', 'fireball']);

export class Player {
  constructor() {
    this.body = new Body(PHYS.PLAYER_WIDTH, PHYS.PLAYER_HEIGHT);
    this.prev = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0;
    this.health = MAX_HEALTH;
    this.hunger = new HungerManager();
    this.air = MAX_AIR;
    this.fireTicks = 0;
    this.invulnerable = 0;      // vanilla: 20 ticks after a hit, damage below last hit ignored while > 10
    this.lastHurt = 0;
    this.hurtTime = 0;          // red flash
    this.effects = {};          // name -> { amp, ticks, hidden } (see effects.js)
    this.inventory = new Inventory(36);
    this.sprinting = false;
    this.sneaking = false;
    this.dead = false;
    this.spawn = { x: 0.5, y: 80, z: 0.5 };
    this.jumpCooldown = 0;
    this.attackTicks = 100;     // ticks since last swing (attack cooldown)
    this.listeners = { hurt: [], death: [] };
    this.stats = { blocksMined: 0, kills: 0 };
    this.xp = newXp();
    this.gamemode = 'survival';  // or 'creative'
    this.flying = false;
    this.xpDelay = 0;           // ticks until the next orb can be absorbed
    this.enchSeed = (Math.random() * 0x7fffffff) | 0; // enchanting-table offers stay put until something is enchanted
  }

  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }
  get eyeHeight() { return this.swimming || this.gliding ? 0.4 : this.sneaking ? PHYS.PLAYER_SNEAK_EYE : PHYS.PLAYER_EYE; }
  get food() { return this.hunger.food; }

  setPosition(x, y, z) {
    this.body.setPos(x, y, z);
    this.prev = { x, y, z };
    this.body.vx = this.body.vy = this.body.vz = 0;
    this.body.fallDistance = 0;
  }

  get creative() { return this.gamemode === 'creative'; }

  setGamemode(mode) {
    this.gamemode = mode;
    this.inventory.creative = mode === 'creative';
    if (mode !== 'creative') this.flying = false;
    this.fireTicks = 0;
  }

  heal(n) { if (!this.dead) this.health = Math.min(MAX_HEALTH, this.health + n); }

  /**
   * Apply damage with the reference game's invulnerability window.
   * @returns {boolean} whether damage was applied
   */
  hurt(amount, source = 'generic', attacker = null) {
    if (this.dead || amount <= 0) return false;
    if (this.creative && source !== 'void' && source !== 'kill') return false; // creative players only die in the void
    // a raised shield stops hits and arrows from in front (within 90 degrees of the view)
    if (this.blocking && attacker && attacker.x !== undefined && source !== 'fall' && source !== 'fire' && source !== 'drown' && source !== 'starve') {
      const dx = attacker.x - this.x, dz = attacker.z - this.z, d = Math.hypot(dx, dz) || 1;
      const lx = -Math.sin(this.yaw), lz = -Math.cos(this.yaw);
      if ((dx * lx + dz * lz) / d > 0) {
        for (const f of this.listeners.blocked || []) f(amount, attacker);
        return false;
      }
    }
    if (FIRE_SOURCES.has(source) && this.effects.fire_resistance) return false;
    if (this.invulnerable > 10) {
      if (amount <= this.lastHurt) return false;
      const extra = amount - this.lastHurt;
      this.lastHurt = amount;
      amount = extra;
    } else {
      this.lastHurt = amount;
      this.invulnerable = 20;
      this.hurtTime = 10;
    }
    if (!BYPASSES_ARMOR.has(source)) {
      const { points, toughness } = armorTotals(this.inventory.armor);
      if (points > 0) {
        const broke = wearArmor(this.inventory.armor, amount);
        if (broke.length) for (const f of this.listeners.armorBroke || []) f(broke);
        amount = armorReduce(amount, points, toughness);
        this.inventory.changed();
      }
    }
    // Bulwark (all damage but the void / starving) and Featherstep (falls) on worn armour
    const epf = protectionFactor(this.inventory.armor, source);
    if (epf > 0) amount = protectionReduce(amount, epf);
    this.health = Math.max(0, this.health - amount);
    this.hunger.addExhaustion(EXHAUSTION.DAMAGE);
    if (attacker && attacker.kind === 'mob') this.lastHurtBy = attacker; // tamed Howlers defend their owner
    if (attacker && attacker.x !== undefined) {
      // knockback away from attacker
      const dx = this.x - attacker.x, dz = this.z - attacker.z;
      const d = Math.hypot(dx, dz) || 1;
      this.body.vx = this.body.vx / 2 + (dx / d) * 0.4;
      this.body.vz = this.body.vz / 2 + (dz / d) * 0.4;
      if (this.body.onGround) this.body.vy = Math.min(0.4, this.body.vy / 2 + 0.4);
    }
    for (const f of this.listeners.hurt) f(amount, source);
    if (this.health <= 0) this.die(source);
    return true;
  }

  die(source) {
    if (this.dead) return;
    this.dead = true;
    this.deathCause = source;
    for (const f of this.listeners.death) f(source);
  }

  respawn() {
    this.dead = false;
    this.health = MAX_HEALTH;
    this.hunger = new HungerManager();
    this.air = MAX_AIR;
    this.fireTicks = 0;
    this.effects = {};
    this.setPosition(this.spawn.x, this.spawn.y, this.spawn.z);
  }

  /** Add a lasting effect (reference stacking: stronger replaces, equal extends). */
  addEffect(type, ticks, amp = 0) {
    if (!EFFECTS[type] || this.dead) return false;
    const ok = stackEffect(this.effects, type, ticks, amp);
    if (ok) for (const f of this.listeners.effect || []) f(type);
    return ok;
  }

  /** Apply one effect of an elixir: instant ones act at once (scaled by a splash factor), others last ticks * factor. */
  applyEffect(type, ticks, amp = 0, factor = 1) {
    if (this.dead || !EFFECTS[type]) return;
    if (EFFECTS[type].instant) {
      const n = instantAmount(type, amp, factor);
      if (type === 'instant_health') this.heal(n); else if (n > 0) { this.invulnerable = 0; this.hurt(n, 'magic'); }
      return;
    }
    const t = Math.floor(ticks * factor + 0.5);
    if (t > 20) this.addEffect(type, t, amp);
  }

  hasEffect(type) { return !!this.effects[type]; }
  effectLevel(type) { return effectLevel(this.effects, type); }
  clearEffects() { this.effects = {}; for (const f of this.listeners.effect || []) f(null); }

  /**
   * One 50 ms tick.
   * @param world
   * @param input {forward, strafe, jump, sprint, sneak}
   */
  tick(world, input) {
    const b = this.body;
    this.prev = { x: b.x, y: b.y, z: b.z };
    if (this.dead) return;
    if (this.invulnerable > 0) this.invulnerable--;
    if (this.xpDelay > 0) this.xpDelay--;
    if (this.hurtTime > 0) this.hurtTime--;
    this.attackTicks++;

    // Sneaking changes the hitbox height (only if there is room to stand)
    if (this.flyGrace > 0) this.flyGrace--;
    if (this.flying && ((b.onGround && !this.flyGrace) || !this.creative)) this.flying = false; // landing ends flight
    const wantSneak = !!input.sneak && !this.flying; // sneak descends while flying
    if (!wantSneak && this.sneaking) {
      if (!world.boxCollides(b.x - 0.3, b.y, b.z - 0.3, b.x + 0.3, b.y + PHYS.PLAYER_HEIGHT, b.z + 0.3)) this.sneaking = false;
    } else this.sneaking = wantSneak;
    b.height = this.sneaking ? PHYS.PLAYER_SNEAK_HEIGHT : PHYS.PLAYER_HEIGHT;

    b.updateFluidState(world, this.eyeHeight);
    // Sprint-swimming: sprinting with your head under water lays you flat (0.6 high) and you swim where you look;
    // you stand up again once out of the water with room above
    if (!this.swimming && this.sprinting && b.inWater && b.eyeInWater && !this.flying) this.swimming = true;
    if (this.swimming && (!b.inWater || !this.sprinting) && !world.boxCollides(b.x - 0.3, b.y, b.z - 0.3, b.x + 0.3, b.y + PHYS.PLAYER_HEIGHT, b.z + 0.3)) this.swimming = false;
    if (this.swimming) b.height = 0.6;

    // Sprint rules
    const canSprint = (this.creative || this.hunger.food >= SPRINT_MIN_FOOD) && !this.sneaking && input.forward > 0 && !this.effects.blindness;
    const fx = this.effects;
    if (input.sprint && canSprint) this.sprinting = true;
    if (!canSprint || (b.horizontalCollision && !b.inWater)) this.sprinting = false;
    if (this.swimming && input.forward > 0 && (this.creative || this.hunger.food >= SPRINT_MIN_FOOD)) this.sprinting = true; // keep swimming while W is held

    const wasOnGround = b.onGround;
    const x0 = b.x, z0 = b.z, y0 = b.y;
    // Voidwing gliding (player/glider.js): press jump in mid-air to spread the wings
    const jumpPressed = !!input.jump && !this.prevJump;
    this.prevJump = !!input.jump;
    const chest = this.inventory.armor[1];
    if (this.gliding && (b.onGround || b.inWater || b.inLava || this.flying || fx.levitation || !gliderUsable(chest))) { this.gliding = false; this.boostTicks = 0; }
    if (!this.gliding && jumpPressed && canStartGliding({ onGround: b.onGround, inWater: b.inWater, inLava: b.inLava, flying: this.flying, levitating: !!fx.levitation, chest })) {
      this.gliding = true; this.glideTicks = 0;
    }
    if (this.gliding) this.glide(world, chest);
    else b.travel(world, {
      // raising a shield slows you to a fifth, like sneaking
      forward: input.forward * (this.blocking ? 0.2 : 1), strafe: input.strafe * (this.blocking ? 0.2 : 1), yaw: this.yaw,
      jump: input.jump && (this.jumpCooldown === 0 || b.inWater || b.inLava),
      sprint: this.sprinting, sneak: this.sneaking, swim: this.swimming, pitch: this.pitch,
      flying: this.flying, descend: this.flying && !!input.sneak,
      speed: PHYS.WALK_SPEED * speedFactor(fx),
      jumpFactor: 1 + jumpBonus(fx) / PHYS.JUMP_VELOCITY,
      slowFall: !!fx.slow_falling,
      levitation: effectLevel(fx, 'levitation'),
    });
    if (fx.slow_falling) b.fallDistance = 0;
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    if (b.jumped) this.jumpCooldown = 10;
    if (!input.jump) this.jumpCooldown = 0;

    // Exhaustion from movement
    if (this.creative) this.hunger.exhaustion = 0;
    const dist = Math.hypot(b.x - x0, b.z - z0);
    if (b.inWater) this.hunger.addExhaustion(EXHAUSTION.SWIM_PER_M * Math.hypot(dist, b.y - y0));
    else if (this.sprinting && wasOnGround) this.hunger.addExhaustion(EXHAUSTION.SPRINT_PER_M * dist);
    if (b.jumped) this.hunger.addExhaustion(this.sprinting ? EXHAUSTION.SPRINT_JUMP : EXHAUSTION.JUMP);

    // Fall damage on landing
    b.updateFluidState(world, this.eyeHeight);
    if (b.inWater) b.fallDistance = 0;
    if (b.onGround) {
      if (b.fallDistance > 0) {
        const onHay = world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.01), Math.floor(b.z)) === B.HAY_BALE;
        const dmg = fallDamageWithEffects(Math.floor(fallDamage(b.fallDistance) * (onHay ? 0.2 : 1)), fx); // hay softens a fall by 80 %
        if (dmg > 0) this.hurt(dmg, 'fall');
        this.landedFrom = b.fallDistance;
      }
      b.fallDistance = 0;
    }

    // Environment
    if (b.inLava) {
      this.fireTicks = Math.max(this.fireTicks, 300);
      this.hurt(4, 'lava');
    }
    if (b.inFire && !b.inWater) {
      this.fireTicks = Math.max(this.fireTicks, 160);
      this.hurt(1, 'fire');
    }
    if (b.inWater) this.fireTicks = 0;
    // standing on a lit campfire burns (1 per second)
    if (!this.creative && world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.01), Math.floor(b.z)) === B.CAMPFIRE && this.attackTicks % 20 === 0) this.hurt(1, 'fire');
    if (this.fireTicks > 0) {
      if (this.fireTicks % 20 === 0) this.hurt(1, 'fire');
      this.fireTicks--;
    }
    if (b.eyeInWater && !fx.water_breathing) {
      this.air--;
      if (this.air <= -20) { this.air = 0; this.hurt(2, 'drown'); }
    } else this.air = Math.min(MAX_AIR, this.air + 4);
    // Cactus contact
    const bx = b.box();
    if (this.touches(world, bx, B.CACTUS)) this.hurt(1, 'cactus');
    if (b.y < MIN_Y - 64) this.hurt(4, 'void');

    // Effects
    if (this.effects.hunger) this.hunger.addExhaustion(EXHAUSTION.HUNGER_EFFECT_PER_TICK * effectLevel(this.effects, 'hunger'));
    for (const a of periodicActions(this.effects, { health: this.health })) {
      if (a.type === 'heal') this.heal(a.amount);
      else { this.invulnerable = Math.min(this.invulnerable, 10); this.hurt(a.amount, a.source); }
    }
    const before = Object.keys(this.effects).length;
    tickEffects(this.effects);
    if (Object.keys(this.effects).length !== before) for (const f of this.listeners.effect || []) f(null);

    if (!this.creative) this.hunger.tick(this);
  }

  /** One tick of gliding flight: reference physics, rocket boosts, wall damage and wing wear. */
  glide(world, chest) {
    const b = this.body;
    b.height = 0.6;
    this.sprinting = false;
    if (this.boostTicks > 0) { rocketBoost(b, this.yaw, this.pitch); this.boostTicks--; }
    const before = Math.hypot(b.vx, b.vz);
    if (b.vy > -0.5) b.fallDistance = 1; // a gentle glide does not build up fall damage
    glideStep(b, this.yaw, this.pitch, this.effects.slow_falling && b.vy <= 0 ? 0.01 : 0.08);
    b.move(world, b.vx, b.vy, b.vz);
    b.jumped = false;
    if (b.horizontalCollision) {
      const dmg = wallDamage(before, Math.hypot(b.vx, b.vz));
      if (dmg > 0) this.hurt(dmg, 'wall');
    }
    if (wearsThisTick(this.glideTicks++) && !this.creative && chest) { chest.damage = (chest.damage | 0) + 1; this.inventory.changed(); }
  }

  touches(world, bx, id) {
    const e = 0.01;
    for (let x = Math.floor(bx[0] - e); x <= Math.floor(bx[3] + e); x++)
      for (let y = Math.floor(bx[1]); y <= Math.floor(bx[4] - 0.001); y++)
        for (let z = Math.floor(bx[2] - e); z <= Math.floor(bx[5] + e); z++)
          if (world.getBlock(x, y, z) === id) return true;
    return false;
  }

  /** Is there room to place a block at x,y,z without overlapping the player? */
  intersectsBlock(x, y, z) {
    const b = this.body.box();
    return b[0] < x + 1 && b[3] > x && b[1] < y + 1 && b[4] > y && b[2] < z + 1 && b[5] > z;
  }

  eyePos() { return [this.body.x, this.body.y + this.eyeHeight, this.body.z]; }
  lookDir() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }
}

export { SOLID };

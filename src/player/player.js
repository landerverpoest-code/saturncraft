// The player: physics body, survival stats and environmental damage.
import { Body } from '../physics/body.js';
import { PHYS, fallDamage } from '../physics/constants.js';
import { HungerManager, EXHAUSTION, MAX_HEALTH, MAX_AIR, SPRINT_MIN_FOOD } from './survival.js';
import { Inventory } from './inventory.js';
import { B, SOLID } from '../world/blocks.js';
import { MIN_Y } from '../world/constants.js';

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
    this.effects = {};          // name -> ticks
    this.inventory = new Inventory(36);
    this.sprinting = false;
    this.sneaking = false;
    this.dead = false;
    this.spawn = { x: 0.5, y: 80, z: 0.5 };
    this.jumpCooldown = 0;
    this.attackTicks = 100;     // ticks since last swing (attack cooldown)
    this.listeners = { hurt: [], death: [] };
    this.stats = { blocksMined: 0, kills: 0 };
  }

  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }
  get eyeHeight() { return this.sneaking ? PHYS.PLAYER_SNEAK_EYE : PHYS.PLAYER_EYE; }
  get food() { return this.hunger.food; }

  setPosition(x, y, z) {
    this.body.setPos(x, y, z);
    this.prev = { x, y, z };
    this.body.vx = this.body.vy = this.body.vz = 0;
    this.body.fallDistance = 0;
  }

  heal(n) { if (!this.dead) this.health = Math.min(MAX_HEALTH, this.health + n); }

  /**
   * Apply damage with the reference game's invulnerability window.
   * @returns {boolean} whether damage was applied
   */
  hurt(amount, source = 'generic', attacker = null) {
    if (this.dead || amount <= 0) return false;
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
    this.health = Math.max(0, this.health - amount);
    this.hunger.addExhaustion(EXHAUSTION.DAMAGE);
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

  addEffect(type, ticks) { this.effects[type] = Math.max(this.effects[type] || 0, ticks); }

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
    if (this.hurtTime > 0) this.hurtTime--;
    this.attackTicks++;

    // Sneaking changes the hitbox height (only if there is room to stand)
    const wantSneak = !!input.sneak;
    if (!wantSneak && this.sneaking) {
      if (!world.boxCollides(b.x - 0.3, b.y, b.z - 0.3, b.x + 0.3, b.y + PHYS.PLAYER_HEIGHT, b.z + 0.3)) this.sneaking = false;
    } else this.sneaking = wantSneak;
    b.height = this.sneaking ? PHYS.PLAYER_SNEAK_HEIGHT : PHYS.PLAYER_HEIGHT;

    b.updateFluidState(world, this.eyeHeight);

    // Sprint rules
    const canSprint = this.hunger.food >= SPRINT_MIN_FOOD && !this.sneaking && input.forward > 0 && !this.effects.blindness;
    if (input.sprint && canSprint) this.sprinting = true;
    if (!canSprint || (b.horizontalCollision && !b.inWater)) this.sprinting = false;

    const wasOnGround = b.onGround;
    const x0 = b.x, z0 = b.z, y0 = b.y;
    b.travel(world, {
      forward: input.forward, strafe: input.strafe, yaw: this.yaw,
      jump: input.jump && (this.jumpCooldown === 0 || b.inWater || b.inLava),
      sprint: this.sprinting, sneak: this.sneaking,
    });
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    if (b.jumped) this.jumpCooldown = 10;
    if (!input.jump) this.jumpCooldown = 0;

    // Exhaustion from movement
    const dist = Math.hypot(b.x - x0, b.z - z0);
    if (b.inWater) this.hunger.addExhaustion(EXHAUSTION.SWIM_PER_M * Math.hypot(dist, b.y - y0));
    else if (this.sprinting && wasOnGround) this.hunger.addExhaustion(EXHAUSTION.SPRINT_PER_M * dist);
    if (b.jumped) this.hunger.addExhaustion(this.sprinting ? EXHAUSTION.SPRINT_JUMP : EXHAUSTION.JUMP);

    // Fall damage on landing
    b.updateFluidState(world, this.eyeHeight);
    if (b.inWater) b.fallDistance = 0;
    if (b.onGround) {
      if (b.fallDistance > 0) {
        const dmg = fallDamage(b.fallDistance);
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
    if (b.inWater) this.fireTicks = 0;
    if (this.fireTicks > 0) {
      if (this.fireTicks % 20 === 0) this.hurt(1, 'fire');
      this.fireTicks--;
    }
    if (b.eyeInWater) {
      this.air--;
      if (this.air <= -20) { this.air = 0; this.hurt(2, 'drown'); }
    } else this.air = Math.min(MAX_AIR, this.air + 4);
    // Cactus contact
    const bx = b.box();
    if (this.touches(world, bx, B.CACTUS)) this.hurt(1, 'cactus');
    if (b.y < MIN_Y - 64) this.hurt(4, 'void');

    // Effects
    if (this.effects.hunger) this.hunger.addExhaustion(EXHAUSTION.HUNGER_EFFECT_PER_TICK);
    if (this.effects.poison && this.effects.poison % 25 === 0 && this.health > 1) this.hurt(1, 'poison');
    for (const k of Object.keys(this.effects)) if (--this.effects[k] <= 0) delete this.effects[k];

    this.hunger.tick(this);
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

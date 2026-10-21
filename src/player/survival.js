// Hunger, saturation, exhaustion and natural regeneration, following the
// documented food mechanics (Normal difficulty).
export const EXHAUSTION = {
  SPRINT_PER_M: 0.1,
  SWIM_PER_M: 0.01,
  JUMP: 0.05,
  SPRINT_JUMP: 0.2,
  ATTACK: 0.1,
  DAMAGE: 0.1,
  BREAK_BLOCK: 0.005,
  REGEN: 6.0,
  HUNGER_EFFECT_PER_TICK: 0.005,
};

export const MAX_FOOD = 20;
export const MAX_HEALTH = 20;
export const MAX_AIR = 300;
export const SPRINT_MIN_FOOD = 7; // sprinting needs food > 6

export class HungerManager {
  constructor() {
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.timer = 0;
    this.peaceTimer = 0;
  }

  addExhaustion(v) { this.exhaustion = Math.min(40, this.exhaustion + v); }

  eat(hunger, saturation) {
    this.food = Math.min(MAX_FOOD, this.food + hunger);
    this.saturation = Math.min(this.saturation + saturation, this.food);
  }

  canEat() { return this.food < MAX_FOOD; }

  /**
   * One game tick.
   * @param {{health:number, heal:(n:number)=>void, hurt:(n:number, src:string)=>void}} p
   */
  tick(p) {
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(this.saturation - 1, 0);
      else this.food = Math.max(this.food - 1, 0);
    }
    const hurt = p.health > 0 && p.health < MAX_HEALTH;
    if (this.saturation > 0 && hurt && this.food >= 20) {
      if (++this.timer >= 10) {
        const f = Math.min(this.saturation, 6);
        p.heal(f / 6);
        this.addExhaustion(f);
        this.timer = 0;
      }
    } else if (this.food >= 18 && hurt) {
      if (++this.timer >= 80) {
        p.heal(1);
        this.addExhaustion(EXHAUSTION.REGEN);
        this.timer = 0;
      }
    } else if (this.food <= 0) {
      if (++this.timer >= 80) {
        // starving stops at 5 hearts on Easy and half a heart on Normal; on Hard it kills
        const floor = p.difficulty === 'easy' ? 10 : p.difficulty === 'hard' ? 0 : 1;
        if (p.health > floor) p.hurt(1, 'starve');
        this.timer = 0;
      }
    } else this.timer = 0;
    if (p.difficulty === 'peaceful' && p.health > 0) {
      // Peaceful: health and hunger come back by themselves
      if (++this.peaceTimer >= 20) { this.peaceTimer = 0; if (p.health < MAX_HEALTH) p.heal(1); if (this.food < MAX_FOOD) this.food++; }
    }
  }
}

// Player interaction with the world: mining (with break progress), placing,
// attacking with the attack cooldown, eating, buckets and containers.
import { B, BLOCKS, SOLID, SHAPE, isFluid } from '../world/blocks.js';
import { ITEMS, I, toolOf, isBlockItem } from '../world/items.js';
import { breakProgressPerTick, blockDrops } from '../world/mining.js';
import { PHYS } from '../physics/constants.js';
import { EXHAUSTION } from './survival.js';
import { lightAt } from '../entities/entities.js';

/** Brightness for block particles: local light, dimmed with the combined sunlight (as the held item). */
function particleLight(g, x, y, z) {
  return lightAt(g, x, y, z) * (0.4 + 0.6 * Math.min(1, g.sky.state.combined + 0.25));
}

export const EAT_TICKS = 32;
export const SWING_TICKS = 6;
const BREAK_DELAY = 5;
const USE_DELAY = 4;

export class Interaction {
  constructor(game) {
    this.game = game;
    this.target = null;       // block raycast result
    this.mobTarget = null;
    this.breaking = null;     // {x,y,z,id,progress}
    this.breakDelay = 0;
    this.useDelay = 0;
    this.eating = 0;
    this.swing = 0;
    this.bowDraw = 0;
  }

  attackCooldownTicks() {
    const tool = toolOf(this.game.player.inventory.selectedStack);
    return 20 / tool.attackSpeed;
  }
  attackCooldownProgress() {
    const p = this.game.player;
    return Math.min(1, (p.attackTicks + 0.5) / this.attackCooldownTicks());
  }

  updateTarget() {
    const g = this.game, p = g.player;
    const [ex, ey, ez] = p.eyePos();
    const [dx, dy, dz] = p.lookDir();
    this.target = g.world.raycast(ex, ey, ez, dx, dy, dz, PHYS.REACH);
    this.mobTarget = g.entities ? g.entities.raycastMob(ex, ey, ez, dx, dy, dz, 3.0) : null;
    if (this.mobTarget && this.target && this.target.dist < this.mobTarget.dist) this.mobTarget = null;
  }

  tick(input) {
    const g = this.game, p = g.player;
    if (p.dead) return;
    this.updateTarget();
    if (this.breakDelay > 0) this.breakDelay--;
    if (this.useDelay > 0) this.useDelay--;
    if (this.swing > 0) this.swing--;

    // Attack / mine
    if (input.leftPressed && this.mobTarget) {
      this.attack(this.mobTarget.mob);
    } else if (input.left && this.target && !this.mobTarget) {
      this.mine();
    } else {
      this.breaking = null;
    }
    if (input.leftPressed && !this.mobTarget && !this.target) { this.swing = SWING_TICKS; p.attackTicks = 0; }

    // Use
    const st = p.inventory.selectedStack;
    const d = st && ITEMS[st.id];
    if (input.right && d && d.food) {
      if (p.hunger.canEat()) {
        this.eating++;
        if (this.eating % 4 === 0) g.audio.play('eat');
        if (this.eating >= EAT_TICKS) { this.eat(st); this.eating = 0; }
      }
      return;
    }
    this.eating = 0;
    if (d && d.bow) {
      if (input.right) this.bowDraw++;
      else if (this.bowDraw > 0) { this.releaseBow(); this.bowDraw = 0; }
      return;
    }
    if (input.right && this.useDelay === 0) {
      if (this.use()) this.useDelay = USE_DELAY;
    }
    if (input.middlePressed && this.target) this.pickBlock(this.target.id);
  }

  mine() {
    const g = this.game, p = g.player, t = this.target;
    if (this.breakDelay > 0) return;
    if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z || this.breaking.id !== t.id) {
      this.breaking = { x: t.x, y: t.y, z: t.z, id: t.id, progress: 0 };
    }
    const tool = toolOf(p.inventory.selectedStack);
    const per = breakProgressPerTick(t.id, tool, { onGround: p.body.onGround || p.body.inWater, inWater: p.body.eyeInWater });
    this.breaking.progress += per;
    // holding the button chains full swings into a continuous chopping motion
    if (this.swing <= 0) this.swing = SWING_TICKS;
    if (g.ticks % 4 === 0) {
      g.audio.play('hit_' + BLOCKS[t.id].sound, [t.x + 0.5, t.y + 0.5, t.z + 0.5]);
      g.particles && g.particles.blockHit(t.x, t.y, t.z, t.id, t.face, particleLight(g, t.x + 0.5 + t.face[0], t.y + 0.5 + t.face[1], t.z + 0.5 + t.face[2]));
    }
    if (this.breaking.progress >= 1) {
      this.breakBlock(t.x, t.y, t.z, t.id, tool);
      this.breaking = null;
      if (per < 1) this.breakDelay = BREAK_DELAY;
    }
  }

  breakBlock(x, y, z, id, tool) {
    const g = this.game, p = g.player;
    const meta = g.world.getMeta(x, y, z);
    g.world.setBlockUrgent(x, y, z, B.AIR);
    if (g.onBlockBroken) g.onBlockBroken(x, y, z, id, meta);
    g.audio.play('break_' + BLOCKS[id].sound, [x + 0.5, y + 0.5, z + 0.5]);
    g.particles && g.particles.blockBreak(x, y, z, id, particleLight(g, x + 0.5, y + 0.5, z + 0.5));
    for (const drop of blockDrops(id, tool)) g.entities.spawnItem(x + 0.5, y + 0.3, z + 0.5, drop);
    // Ice melts into water when broken above a solid block
    if (id === B.ICE && SOLID[g.world.getBlock(x, y - 1, z)]) {
      g.world.setBlockUrgent(x, y, z, B.WATER, 0);
      g.world.scheduleTick(x, y, z, 5);
    }
    p.hunger.addExhaustion(EXHAUSTION.BREAK_BLOCK);
    p.stats.blocksMined++;
    if (BLOCKS[id].hardness > 0 && tool.type) p.inventory.damageSelected(tool.type === 'sword' ? 2 : 1);
  }

  attack(mob) {
    const g = this.game, p = g.player;
    const tool = toolOf(p.inventory.selectedStack);
    const cd = this.attackCooldownProgress();
    let dmg = tool.damage * (0.2 + cd * cd * 0.8);
    const crit = cd > 0.9 && p.body.fallDistance > 0 && !p.body.onGround && !p.body.inWater && !p.sprinting;
    if (crit) dmg *= 1.5;
    const knock = 0.4 + (p.sprinting && cd > 0.9 ? 1 : 0) * 0.5;
    if (mob.hurt(dmg, 'player', p, knock)) {
      if (crit) g.particles && g.particles.crit(mob.x, mob.y + mob.height * 0.6, mob.z);
      if (p.sprinting && cd > 0.9) p.sprinting = false;
      if (tool.type) p.inventory.damageSelected(tool.type === 'sword' ? 1 : 2);
    }
    p.hunger.addExhaustion(EXHAUSTION.ATTACK);
    p.attackTicks = 0;
    this.swing = SWING_TICKS;
  }

  eat(st) {
    const g = this.game, p = g.player;
    const f = ITEMS[st.id].food;
    p.hunger.eat(f.hunger, f.saturation);
    if (f.effect && Math.random() < f.effect.chance) p.addEffect(f.effect.type, f.effect.ticks);
    p.inventory.removeFromSlot(p.inventory.selected, 1);
    g.audio.play('burp');
  }

  releaseBow() {
    const g = this.game, p = g.player;
    const slot = p.inventory.slots.findIndex((s) => s && s.id === I.ARROW);
    if (slot < 0) return;
    // charge curve: f = t/20; power = (f^2 + 2f)/3 capped at 1
    let f = this.bowDraw / 20;
    f = (f * f + f * 2) / 3;
    if (f < 0.1) return;
    f = Math.min(1, f);
    const [ex, ey, ez] = p.eyePos();
    const [dx, dy, dz] = p.lookDir();
    g.entities.spawnArrow(ex, ey - 0.1, ez, dx * 3 * f, dy * 3 * f, dz * 3 * f, p, f >= 1);
    p.inventory.removeFromSlot(slot, 1);
    p.inventory.damageSelected(1);
    g.audio.play('bow');
  }

  /** Right-click action. Returns true if something happened. */
  use() {
    const g = this.game, p = g.player, w = g.world;
    const st = p.inventory.selectedStack;
    const d = st && ITEMS[st.id];
    // Buckets
    if (st && (st.id === I.BUCKET)) {
      const [ex, ey, ez] = p.eyePos();
      const [dx, dy, dz] = p.lookDir();
      const hit = w.raycast(ex, ey, ez, dx, dy, dz, PHYS.REACH, true);
      if (hit && isFluid(hit.id) && w.getMeta(hit.x, hit.y, hit.z) === 0) {
        w.setBlockUrgent(hit.x, hit.y, hit.z, B.AIR);
        p.inventory.removeFromSlot(p.inventory.selected, 1);
        const full = { id: hit.id === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET, count: 1 };
        if (!p.inventory.selectedStack) p.inventory.slots[p.inventory.selected] = full;
        else if (p.inventory.add(full)) g.entities.spawnItem(p.x, p.y + 1, p.z, full);
        p.inventory.changed();
        g.audio.play('bucket_fill');
        return true;
      }
      return false;
    }
    const t = this.target;
    if (!t) return false;
    // Interactive blocks
    if (!p.sneaking || !st) {
      if (t.id === B.WORKBENCH) { g.ui.openWorkbench(); return true; }
      if (t.id === B.FURNACE || t.id === B.FURNACE_LIT) { g.ui.openFurnace(t.x, t.y, t.z); return true; }
    }
    if (!st) return false;
    let placeId = isBlockItem(st.id) ? st.id : d.places;
    if (placeId === undefined) return false;
    // Place location: replace soft blocks, else the adjacent cell
    let px = t.x, py = t.y, pz = t.z;
    const tb = BLOCKS[t.id];
    if (!(tb.replaceable && !isFluid(t.id))) { px += t.face[0]; py += t.face[1]; pz += t.face[2]; }
    const cur = w.getBlock(px, py, pz);
    if (cur && !BLOCKS[cur].replaceable) return false;
    if (SOLID[placeId] && (p.intersectsBlock(px, py, pz) || g.entities.blockOccupied(px, py, pz))) return false;
    if (BLOCKS[placeId].needsSupport && !w.hasSupport(px, py, pz, placeId)) return false;
    if ((placeId === B.TALL_GRASS || placeId === B.SUNPETAL || placeId === B.REDBLOOM) && !w.hasSupport(px, py, pz, placeId)) return false;
    let meta = 0;
    if (placeId === B.FURNACE) {
      // face the player: meta 0 = -z front, 1 = +x, 2 = +z, 3 = -x
      const dx = p.x - (px + 0.5), dz = p.z - (pz + 0.5);
      meta = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0);
    }
    w.setBlockUrgent(px, py, pz, placeId, meta);
    if (isFluid(placeId)) w.scheduleTick(px, py, pz, 5);
    g.audio.play('place_' + BLOCKS[placeId].sound, [px + 0.5, py + 0.5, pz + 0.5]);
    if (d.places) {
      p.inventory.slots[p.inventory.selected] = { id: I.BUCKET, count: 1, damage: 0 };
      p.inventory.changed();
    } else p.inventory.removeFromSlot(p.inventory.selected, 1);
    this.swing = SWING_TICKS;
    return true;
  }

  pickBlock(id) {
    const inv = this.game.player.inventory;
    const want = BLOCKS[id] && typeof BLOCKS[id].drops === 'number' && !isBlockItem(id) ? BLOCKS[id].drops : id;
    for (let i = 0; i < 9; i++) if (inv.slots[i] && inv.slots[i].id === want) { inv.selected = i; return; }
  }
}

export { SHAPE };

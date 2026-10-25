// Player interaction with the world: mining (with break progress), placing,
// attacking with the attack cooldown, eating, buckets and containers.
import { Mob } from '../mobs/mob.js';
import { pairOnPlace } from '../world/chests.js';
import { hopperPlaceMeta } from '../world/hoppers.js';
import { dispenserPlaceMeta } from '../world/dispensers.js';
import { compost, READY, SETTLE_TICKS } from '../world/composter.js';
import { B, BLOCKS, SOLID, SHAPE, isFluid, CROPS, isFurnace, DOOR_SETS, CANDLES, POTTED } from '../world/blocks.js';
import { ITEMS, I, toolOf, isBlockItem, WOOL_ITEMS, POTION_ITEM, isArrow, DISCS } from '../world/items.js';
import { POTIONS } from '../world/potions.js';
import { breakProgressPerTick, blockDrops, canHarvest } from '../world/mining.js';
import { enchLevel, meleeBonus, silkDropsSelf } from '../world/enchantments.js';
import { PHYS } from '../physics/constants.js';
import { Body } from '../physics/body.js';
import { EXHAUSTION } from './survival.js';
import { meleeWithEffects } from './effects.js';
import { lightAt } from '../entities/entities.js';
import { canLight, FIRE_DELAY } from '../world/fire.js';
import { Bobber } from '../entities/bobber.js';
import { igniteTNT } from '../entities/tnt.js';
import { scaffoldDistance, scaffoldColumnTop, SCAFFOLD_MAX } from '../world/scaffolding.js';
import { updateRails } from '../world/rails.js';
import { placeMeta as circuitPlaceMeta, useMeta as circuitUseMeta } from '../world/circuits.js';
import { choosePainting, placePainting } from '../world/paintings.js';
import { standYaw, standAt, useStand, punchStand } from '../entities/armorStand.js';
import { tryLightRift, findHollowRing, fillHollowGate } from '../world/dimensions/portal.js';
import { LEAVES, SAPLING_TREE, growTree } from '../world/trees.js';
import { useSkyRocket } from '../entities/skyRocket.js';
import { hushfruitTeleport } from '../world/dimensions/hushvine.js';
import { cavePlaceMeta, waxCopper, scrapeCopper } from '../world/caves.js';
import { sideOf, SIDE_DIRS, DOOR_OPEN, DOOR_UPPER, BED_HEAD, SLAB_TOP, SLAB_DOUBLE, STAIRS_UPSIDE, GATE_OPEN, TRAPDOOR_OPEN, TRAPDOOR_TOP } from '../world/shapes.js';

/** Brightness for block particles: local light, dimmed with the combined sunlight (as the held item). */
function particleLight(g, x, y, z) {
  return lightAt(g, x, y, z) * (0.4 + 0.6 * Math.min(1, g.sky.state.combined + 0.25));
}

export const EAT_TICKS = 32;
export const SWING_TICKS = 6;
// Experience from ores whose drop is not the block itself: [min, max]
const ORE_XP = {
  [B.COAL_ORE]: [0, 2], [B.DEEP_COAL_ORE]: [0, 2], [B.DIAMOND_ORE]: [3, 7], [B.DEEP_DIAMOND_ORE]: [3, 7],
  [B.BERYL_ORE]: [3, 7], [B.AZURITE_ORE]: [2, 5], [B.DEEP_AZURITE_ORE]: [2, 5],
  [B.CINNABAR_ORE]: [1, 5], [B.DEEP_CINNABAR_ORE]: [1, 5], [B.SPAWNER]: [15, 43],
};
const BREAK_DELAY = 5;
/** Blocks that right-click opens / toggles instead of using the held item. */
const USABLE_BLOCKS = new Set([B.WORKBENCH, B.FURNACE, B.FURNACE_LIT, B.SMOKER, B.SMOKER_LIT, B.BLAST_FURNACE, B.BLAST_FURNACE_LIT, B.CHEST, B.BARREL, B.DOOR, B.BED, B.ENCHANTING_TABLE, B.ANVIL, B.BREWING_STAND, B.GLOOMSHELL_BOX, B.HOPPER, B.COMPOSTER, B.SWEET_BERRY_BUSH, B.JUKEBOX, B.CAVE_VINES_LIT, B.FLOWER_POT, B.BEACON, B.DISPENSER, B.DROPPER]);
const CIRCUIT_USE = new Set([B.LEVER, B.STONE_BUTTON, B.REPEATER, B.CHIME_BLOCK]);
const CIRCUIT_PLACE = new Set([B.LEVER, B.STONE_BUTTON, B.CINNABAR_WIRE, B.REPEATER, B.WOODEN_PRESSURE_PLATE, B.PISTON, B.STICKY_PISTON]);
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
    if (g.net) {
      // multiplayer: other players can be hit too (PvP)
      const pt = g.net.raycastPlayers(ex, ey, ez, dx, dy, dz, 3.0);
      if (pt && (!this.mobTarget || pt.dist < this.mobTarget.dist) && !(this.target && this.target.dist < pt.dist)) this.mobTarget = { mob: pt.target, dist: pt.dist };
    }
    this.boatTarget = g.entities ? g.entities.raycastBoat(ex, ey, ez, dx, dy, dz, 3.0) : null;
    if (this.boatTarget && ((this.target && this.target.dist < this.boatTarget.dist) || this.boatTarget.boat === p.riding)) this.boatTarget = null;
    // armour stands: in front of whatever is behind them
    const sd = g.entities && g.entities.raycastStand ? g.entities.raycastStand(ex, ey, ez, dx, dy, dz, 3.0) : null;
    const nearer = (o) => o && o.dist < sd.dist;
    this.standTarget = sd && !nearer(this.target) && !nearer(this.mobTarget) && !nearer(this.boatTarget) ? sd : null;
    if (this.standTarget) { this.mobTarget = null; this.boatTarget = null; }
  }

  tick(input) {
    const g = this.game, p = g.player;
    if (p.dead) return;
    if (p.gamemode === 'spectator') { this.target = null; this.mobTarget = null; this.boatTarget = null; this.standTarget = null; this.eating = 0; return; } // spectators only watch
    this.updateTarget();
    if (this.breakDelay > 0) this.breakDelay--;
    if (this.useDelay > 0) this.useDelay--;
    if (this.swing > 0) this.swing--;

    // Attack / mine
    // armour stands: left-click hits (two quick hits knock it down), right-click dresses or undresses it
    if (this.standTarget) {
      const { stand, relY } = this.standTarget;
      if (input.leftPressed) { this.swing = SWING_TICKS; p.attackTicks = 0; this.hitStand(stand); return; }
      if (input.rightPressed) { this.useStand(stand, relY); this.useDelay = USE_DELAY; return; }
      if (input.left || input.right) { this.breaking = null; return; }
    }
    // boats: left-click hits (three hits break it), right-click gets in
    if (this.boatTarget && !this.mobTarget) {
      const boat = this.boatTarget.boat;
      if (input.leftPressed) {
        this.swing = SWING_TICKS;
        if (boat.netProxy) { g.net.hitBoat(boat); return; } // a shared boat: the host counts the hits
        boat.hits++; boat.hitTime = 10;
        g.audio.play('hit_wood', [boat.x, boat.y, boat.z]);
        if (boat.hits >= 3 || p.creative) {
          boat.dead = true;
          if (boat.rider) g.dismount();
          if (!p.creative) g.entities.spawnItem(boat.x, boat.y + 0.5, boat.z, { id: boat.dropId || I.OAK_BOAT, count: 1 });
        }
        return;
      }
      if (input.rightPressed && !boat.rider && !boat.remoteRider && !p.riding) { g.mount(boat); return; }
    }
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
    // right-clicking an animal feeds, breeds or shears it
    if (input.rightPressed && this.mobTarget && this.interactMob(this.mobTarget.mob)) { this.useDelay = USE_DELAY; return; }
    // elixirs and milk are drunk like food is eaten (32 ticks), unless aiming at a block to use
    const drinkable = d && (d.drink || d.milk) && !(this.target && USABLE_BLOCKS.has(this.target.id) && !p.sneaking);
    if (input.right && drinkable) {
      this.eating++;
      if (this.eating % 4 === 0) g.audio.play('drink');
      if (this.eating >= EAT_TICKS) { this.drink(st); this.eating = 0; }
      return;
    }
    // food that is also a seed (carrots) is planted when aimed at the top of farmland
    const tg = this.target;
    const plants = d && d.places && tg && ((tg.id === B.FARMLAND && tg.face[1] === 1)
      || (d.places === B.SWEET_BERRY_BUSH && tg.face[1] === 1 && (tg.id === B.GRASS || tg.id === B.DIRT || tg.id === B.SNOWY_GRASS)) // berries are planted on soil
      || (d.places === B.CAVE_VINES && tg.face[1] === -1)); // glow berries hang under a block
    if (input.right && d && d.food && !plants) {
      if (p.hunger.canEat() || d.food.always) {
        this.eating++;
        if (this.eating % 4 === 0) g.audio.play('eat');
        if (this.eating >= EAT_TICKS) { this.eat(st); this.eating = 0; }
      }
      return;
    }
    this.eating = 0;
    // Farglass: hold right mouse to look through it (game.render narrows the view)
    p.zooming = !!(d && d.spyglass && input.right);
    if (p.zooming) return;
    if (d && d.crossbow) {
      if (d.loaded) { if (input.rightPressed) this.fireCrossbow(); }
      else if (input.right) { if (++this.bowDraw >= 25) { this.loadCrossbow(); this.bowDraw = 0; } }
      else this.bowDraw = 0;
      return;
    }
    if (d && d.spear) {
      // hold to raise the Tidespear, release after half a second to throw it
      if (input.right) this.bowDraw++;
      else { if (this.bowDraw >= 10) this.throwSpear(); this.bowDraw = 0; }
      if (input.right) return;
    }
    if (d && d.bow) {
      if (input.right) this.bowDraw++;
      else if (this.bowDraw > 0) { this.releaseBow(); this.bowDraw = 0; }
      return;
    }
    // shields: hold right mouse to block (after a short raise, as in the reference)
    p.blocking = !!(d && d.shield && input.right && (this.shieldRaise = (this.shieldRaise || 0) + 1) > 5);
    if (!(d && d.shield && input.right)) this.shieldRaise = 0;
    if (d && d.shield) return;
    if (d && d.rod && input.rightPressed) {
      // cast the bobber, or reel it in (a catch if a fish is biting)
      if (this.bobber && !this.bobber.dead) {
        const dmg = this.bobber.reel(g);
        if (dmg && !p.creative) p.inventory.damageSelected(dmg);
      } else {
        const [ex, ey, ez] = p.eyePos(), [dx, dy, dz] = p.lookDir();
        this.bobber = g.entities.add(new Bobber(ex + dx * 0.5, ey + dy * 0.5, ez + dz * 0.5, dx * 0.7, dy * 0.7 + 0.15, dz * 0.7, p));
        g.audio.play('bow', [ex, ey, ez], 0.4);
      }
      this.swing = SWING_TICKS;
      return;
    }
    if (d && d.horn && input.rightPressed) {
      // a Crag Horn sounds far and wide (7 s cooldown)
      if (g.ticks >= (this.hornReady || 0)) { this.hornReady = g.ticks + 140; g.audio.play('horn', [p.x, p.y + 1.5, p.z]); }
      return;
    }
    if (d && d.emptyMap && input.rightPressed) {
      // an empty map becomes a map of the 128-block square around the player
      const m = g.createMap(p.x, p.z);
      const filled = { id: I.FILLED_MAP, count: 1, damage: 0, map: m.id, mapX: Math.floor(m.x0 / 128), mapZ: Math.floor(m.z0 / 128) };
      if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
      if (!p.inventory.selectedStack) p.inventory.slots[p.inventory.selected] = filled;
      else if (p.inventory.add(filled)) g.entities.spawnItem(p.x, p.y + 1, p.z, filled);
      p.inventory.changed();
      g.audio.play('page', [p.x, p.y + 1, p.z]);
      this.swing = SWING_TICKS;
      return;
    }
    if (d && d.throwable === 'potion' && input.rightPressed) {
      // splash elixirs: thrown at 0.5 blocks/tick, aimed 20 degrees above the view
      const [ex, ey, ez] = p.eyePos();
      const pitch = p.pitch + 20 * Math.PI / 180, cp = Math.cos(pitch);
      const dx = -Math.sin(p.yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(p.yaw) * cp;
      g.entities.spawnArrow(ex + dx * 0.4, ey - 0.1 + dy * 0.4, ez + dz * 0.4, dx * 0.5 + p.body.vx, dy * 0.5, dz * 0.5 + p.body.vz, p, false, 'potion', 0, st.id);
      if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
      g.audio.play('bow', [ex, ey, ez], 0.4);
      this.swing = SWING_TICKS;
      return;
    }
    if (d && d.throwable && input.rightPressed) {
      // snowballs and eggs: thrown at 1.5 blocks/tick from the eye
      const [ex, ey, ez] = p.eyePos(), [dx, dy, dz] = p.lookDir();
      g.entities.spawnArrow(ex + dx * 0.4, ey - 0.1 + dy * 0.4, ez + dz * 0.4, dx * 1.5, dy * 1.5 + 0.05, dz * 1.5, p, false, d.throwable);
      if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
      g.audio.play('bow', [ex, ey, ez], 0.5);
      this.swing = SWING_TICKS;
      return;
    }
    // Sky Rockets: a boost while gliding, or launched from the clicked block
    if (d && d.rocket && input.rightPressed && !(this.target && USABLE_BLOCKS.has(this.target.id) && !p.sneaking)) {
      if (useSkyRocket(g, this.target)) { if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1); this.swing = SWING_TICKS; }
      return;
    }
    if (input.right && this.useDelay === 0) {
      if (this.use()) this.useDelay = USE_DELAY;
    }
    if (input.middlePressed && this.target) this.pickBlock(this.target.id);
  }

  hitStand(stand) {
    const g = this.game, p = g.player;
    if (stand.netProxy) { g.net.hitStand(stand); return; } // a shared stand: the host counts the hits
    punchStand(g, stand, p.creative);
  }

  /** Right-click on a stand: armour goes on, another item into its hand, an empty hand takes the clicked piece. */
  useStand(stand, relY) {
    const g = this.game, inv = g.player.inventory, held = inv.selectedStack;
    this.swing = SWING_TICKS;
    if (stand.netProxy) { g.net.useStand(stand, held, relY); return; } // the host swaps and answers
    const r = useStand(stand, held, relY);
    if (!r.ok) return;
    inv.slots[inv.selected] = r.give;
    inv.changed();
    g.audio.play('equip', [stand.x, stand.y + 1, stand.z]);
  }

  mine() {
    const g = this.game, p = g.player, t = this.target;
    if (this.breakDelay > 0 || p.gamemode === 'adventure') return; // adventurers can't break blocks
    if (t.id === B.ITEM_FRAME && g.frames.get(`${t.x},${t.y},${t.z}`)) {
      // the first hit knocks the item out of the frame
      const st = g.frames.get(`${t.x},${t.y},${t.z}`);
      g.setFrameItem(t.x, t.y, t.z, null);
      if (!p.creative) g.entities.spawnItem(t.x + 0.5, t.y + 0.5, t.z + 0.5, st);
      g.audio.play('hit_wood', [t.x + 0.5, t.y + 0.5, t.z + 0.5]);
      this.swing = SWING_TICKS; this.breakDelay = BREAK_DELAY;
      return;
    }
    if (p.creative) {
      // creative: blocks break at once (bedrock too), 5 ticks apart, without drops
      this.swing = SWING_TICKS;
      this.breakBlock(t.x, t.y, t.z, t.id, toolOf(null));
      this.breaking = null;
      this.breakDelay = BREAK_DELAY;
      return;
    }
    if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z || this.breaking.id !== t.id) {
      this.breaking = { x: t.x, y: t.y, z: t.z, id: t.id, progress: 0 };
    }
    const tool = toolOf(p.inventory.selectedStack);
    const per = breakProgressPerTick(t.id, tool, { onGround: p.body.onGround || p.body.inWater, inWater: p.body.eyeInWater, swiftdig: enchLevel(p.inventory.selectedStack, 'swiftdig'), haste: p.effectLevel ? p.effectLevel('haste') : 0, fatigue: p.effectLevel ? p.effectLevel('mining_fatigue') : 0 });
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
    g.world.setBlockUrgent(x, y, z, BLOCKS[id].waterlogged ? B.WATER : B.AIR); // kelp leaves its water behind
    if (g.onBlockBroken) g.onBlockBroken(x, y, z, id, meta);
    if (id === B.FIRE) { g.audio.play('fizz', [x + 0.5, y + 0.5, z + 0.5]); return; }
    g.audio.play('break_' + BLOCKS[id].sound, [x + 0.5, y + 0.5, z + 0.5]);
    g.particles && g.particles.blockBreak(x, y, z, id, particleLight(g, x + 0.5, y + 0.5, z + 0.5));
    const held = p.inventory.selectedStack, ench = tool.type && held && held.ench ? held.ench : null;
    const silk = !!(ench && ench.gentle_hand && silkDropsSelf(id));
    const xp = p.creative || silk ? null : ORE_XP[id];
    if (xp && canHarvest(id, tool)) g.entities.spawnXp(x + 0.5, y + 0.5, z + 0.5, xp[0] + Math.floor(Math.random() * (xp[1] - xp[0] + 1)));
    if (!p.creative) for (const drop of blockDrops(id, tool, Math.random, meta, ench)) g.entities.spawnItem(x + 0.5, y + 0.3, z + 0.5, drop);
    // Ice melts into water when broken above a solid block
    if (id === B.ICE && SOLID[g.world.getBlock(x, y - 1, z)] && g.world.dimension !== 'cinderdeep') {
      g.world.setBlockUrgent(x, y, z, B.WATER, 0);
      g.world.scheduleTick(x, y, z, 5);
    }
    p.hunger.addExhaustion(EXHAUSTION.BREAK_BLOCK);
    p.stats.blocksMined++;
    if (BLOCKS[id].hardness > 0 && tool.type) p.inventory.damageSelected(tool.type === 'sword' ? 2 : 1);
    // an ice block broken with Gentle Hand drops itself and leaves no water
    if (silk && id === B.ICE && g.world.getBlock(x, y, z) === B.WATER) g.world.setBlockUrgent(x, y, z, B.AIR);
  }

  attack(mob) {
    const g = this.game, p = g.player;
    const held = p.inventory.selectedStack;
    const tool = toolOf(held);
    const cd = this.attackCooldownProgress();
    let dmg = meleeWithEffects(tool.damage, p.effects) * (0.2 + cd * cd * 0.8); // Strength / Weakness change the base damage
    const crit = cd > 0.9 && p.body.fallDistance > 0 && !p.body.onGround && !p.body.inWater && !p.sprinting;
    if (crit) dmg *= 1.5;
    dmg += meleeBonus(held, mob) * cd; // Keen / Hallowed, scaled by the cooldown like the reference
    const knock = 0.4 + ((p.sprinting && cd > 0.9 ? 1 : 0) + enchLevel(held, 'shove')) * 0.5;
    p.lastAttacked = mob; // tamed Howlers join in
    if (mob.kind === 'mob') mob.plunder = enchLevel(held, 'plunder'); // looting for its drops
    if (mob.hurt(dmg, 'player', p, knock)) {
      const fire = enchLevel(held, 'emberbrand');
      if (fire && mob.kind === 'mob' && !(mob.def && mob.def.fireImmune)) mob.fireTicks = Math.max(mob.fireTicks || 0, fire * 80);
      if (crit) g.particles && g.particles.crit(mob.x, mob.y + mob.height * 0.6, mob.z);
      if (p.sprinting && cd > 0.9) p.sprinting = false;
      if (tool.type) p.inventory.damageSelected(tool.type === 'sword' || tool.type === 'spear' ? 1 : 2);
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
    for (const [type, ticks, amp] of f.effects || []) p.addEffect(type, ticks, amp); // a Gilded Apple's sure effects
    p.inventory.removeFromSlot(p.inventory.selected, 1);
    if (f.leaves) p.inventory.add({ id: f.leaves === 'vial' ? I.GLASS_VIAL : I.BOWL, count: 1, damage: 0 }); // soup leaves its bowl, honey its vial
    if (f.cures && p.effects[f.cures]) { delete p.effects[f.cures]; for (const fn of p.listeners.effect || []) fn(null); }
    g.audio.play('burp');
    if (f.teleport) {
      // Hushfruit: off to a random spot within 8 blocks
      const to = hushfruitTeleport((x, y, z) => g.world.getBlock(x, y, z), p.x, p.y, p.z, Math.random, g.world.dimension === 'overworld' ? -64 : 0);
      if (to) {
        g.particles.smoke(p.x, p.y + 1, p.z, 10, 0.6);
        p.setPosition(to.x, to.y, to.z);
        p.gliding = false;
        g.audio.play('teleport', [to.x, to.y + 1, to.z]);
      }
    }
  }

  /** Finish drinking: an elixir's effects (glass vial back) or milk (clears all effects, bucket back). */
  drink(st) {
    const g = this.game, p = g.player, d = ITEMS[st.id];
    if (d.milk) p.clearEffects();
    else if (d.potion) for (const [type, ticks, amp] of POTIONS[d.potion.kind].effects) p.applyEffect(type, ticks, amp);
    if (!p.creative) {
      const back = { id: d.milk ? I.BUCKET : I.GLASS_VIAL, count: 1, damage: 0 };
      p.inventory.removeFromSlot(p.inventory.selected, 1);
      if (!p.inventory.selectedStack) p.inventory.slots[p.inventory.selected] = back;
      else if (p.inventory.add(back)) g.entities.spawnItem(p.x, p.y + 1, p.z, back);
      p.inventory.changed();
    }
    g.audio.play('burp');
  }

  releaseBow() {
    const g = this.game, p = g.player;
    const slot = p.inventory.slots.findIndex((s) => s && isArrow(s.id));
    if (slot < 0) return;
    const ammo = p.inventory.slots[slot].id;
    // charge curve: f = t/20; power = (f^2 + 2f)/3 capped at 1
    let f = this.bowDraw / 20;
    f = (f * f + f * 2) / 3;
    if (f < 0.1) return;
    f = Math.min(1, f);
    const [ex, ey, ez] = p.eyePos();
    const [dx, dy, dz] = p.lookDir();
    const bow = p.inventory.selectedStack, endless = enchLevel(bow, 'endless') > 0;
    const arrow = g.entities.spawnArrow(ex, ey - 0.1, ez, dx * 3 * f, dy * 3 * f, dz * 3 * f, p, f >= 1, null, enchLevel(bow, 'strongdraw'), 0, ammo !== I.ARROW ? { id: ammo, count: 1 } : null);
    if (arrow && endless) arrow.pickup = false; // Endless arrows cannot be picked back up
    if (!endless) p.inventory.removeFromSlot(slot, 1);
    p.inventory.damageSelected(1);
    g.audio.play('bow');
  }

  /** Pick a ripe berry bush (it drops back to age 1), or bone-meal it a stage riper. */
  useBerryBush(t, st, d) {
    const g = this.game, p = g.player, w = g.world, age = w.getMeta(t.x, t.y, t.z) & 3;
    if (d && d.boneMeal && age < 3) {
      w.setBlockUrgent(t.x, t.y, t.z, B.SWEET_BERRY_BUSH, age + 1);
      if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
      for (let k = 0; k < 8; k++) g.particles.emit(t.x + Math.random(), t.y + Math.random() * 0.6, t.z + Math.random(), 0, 0.02, 0, 0.4, 0.9, 0.3, 20, -0.001);
      return true;
    }
    if (age < 2) return false;
    const n = age === 3 ? 2 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 2);
    g.entities.spawnItem(t.x + 0.5, t.y + 0.6, t.z + 0.5, { id: I.SWEET_BERRIES, count: n });
    w.setBlockUrgent(t.x, t.y, t.z, B.SWEET_BERRY_BUSH, 1);
    g.audio.play('pop', [t.x + 0.5, t.y + 0.5, t.z + 0.5]);
    return true;
  }

  /** Fill a composter with the held plant matter, or empty a ready one (Bone Meal pops out). */
  useComposter(t, st) {
    const g = this.game, p = g.player, w = g.world, level = w.getMeta(t.x, t.y, t.z) & 15;
    const cx = t.x + 0.5, cz = t.z + 0.5;
    if (level >= READY) {
      w.setBlockUrgent(t.x, t.y, t.z, B.COMPOSTER, 0);
      g.entities.spawnItem(cx, t.y + 1.1, cz, { id: I.BONE_MEAL, count: 1 }, [0, 0.15, 0]);
      g.audio.play('place_gravel', [cx, t.y + 1, cz]);
      return true;
    }
    if (level === 7) { w.scheduleTick(t.x, t.y, t.z, SETTLE_TICKS); return false; } // still settling
    const r = st && compost(level, st.id);
    if (!r) return false;
    if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
    if (r.level !== level) {
      w.setBlockUrgent(t.x, t.y, t.z, B.COMPOSTER, r.level);
      if (r.level === 7) w.scheduleTick(t.x, t.y, t.z, SETTLE_TICKS);
    }
    for (let k = 0; k < 6; k++) g.particles.emit(cx + (Math.random() - 0.5) * 0.6, t.y + 0.4 + r.level / 9, cz + (Math.random() - 0.5) * 0.6, 0, 0.02, 0, 0.4, 0.8, 0.3, 16, -0.001);
    g.audio.play('place_gravel', [cx, t.y + 0.5, cz], 0.6);
    return true;
  }

  /** A crossbow drawn for 1.25 s takes an arrow (none needed in creative or with Endless). */
  loadCrossbow() {
    const g = this.game, p = g.player, inv = p.inventory, bow = inv.selectedStack;
    const free = p.creative || enchLevel(bow, 'endless') > 0;
    const slot = inv.slots.findIndex((s) => s && s.id === I.ARROW);
    if (slot < 0 && !free) return;
    if (!free) inv.removeFromSlot(slot, 1);
    inv.slots[inv.selected] = { ...inv.slots[inv.selected], id: I.CROSSBOW_LOADED };
    inv.changed();
    g.audio.play('click', [p.x, p.y + 1, p.z]);
  }

  /** Throw the held Tidespear: it flies like a heavy arrow and lands as an item with its wear. */
  throwSpear() {
    const g = this.game, p = g.player, inv = p.inventory, st = inv.selectedStack;
    const [ex, ey, ez] = p.eyePos(), [dx, dy, dz] = p.lookDir();
    inv.damageSelected(1);
    const spear = inv.selectedStack; // null if that throw broke it
    if (!spear) return;
    g.entities.spawnArrow(ex, ey - 0.1, ez, dx * 2.5, dy * 2.5, dz * 2.5, p, false, 'spear', 0, 0, { ...spear });
    if (!p.creative) inv.slots[inv.selected] = null;
    inv.changed();
    g.audio.play('bow', [ex, ey, ez], 0.8);
    this.swing = SWING_TICKS;
  }

  /** Fire a loaded crossbow: a fast, flat, always-critical arrow. */
  fireCrossbow() {
    const g = this.game, p = g.player, inv = p.inventory, bow = inv.selectedStack;
    const [ex, ey, ez] = p.eyePos(), [dx, dy, dz] = p.lookDir();
    const arrow = g.entities.spawnArrow(ex, ey - 0.1, ez, dx * 3.15, dy * 3.15, dz * 3.15, p, true, null, enchLevel(bow, 'strongdraw'));
    if (arrow && (p.creative || enchLevel(bow, 'endless') > 0)) arrow.pickup = false;
    inv.slots[inv.selected] = { ...bow, id: I.CROSSBOW };
    inv.changed();
    inv.damageSelected(1);
    g.audio.play('bow', null, 1.2);
  }

  /** Right-click action. Returns true if something happened. */
  use() {
    const g = this.game, p = g.player, w = g.world;
    const st = p.inventory.selectedStack;
    const d = st && ITEMS[st.id];
    // Armour: right-click puts it on (swapping with what is worn), unless aiming at something usable
    const usable = this.target && (USABLE_BLOCKS.has(this.target.id) || [SHAPE.GATE, SHAPE.DOOR, SHAPE.TRAPDOOR].includes(BLOCKS[this.target.id].shape));
    if (d && d.armor && !usable) {
      const inv = p.inventory, worn = inv.armor[d.armor.slot];
      inv.armor[d.armor.slot] = st;
      inv.slots[inv.selected] = worn;
      inv.changed();
      g.audio.play('equip');
      return true;
    }
    // Honeycomb seals copper against weathering; an axe takes the seal off, or scrapes a stage of weathering away
    const ct = this.target;
    if (ct && d && (st.id === I.HONEYCOMB || (d.tool && d.tool.type === 'axe'))) {
      const next = st.id === I.HONEYCOMB ? waxCopper(ct.id) : scrapeCopper(ct.id);
      if (next != null) {
        w.setBlockUrgent(ct.x, ct.y, ct.z, next, 0);
        if (!p.creative) { if (st.id === I.HONEYCOMB) p.inventory.removeFromSlot(p.inventory.selected, 1); else p.inventory.damageSelected(1); }
        const col = st.id === I.HONEYCOMB ? [1, 0.7, 0.2] : [0.9, 0.95, 1];
        for (let k = 0; k < 10; k++) g.particles.emit(ct.x + Math.random(), ct.y + Math.random(), ct.z + Math.random(), 0, 0.02, 0, col[0], col[1], col[2], 20, -0.001);
        g.audio.play(st.id === I.HONEYCOMB ? 'squish' : 'shear', [ct.x + 0.5, ct.y + 0.5, ct.z + 0.5]);
        this.swing = SWING_TICKS;
        return true;
      }
    }
    // Glass vials fill at a water source (which stays)
    if (st && st.id === I.GLASS_VIAL && !(usable && !p.sneaking)) {
      const [ex, ey, ez] = p.eyePos();
      const [dx, dy, dz] = p.lookDir();
      const hit = w.raycast(ex, ey, ez, dx, dy, dz, PHYS.REACH, true);
      if (hit && hit.id === B.WATER) {
        const full = { id: POTION_ITEM.water, count: 1, damage: 0 };
        p.inventory.removeFromSlot(p.inventory.selected, 1);
        if (!p.inventory.selectedStack) p.inventory.slots[p.inventory.selected] = full;
        else if (p.inventory.add(full)) g.entities.spawnItem(p.x, p.y + 1, p.z, full);
        p.inventory.changed();
        g.audio.play('bucket_fill');
        this.swing = SWING_TICKS;
        return true;
      }
    }
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
    if (d && d.cocoa && this.target && this.target.id === B.JUNGLE_LOG && this.target.face[1] === 0) {
      // plant beans on the side of a jungle log
      const t = this.target, x = t.x + t.face[0], z = t.z + t.face[2];
      if (w.getBlock(x, t.y, z)) return false;
      w.setBlockUrgent(x, t.y, z, B.COCOA, sideOf(-t.face[0], -t.face[2]));
      if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
      this.swing = SWING_TICKS;
      return true;
    }
    if (d && d.itemFrame) {
      // hang a frame on the clicked wall
      if (!this.target || this.target.face[1] !== 0) return false;
      const t = this.target, x = t.x + t.face[0], y = t.y, z = t.z + t.face[2], side = sideOf(-t.face[0], -t.face[2]);
      if (w.getBlock(x, y, z) && !BLOCKS[w.getBlock(x, y, z)].replaceable) return false;
      if (!w.hasSupport(x, y, z, B.ITEM_FRAME, side)) return false;
      w.setBlockUrgent(x, y, z, B.ITEM_FRAME, side);
      g.audio.play('place_wood', [x + 0.5, y + 0.5, z + 0.5]);
      if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
      this.swing = SWING_TICKS;
      return true;
    }
    if (d && d.sign) {
      // a standing sign on top of a block, or a wall sign on its side; then write on it
      if (!this.target || this.target.face[1] === -1) return false;
      const t = this.target, x = t.x + t.face[0], y = t.y + t.face[1], z = t.z + t.face[2];
      if (w.getBlock(x, y, z) && !BLOCKS[w.getBlock(x, y, z)].replaceable) return false;
      let id, meta;
      if (t.face[1] === 1) { id = B.OAK_SIGN; const dx = p.x - (x + 0.5), dz = p.z - (z + 0.5); meta = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0); }
      else { id = B.OAK_WALL_SIGN; meta = sideOf(-t.face[0], -t.face[2]); }
      if (!w.hasSupport(x, y, z, id, meta)) return false;
      w.setBlockUrgent(x, y, z, id, meta);
      g.audio.play('place_wood', [x + 0.5, y + 0.5, z + 0.5]);
      if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
      this.swing = SWING_TICKS;
      g.ui.openSignEditor(x, y, z);
      return true;
    }
    if (d && d.painting) {
      // hang the largest picture that fits on the clicked wall
      if (!this.target || this.target.face[1] !== 0) return false;
      const t = this.target, side = sideOf(-t.face[0], -t.face[2]);
      const pick = choosePainting(w, side, t.x + t.face[0], t.y, t.z + t.face[2]);
      if (!pick) return false;
      placePainting(w, side, pick, (x, y, z, id, m) => w.setBlockUrgent(x, y, z, id, m, false));
      g.audio.play('place_wood', [t.x + 0.5, t.y + 0.5, t.z + 0.5]);
      if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
      this.swing = SWING_TICKS;
      return true;
    }
    if (d && d.armorStand) {
      // stands go on top of a block, facing the player
      const t = this.target;
      if (!t || t.face[1] !== 1) return false;
      const x = t.x, y = t.y + 1, z = t.z;
      if (SOLID[w.getBlock(x, y, z)] || SOLID[w.getBlock(x, y + 1, z)] || standAt(g.entities.list, x, y, z)) return false;
      g.entities.spawnStand(x + 0.5, y, z + 0.5, standYaw(p.yaw));
      g.audio.play('place_wood', [x + 0.5, y, z + 0.5]);
      if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
      this.swing = SWING_TICKS;
      return true;
    }
    if (d && d.minecart) {
      // carts go on rails
      if (!this.target || this.target.id !== B.RAIL) return false;
      const t = this.target;
      g.entities.spawnBoat(t.x + 0.5, t.y + 1 / 16, t.z + 0.5, p.yaw, true);
      if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
      this.swing = SWING_TICKS;
      return true;
    }
    if (d && d.boat) {
      // on the water surface (looked at through the water) or on top of a block
      const [ex, ey, ez] = p.eyePos(), [dx, dy, dz] = p.lookDir();
      const wh = w.raycast(ex, ey, ez, dx, dy, dz, PHYS.REACH, true);
      let pos = null;
      if (wh && wh.id === B.WATER) pos = [wh.x + 0.5, wh.y + 0.75, wh.z + 0.5];
      else if (this.target && this.target.face[1] === 1) pos = [this.target.x + 0.5, this.target.y + 1, this.target.z + 0.5];
      if (!pos) return false;
      g.entities.spawnBoat(pos[0], pos[1], pos[2], p.yaw);
      p.inventory.removeFromSlot(p.inventory.selected, 1);
      this.swing = SWING_TICKS;
      return true;
    }
    // Eye of the Void: set into a Hollow Frame, or thrown to point at the nearest sanctum
    if (d && d.voidEye) return this.useVoidEye(this.target);
    const t = this.target;
    if (!t) return false;
    if ((t.id === B.BEE_NEST || t.id === B.BEEHIVE) && st && (d.shears || st.id === I.GLASS_VIAL) && ((w.getMeta(t.x, t.y, t.z) >> 2) & 7) >= 5) {
      // a full nest: shears cut 3 honeycomb, a vial fills with honey; the bees mind unless a campfire smokes below
      const m = w.getMeta(t.x, t.y, t.z);
      w.setBlockUrgent(t.x, t.y, t.z, t.id, m & 3);
      if (d.shears) { g.entities.spawnItem(t.x + 0.5, t.y + 0.5, t.z + 0.5, { id: I.HONEYCOMB, count: 3, damage: 0 }); if (!p.creative) p.inventory.damageSelected(1); g.audio.play('shear', [t.x + 0.5, t.y + 0.5, t.z + 0.5]); }
      else {
        const honey = { id: I.HONEY_BOTTLE, count: 1, damage: 0 };
        if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
        if (!p.inventory.selectedStack) p.inventory.slots[p.inventory.selected] = honey; else if (p.inventory.add(honey)) g.entities.spawnItem(p.x, p.y + 1, p.z, honey);
        p.inventory.changed();
        g.audio.play('bucket_fill', [t.x + 0.5, t.y + 0.5, t.z + 0.5]);
      }
      let smoked = false;
      for (let dy = 1; dy <= 5 && !smoked; dy++) smoked = w.getBlock(t.x, t.y - dy, t.z) === B.CAMPFIRE;
      if (!smoked) Mob.angerBees(g, t.x, t.y, t.z);
      this.swing = SWING_TICKS;
      return true;
    }
    // Interactive blocks
    if (!p.sneaking || !st) {
      if (t.id === B.WORKBENCH) { g.ui.openWorkbench(); return true; }
      if (t.id === B.OAK_SIGN || t.id === B.OAK_WALL_SIGN) { g.ui.openSignEditor(t.x, t.y, t.z); return true; }
      if (t.id === B.ITEM_FRAME) {
        // put the held item in, or turn the item that is there
        const k = `${t.x},${t.y},${t.z}`, m = w.getMeta(t.x, t.y, t.z);
        if (g.frames.get(k)) w.setBlockUrgent(t.x, t.y, t.z, B.ITEM_FRAME, (m & 3) | ((((m >> 2) + 1) & 7) << 2));
        else if (st) { g.setFrameItem(t.x, t.y, t.z, { ...st, count: 1 }); if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1); }
        else return false;
        g.audio.play('click', [t.x + 0.5, t.y + 0.5, t.z + 0.5]);
        this.swing = SWING_TICKS;
        return true;
      }
      if (isFurnace(t.id)) { g.ui.openFurnace(t.x, t.y, t.z); return true; }
      if (t.id === B.BED) { g.trySleep(t.x, t.y, t.z); return true; }
      if (t.id === B.ENCHANTING_TABLE) { g.ui.openEnchanting(t.x, t.y, t.z); return true; }
      if (t.id === B.ANVIL) { g.ui.openAnvil(t.x, t.y, t.z); return true; }
      if (t.id === B.BEACON) { g.ui.openBeacon(t.x, t.y, t.z); return true; }
      if (t.id === B.BREWING_STAND) { g.ui.openBrewing(t.x, t.y, t.z); return true; }
      if (CIRCUIT_USE.has(t.id)) {
        // levers flip, buttons press (the host releases them), repeaters change delay, chime blocks change pitch
        const um = circuitUseMeta(t.id, w.getMeta(t.x, t.y, t.z));
        if (um >= 0) {
          w.setBlockUrgent(t.x, t.y, t.z, t.id, um);
          g.audio.play(t.id === B.CHIME_BLOCK ? 'chime_' + (um & 31) : 'click', [t.x + 0.5, t.y + 0.5, t.z + 0.5]);
        }
        this.swing = SWING_TICKS;
        return true;
      }
      if (BLOCKS[t.id].shape === SHAPE.TRAPDOOR) {
        const m = w.getMeta(t.x, t.y, t.z);
        w.setBlockUrgent(t.x, t.y, t.z, t.id, m ^ TRAPDOOR_OPEN);
        g.audio.play(m & TRAPDOOR_OPEN ? 'door_close' : 'door_open', [t.x + 0.5, t.y + 0.5, t.z + 0.5]);
        this.swing = SWING_TICKS;
        return true;
      }
      if (BLOCKS[t.id].shape === SHAPE.GATE) {
        const m = w.getMeta(t.x, t.y, t.z);
        w.setBlockUrgent(t.x, t.y, t.z, t.id, m ^ GATE_OPEN);
        g.audio.play(m & GATE_OPEN ? 'door_close' : 'door_open', [t.x + 0.5, t.y + 0.5, t.z + 0.5]);
        this.swing = SWING_TICKS;
        return true;
      }
      if (BLOCKS[t.id].shape === SHAPE.DOOR) {
        // open/close both halves together
        const m = w.getMeta(t.x, t.y, t.z), by = m & DOOR_UPPER ? t.y - 1 : t.y;
        for (const yy of [by, by + 1]) if (w.getBlock(t.x, yy, t.z) === t.id) w.setBlockUrgent(t.x, yy, t.z, t.id, w.getMeta(t.x, yy, t.z) ^ DOOR_OPEN, false);
        g.audio.play(m & DOOR_OPEN ? 'door_close' : 'door_open', [t.x + 0.5, by + 1, t.z + 0.5]);
        this.swing = SWING_TICKS;
        return true;
      }
      if (t.id === B.CHEST || t.id === B.BARREL || t.id === B.GLOOMSHELL_BOX || t.id === B.HOPPER || t.id === B.DISPENSER || t.id === B.DROPPER) { g.ui.openChest(t.x, t.y, t.z); g.audio.play('chest_open', [t.x + 0.5, t.y + 0.5, t.z + 0.5]); return true; }
    }
    if (t && t.id === B.COMPOSTER && !p.sneaking && this.useComposter(t, st)) { this.swing = SWING_TICKS; return true; }
    if (t && t.id === B.SWEET_BERRY_BUSH && this.useBerryBush(t, st, d)) { this.swing = SWING_TICKS; return true; }
    if (t && t.id === B.CAVE_VINES_LIT) {
      // pick the glow berries
      g.entities.spawnItem(t.x + 0.5, t.y + 0.3, t.z + 0.5, { id: I.GLOW_BERRIES, count: 1 });
      w.setBlockUrgent(t.x, t.y, t.z, B.CAVE_VINES, 0);
      g.audio.play('pop', [t.x + 0.5, t.y + 0.5, t.z + 0.5]);
      this.swing = SWING_TICKS;
      return true;
    }
    if (t && t.id === B.FLOWER_POT && !p.sneaking) {
      // plant a flower, sapling, mushroom or cactus in an empty pot, or take back what grows in it
      const m = w.getMeta(t.x, t.y, t.z), k = d ? POTTED.indexOf(d.block ?? d.places ?? d.id) : -1;
      if (!m && k >= 0) {
        w.setBlockUrgent(t.x, t.y, t.z, B.FLOWER_POT, k + 1);
        if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
        g.audio.play('place_grass', [t.x + 0.5, t.y + 0.5, t.z + 0.5]);
        this.swing = SWING_TICKS;
        return true;
      }
      if (m && !st) {
        const back = { id: POTTED[m - 1], count: 1 };
        if (p.inventory.add(back)) g.entities.spawnItem(t.x + 0.5, t.y + 0.6, t.z + 0.5, back);
        w.setBlockUrgent(t.x, t.y, t.z, B.FLOWER_POT, 0);
        this.swing = SWING_TICKS;
        return true;
      }
    }
    if (t && CANDLES.has(t.id)) {
      // flint and steel lights candles; a click with anything but another candle (or something to light them) snuffs them out
      const c = CANDLES.get(t.id), m = w.getMeta(t.x, t.y, t.z), at = [t.x + 0.5, t.y + 0.4, t.z + 0.5];
      if (t.id === c.unlit && d && d.igniter) {
        w.setBlockUrgent(t.x, t.y, t.z, c.lit, m);
        g.audio.play('ignite', at);
        this.useIgniter(d);
        this.swing = SWING_TICKS;
        return true;
      }
      if (t.id === c.lit && !(d && CANDLES.has(d.block ?? d.id))) {
        w.setBlockUrgent(t.x, t.y, t.z, c.unlit, m);
        g.particles.smoke && g.particles.smoke(at[0], at[1], at[2], 4, 0.3);
        g.audio.play('fizz', at, 0.3);
        this.swing = SWING_TICKS;
        return true;
      }
    }
    if (t && t.id === B.JUKEBOX && !p.sneaking) {
      // eject the disc that is playing, or put the held disc in
      const m = w.getMeta(t.x, t.y, t.z);
      if (m > 0) { g.entities.spawnItem(t.x + 0.5, t.y + 1.1, t.z + 0.5, { id: DISCS[m - 1], count: 1 }, [0, 0.2, 0]); w.setBlockUrgent(t.x, t.y, t.z, B.JUKEBOX, 0); return true; }
      if (d && d.disc) {
        w.setBlockUrgent(t.x, t.y, t.z, B.JUKEBOX, d.disc.index + 1);
        if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
        g.hud.toast('Now playing: ' + d.disc.title);
        return true;
      }
    }
    if (!st) return false;
    // Bone meal: crops grow 2-5 stages; on grass it sprouts tall grass and flowers around
    if (d.boneMeal && this.boneMeal(t)) {
      p.inventory.removeFromSlot(p.inventory.selected, 1);
      this.swing = SWING_TICKS;
      return true;
    }
    // Hoes till grass and dirt into farmland (not from below, and only with air above)
    if (d.tool && d.tool.type === 'hoe' && (t.id === B.GRASS || t.id === B.DIRT || t.id === B.SNOWY_GRASS) && t.face[1] !== -1 && !w.getBlock(t.x, t.y + 1, t.z)) {
      w.setBlockUrgent(t.x, t.y, t.z, B.FARMLAND, 0);
      g.audio.play('place_gravel', [t.x + 0.5, t.y + 1, t.z + 0.5]);
      p.inventory.damageSelected(1);
      this.swing = SWING_TICKS;
      return true;
    }
    // Flint and steel lights a fire on the clicked face (or lights a fire on top of a solid block)
    if (d.igniter) {
      if (t.id === B.TNT) { igniteTNT(g, t.x, t.y, t.z); this.useIgniter(d); this.swing = SWING_TICKS; return true; }
      const fx = t.x + t.face[0], fy = t.y + t.face[1], fz = t.z + t.face[2];
      // inside an obsidian frame: open a Rift portal instead of lighting a fire
      if (w.dimension !== 'hollow' && tryLightRift(w, fx, fy, fz, (x, y, z, id, m) => w.setBlockUrgent(x, y, z, id, m, false))) {
        g.audio.play('ignite', [fx + 0.5, fy + 0.5, fz + 0.5]); g.audio.play('warble', [fx + 0.5, fy + 0.5, fz + 0.5]);
        this.useIgniter(d);
        if (g.milestones) g.milestones.event('rift');
        this.swing = SWING_TICKS;
        return true;
      }
      if (!canLight(w, fx, fy, fz)) return false;
      w.setBlockUrgent(fx, fy, fz, B.FIRE, 0);
      w.scheduleTick(fx, fy, fz, FIRE_DELAY + Math.floor(Math.random() * 10));
      g.audio.play('ignite', [fx + 0.5, fy + 0.5, fz + 0.5]);
      this.useIgniter(d);
      this.swing = SWING_TICKS;
      return true;
    }
    if (d.door) return this.placeDoor(t);
    if (d.bed) return this.placeBed(t);
    let placeId = isBlockItem(st.id) ? st.id : d.places;
    if (placeId === undefined || p.gamemode === 'adventure') return false; // nor place them
    // where on the clicked block the crosshair is (0 = bottom, 1 = top), for slabs and stairs
    const [ex, ey, ez] = p.eyePos(), [ldx, ldy, ldz] = p.lookDir();
    const hitY = ey + ldy * t.dist - t.y;
    const pshape = BLOCKS[placeId].shape;
    if (pshape === SHAPE.SLAB && t.id === placeId) {
      // clicking the open face of a single slab of the same kind makes it a double slab
      const m = w.getMeta(t.x, t.y, t.z);
      if ((m === 0 && t.face[1] === 1) || (m === 1 && t.face[1] === -1)) return this.finishPlace(t.x, t.y, t.z, placeId, SLAB_DOUBLE);
    }
    // scaffolding against scaffolding: a side click (not sneaking) builds onto the top of that column; a click on
    // the top that the player stands in the way of reaches out sideways in the direction they look
    if (placeId === B.SCAFFOLDING && t.id === B.SCAFFOLDING) {
      let cell = null;
      if (t.face[1] === 0 && !p.sneaking) cell = scaffoldColumnTop(w, t.x, t.y, t.z);
      else if (t.face[1] === 1 && p.intersectsBlock(t.x, t.y + 1, t.z)) {
        const sx = Math.abs(ldx) > Math.abs(ldz) ? Math.sign(ldx) : 0, sz = sx ? 0 : Math.sign(ldz);
        for (let k = 1; k <= SCAFFOLD_MAX && !cell; k++) {
          const id = w.getBlock(t.x + sx * k, t.y, t.z + sz * k);
          if (id === B.SCAFFOLDING) continue;
          if (id === 0 || BLOCKS[id].replaceable) cell = [t.x + sx * k, t.y, t.z + sz * k]; else break;
        }
      }
      if (cell) {
        const dist = scaffoldDistance(w, cell[0], cell[1], cell[2]);
        if (dist > SCAFFOLD_MAX || p.intersectsBlock(cell[0], cell[1], cell[2]) || g.entities.blockOccupied(cell[0], cell[1], cell[2])) return false;
        return this.finishPlace(cell[0], cell[1], cell[2], B.SCAFFOLDING, dist);
      }
    }
    // a candle on a candle of the same colour adds one (up to four)
    const tc = CANDLES.get(t.id);
    if (tc && tc.unlit === placeId && (w.getMeta(t.x, t.y, t.z) & 3) < 3) return this.finishPlace(t.x, t.y, t.z, t.id, (w.getMeta(t.x, t.y, t.z) & 3) + 1);
    // placing snow on snow adds a layer (up to a full block of 8)
    if (placeId === B.SNOW_LAYER && t.id === B.SNOW_LAYER && (w.getMeta(t.x, t.y, t.z) & 7) < 7) return this.finishPlace(t.x, t.y, t.z, B.SNOW_LAYER, (w.getMeta(t.x, t.y, t.z) & 7) + 1);
    // Place location: replace soft blocks, else the adjacent cell
    let px = t.x, py = t.y, pz = t.z;
    const tb = BLOCKS[t.id];
    if (!(tb.replaceable && !isFluid(t.id))) { px += t.face[0]; py += t.face[1]; pz += t.face[2]; }
    const cur = w.getBlock(px, py, pz);
    if (pshape === SHAPE.SLAB && cur === placeId && w.getMeta(px, py, pz) !== SLAB_DOUBLE) return this.finishPlace(px, py, pz, placeId, SLAB_DOUBLE);
    if (cur && !BLOCKS[cur].replaceable) return false;
    // pillaring: mid-jump with the feet still dipping into the cell below, place it anyway and lift the player on top
    let lift = false;
    if (SOLID[placeId] && p.intersectsBlock(px, py, pz)) {
      if (!this.canPillarLift(px, py, pz, placeId)) return false;
      lift = true;
    }
    if (SOLID[placeId] && g.entities.blockOccupied(px, py, pz)) return false;
    let meta = d.placeMeta || 0;
    const upper = t.face[1] === -1 || (t.face[1] === 0 && hitY - Math.floor(hitY) > 0.5);
    if (pshape === SHAPE.SLAB) meta = upper ? SLAB_TOP : 0;
    if (pshape === SHAPE.STAIRS || pshape === SHAPE.GATE) {
      const s = Math.abs(ldx) > Math.abs(ldz) ? (ldx > 0 ? 1 : 3) : (ldz > 0 ? 2 : 0);
      meta = s | (upper && pshape === SHAPE.STAIRS ? STAIRS_UPSIDE : 0);
    }
    if (placeId === B.LANTERN) meta = t.face[1] === -1 ? 1 : 0; // hangs when placed under a block
    if (pshape === SHAPE.TRAPDOOR) {
      // hinged on the clicked wall, or on the far side from the player on floors and ceilings; upper half when placed high
      const s = t.face[1] === 0 ? sideOf(-t.face[0], -t.face[2]) : (Math.abs(ldx) > Math.abs(ldz) ? (ldx > 0 ? 1 : 3) : (ldz > 0 ? 2 : 0));
      meta = s | (upper ? TRAPDOOR_TOP : 0);
    }
    const torch = placeId === B.TORCH || placeId === B.CINNABAR_TORCH;
    if (torch || placeId === B.LADDER || placeId === B.VINES) {
      // torches stand on floors or hang on walls; ladders only hang on walls
      if (t.face[1] === -1 || (!torch && t.face[1] === 1)) return false;
      if (t.face[1] === 0) { const s = sideOf(-t.face[0], -t.face[2]); meta = torch ? 1 + s : s; }
    }
    if (CIRCUIT_PLACE.has(placeId)) {
      // levers and buttons go on any face; wire, repeaters and plates on top; pistons face the player
      meta = circuitPlaceMeta(placeId, t.face, [ldx, ldy, ldz]);
      if (meta < 0) return false;
    }
    if (placeId === B.HOPPER) meta = hopperPlaceMeta(t.face);
    if (placeId === B.SCAFFOLDING) { meta = scaffoldDistance(w, px, py, pz); if (meta > SCAFFOLD_MAX) return false; }
    if (placeId === B.ANVIL) meta = Math.abs(ldx) > Math.abs(ldz) ? 1 : 0; // the long side faces across the player's view
    if (BLOCKS[placeId].crystal || placeId === B.STORM_ROD) {
      // buds point away from the clicked face, spikes up or down, rods stand or hang
      meta = cavePlaceMeta(w, px, py, pz, placeId, t.face);
      if (meta < 0) return false;
    }
    if (BLOCKS[placeId].needsSupport && !w.hasSupport(px, py, pz, placeId, meta)) return false;
    if ((placeId === B.TALL_GRASS || placeId === B.SUNPETAL || placeId === B.REDBLOOM) && !w.hasSupport(px, py, pz, placeId)) return false;
    if (placeId === B.FURNACE || BLOCKS[placeId].tex.front) {
      // face the player: meta 0 = -z front, 1 = +x, 2 = +z, 3 = -x
      const dx = p.x - (px + 0.5), dz = p.z - (pz + 0.5);
      meta = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0);
    }
    if (placeId === B.DISPENSER || placeId === B.DROPPER) meta = dispenserPlaceMeta([ldx, ldy, ldz]); // the face looks at the player, up or down too
    let chestPair = null;
    if (placeId === B.CHEST) { const pr = pairOnPlace(w, px, py, pz, meta, p.sneaking); meta = pr.meta; chestPair = pr.neighbour; } // join a lone chest beside it
    if (placeId === B.WATER && w.dimension === 'cinderdeep') {
      // water boils away at once in the Cinderdeep
      g.audio.play('fizz', [px + 0.5, py + 0.5, pz + 0.5]);
      g.particles.smoke(px + 0.5, py + 0.5, pz + 0.5, 16, 1);
      p.inventory.slots[p.inventory.selected] = { id: I.BUCKET, count: 1, damage: 0 };
      p.inventory.changed();
      this.swing = SWING_TICKS;
      return true;
    }
    w.setBlockUrgent(px, py, pz, placeId, meta);
    if (lift) { p.body.y = py + 1; p.body.vy = Math.max(p.body.vy, 0); }
    if (chestPair) w.setBlockUrgent(chestPair.x, chestPair.y, chestPair.z, B.CHEST, chestPair.meta);
    if (placeId === B.GLOOMSHELL_BOX && g.onBoxPlaced) g.onBoxPlaced(px, py, pz, st); // the box unpacks what it carried
    if (CROPS.has(placeId) && g.milestones) g.milestones.event('plant');
    if (isFluid(placeId)) w.scheduleTick(px, py, pz, 5);
    g.audio.play('place_' + BLOCKS[placeId].sound, [px + 0.5, py + 0.5, pz + 0.5]);
    if (d.places === B.WATER || d.places === B.LAVA) {
      p.inventory.slots[p.inventory.selected] = { id: I.BUCKET, count: 1, damage: 0 };
      p.inventory.changed();
    } else p.inventory.removeFromSlot(p.inventory.selected, 1);
    this.swing = SWING_TICKS;
    return true;
  }

  useVoidEye(t) {
    const g = this.game, w = g.world, p = g.player;
    if (t && t.id === B.HOLLOW_FRAME) {
      w.setBlockUrgent(t.x, t.y, t.z, B.HOLLOW_FRAME_EYE, 0, false);
      if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
      g.audio.play('place_glass', [t.x + 0.5, t.y + 1, t.z + 0.5]);
      const ring = findHollowRing(w, t.x, t.y, t.z);
      if (ring) {
        fillHollowGate(w, ring, (x, y, z, id) => w.setBlockUrgent(x, y, z, id, 0, false));
        g.audio.play('teleport', [ring.x + 0.5, ring.y, ring.z + 0.5]);
        g.hud.toast('The Hollow Gate opens');
      }
      this.swing = SWING_TICKS;
      return true;
    }
    if (t && t.id === B.HOLLOW_FRAME_EYE) return false;
    if (g.dims && g.dims.throwEye()) {
      if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
      this.swing = SWING_TICKS;
      return true;
    }
    return false;
  }

  /** Flint and steel wears; a fire charge is used up. */
  useIgniter(d) {
    const p = this.game.player;
    if (p.creative) return;
    if (d && d.charge) p.inventory.removeFromSlot(p.inventory.selected, 1);
    else p.inventory.damageSelected(1);
  }

  boneMeal(t) {
    const g = this.game, w = g.world;
    const burst = (x, y, z) => { for (let k = 0; k < 10; k++) g.particles.emit(x + Math.random(), y + Math.random() * 0.6, z + Math.random(), 0, 0.02, 0, 0.4, 0.9, 0.3, 20, -0.001); };
    if (CROPS.has(t.id)) {
      const m = w.getMeta(t.x, t.y, t.z);
      if (m >= 7) return false;
      w.setBlockUrgent(t.x, t.y, t.z, t.id, Math.min(7, m + 2 + Math.floor(Math.random() * 4)));
      burst(t.x, t.y, t.z);
      return true;
    }
    if (SAPLING_TREE[t.id]) {
      // 45 % chance to advance the sapling a stage
      if (Math.random() < 0.45) {
        if (w.getMeta(t.x, t.y, t.z) === 0) w.setBlockUrgent(t.x, t.y, t.z, t.id, 1);
        else { w.urgentEdits = true; try { growTree(w, t.x, t.y, t.z, SAPLING_TREE[t.id]); } finally { w.urgentEdits = false; } }
      }
      burst(t.x, t.y, t.z);
      return true;
    }
    if (t.id === B.GRASS && !w.getBlock(t.x, t.y + 1, t.z)) {
      for (let k = 0; k < 24; k++) {
        const x = t.x + Math.round((Math.random() - Math.random()) * 3), z = t.z + Math.round((Math.random() - Math.random()) * 3);
        for (const y of [t.y, t.y + 1, t.y - 1]) {
          if (w.getBlock(x, y, z) !== B.GRASS || w.getBlock(x, y + 1, z)) continue;
          const r = Math.random();
          w.setBlockUrgent(x, y + 1, z, r < 0.08 ? B.SUNPETAL : r < 0.16 ? B.REDBLOOM : B.TALL_GRASS);
          burst(x, y + 1, z);
          break;
        }
      }
      return true;
    }
    return false;
  }

  /** Feed / breed / shear a passive mob. Returns true if something happened. */
  /** Howlers (bones) and Purrlings (fish): tame a wild one (1 in 3), heal/breed a tame one with meat, otherwise sit/stand. */
  interactHowler(mob, st, d) {
    const g = this.game, p = g.player;
    const use = () => { if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1); this.swing = SWING_TICKS; };
    if (!mob.tamed) {
      if (!st || !(mob.def.tameFood || [I.BONE]).includes(st.id) || mob.target) return false;
      use();
      if (Math.random() < 1 / 3) {
        mob.tame(g);
      } else g.particles.smoke(mob.x, mob.y + mob.height, mob.z, 7, 0.4);
      return true;
    }
    if (d && d.food && mob.def.food.includes(st.id)) {
      if (mob.health < mob.maxHealth) { mob.health = Math.min(mob.maxHealth, mob.health + d.food.hunger); use(); g.audio.play('eat', [mob.x, mob.y + 0.5, mob.z]); mob.hearts(g, 2, true); return true; }
      if (mob.feed(g)) { use(); return true; }
    }
    if (mob.ownerName && p.netName && mob.ownerName !== p.netName) return false; // only its owner tells it to sit
    mob.sitting = !mob.sitting;
    mob.path = null; mob.wander = null; mob.target = null;
    return true;
  }

  interactMob(mob) {
    const g = this.game, p = g.player, st = p.inventory.selectedStack, d = st && ITEMS[st.id];
    if (mob.isRemotePlayer) return false;
    // milking a grown Mooxen with an empty bucket (no change to the mob, so guests do it themselves)
    if (st && st.id === I.BUCKET && (mob.type === 'mooxen' || mob.type === 'cragbuck') && mob.deathTime === 0 && !mob.baby) {
      const milk = { id: I.MILK_BUCKET, count: 1, damage: 0 };
      p.inventory.removeFromSlot(p.inventory.selected, 1);
      if (!p.inventory.selectedStack) p.inventory.slots[p.inventory.selected] = milk;
      else if (p.inventory.add(milk)) g.entities.spawnItem(p.x, p.y + 1, p.z, milk);
      p.inventory.changed();
      g.audio.play('bucket_fill', [mob.x, mob.y + 1, mob.z]);
      this.swing = SWING_TICKS;
      return true;
    }
    if (mob.netProxy) return g.net.interactMob(mob); // multiplayer guest: the host feeds, shears, tames or trades
    if (mob.def.villager && mob.deathTime === 0 && mob.trades.length && !(d && d.food && mob.def.food)) { g.ui.openTrade(mob); g.audio.play('hmm', [mob.x, mob.y + 1.5, mob.z]); return true; }
    if (mob.def.tameable && mob.deathTime === 0 && this.interactHowler(mob, st, d)) return true;
    if (mob.def.rideable && mob.deathTime === 0 && mob.age >= 0) {
      // Gallopers: saddle a tame one, feed it (taming goes faster), or climb on
      const use = () => { if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1); this.swing = SWING_TICKS; };
      if (d && d.saddle && mob.tamed && !mob.saddled) { mob.saddled = true; use(); g.audio.play('equip', [mob.x, mob.y + 1, mob.z]); return true; }
      if (d && d.food && mob.def.food.includes(st.id)) {
        if (mob.health < mob.maxHealth || !mob.tamed) { mob.health = Math.min(mob.maxHealth, mob.health + 2); mob.temper = Math.min(100, (mob.temper || 0) + 3); use(); g.audio.play('eat', [mob.x, mob.y + 1, mob.z]); mob.hearts(g, 2, true); return true; }
        if (mob.feed(g)) { use(); return true; }
      }
      if (!mob.rider && !p.riding && !p.sneaking) { g.mount(mob); return true; }
    }
    if (!d || mob.deathTime > 0 || mob.def.category !== 'creature') return false;
    if (d.dye && mob.type === 'fleecer' && mob.woolColor !== d.dye) {
      mob.woolColor = d.dye;
      p.inventory.removeFromSlot(p.inventory.selected, 1);
      this.swing = SWING_TICKS;
      return true;
    }
    if (d.shears && mob.type === 'fleecer' && !mob.sheared && mob.age >= 0) {
      mob.sheared = true;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) g.entities.spawnItem(mob.x, mob.y + 1, mob.z, { id: WOOL_ITEMS[mob.woolColor || 0], count: 1 }, [(Math.random() - Math.random()) * 0.1, Math.random() * 0.05 + 0.1, (Math.random() - Math.random()) * 0.1]);
      p.inventory.damageSelected(1);
      g.audio.play('shear', [mob.x, mob.y + 1, mob.z]);
      this.swing = SWING_TICKS;
      return true;
    }
    if (mob.def.food && mob.def.food.includes(st.id) && mob.feed(g)) {
      p.inventory.removeFromSlot(p.inventory.selected, 1);
      g.audio.play('eat', [mob.x, mob.y + 1, mob.z]);
      this.swing = SWING_TICKS;
      return true;
    }
    return false;
  }

  /**
   * Can a full block go into the cell under a jumping player? Allowed once the feet are in the
   * upper part of the cell, standing on it fits (no overlap with other blocks), and the player
   * is above the cell's centre, so pillaring up does not need frame-perfect timing.
   */
  canPillarLift(x, y, z, id) {
    const g = this.game, b = g.player.body;
    if (BLOCKS[id].shape !== SHAPE.CUBE || b.onGround || b.inWater || b.inLava) return false;
    if (Math.floor(b.x) !== x || Math.floor(b.z) !== z || b.y < y + 0.35 || b.y >= y + 1) return false;
    const h = b.width / 2, boxes = [];
    Body.solidBoxes(g.world, b.x - h, y + 1, b.z - h, b.x + h, y + 1 + b.height, b.z + h, boxes);
    for (let i = 0; i < boxes.length; i += 6) {
      if (boxes[i] < b.x + h && boxes[i + 3] > b.x - h && boxes[i + 1] < y + 1 + b.height && boxes[i + 4] > y + 1 &&
          boxes[i + 2] < b.z + h && boxes[i + 5] > b.z - h) return false;
    }
    return true;
  }

  /** Put a block (used for merging slabs) and consume one item. */
  finishPlace(x, y, z, id, meta) {
    const g = this.game, p = g.player;
    if (p.intersectsBlock(x, y, z) && meta === SLAB_DOUBLE) return false;
    if (LEAVES.has(id)) meta = 1; // placed leaves never decay
    g.world.setBlockUrgent(x, y, z, id, meta);
    if (id === B.PUMPKIN || id === B.JACK_O_LANTERN) { if (!this.tryBuildIronguard(x, y, z)) this.tryBuildFrostling(x, y, z); }
    if (id === B.RAIL) updateRails(g.world, x, y, z);
    g.audio.play('place_' + BLOCKS[id].sound, [x + 0.5, y + 0.5, z + 0.5]);
    p.inventory.removeFromSlot(p.inventory.selected, 1);
    this.swing = SWING_TICKS;
    return true;
  }

  /** Is the player still holding a fishing rod? (the bobber vanishes otherwise) */
  holdingRod() {
    const st = this.game.player.inventory.selectedStack;
    return !!(st && ITEMS[st.id] && ITEMS[st.id].rod);
  }

  /** A pumpkin on two snow blocks comes alive as a Frostling. */
  tryBuildFrostling(x, y, z) {
    const g = this.game, w = g.world;
    if (w.getBlock(x, y - 1, z) !== B.SNOW_BLOCK || w.getBlock(x, y - 2, z) !== B.SNOW_BLOCK) return false;
    for (const yy of [y, y - 1, y - 2]) { w.setBlockUrgent(x, yy, z, B.AIR); g.particles.smoke(x + 0.5, yy + 0.5, z + 0.5, 6, 1); }
    g.spawner.spawnMob('frostling', x + 0.5, y - 2, z + 0.5);
    g.audio.play('squish', [x + 0.5, y, z + 0.5]);
    return true;
  }

  /** A pumpkin on top of a T of four iron blocks comes alive as an Ironguard. */
  tryBuildIronguard(x, y, z) {
    const g = this.game, w = g.world;
    if (w.getBlock(x, y - 1, z) !== B.IRON_BLOCK || w.getBlock(x, y - 2, z) !== B.IRON_BLOCK) return false;
    for (const [ax, az] of [[1, 0], [0, 1]]) {
      if (w.getBlock(x + ax, y - 1, z + az) !== B.IRON_BLOCK || w.getBlock(x - ax, y - 1, z - az) !== B.IRON_BLOCK) continue;
      for (const [bx, by, bz] of [[x, y, z], [x, y - 1, z], [x, y - 2, z], [x + ax, y - 1, z + az], [x - ax, y - 1, z - az]]) {
        w.setBlockUrgent(bx, by, bz, B.AIR);
        g.particles.smoke(bx + 0.5, by + 0.5, bz + 0.5, 6, 1);
      }
      const m = g.spawner.spawnMob('ironguard', x + 0.5, y - 2, z + 0.5);
      if (m) { m.playerMade = true; m.home = { x: x + 0.5, y: y - 2, z: z + 0.5 }; }
      g.audio.play('clank', [x + 0.5, y, z + 0.5]);
      if (g.milestones) g.milestones.event('golem');
      return true;
    }
    return false;
  }

  /** Doors take two blocks: the clicked spot (or the one beside it) and the one above. */
  placeDoor(t) {
    const g = this.game, w = g.world, p = g.player;
    let px = t.x, py = t.y, pz = t.z;
    if (!(BLOCKS[t.id].replaceable && !isFluid(t.id))) { px += t.face[0]; py += t.face[1]; pz += t.face[2]; }
    for (const yy of [py, py + 1]) {
      const cur = w.getBlock(px, yy, pz);
      if (cur && !BLOCKS[cur].replaceable) return false;
      if (p.intersectsBlock(px, yy, pz) || g.entities.blockOccupied(px, yy, pz)) return false;
    }
    if (!SOLID[w.getBlock(px, py - 1, pz)]) return false;
    const dx = p.x - (px + 0.5), dz = p.z - (pz + 0.5);
    const facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0);
    const door = ITEMS[p.inventory.selectedStack.id].doorBlock || B.DOOR;
    w.setBlockUrgent(px, py + 1, pz, door, facing | DOOR_UPPER, false);
    w.setBlockUrgent(px, py, pz, door, facing);
    g.audio.play('place_wood', [px + 0.5, py + 0.5, pz + 0.5]);
    p.inventory.removeFromSlot(p.inventory.selected, 1);
    this.swing = SWING_TICKS;
    return true;
  }

  /** Beds take two blocks: the foot where clicked and the head further along the player's view. */
  placeBed(t) {
    const g = this.game, w = g.world, p = g.player;
    let px = t.x, py = t.y, pz = t.z;
    if (!(BLOCKS[t.id].replaceable && !isFluid(t.id))) { px += t.face[0]; py += t.face[1]; pz += t.face[2]; }
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const side = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 2 : 0);
    const [dx, , dz] = SIDE_DIRS[side];
    const cells = [[px, pz], [px + dx, pz + dz]];
    for (const [cx, cz] of cells) {
      const cur = w.getBlock(cx, py, cz);
      if (cur && !BLOCKS[cur].replaceable) return false;
      if (!SOLID[w.getBlock(cx, py - 1, cz)]) return false;
      if (p.intersectsBlock(cx, py, cz) || g.entities.blockOccupied(cx, py, cz)) return false;
    }
    w.setBlockUrgent(px + dx, py, pz + dz, B.BED, side | BED_HEAD, false);
    w.setBlockUrgent(px, py, pz, B.BED, side);
    g.audio.play('place_wool', [px + 0.5, py + 0.5, pz + 0.5]);
    p.inventory.removeFromSlot(p.inventory.selected, 1);
    this.swing = SWING_TICKS;
    return true;
  }

  pickBlock(id) {
    const inv = this.game.player.inventory;
    const asItem = { [B.CINNABAR_WIRE]: I.CINNABAR, [B.CINNABAR_TORCH_OFF]: B.CINNABAR_TORCH, [B.CINNABAR_LAMP_ON]: B.CINNABAR_LAMP, [B.DOOR]: I.OAK_DOOR, ...Object.fromEntries(DOOR_SETS.slice(1).map(([, door]) => [door, BLOCKS[door].doorItem])), [B.BED]: I.BED, [B.WHEAT]: I.WHEAT_SEEDS, [B.MELON_STEM]: I.MELON_SEEDS, [B.PUMPKIN_STEM]: I.PUMPKIN_SEEDS, [B.CARROTS]: I.CARROT, [B.POTATOES]: I.POTATO, [B.BEETROOTS]: I.BEETROOT_SEEDS, [B.FURNACE_LIT]: B.FURNACE, [B.SMOKER_LIT]: B.SMOKER, [B.BLAST_FURNACE_LIT]: B.BLAST_FURNACE, [B.FARMLAND]: B.DIRT, [B.CINDERROOT]: I.CINDERROOT };
    const want = asItem[id] ?? id;
    for (let i = 0; i < 9; i++) if (inv.slots[i] && inv.slots[i].id === want) { inv.selected = i; return; }
    if (this.game.player.creative && ITEMS[want]) {
      // creative: put the block in an empty hotbar slot (or the selected one)
      let slot = inv.selected;
      if (inv.slots[slot]) for (let i = 0; i < 9; i++) if (!inv.slots[i]) { slot = i; break; }
      inv.slots[slot] = { id: want, count: 1, damage: 0 };
      inv.selected = slot;
      inv.changed();
    }
  }
}

export { SHAPE };

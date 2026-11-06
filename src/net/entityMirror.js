// Client side of entity sync. The host simulates every entity (mobs, dropped
// items, experience orbs, arrows, boats, falling blocks) and sends snapshots;
// here they become non-simulated proxies of the same classes that glide to the
// latest snapshot. Hitting, picking up and riding them are requests to the host.
import { splashParticles } from '../entities/splash.js';
import { Mob } from '../mobs/mob.js';
import { MOBS } from '../mobs/mobTypes.js';
import { equipFromIds } from '../mobs/equipment.js';
import { offhandFromId } from '../mobs/offhand.js';
import { ItemEntity, XPOrb, Arrow, Boat, Minecart, FallingBlock } from '../entities/entities.js';
import { ArmorStand } from '../entities/armorStand.js';
import { AreaCloud } from '../entities/areaCloud.js';
import { I, ITEMS, maxStack } from '../world/items.js';
import { unpackEntity, roomFor } from './protocol.js';
import { knotAt } from '../entities/leash.js';
import { deadReckon, velocityBetween } from './interp.js';
import { dirt } from '../mobs/hushkeeper.js';

const TAKE_RETRY = 10; // ticks between pickup requests for the same entity

function place(e, x, y, z) {
  if (e.body) e.body.setPos(x, y, z); else { e.x = x; e.y = y; e.z = z; }
}

export class EntityMirror {
  constructor(game, session) {
    this.game = game;
    this.session = session;
    this.proxies = new Map(); // host entity id -> proxy
    this.ticks = 0;
  }

  /**
   * Apply a snapshot: packed entities near us. Without `ids` it is a full list and entities
   * missing from it are gone; with `ids` the list holds only what changed and `ids` names
   * everything that is still there.
   */
  apply(list, ids = null) {
    const g = this.game, seen = new Set(ids || []);
    for (const a of list || []) {
      const s = unpackEntity(a);
      if (!s) continue;
      if (s.kind === 'mob' && !MOBS[s.type]) continue;
      if (s.kind === 'item' && !ITEMS[s.stack.id]) continue;
      if (!g.world.isLoaded(Math.floor(s.x), Math.floor(s.z))) continue; // outside our loaded area
      let e = this.proxies.get(s.id);
      if (e && (e.removed || (e.dead && e !== g.player.riding))) { this.proxies.delete(s.id); e = null; }
      if (e && e.kind !== s.kind) { e.dead = e.removed = true; e = null; }
      if (!e) e = this.create(s);
      if (!e) continue;
      seen.add(s.id);
      if (s.kind === 'mob') { // its speed, to carry it on when the next snapshot is late (far mobs are sent less often)
        const now = performance.now();
        e.netVel = velocityBetween(e.netState, s, now - (e.netSnapAt || 0));
        e.netSnapAt = now;
      }
      e.netState = s;
      this.update(e, s);
    }
    for (const [id, e] of this.proxies) {
      if (seen.has(id)) continue;
      if (e.kind === 'mob' && e.deathTime > 0) g.particles.smoke(e.x, e.y + e.height / 2, e.z, 14, e.width);
      if (e.kind === 'arrow' && e.thrown === 'potion') splashParticles(g, e.x, e.y, e.z, e.potion); // the host's elixir broke
      e.removed = true; e.dead = true;
      this.proxies.delete(id);
    }
  }

  create(s) {
    const g = this.game;
    let e;
    switch (s.kind) {
      case 'mob':
        e = new Mob(s.type, s.x, s.y, s.z);
        e._game = g;
        e.persistent = false;
        e.yaw = e.prevYaw = s.yaw;
        e.hurt = (dmg, source, attacker = null, knockback = 0.4, projectile = null) => this.requestHit(e, dmg, source, attacker, knockback, projectile);
        break;
      case 'item': e = new ItemEntity(s.x, s.y, s.z, s.stack); break;
      case 'xp': e = new XPOrb(s.x, s.y, s.z, s.value); break;
      case 'arrow': e = new Arrow(s.x, s.y, s.z, s.vx, s.vy, s.vz, null, false, s.thrown, s.potion); break;
      case 'boat': e = s.cart ? new Minecart(s.x, s.y, s.z, s.yaw, s.variant) : new Boat(s.x, s.y, s.z, s.yaw, s.variant); break;
      case 'falling': e = new FallingBlock(0, 0, 0, s.blockId); break;
      case 'stand': e = new ArmorStand(s.x, s.y, s.z, s.yaw); break;
      case 'cloud': e = new AreaCloud(s.x, s.y, s.z, { potion: s.potion, breath: s.breath, radius: s.radius }); break;
      default: return null;
    }
    if (e.body) { e.body.vx = e.body.vy = e.body.vz = 0; }
    place(e, s.x, s.y, s.z);
    e.prev = [s.x, s.y, s.z];
    e.netProxy = true;
    e.netId = s.id;
    e.netTick = () => this.tickProxy(e);
    g.entities.add(e);
    this.proxies.set(s.id, e);
    return e;
  }

  update(e, s) {
    if (e.kind === 'mob') {
      e.health = s.health;
      if (s.hurtTime > e.hurtTime) e.hurtTime = s.hurtTime;
      e.deathTime = s.deathTime;
      e.headPitch = s.headPitch;
      e.target = s.target ? 'player' : null;
      e.angry = s.angry; e.sheared = s.sheared; e.tamed = s.tamed; e.sitting = s.sitting; e.enemy = s.enemy ? 'player' : null;
      e.woolColor = s.woolColor; e.fuse = s.fuse; e.special = s.special; e.beam = s.beam; e.moving = s.moving; e.captain = s.captain; // Marauder Captains carry a banner
      e.netDriver = s.driver; // who steers it (a player's id, -1 nobody)
      e.saddled = s.saddled; e.dancing = s.dancing; e.passengerId = s.passenger >= 0 ? s.passenger : null; e.heldItemId = ITEMS[s.heldItem] ? s.heldItem : 0; // Dune Striders, Hoverlings
      if (e.def && e.def.villager) { // a settler's trade (robe colour) follows the host's, including losing it; a new one shows the green burst
        if (e.netProfSeen && s.profession && s.profession !== e.profession) e.jobBurst(this.game);
        e.profession = s.profession; e.netProfSeen = true;
      } else if (s.profession) e.profession = s.profession;
      e.customName = s.name || undefined; // a Name Tag's label
      e.leashHolder = this.leashHolder(s.leash);
      e.emerging = s.emerging; e.digging = s.digging; // a Hushkeeper rising / sinking (drawn by its customRender)
      e.netRiding = s.riding; // a jockey: seated pose (the host places it on its mount)
      const ek = s.equip ? s.equip.join(',') : '';
      const oh = offhandFromId(s.offhand);
      if ((e.offhand ? e.offhand.id : 0) !== (oh ? oh.id : 0)) e.offhand = oh; // shown only; the host keeps the real item
      if (e.equipKey !== ek) { e.equipKey = ek; e.equip = equipFromIds(s.equip); } // shown only; the host keeps the real gear
      if (s.baby !== e.age < 0) e.setBaby(s.baby);
      e.body.onGround = s.onGround;
    } else if (e.kind === 'item') {
      e.stack.count = s.stack.count; e.stack.damage = s.stack.damage;
      e.pickupDelay = s.delayed ? 10 : 0;
    } else if (e.kind === 'xp') e.value = s.value;
    else if (e.kind === 'stand') {
      // only the ids matter here (what it looks like); the host keeps the real stacks
      const st = (id) => (id && ITEMS[id] ? { id, count: 1, damage: 0 } : null);
      e.yaw = s.yaw; e.hitTime = s.hitTime;
      e.armor = s.armor.map(st); e.hand = st(s.hand);
    }
    else if (e.kind === 'cloud') e.radius = s.radius;
    else if (e.kind === 'arrow') {
      e.vx = s.vx; e.vy = s.vy; e.vz = s.vz; e.stuck = s.stuck; e.pickup = s.pickup;
    } else if (e.kind === 'boat') {
      e.hitTime = s.hitTime;
      if (e.cart) { e.prevPitch = e.pitch; e.pitch = s.pitch; e.fuel = s.lit ? 1 : 0; } // (a lit furnace cart: only that it burns matters here)
      // who sits where: the driver (seat 0) and the second passenger (seat 1: a player, or a creature led aboard, -2)
      const p = this.game.player, mine = p.riding === e, seat = p.seat | 0;
      e.remoteRider = !(mine && seat === 0) && s.rider !== -1 ? s.rider : null;
      e.remoteRider2 = !(mine && seat === 1) && s.passenger >= 0 ? s.passenger : null;
      e.mobSeen = s.passenger === -2;
    }
  }

  /** The object a mirrored lead is drawn to: us, another player, or a (local copy of a) fence knot. */
  leashHolder(l) {
    const g = this.game;
    if (!l) return null;
    if (l.knot) {
      const [bx, by, bz] = l.knot;
      let k = knotAt(g, bx, by, bz);
      if (!k) { k = knotAt(g, bx, by, bz, true); k.mirrored = true; }
      return k;
    }
    if (l.player === this.session.id) return g.player;
    const rp = this.session.remotes.get(l.player);
    return rp ? rp.anchor : null;
  }

  /** One game tick: move halfway to the snapshot (snapshots come every other tick). */
  tickProxy(e) {
    const g = this.game, s = e.netState, p = g.player;
    this.ticks = g.ticks;
    if (e.kind === 'boat' && p.riding === e) {
      this.checkBoatSeat(e);
      if (!(p.seat | 0)) { this.tickRiddenBoat(e); return; } // the driver steers here; a passenger just follows the host's boat
    }
    if (e.kind === 'mob' && p.riding === e) { this.checkSeat(e); this.steerMount(e); }
    e.prev = [e.x, e.y, e.z];
    if (e.kind === 'mob') {
      e.prevYaw = e.yaw; e.prevFuse = e.fuse; if (e.hurtTime > 0) e.hurtTime--;
      if (e.emerging > 0 || e.digging > 0) { // count down between snapshots (smooth rising / sinking), throwing up dirt
        if (e.emerging > 0) e.emerging--; else e.digging--;
        if (g.ticks % 4 === 0 && g.particles) (e.def && e.def.digDust ? e.def.digDust : dirt)(e, g); // (a Dustmole throws sand, a Hushkeeper dirt)
      }
    }
    if (e.kind === 'boat') e.prevYaw = e.yaw;
    if (!s) return;
    let tx = s.x, tz = s.z;
    if (e.kind === 'mob' && e.netVel && !(p.riding === e)) [tx, , tz] = deadReckon(s, e.netVel, performance.now() - e.netSnapAt);
    const dx = tx - e.x, dy = s.y - e.y, dz = tz - e.z;
    if (dx * dx + dy * dy + dz * dz > 64) { place(e, s.x, s.y, s.z); e.prev = [s.x, s.y, s.z]; }
    else place(e, e.x + dx * 0.5, e.y + dy * 0.5, e.z + dz * 0.5);
    if (e.kind === 'mob' || e.kind === 'boat') {
      let dyaw = s.yaw - e.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2; while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      e.yaw += dyaw * 0.5;
    }
    if (e.kind === 'mob') {
      const moved = Math.hypot(e.x - e.prev[0], e.z - e.prev[2]);
      e.limbAmount += (Math.min(1, moved * 4) - e.limbAmount) * 0.4;
      e.limbSwing += moved * 4;
    }
    if (e.kind === 'xp' && e.age !== undefined) e.age++;
    if (e.proxyTick) e.proxyTick(g); // a lingering cloud's specks
    this.tryPickup(e);
  }

  /** We sit on the host's Dune Strider, Galloper or Thistlehorn: get off again if the host gave the seat to someone else (or never gave it). */
  checkSeat(e) {
    const st = e.netState, me = this.session.id;
    const mine = st && ((this.game.player.seat | 0) === 1 ? st.passenger === me : st.driver === me);
    e.seatWait = mine ? 0 : (e.seatWait || 0) + 1;
    if (e.seatWait > 40) { e.seatWait = 0; this.game.dismount(); }
  }

  /** The reins: tell the host where we steer the mount we sit on (the host moves it; every 4th tick, at once when the keys change). */
  steerMount(e) {
    const g = this.game, p = g.player;
    if ((p.seat | 0) !== 0 || !g.boatInput) return;
    const i = g.boatInput, f = Math.sign(i.forward || 0), s = Math.round((i.strafe || 0) * 10) / 10, j = !!i.jump, sp = !!i.sprint;
    const key = `${f},${s},${j},${sp}`;
    if (key === e.steerKey && g.ticks - (e.steerAt || 0) < 4) return;
    e.steerKey = key; e.steerAt = g.ticks;
    this.session.send({ t: 'steer', id: e.netId, f, s, j: j ? 1 : 0, sp: sp ? 1 : 0 });
  }

  /** We sit in this boat: get out again if the host never gave us the seat (someone else was quicker). */
  checkBoatSeat(e) {
    const st = e.netState, p = this.game.player, me = this.session.id;
    const mine = st && ((p.seat | 0) === 0 ? st.rider === me : st.passenger === me);
    e.seatWait = mine ? 0 : (e.seatWait || 0) + 1;
    if (e.seatWait > 40) { e.seatWait = 0; this.game.dismount(); }
  }

  /** We sit in this boat: steer it here (the host takes our word for where it is). */
  tickRiddenBoat(e) {
    const g = this.game;
    e.tick(g, g.boatInput);
    if (g.ticks % 2 === 0) this.session.send({ t: 'boat', id: e.netId, x: e.x, y: e.y, z: e.z, yaw: e.yaw });
  }

  /** Ask the host for items, orbs and arrows we touch (it decides; nothing is duplicated). */
  tryPickup(e) {
    const g = this.game, p = g.player;
    if (p.dead || (e.kind !== 'item' && e.kind !== 'xp' && e.kind !== 'arrow')) return;
    if (e.takeAt && g.ticks - e.takeAt < TAKE_RETRY) return;
    const b = p.body.box();
    if (e.kind === 'item') {
      if (e.pickupDelay > 0) return;
      if (!(e.x > b[0] - 1 && e.x < b[3] + 1 && e.y > b[1] - 0.5 && e.y < b[4] + 0.5 && e.z > b[2] - 1 && e.z < b[5] + 1)) return;
      const n = Math.min(e.stack.count, roomFor(p.inventory.slots, e.stack, maxStack, !ITEMS[e.stack.id].durability));
      if (n <= 0) return;
      e.takeAt = g.ticks;
      this.session.send({ t: 'take', id: e.netId, n });
    } else if (e.kind === 'xp') {
      if (!(e.x > b[0] - 0.5 && e.x < b[3] + 0.5 && e.y > b[1] - 0.5 && e.y < b[4] + 0.5 && e.z > b[2] - 0.5 && e.z < b[5] + 0.5)) return;
      e.takeAt = g.ticks;
      this.session.send({ t: 'take', id: e.netId, n: 1 });
    } else if (e.stuck && e.pickup) {
      if (!(Math.abs(p.x - e.x) < 1.2 && Math.abs(p.z - e.z) < 1.2 && e.y > p.y - 0.5 && e.y < p.y + 2.3)) return;
      if (e.thrown === 'spear' ? !p.inventory.slots.some((sl) => !sl) : roomFor(p.inventory.slots, { id: I.ARROW }, maxStack) <= 0) return; // (the host checks a spear's thrower)
      e.takeAt = g.ticks;
      this.session.send({ t: 'take', id: e.netId, n: 1 });
    }
  }

  requestHit(m, dmg, source, attacker, knockback, projectile) {
    if (m.deathTime > 0 || m.removed || this.session.applyingRemote) return false;
    if (!(attacker && attacker.isPlayer)) return false; // only our own attacks are forwarded
    this.session.send({ t: 'hit', id: m.netId, d: Math.round(dmg * 100) / 100, k: Math.round(knockback * 100) / 100, p: projectile ? 1 : 0 });
    m.hurtTime = 10; // immediate feedback; the host's snapshot follows
    this.game.audio.play('mob_hurt', [m.x, m.y + 1, m.z]);
    return true;
  }

  byNetId(id) { return this.proxies.get(id); }

  clear() {
    for (const e of this.proxies.values()) { e.removed = true; e.dead = true; }
    this.proxies.clear();
  }
}

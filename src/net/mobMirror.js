// Client side of mob sync: the host simulates every mob and sends snapshots;
// here they become non-simulated proxy Mob entities that only glide towards the
// latest snapshot. Hitting a proxy (melee or arrow) asks the host to apply it.
import { Mob } from '../mobs/mob.js';
import { MOBS } from '../mobs/mobTypes.js';
import { unpackMob } from './protocol.js';

export class MobMirror {
  constructor(game, session) {
    this.game = game;
    this.session = session;
    this.proxies = new Map(); // host mob id -> proxy
  }

  /** Apply a snapshot (list of packed mobs); mobs missing from it are gone. */
  apply(list) {
    const g = this.game, seen = new Set();
    for (const a of list || []) {
      const s = unpackMob(a);
      if (!s || !MOBS[s.type]) continue;
      let m = this.proxies.get(s.id);
      if (!g.world.isLoaded(Math.floor(s.x), Math.floor(s.z))) continue; // not in our loaded area
      if (m && (m.removed || m.dead)) { this.proxies.delete(s.id); m = null; }
      if (!m) m = this.create(s);
      seen.add(s.id);
      m.netState = s;
      m.health = s.health;
      if (s.hurtTime > m.hurtTime) m.hurtTime = s.hurtTime;
      m.deathTime = s.deathTime;
      m.headPitch = s.headPitch;
      m.target = s.target ? 'player' : null;
      m.angry = s.angry; m.sheared = s.sheared; m.tamed = s.tamed; m.sitting = s.sitting; m.enemy = s.enemy ? 'player' : null;
      m.woolColor = s.woolColor; m.fuse = s.fuse;
      if (s.profession) m.profession = s.profession;
      if (s.baby !== m.age < 0) m.setBaby(s.baby);
      m.body.onGround = s.onGround;
    }
    for (const [id, m] of this.proxies) {
      if (seen.has(id)) continue;
      if (m.deathTime > 0) g.particles.smoke(m.x, m.y + m.height / 2, m.z, 14, m.width);
      m.removed = true; m.dead = true;
      this.proxies.delete(id);
    }
  }

  create(s) {
    const g = this.game;
    const m = new Mob(s.type, s.x, s.y, s.z);
    m.netProxy = true;
    m.netId = s.id;
    m._game = g;
    m.persistent = false;
    m.yaw = m.prevYaw = s.yaw;
    m.netTick = () => this.tickProxy(m);
    m.hurt = (dmg, source, attacker = null, knockback = 0.4, projectile = null) => this.requestHit(m, dmg, source, attacker, knockback, projectile);
    g.entities.add(m);
    this.proxies.set(s.id, m);
    return m;
  }

  /** One game tick: move halfway to the snapshot (snapshots come every other tick). */
  tickProxy(m) {
    const s = m.netState, b = m.body;
    m.prev = [b.x, b.y, b.z];
    m.prevYaw = m.yaw;
    m.prevFuse = m.fuse;
    if (m.hurtTime > 0) m.hurtTime--;
    if (!s) return;
    const dx = s.x - b.x, dy = s.y - b.y, dz = s.z - b.z;
    if (dx * dx + dy * dy + dz * dz > 64) { b.setPos(s.x, s.y, s.z); m.prev = [s.x, s.y, s.z]; }
    else b.setPos(b.x + dx * 0.5, b.y + dy * 0.5, b.z + dz * 0.5);
    let dyaw = s.yaw - m.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2; while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    m.yaw += dyaw * 0.5;
    const moved = Math.hypot(b.x - m.prev[0], b.z - m.prev[2]);
    m.limbAmount += (Math.min(1, moved * 4) - m.limbAmount) * 0.4;
    m.limbSwing += moved * 4;
  }

  requestHit(m, dmg, source, attacker, knockback, projectile) {
    if (m.deathTime > 0 || m.removed || this.session.applyingRemote) return false;
    if (!(attacker && attacker.isPlayer)) return false; // only our own attacks are forwarded
    this.session.send({ t: 'hit', id: m.netId, d: Math.round(dmg * 100) / 100, k: Math.round(knockback * 100) / 100, p: projectile ? 1 : 0 });
    m.hurtTime = 10; // immediate feedback; the host's snapshot follows
    this.game.audio.play('mob_hurt', [m.x, m.y + 1, m.z]);
    return true;
  }

  clear() {
    for (const m of this.proxies.values()) { m.removed = true; m.dead = true; }
    this.proxies.clear();
  }
}

// The Void Wyrm, the Hollow's boss (simplified flight AI):
//  circle - glides around the pillars, 56 blocks out, 16-24 blocks above the island
//  swoop  - dives at the player; touching its head deals 10, its body 5, and flings the player
//  climb  - pulls up and away after a pass (or when the swoop times out)
// Mending Crystals on the pillars heal it while it is within their reach
// (see DimensionManager.wyrmTick). Its death opens the exit gate.
import { I } from '../world/items.js';

const SPEED = { circle: 0.5, swoop: 0.72, climb: 0.55 };

export function wyrmAI(m, g, p, pdist) {
  const b = m.body, ctl = g.dims;
  if (!m.phase) { m.phase = 'circle'; m.angle = Math.atan2(m.z, m.x); m.phaseTimer = 160; m.buffet = 0; m.pitch = 0; }
  const cy = ctl ? ctl.wyrmCircleY() : 80;
  const canTarget = !p.dead && !p.creative && g.world.dimension === 'hollow' && pdist < 160;
  let tx, ty, tz;
  if (m.phase === 'circle') {
    m.angle += 0.0105;
    tx = Math.cos(m.angle) * 56; tz = Math.sin(m.angle) * 56; ty = cy + Math.sin(m.angle * 3) * 5;
    if (--m.phaseTimer <= 0 && canTarget) { m.phase = 'swoop'; m.phaseTimer = 240; g.audio.play('scream', [m.x, m.y + 1, m.z], 1); }
  } else if (m.phase === 'swoop') {
    tx = p.x; ty = p.y + 0.6; tz = p.z;
    if (--m.phaseTimer <= 0 || !canTarget) { m.phase = 'climb'; m.phaseTimer = 70; }
  } else {
    const d = Math.hypot(m.x, m.z) || 1;
    tx = m.x + (m.x / d) * 24; tz = m.z + (m.z / d) * 24; ty = cy + 12;
    if (--m.phaseTimer <= 0) { m.phase = 'circle'; m.angle = Math.atan2(m.z, m.x); m.phaseTimer = 140 + Math.floor(Math.random() * 180); }
  }
  const dx = tx - m.x, dy = ty - m.y, dz = tz - m.z, l = Math.hypot(dx, dy, dz) || 1;
  const sp = SPEED[m.phase] * (m.phase === 'swoop' && l < 10 ? 0.75 : 1), k = m.phase === 'swoop' ? 0.09 : 0.05;
  b.vx += (dx / l * sp - b.vx) * k; b.vy += (dy / l * sp - b.vy) * k; b.vz += (dz / l * sp - b.vz) * k;
  const hv = Math.hypot(b.vx, b.vz);
  if (hv > 0.02) m.yaw = Math.atan2(-b.vx, -b.vz);
  m.pitch = Math.atan2(b.vy, Math.max(0.05, hv));

  // contact damage: head (in front of the body) and body
  if (m.buffet > 0) m.buffet--;
  if (canTarget && m.buffet === 0) {
    const hx = m.x - Math.sin(m.yaw) * 2.6, hz = m.z - Math.cos(m.yaw) * 2.6;
    const dHead = Math.hypot(p.x - hx, p.y + 0.9 - (m.y + 1.3), p.z - hz);
    const dBody = Math.hypot(p.x - m.x, p.y + 0.9 - (m.y + 1), p.z - m.z);
    if (dHead < 2.4 || dBody < 2.6) {
      p.hurt(dHead < 2.4 ? 10 : 5, 'mob:Void Wyrm', m);
      const kx = p.x - m.x, kz = p.z - m.z, kl = Math.hypot(kx, kz) || 1;
      p.body.vx += kx / kl * 1.1; p.body.vz += kz / kl * 1.1; p.body.vy = 0.75;
      m.buffet = 20;
      if (m.phase === 'swoop') { m.phase = 'climb'; m.phaseTimer = 70; }
    }
  }
  if (ctl) ctl.wyrmTick(m);
  if (g.ticks % 9 === 0) g.particles.emit(m.x + (Math.random() - 0.5) * 2, m.y + 0.6, m.z + (Math.random() - 0.5) * 2, 0, -0.01, 0, 0.6, 0.2, 0.9, 30, 0);
}

/** Being hit makes it break off a swoop; explosions only scratch it. */
export function wyrmHurt(m, dmg, source, attacker) {
  if (source === 'explosion') dmg *= 0.25;
  if (attacker && attacker.isPlayer && m.phase === 'swoop' && Math.random() < 0.3) { m.phase = 'climb'; m.phaseTimer = 60; }
  return dmg;
}

export function wyrmDeath(m, g) {
  for (let k = 0; k < 120; k++) {
    g.particles.emit(m.x + (Math.random() - 0.5) * 6, m.y + Math.random() * 4, m.z + (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3, 0.8, 0.4, 1, 40, -0.004);
  }
  g.audio.play('explode', [m.x, m.y, m.z]);
  if (g.dims) g.dims.onWyrmSlain(m);
  // two Suncores fall on the middle of the island (not into the void under the Wyrm)
  if (!g.net || g.net.isHost) g.entities.spawnItem(0.5, g.world.heightAt(0, 0) + 1.5, 0.5, { id: I.SUNCORE, count: 2 });
}

export function wyrmRender(m, model, alpha, sec) {
  model.rotation.order = 'YXZ';
  model.rotation.x = (m.pitch || 0) * 0.7;
  if (m.deathTime > 0) model.rotation.z = 0;
}

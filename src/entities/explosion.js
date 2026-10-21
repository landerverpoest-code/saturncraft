// Explosions: 16x16x16 ray block destruction with blast resistance, entity
// damage with exposure, and 1/power drop survival.
import { B, BLOCKS, isFluid } from '../world/blocks.js';
import { igniteTNT } from './tnt.js';
import { blockDrops } from '../world/mining.js';

/** Damage dealt to an entity at normalised distance d (0..1) with exposure e. */
export function explosionDamage(power, d, exposure) {
  const impact = (1 - d) * exposure;
  return Math.floor(((impact * impact + impact) / 2) * 7 * (power * 2) + 1);
}

/** Blocks destroyed by an explosion (pure; `getBlock(x,y,z)` lookup). */
export function explosionBlocks(getBlock, x, y, z, power, rng = Math.random) {
  const out = new Map();
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
    if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
    let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1;
    const l = Math.hypot(dx, dy, dz);
    dx /= l; dy /= l; dz /= l;
    let intensity = power * (0.7 + rng() * 0.6);
    let px = x, py = y, pz = z;
    while (intensity > 0) {
      const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
      const id = getBlock(bx, by, bz);
      if (id !== B.AIR) {
        intensity -= (BLOCKS[id].resistance + 0.3) * 0.3;
        if (intensity > 0 && !isFluid(id)) out.set(`${bx},${by},${bz}`, [bx, by, bz, id]);
      }
      px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
      intensity -= 0.225;
    }
  }
  return [...out.values()];
}

function exposure(world, cx, cy, cz, e) {
  const hw = e.width / 2;
  let seen = 0, total = 0;
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++) {
    const tx = e.x - hw + e.width * i / 2, ty = e.y + e.height * j / 2, tz = e.z - hw + e.width * k / 2;
    const dx = tx - cx, dy = ty - cy, dz = tz - cz, d = Math.hypot(dx, dy, dz);
    total++;
    if (d < 0.01) { seen++; continue; }
    const hit = world.raycast(cx, cy, cz, dx / d, dy / d, dz / d, d);
    if (!hit) seen++;
  }
  return seen / total;
}

export function explode(game, x, y, z, power, source) {
  const w = game.world;
  const blocks = explosionBlocks((a, b, c) => w.getBlock(a, b, c), x, y, z, power);
  // Entities
  const radius = power * 2;
  const targets = game.entities.list.filter((e) => (e.kind === 'mob' && e.deathTime === 0 && e !== source) || e.kind === 'item');
  const p = game.player;
  const all = [...targets];
  if (!p.dead) all.push({ isPlayer: true, x: p.x, y: p.y, z: p.z, width: 0.6, height: p.body.height, body: p.body, ref: p });
  for (const e of all) {
    const dx = e.x - x, dy = (e.y + (e.height || 0.25) * 0.5) - y, dz = e.z - z;
    const dist = Math.hypot(dx, dy, dz);
    const d = dist / radius;
    if (d > 1) continue;
    if (e.kind === 'item') { e.dead = true; continue; }
    const ex = exposure(w, x, y, z, { x: e.x, y: e.y, z: e.z, width: e.width, height: e.height });
    const dmg = explosionDamage(power, d, ex);
    const impact = (1 - d) * ex;
    const body = e.body;
    if (dist > 0.01 && body) { body.vx += dx / dist * impact; body.vy += dy / dist * impact; body.vz += dz / dist * impact; }
    if (e.isPlayer) e.ref.hurt(dmg, 'explosion');
    else e.hurt(dmg, 'explosion', null, 0);
  }
  // Blocks
  for (const [bx, by, bz, id] of blocks) {
    if (BLOCKS[id].hardness < 0 || w.getBlock(bx, by, bz) !== id) continue; // may already be gone (door halves)
    if (id === B.TNT) { igniteTNT(game, bx, by, bz, 10 + Math.floor(Math.random() * 20)); continue; } // chain reaction
    const meta = w.getMeta(bx, by, bz);
    w.setBlock(bx, by, bz, B.AIR);
    if (Math.random() < 1 / power) {
      const ideal = { type: BLOCKS[id].tool, tier: 99, speed: 1 };
      for (const st of blockDrops(id, ideal, Math.random, meta)) game.entities.spawnItem(bx + 0.5, by + 0.5, bz + 0.5, st);
    }
    if (id === B.FURNACE || id === B.FURNACE_LIT || id === B.CHEST || id === B.BARREL || id === B.BREWING_STAND || id === B.GLOOMSHELL_BOX) game.onBlockBroken(bx, by, bz, id, meta);
  }
  game.particles.smoke(x, y, z, 80, power * 1.5);
  game.audio.play('explode', [x, y, z]);
}

// The Proving Vaults at run time (rules in world/provingVaults.js, loot in world/provingLoot.js).
//
// Proving Spawners: when a player (not creative or a spectator) comes within 14 blocks a spawner wakes
// and calls a wave of its mob kind, 6 for one player and 2 more for each other player near, at most 3
// about at once. When the last of the wave is beaten it throws out one reward roll per player (Proving
// Keys, arrows, food, beryl) and rests for 30 minutes. Its sides show whether it waits, fights or rests
// (meta bits 4-5, so guests see it through the ordinary block edits).
//
// An ominous Proving Spawner (some of the hall's spawners are, and an ordinary one woken by a player with
// Dark Omen turns into one, using the omen up) calls a bigger, faster wave of mobs that come armed and
// enchanted, and throws out two reward rolls per player (rules: provingVaults.js WAVE_RULES).
//
// Vaults: right-click one holding a Proving Key and it takes the key and throws out one roll of
// treasure; it remembers every player it rewarded (by name) and opens for each of them only once.
//
// Simulated on the host (or in single player); spawner rests and the Vault ledger are saved with the
// world, and the ledger is shared with guests (net/session.js: welcome 'vaults', 'vault' requests,
// 'vaultset' updates, 'vaultno' refusals).
import { B, SOLID } from './blocks.js';
import { I } from './items.js';
import {
  PROVING_RANGE, SPAWNER_STATE, isProver, VaultLedger, newSpawnerState, spawnerStep, spawnerSpawned, spawnerKind, spawnerShown, spawnerMeta,
  saveSpawnerStates, loadSpawnerStates,
} from './provingVaults.js';
import { spawnerRewards, vaultRoll } from './provingLoot.js';
import { SIDE_DIRS } from './shapes.js';
import { spawnGear } from '../mobs/equipment.js';

/** A wave's mob that strays this far from its spawner no longer counts. */
export const STRAY_RANGE = 48;
/** Chance that an ominous spawner's armed mob (Shamblers, Rattlers...) wears armour. */
export const OMINOUS_ARMOR_CHANCE = 0.65;
const key = (x, y, z) => `${x},${y},${z}`;

export class ProvingSystem {
  constructor(game) {
    this.game = game;
    this.spawners = new Map(); // "x,y,z" -> spawner state (provingVaults.js newSpawnerState)
    this.waves = new Map();    // "x,y,z" -> the mobs of a running wave
    this.vaults = new VaultLedger();
  }

  get authority() { const n = this.game.net; return !n || !!n.isHost; }

  /** Everyone who can wake a spawner: [{ name, obj }] (the host's guests too). */
  players() {
    const g = this.game;
    if (g.net && g.net.isHost) return g.net.players().map((p) => ({ name: p.name, obj: p.obj }));
    return [{ name: g.player.netName || 'player', obj: g.player }];
  }

  /** Once a tick on the host / in single player. */
  tick() {
    const g = this.game, w = g.world;
    if (!this.authority || w.dimension !== 'overworld') return;
    const fighters = this.players().map((p) => p.obj).filter((o) => o && !o.dead && !o.creative && !o.spectator && o.gamemode !== 'spectator');
    const hostile = !(g.settings && g.settings.hostileMobs === false) && g.difficulty !== 'peaceful';
    // the spawners near someone
    const near = new Set();
    for (const p of this.players()) {
      const o = p.obj;
      if (!o) continue;
      const pcx = Math.floor(o.x / 16), pcz = Math.floor(o.z / 16);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const c = w.getChunk(pcx + dx, pcz + dz);
        if (c && c.provers) for (const k of c.provers) near.add(k);
      }
    }
    // the others only rest
    for (const [k, s] of this.spawners) {
      if (near.has(k)) continue;
      if (s.state === SPAWNER_STATE.COOLDOWN) spawnerStep(s, 0, 0);
      else if (s.state === SPAWNER_STATE.ACTIVE) spawnerStep(s, 0, this.alive(k, null));
      if (s.state === SPAWNER_STATE.IDLE) { this.spawners.delete(k); this.waves.delete(k); }
    }
    for (const k of near) {
      const [x, y, z] = k.split(',').map(Number);
      let id = w.getBlock(x, y, z);
      if (!isProver(id)) continue;
      let s = this.spawners.get(k);
      if (!s) { s = newSpawnerState(); this.spawners.set(k, s); }
      const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
      const inRange = fighters.filter((o) => Math.hypot(o.x - cx, o.y + 0.9 - cy, o.z - cz) <= PROVING_RANGE);
      const players = hostile ? inRange.length : 0;
      // a waiting spawner woken by someone carrying Dark Omen turns ominous; the omen is used up
      if (id === B.PROVING_SPAWNER && players > 0 && s.state === SPAWNER_STATE.IDLE && this.consumeOmen(inRange)) {
        w.setBlock(x, y, z, B.OMINOUS_SPAWNER, w.getMeta(x, y, z));
        id = B.OMINOUS_SPAWNER;
        if (g.particles) for (let n = 0; n < 20; n++) g.particles.emit(cx, cy + 0.3, cz, (Math.random() - 0.5) * 0.15, 0.05 + Math.random() * 0.08, (Math.random() - 0.5) * 0.15, 0.6, 0.25, 0.9, 30, 0);
        if (g.audio) g.audio.play('scream', [cx, cy, cz], 0.5);
      }
      const ominous = id === B.OMINOUS_SPAWNER;
      const r = spawnerStep(s, players, this.alive(k, [cx, cy, cz]), ominous);
      const m = w.getMeta(x, y, z);
      if (r.spawn && this.spawnOne(x, y, z, spawnerKind(m), k, ominous)) spawnerSpawned(s);
      if (r.eject) this.eject(x, y, z, r.eject, ominous);
      if (s.state === SPAWNER_STATE.ACTIVE && g.particles && Math.random() < 0.3) g.particles.flame(x + Math.random(), y + Math.random(), z + Math.random());
      if (spawnerShown(m) !== s.state) w.setBlock(x, y, z, id, spawnerMeta(m & 15, s.state));
      if (s.state === SPAWNER_STATE.IDLE && !r.changed) { this.spawners.delete(k); this.waves.delete(k); }
    }
  }

  /** Use up the Dark Omen of the local player if they are among `near` (guests' omens are not tracked). Returns true if one was used. */
  consumeOmen(near) {
    const p = this.game.player;
    if (!p || !near.includes(p) || !p.effects || !p.effects.dark_omen) return false;
    delete p.effects.dark_omen;
    for (const f of (p.listeners && p.listeners.effect) || []) f(null);
    return true;
  }

  /** How many of a spawner's wave are still about (dropping the dead and those that strayed off). */
  alive(k, at) {
    const list = this.waves.get(k);
    if (!list) return 0;
    const live = list.filter((e) => !e.dead && !e.removed && e.deathTime === 0 && (!at || Math.hypot(e.x - at[0], e.y - at[1], e.z - at[2]) <= STRAY_RANGE));
    this.waves.set(k, live);
    return live.length;
  }

  /** Call one mob of the wave within 4 blocks of the spawner, on solid ground with room to stand. */
  spawnOne(x, y, z, kind, k, ominous = false) {
    const g = this.game, w = g.world;
    if (!g.spawner) return null;
    for (let t = 0; t < 12; t++) {
      const sx = x + Math.floor(Math.random() * 9) - 4, sz = z + Math.floor(Math.random() * 9) - 4, sy = y + Math.floor(Math.random() * 3) - 1;
      if (sx === x && sz === z) continue;
      if (!SOLID[w.getBlock(sx, sy - 1, sz)] || !g.spawner.canFit(kind, sx, sy, sz)) continue;
      const m = g.spawner.spawnMob(kind, sx + 0.5, sy, sz + 0.5);
      if (!m) return null;
      if (kind === 'wobbler' && m.setSize) m.setSize(2);
      if (ominous) { m.equip = spawnGear(kind, 1, g.difficulty, Math.random, { armorChance: OMINOUS_ARMOR_CHANCE }); m.canPickUp = false; }
      m.provingSpawner = k;
      const list = this.waves.get(k) || [];
      list.push(m);
      this.waves.set(k, list);
      if (g.particles) g.particles.smoke(sx + 0.5, sy + 0.5, sz + 0.5, 12, 1);
      if (g.audio) g.audio.play('fizz', [sx + 0.5, sy + 0.5, sz + 0.5], 0.6);
      return m;
    }
    return null;
  }

  /** A beaten wave: the spawner throws out its rewards. */
  eject(x, y, z, players, ominous = false) {
    const g = this.game;
    for (const st of spawnerRewards(players, Math.random, ominous)) {
      g.entities.spawnItem(x + 0.5, y + 1.1, z + 0.5, st, [(Math.random() - 0.5) * 0.16, 0.32, (Math.random() - 0.5) * 0.16]);
    }
    if (g.particles) for (let k = 0; k < 16; k++) g.particles.emit(x + 0.5, y + 1, z + 0.5, (Math.random() - 0.5) * 0.12, 0.08 + Math.random() * 0.08, (Math.random() - 0.5) * 0.12, 1, 0.75, 0.35, 24, 0.004);
    if (g.audio) g.audio.play('levelup', [x + 0.5, y + 0.5, z + 0.5], 0.7);
  }

  /**
   * `name` used the Vault at (x, y, z) holding `held`. On the host / in single player: checks the key
   * and the ledger, records the opening and throws the treasure out of the keyhole. Returns { ok, msg }.
   */
  openVault(x, y, z, name, held) {
    const g = this.game, k = key(x, y, z);
    if (!held || held.id !== I.PROVING_KEY) return { ok: false, msg: 'The Vault needs a Proving Key' };
    if (this.vaults.has(k, name)) return { ok: false, msg: 'This Vault has already rewarded you' };
    if (!this.vaults.unlock(k, name)) return { ok: false, msg: 'The Vault stays shut' };
    const [fx, , fz] = SIDE_DIRS[g.world.getMeta(x, y, z) & 3];
    let i = 0;
    for (const st of vaultRoll()) {
      g.entities.spawnItem(x + 0.5 + fx * 0.7, y + 0.5, z + 0.5 + fz * 0.7, st, [fx * 0.12 + (Math.random() - 0.5) * 0.04, 0.2 + i++ * 0.05, fz * 0.12 + (Math.random() - 0.5) * 0.04]);
    }
    if (g.particles) for (let n = 0; n < 12; n++) g.particles.emit(x + 0.5 + fx * 0.55, y + 0.5, z + 0.5 + fz * 0.55, fx * 0.05 + (Math.random() - 0.5) * 0.05, 0.05 + Math.random() * 0.05, fz * 0.05 + (Math.random() - 0.5) * 0.05, 1, 0.85, 0.45, 20, 0);
    if (g.audio) g.audio.play('click', [x + 0.5, y + 0.5, z + 0.5]);
    if (g.net && g.net.isHost) g.net.broadcast({ t: 'vaultset', k, n: this.vaults.names(k) });
    return { ok: true };
  }

  /** Our own right-click on a Vault (interaction.js). Always handled. */
  useVault(x, y, z) {
    const g = this.game, p = g.player, st = p.inventory.selectedStack, name = p.netName || 'player';
    const toast = (m) => { if (g.hud) g.hud.toast(m); };
    if (g.net && g.net.isClient) {
      // a guest asks the host, which keeps the ledger (and answers with 'used' or 'vaultno')
      if (!st || st.id !== I.PROVING_KEY) toast('The Vault needs a Proving Key');
      else if (this.vaults.has(key(x, y, z), name)) toast('This Vault has already rewarded you');
      else g.net.useVault(x, y, z, st);
      return true;
    }
    const r = this.openVault(x, y, z, name, st);
    if (!r.ok) toast(r.msg);
    else if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
    return true;
  }

  /** A spawner or Vault was broken (or replaced): forget it. */
  blockChanged(x, y, z, old, id) {
    if (old === id) return;
    const k = key(x, y, z);
    if (isProver(old) && isProver(id)) return; // an ordinary spawner turned ominous keeps its wave
    if (isProver(old)) { this.spawners.delete(k); this.waves.delete(k); }
    if (old === B.VAULT && this.authority) this.vaults.remove(k);
  }

  save() { return { spawners: saveSpawnerStates(this.spawners), vaults: this.vaults.save() }; }
  load(d) {
    this.spawners = loadSpawnerStates(d && d.spawners);
    this.waves.clear();
    this.vaults.load(d && d.vaults);
  }
}

// Field Guide tracking: notices what the player sees, visits and picks up, on a few cheap timers
// (nothing runs every tick; the busiest check is a look at the nearby mobs twice a second).
//  * creatures:  a mob of a type not yet in the guide, within sight range, in front of the player and
//                not behind a wall, is "seen" (killing one is recorded by stats.js recordKill)
//  * biomes:     the biome under the player (overworld), every second
//  * structures: landmarks within SIGHT blocks (world/landmarks.js), every two seconds; an Explorer Chart
//                marks its destination as "located"
//  * items:      checked when the inventory changes
// A guest keeps its guide on its own machine (fieldGuide.js saveGuestGuide). New entries raise one
// coalesced toast. The rules that need no game are exported for the tests.
import { OPAQUE } from '../world/blocks.js';
import { BIOMES } from '../world/biomes.js';
import { landmarksInBox, SIGHT } from '../world/landmarks.js';
import { discover, guideOf, onDiscover, recordOf, saveGuestGuide, LEVEL } from './fieldGuide.js';
import { entriesOf, entryName } from './fieldGuideEntries.js';

export const SEE_RANGE = 32;       // blocks a creature can be seen from
export const SEE_HEIGHT = 24;      // ... and the most it may be above or below
export const SEE_CONE = 0.35;      // cosine of the view cone's half angle (about 70 degrees); closer than NEAR counts all round
export const NEAR = 4;

/** Is the straight line between two points free of opaque blocks? (samples every half block) */
export function lineClear(world, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
  const n = Math.floor(len / 0.5);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (OPAQUE[world.getBlock(Math.floor(a[0] + dx * t), Math.floor(a[1] + dy * t), Math.floor(a[2] + dz * t))]) return false;
  }
  return true;
}

/** Can the player (eye, look direction) see this mob? */
export function canSee(world, eye, look, mob) {
  const h = (mob.def && mob.def.height) || 1;
  const to = [mob.x, mob.y + h * 0.6, mob.z];
  const dx = to[0] - eye[0], dy = to[1] - eye[1], dz = to[2] - eye[2], d = Math.hypot(dx, dy, dz);
  if (d > SEE_RANGE || Math.abs(mob.y - eye[1]) > SEE_HEIGHT) return false;
  if (d > NEAR && (dx * look[0] + dy * look[1] + dz * look[2]) / d < SEE_CONE) return false;
  return lineClear(world, eye, to);
}

export class GuideTracker {
  constructor(game) {
    this.game = game;
    this.queue = [];
    this.dirty = false;
    this.itemIds = null;
    onDiscover((guide, tab, key, level) => {
      if (guide !== this.guide()) return;
      this.queue.push([tab, key, level]);
      this.dirty = true;
    });
  }

  guide() { return guideOf(this.game.player.stats); }
  now() { return this.game.player.stats.ticks | 0; }
  overworld() { const w = this.game.world; return w.dimension === 'overworld' && !!w.gen; }

  /** Called once per game tick. */
  tick() {
    const g = this.game, n = g.ticks, p = g.player;
    if (p.dead) return;
    if (n % 10 === 0) this.seeCreatures();
    if (n % 20 === 3) this.visitBiome();
    if (n % 40 === 11) this.findStructures();
    if (n % 40 === 0) this.toast();
    if (n % 100 === 50 && this.dirty && g.net && g.net.isClient) { saveGuestGuide(this.guide()); this.dirty = false; }
  }

  seeCreatures() {
    const g = this.game, p = g.player, guide = this.guide();
    let eye = null, look = null;
    for (const e of g.entities.list) {
      if (e.kind !== 'mob' || e.dead || e.removed || !e.type || recordOf(guide, 'creatures', e.type)) continue;
      if (Math.abs(e.x - p.x) > SEE_RANGE || Math.abs(e.z - p.z) > SEE_RANGE) continue;
      if (!eye) { eye = p.eyePos(); look = p.lookDir(); }
      if (canSee(g.world, eye, look, e)) discover(guide, 'creatures', e.type, LEVEL.SEEN, this.now());
    }
  }

  visitBiome() {
    if (!this.overworld()) return;
    const p = this.game.player, b = BIOMES[this.game.world.biomeAt(Math.floor(p.x), Math.floor(p.z))];
    if (b) discover(this.guide(), 'biomes', b.key, LEVEL.VISITED, this.now());
  }

  findStructures() {
    // the overworld's structures, or the Cinderforges and Wyrm Ribs of the dimension the player is in
    const w = this.game.world, gen = this.overworld() ? w.gen : w.dimension === 'cinderdeep' || w.dimension === 'hollow' ? w.dimGenerator : null;
    if (!gen) return;
    const p = this.game.player, guide = this.guide();
    for (const s of landmarksInBox(gen, p.x - SIGHT, p.z - SIGHT, p.x + SIGHT, p.z + SIGHT)) {
      discover(guide, 'structures', s.kind, LEVEL.FOUND, this.now(), { x: s.x, z: s.z });
    }
  }

  /** An Explorer Chart marked a structure of this kind at `site` ({ x, z }). */
  located(kind, site) { discover(this.guide(), 'structures', kind, LEVEL.LOCATED, this.now(), site); }

  /** The inventory changed (or on load): note the items of note in it. */
  checkInventory() {
    const inv = this.game.player.inventory, guide = this.guide();
    if (!this.itemIds) this.itemIds = new Set(entriesOf('items').map((e) => e.id));
    for (const list of [inv.slots, inv.armor]) {
      for (const st of list || []) if (st && this.itemIds.has(st.id)) discover(guide, 'items', String(st.id), LEVEL.OBTAINED, this.now());
    }
  }

  /** One toast for what is new since the last one. */
  toast() {
    if (!this.queue.length) return;
    const q = this.queue; this.queue = [];
    const hud = this.game.hud;
    if (!hud || !hud.toast) return;
    if (q.length === 1) {
      const [tab, key, level] = q[0];
      const name = entryName(tab, key);
      if (name) hud.toast(`Field Guide: ${name}${tab === 'creatures' && level === LEVEL.KILLED ? ' (defeated)' : ''}`);
    } else hud.toast(`Field Guide: ${q.length} new entries`);
  }
}

// Glue between the world and the audio engine: once a second it gathers the
// cheap facts about the player's surroundings, picks the soundscape (ambience.js),
// feeds the ambient bed and one-shot events, measures the room for reverb and
// finds the roof over the player's head so rain drums on the right material
// (acoustics.js). Everything is sampled at 1 Hz (about 400 block reads), so the
// cost per frame is nil.
import { BLOCKS, B } from '../world/blocks.js';
import { BIOMES } from '../world/biomes.js';
import { pickSoundscape, emptyFacts, bedFor, AmbientDirector, musicProfileFor } from './ambience.js';
import { measureRoom, reverbFor, roofMaterial } from './acoustics.js';

/** Sound material of a solid block, or null for anything sound passes through (air, plants, liquids). */
export function soundMaterial(id) {
  const b = id ? BLOCKS[id] : null;
  return b && b.solid ? b.sound || 'stone' : null;
}

const LAVA_SPAN = 6; // lava is counted in a box of 2 * LAVA_SPAN + 1 columns around the player, every other block

export class AmbientSystem {
  constructor(game, rng = Math.random) {
    this.game = game;
    this.director = new AmbientDirector(rng);
    this.scape = 'plains';
    this.roof = null;     // { mat, depth } over the player's head, or null in the open (read by Audio.setRain)
    this.facts = emptyFacts();
  }

  /** Lava blocks within reach (a cavern floored by a Magma Lake has hundreds). */
  countLava(world, px, py, pz) {
    let n = 0;
    for (let dy = -6; dy <= 2; dy += 2) for (let dz = -LAVA_SPAN; dz <= LAVA_SPAN; dz += 2) for (let dx = -LAVA_SPAN; dx <= LAVA_SPAN; dx += 2) {
      if (world.getBlock(px + dx, py + dy, pz + dz) === B.LAVA) n++;
    }
    return n;
  }

  gather() {
    const g = this.game, w = g.world, p = g.player;
    const px = Math.floor(p.x), py = Math.floor(p.y + 1), pz = Math.floor(p.z);
    const f = this.facts;
    f.dimension = w.dimension;
    f.y = py;
    if (w.dimension === 'overworld') {
      const surf = w.heightAt(px, pz), sky = w.skyLight(px, py, pz);
      f.skyLight = sky;
      f.depthBelowSurface = Math.max(0, surf - py);
      f.under = sky === 0 && py < surf - 4;
      f.biome = (BIOMES[w.biomeAt(px, pz)] || BIOMES[3]).key;
      f.lavaNear = py < 0 ? this.countLava(w, px, py, pz) : 0;
      f.night = g.sky.state.aboveCount === 0;
      f.raining = g.weather.level > 0.2;
    } else { f.under = false; f.depthBelowSurface = 0; f.lavaNear = 0; f.night = false; f.raining = false; }
    return f;
  }

  /** Called once a second (game tick loop). Returns the soundscape key. */
  tick(dt = 1) {
    const g = this.game, a = g.audio, w = g.world, p = g.player;
    const f = this.gather();
    this.scape = pickSoundscape(f);
    this.musicProfile = musicProfileFor(this.scape);
    // looping bed (the rain has its own layer in Audio.setRain)
    a.setBed(bedFor(this.scape, f.night));
    for (const e of this.director.tick(dt, this.scape, f.night)) {
      a.play(e.sound, [p.x + e.dx, p.y + 1.6 + e.dy, p.z + e.dz], e.vol);
    }
    // room acoustics and the roof, measured from the head
    const matAt = (x, y, z) => soundMaterial(w.getBlock(x, y, z));
    const hx = p.x, hy = p.y + 1.6, hz = p.z;
    a.setRoom(reverbFor(measureRoom(matAt, hx, hy, hz)));
    this.roof = roofMaterial(matAt, Math.floor(hx), Math.floor(hy), Math.floor(hz));
    return this.scape;
  }
}

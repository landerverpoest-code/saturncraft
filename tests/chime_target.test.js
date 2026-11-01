import { describe, it, expect } from 'vitest';
import { World } from '../src/world/world.js';
import { B, BLOCKS } from '../src/world/blocks.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { ON, CHIME_POWERED } from '../src/world/circuitShapes.js';
import { useMeta, changeSound } from '../src/world/circuits.js';
import {
  PITCHES, INSTRUMENTS, instrumentFor, pitchOf, chimeSoundName, parseChimeSound, pitchFreq, chimeSoundAt, noteName, noteColor,
  chimeCaption, chimeVoices,
} from '../src/world/chimes.js';
import { captionText } from '../src/ui/accessibility.js';
import { entryHit, rocketStrike, projectileHit, targetPower, targetTicks, TARGET_TICKS_THROWN } from '../src/world/signalBlocks.js';
import { packChunk, unpackChunk } from '../src/world/save.js';
import { SkyRocket } from '../src/entities/skyRocket.js';
import { Game } from '../src/game.js';
import { Interaction } from '../src/player/interaction.js';
import { rng } from './helpers.js';

function flatChunk() {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}
function flatWorld() {
  const w = new World(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.addChunk(cx, cz, flatChunk());
  w.tick();
  return w;
}
const run = (w, n = 1) => { for (let i = 0; i < n; i++) w.tick(); };
const Y = 64;

describe('Chime Block instruments', () => {
  it('are chosen by the material of the block below', () => {
    expect(instrumentFor(B.STONE)).toBe('bell');
    expect(instrumentFor(B.OAK_PLANKS)).toBe('bass');
    expect(instrumentFor(B.GLASS)).toBe('click');
    expect(instrumentFor(B.SAND)).toBe('snare');
    expect(instrumentFor(B.WOOL)).toBe('pad');
    expect(instrumentFor(B.IRON_BLOCK)).toBe('chime');
    expect(instrumentFor(B.GRAVEL)).toBe('drum');
    expect(instrumentFor(B.HAY_BALE)).toBe('flute');
    expect(instrumentFor(B.GRASS)).toBe('harp');
    expect(instrumentFor(B.AIR)).toBe('harp');
    expect(instrumentFor(B.TORCH)).toBe('harp'); // a non-solid block under it is no sounding board
    for (let id = 0; id < BLOCKS.length; id++) expect(INSTRUMENTS).toContain(instrumentFor(id));
  });

  it('keep 25 pitches over two octaves from F#3 in the block meta', () => {
    expect(PITCHES).toBe(25);
    expect(pitchFreq(0)).toBeCloseTo(185, 5);
    expect(pitchFreq(24)).toBeCloseTo(740, 5);
    expect(noteName(0)).toBe('F#3');
    expect(noteName(6)).toBe('C4');
    expect(noteName(24)).toBe('F#5');
    // right-click walks through all 25 and wraps, keeping the powered bit
    let m = 0;
    const seen = new Set();
    for (let i = 0; i < PITCHES; i++) { seen.add(pitchOf(m)); m = useMeta(B.CHIME_BLOCK, m | CHIME_POWERED); expect(m & CHIME_POWERED).toBe(CHIME_POWERED); }
    expect(seen.size).toBe(25);
    expect(pitchOf(m)).toBe(0);
    expect(pitchOf(31)).toBeLessThan(PITCHES); // a stray value wraps into range
  });

  it('name their sounds chime_<instrument>_<pitch> (the old chime_<pitch> is a bell)', () => {
    expect(chimeSoundName('bass', 12)).toBe('chime_bass_12');
    expect(chimeSoundName('nonsense', 3)).toBe('chime_harp_3');
    expect(parseChimeSound('chime_snare_24')).toEqual({ instrument: 'snare', pitch: 24 });
    expect(parseChimeSound('chime_7')).toEqual({ instrument: 'bell', pitch: 7 });
    expect(parseChimeSound('chime_wat_5')).toEqual({ instrument: 'harp', pitch: 5 });
    expect(parseChimeSound('step_stone')).toBe(null);
    expect(captionText('chime_bass_12')).toBe('Chime plays (bass)');
    expect(captionText('chime_7')).toBe('Chime plays');
    expect(chimeCaption('chime_pad_0')).toBe('Chime plays (pad)');
  });

  it('are synthesised differently, and pitched notes follow the pitch', () => {
    const sig = (inst, p) => JSON.stringify(chimeVoices(inst, p));
    const sigs = new Set(INSTRUMENTS.map((i) => sig(i, 5)));
    expect(sigs.size).toBe(INSTRUMENTS.length);
    for (const i of INSTRUMENTS) for (const p of [0, 12, 24]) {
      const v = chimeVoices(i, p);
      expect(v.length).toBeGreaterThan(0);
      for (const s of v) { expect(s.dur).toBeGreaterThan(0); expect(s.gain).toBeGreaterThan(0); expect(s.gain).toBeLessThan(0.5); }
    }
    expect(chimeVoices('harp', 12)[0].f0).toBeCloseTo(2 * chimeVoices('harp', 0)[0].f0, 5);
    expect(chimeVoices('bass', 0)[0].f0).toBeLessThan(chimeVoices('harp', 0)[0].f0);
  });

  it('colour the note particle along the pitch', () => {
    expect(noteColor(0).map(Math.round)).toEqual([1, 0, 0]);
    const all = new Set();
    for (let p = 0; p < PITCHES; p++) { const c = noteColor(p); for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } all.add(c.join()); }
    expect(all.size).toBe(PITCHES);
  });

  it('ring with the instrument of the block below when powered by a signal edge', () => {
    const w = flatWorld();
    w.setBlock(4, Y - 1, 0, B.OAK_PLANKS);
    w.setBlock(4, Y, 0, B.CHIME_BLOCK, useMeta(B.CHIME_BLOCK, 0)); // pitch 1
    w.setBlock(6, Y, 0, B.CHIME_BLOCK, 9); // stone below: pitch 9
    const sounds = [];
    w.on('blockChanged', (x, y, z, o, id) => {
      if (id === B.CHIME_BLOCK && w.getMeta(x, y, z) & CHIME_POWERED && o === id) sounds.push(changeSound(w, x, y, z, o, id));
    });
    w.setBlock(5, Y, 0, B.LEVER, ON); // beside both
    run(w, 3);
    expect(sounds.sort()).toEqual(['chime_bass_1', 'chime_bell_9']);
    expect(chimeSoundAt(w, 4, Y, 0)).toBe('chime_bass_1');
    w.setBlock(4, Y - 1, 0, B.GLASS);
    expect(chimeSoundAt(w, 4, Y, 0)).toBe('chime_click_1');
  });

  it('keep their pitch per position in the save', () => {
    const c = flatChunk();
    c.blocks[cidx(3, Y, 4)] = B.CHIME_BLOCK; c.meta[cidx(3, Y, 4)] = 17;
    c.blocks[cidx(9, Y, 2)] = B.CHIME_BLOCK; c.meta[cidx(9, Y, 2)] = 4 | CHIME_POWERED;
    const back = unpackChunk(packChunk(c));
    expect(back.blocks[cidx(3, Y, 4)]).toBe(B.CHIME_BLOCK);
    expect(pitchOf(back.meta[cidx(3, Y, 4)])).toBe(17);
    expect(pitchOf(back.meta[cidx(9, Y, 2)])).toBe(4);
  });

  it('play (note, particle, caption, network) when punched or retuned', () => {
    const w = flatWorld();
    w.setBlock(2, Y - 1, 2, B.WOOL);
    w.setBlock(2, Y, 2, B.CHIME_BLOCK, 7);
    const played = [], specks = [], sent = [], toasts = [];
    const game = {
      world: w, ticks: 5, entities: { list: [{ type: 'hoverling', x: 2.5, y: Y + 1, z: 2.5 }] },
      audio: { play: (n, pos) => played.push([n, pos]) },
      particles: { emit: (...a) => specks.push(a) },
      hud: { toast: (m) => toasts.push(m) },
      net: { isHost: true, sendNote: (x, y, z) => sent.push([x, y, z]) },
      chimeNote: Game.prototype.chimeNote,
    };
    expect(Game.prototype.playChime.call(game, 2, Y, 2, { toast: true })).toBe(true);
    expect(played).toEqual([['chime_pad_7', [2.5, Y + 0.5, 2.5]]]);
    expect(specks.length).toBeGreaterThan(0);
    expect(specks[0][1]).toBeGreaterThan(Y + 1); // rises above the block
    expect(toasts).toEqual(['Note ' + noteName(7)]);
    expect(sent).toEqual([[2, Y, 2]]);
    expect(game.entities.list[0].chime).toMatchObject({ x: 2, y: Y, z: 2, t: 5 }); // a Hoverling nearby remembers where it rang
    // a note heard from another player is not sent back out
    sent.length = 0;
    Game.prototype.playChime.call(game, 2, Y, 2, { fromNet: true });
    expect(sent).toEqual([]);
    expect(played.length).toBe(2);
    // not a chime block: nothing happens
    expect(Game.prototype.playChime.call(game, 3, Y, 3)).toBe(false);
    expect(played.length).toBe(2);
  });

  it('are punched by a player who starts to break one (and not by a creative swing)', () => {
    const w = flatWorld();
    w.setBlock(1, Y, 1, B.CHIME_BLOCK, 3);
    const rang = [];
    const it2 = Object.create(Interaction.prototype);
    it2.game = {
      world: w, ticks: 0, audio: { play() {} }, particles: null, hush: null,
      player: { creative: false, gamemode: 'survival', inventory: { selectedStack: null }, body: { onGround: true, inWater: false, eyeInWater: false }, effectLevel: () => 0 },
      playChime: (x, y, z) => rang.push([x, y, z]),
    };
    it2.breaking = null; it2.swing = 0; it2.breakDelay = 0;
    const t = { x: 1, y: Y, z: 1, id: B.CHIME_BLOCK, face: [0, 1, 0] };
    it2.target = t;
    it2.mine();
    it2.mine(); // still holding the button: no second note
    expect(rang).toEqual([[1, Y, 1]]);
  });
});

describe('Target block', () => {
  const setup = () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.TARGET);
    w.setBlock(1, Y, 0, B.CINNABAR_WIRE);
    return w;
  };

  it('finds the face and point where a straight flight enters it', () => {
    const e = entryHit([-1.5, Y + 0.5, 0.5], [0.5, Y + 0.5, 0.5], 0, Y, 0);
    expect(e.hit.face).toEqual([-1, 0, 0]);
    expect(e.x).toBeCloseTo(0, 6); expect(e.y).toBeCloseTo(Y + 0.5, 6); expect(e.z).toBeCloseTo(0.5, 6);
    const down = entryHit([0.5, Y + 2, 0.5], [0.5, Y + 0.5, 0.5], 0, Y, 0);
    expect(down.hit.face).toEqual([0, 1, 0]);
    expect(down.y).toBeCloseTo(Y + 1, 6);
    expect(entryHit([-3, Y + 0.5, 0.5], [-2, Y + 0.5, 0.5], 0, Y, 0)).toBe(null); // stops short
    expect(entryHit([-1.5, Y + 3.5, 0.5], [0.5, Y + 3.5, 0.5], 0, Y, 0)).toBe(null); // passes above
  });

  it('answer a Star Rocket by how close to the middle it strikes, holding the signal a few ticks', () => {
    for (const [off, want] of [[0.5, 15], [0.95, 2]]) {
      const w = setup();
      const calls = [];
      const game = { world: w, onProjectileHit: (hit, x, y, z, kind) => { calls.push(kind); projectileHit(w, hit, x, y, z, kind); } };
      expect(rocketStrike(game, [-0.6, Y + off, 0.5], [0.4, Y + off, 0.5])).toBe(true);
      expect(calls).toEqual(['rocket']);
      run(w, 1);
      expect(w.getMeta(0, Y, 0) & 15).toBe(want);
      expect(w.getMeta(1, Y, 0) & 15).toBe(want); // wire beside it follows
      expect(targetPower(0, Y + off, 0.5, [-1, 0, 0])).toBe(want);
      run(w, TARGET_TICKS_THROWN + 1);
      expect(w.getMeta(0, Y, 0) & 15).toBe(0);
    }
    expect(targetTicks('rocket')).toBe(TARGET_TICKS_THROWN);
  });

  it('are struck by a Star Rocket flying into them and by none that miss', () => {
    const w = setup();
    const game = {
      world: w, particles: { emit() {} }, audio: { play() {} }, entities: { list: [] },
      onProjectileHit: (hit, x, y, z, kind) => projectileHit(w, hit, x, y, z, kind),
    };
    const r = new SkyRocket(-3, Y + 0.5, 0.5, null, rng(3), null, null);
    r.dir = [1, 0, 0]; r.vx = 0.8; r.vy = 0; r.vz = 0; r.speed = 0.8; r.life = 40;
    for (let k = 0; k < 8 && !r.exploded; k++) r.tick(game);
    expect(r.exploded).toBe(true);
    run(w, 1);
    expect(w.getMeta(0, Y, 0) & 15).toBe(15);
    run(w, TARGET_TICKS_THROWN + 1);
    expect(w.getMeta(0, Y, 0) & 15).toBe(0);
    // a rocket into plain stone changes nothing
    w.setBlock(0, Y + 2, 0, B.STONE);
    const r2 = new SkyRocket(-3, Y + 2.5, 0.5, null, rng(3), null, null);
    r2.dir = [1, 0, 0]; r2.vx = 0.8; r2.vy = 0; r2.vz = 0; r2.speed = 0.8; r2.life = 40;
    for (let k = 0; k < 8 && !r2.exploded; k++) r2.tick(game);
    expect(r2.exploded).toBe(true);
    run(w, 2);
    expect(w.getMeta(0, Y, 0) & 15).toBe(0);
  });
});

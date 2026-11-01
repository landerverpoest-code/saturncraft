// Chime Block instruments (pure helpers; the block itself lives in world/circuits.js, the synthesis in audio/audio.js).
//
// A Chime Block holds one of 25 pitches (meta bits 0-4, so it is saved with the chunk and travels with block edits)
// spanning two octaves from F#3. Its timbre comes from the block UNDER it, by that block's material:
// stone = bell, wood = bass, glass = click, sand = snare, wool = soft pad, metal = chime, gravel / mud = drum,
// snow = flute, anything else (grass, dirt, air...) = harp. Sound names are `chime_<instrument>_<pitch>`; the older
// `chime_<pitch>` form is a bell.
import { B, BLOCKS } from './blocks.js';

export const PITCHES = 25;
export const PITCH_MASK = 31;
export const BASE_FREQ = 185; // F#3 in Hz

export const INSTRUMENTS = ['harp', 'bell', 'bass', 'click', 'snare', 'pad', 'chime', 'drum', 'flute'];
const BY_SOUND = { stone: 'bell', wood: 'bass', glass: 'click', sand: 'snare', wool: 'pad', metal: 'chime', gravel: 'drum', mud: 'drum', snow: 'flute' };
/** Blocks whose material says something else than their footstep sound. */
const OVERRIDE = { [B.HAY_BALE]: 'flute' };

/** The instrument a Chime Block plays when `belowId` is the block under it. */
export function instrumentFor(belowId) {
  if (OVERRIDE[belowId]) return OVERRIDE[belowId];
  const d = BLOCKS[belowId];
  if (!d || !d.solid) return 'harp';
  return BY_SOUND[d.sound] || 'harp';
}

/** The pitch stored in a Chime Block's meta, 0-24 (a stray value wraps into range). */
export const pitchOf = (meta) => (meta & PITCH_MASK) % PITCHES;

const wrapPitch = (p) => (((p | 0) % PITCHES) + PITCHES) % PITCHES;

/** Sound name of a note: `chime_bass_12`. */
export const chimeSoundName = (instrument, pitch) => `chime_${INSTRUMENTS.includes(instrument) ? instrument : 'harp'}_${wrapPitch(pitch)}`;

/** Parse `chime_<instrument>_<pitch>` or the plain `chime_<pitch>` (a bell): { instrument, pitch } or null. */
export function parseChimeSound(name) {
  const m = /^chime_(?:([a-z]+)_)?(\d+)$/.exec(name || '');
  if (!m) return null;
  const instrument = m[1] ? (INSTRUMENTS.includes(m[1]) ? m[1] : 'harp') : 'bell';
  return { instrument, pitch: Math.min(PITCHES - 1, +m[2]) };
}

/** Frequency of a pitch (0-24 semitones above F#3), in Hz. */
export const pitchFreq = (pitch) => BASE_FREQ * Math.pow(2, pitch / 12);

/** The sound a Chime Block at x,y,z makes now (instrument from the block below, pitch from its meta). */
export function chimeSoundAt(w, x, y, z) {
  return chimeSoundName(instrumentFor(w.getBlock(x, y - 1, z)), pitchOf(w.getMeta(x, y, z)));
}

const NOTE_NAMES = ['F#', 'G', 'G#', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F'];
/** "F#3" ... "F#5" for a pitch. */
export function noteName(pitch) {
  const p = wrapPitch(pitch);
  // the octave number rises at each C (pitch 6 and 18)
  return NOTE_NAMES[p % 12] + (3 + Math.floor((p + 6) / 12));
}

/** Colour of the note particle: the hue travels from red to blue over the two octaves (r, g, b 0-1). */
export function noteColor(pitch) {
  const h = (wrapPitch(pitch) / 24) * 4; // 0 .. 4
  const f = (n) => Math.max(0, Math.min(1, Math.abs(((h + n) % 6) - 3) - 1));
  return [f(0), f(4), f(2)];
}

/**
 * How to synthesise a note, as a list of voices for audio.js: `{ k: 'tone', dt, dur, f0, f1, gain, type }` (an oscillator
 * gliding f0 -> f1) and `{ k: 'noise', dt, dur, freq, q, gain, filter }` (filtered noise); gains are before the master volume.
 */
export function chimeVoices(instrument, pitch) {
  const p = wrapPitch(pitch), f = pitchFreq(p);
  const tone = (dt, dur, f0, f1, gain, type = 'sine') => ({ k: 'tone', dt, dur, f0, f1, gain, type });
  const noise = (dt, dur, freq, q, gain, filter = 'bandpass') => ({ k: 'noise', dt, dur, freq, q, gain, filter });
  switch (instrument) {
    case 'bass': return [tone(0, 0.55, f / 2, f / 2, 0.3, 'triangle'), tone(0, 0.3, f, f, 0.06, 'sine')];
    case 'click': return [noise(0, 0.03, 3800 + p * 90, 5, 0.3, 'highpass'), tone(0, 0.04, f * 4, f * 3, 0.06, 'square')];
    case 'snare': return [noise(0, 0.16, 2200 + p * 60, 1.2, 0.34), tone(0, 0.1, 190, 110, 0.14, 'triangle')];
    case 'pad': return [tone(0, 0.9, f, f * 1.002, 0.1, 'sawtooth'), tone(0, 0.9, f * 1.006, f, 0.1, 'triangle'), tone(0, 0.9, f / 2, f / 2, 0.08, 'sine')];
    case 'chime': return [tone(0, 1.1, f * 2, f * 2, 0.14, 'sine'), tone(0, 0.8, f * 3.02, f * 3, 0.06, 'sine'), tone(0, 0.5, f * 5.4, f * 5.4, 0.03, 'sine')];
    case 'drum': return [tone(0, 0.22, f * 0.8, f * 0.3, 0.34, 'sine'), noise(0, 0.05, 700, 1, 0.12)];
    case 'flute': return [tone(0, 0.6, f * 2, f * 2, 0.17, 'sine'), noise(0, 0.12, f * 4, 4, 0.025)];
    case 'bell': return [tone(0, 0.9, f, f * 0.995, 0.22, 'sine'), tone(0, 0.5, f * 2.01, f * 2, 0.07, 'sine')];
    default: return [tone(0, 0.45, f, f, 0.2, 'triangle'), tone(0, 0.25, f * 2, f * 2, 0.05, 'sine')]; // harp
  }
}

/** Caption for assistive text: "Chime plays (bass)"; the plain old form stays "Chime plays". */
export function chimeCaption(name) {
  if (/^chime_\d+$/.test(name)) return 'Chime plays';
  const p = parseChimeSound(name);
  return p ? `Chime plays (${p.instrument})` : null;
}

// Pulse Gate: the cinnabar pulse limiter and metronome (simulation in world/circuits.js). Meta: bits 0-1 the side it sends
// to (the input is behind it, as with a repeater), bits 2-4 the setting, bit 5 sending, bit 6 the input was seen high,
// bit 7 resting. Right-click steps through the eight settings.
//
// * Limiter (settings 0-3): a rising edge starts one pulse of `ticks` ticks, then it rests for as long again. Edges that
//   arrive while it pulses or rests are ignored, and a held input gives only one pulse, so a limiter squares up a short
//   blip (pulse extender), shortens a long signal, and caps how often a noisy line can drive what it feeds.
// * Metronome (settings 4-7): while the input is on it beats: on for `ticks` ticks, off for `ticks`, and so on, starting
//   on. It stops the moment the input goes off.
export const PULSE_GATE_SETTINGS = [
  { kind: 'limiter', ticks: 2 }, { kind: 'limiter', ticks: 4 }, { kind: 'limiter', ticks: 8 }, { kind: 'limiter', ticks: 20 },
  { kind: 'metronome', ticks: 4 }, { kind: 'metronome', ticks: 10 }, { kind: 'metronome', ticks: 20 }, { kind: 'metronome', ticks: 40 },
];

/** Setting record of a pulse gate meta (bits 2-4). */
export const gateSetting = (meta) => PULSE_GATE_SETTINGS[(meta >> 2) & 7];

/** Short description of a setting, for the toast when it changes. */
export function gateLabel(meta) {
  const s = gateSetting(meta), sec = String(s.ticks / 20);
  return s.kind === 'limiter' ? `Limiter: pulses of ${sec} s` : `Metronome: beats every ${sec} s`;
}

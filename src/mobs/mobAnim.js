// Generic mob animation helpers (breathing, blinking, ear twitch, head look, tail wag, death tip). The maths are pure so they can be tested;
// models.js animateModel applies them each frame as additive deltas that customRender hooks may still override afterwards.
export const ANIM_RANGE = 48; // no flourishes for mobs further than this from the player
export const LOOK_RANGE = 6;  // heads turn toward a player this close
const TAU = Math.PI * 2;
/** A cheap deterministic hash of (id, n) into [0,1). */
export function hash01(id, n) {
  let h = (Math.imul((id | 0) + 1, 374761393) + Math.imul(n | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Breathing: a slow vertical swell of the body, ~1.5%. */
export function breathe(id, sec) { return 1 + Math.sin(sec * 1.9 + (id % 13)) * 0.015; }
/** True while the eyes are shut: a ~0.14 s blink once every 3 to 7 s, phase-shifted per mob. */
export function blinkClosed(id, sec) {
  const period = 3 + hash01(id, 1) * 4, t = sec + hash01(id, 2) * period;
  return (t % period) < 0.14;
}
/** Ear flick angle (radians, 0 most of the time): a brief 0.25 s twitch in some 2 s windows, decided by id and window. */
export function earTwitch(id, sec, side = 1) {
  const x = sec / 2 + hash01(id, 3) * 7, w = Math.floor(x);
  if (hash01(id, 100 + w) > 0.45) return 0;
  const u = (x - w) * 2 / 0.25 - hash01(id, 200 + w) * 6.4; // 0..1 over a 0.25 s flick starting somewhere in the 2 s window
  if (u < 0 || u > 1) return 0;
  return Math.sin(u * Math.PI * 2) * 0.35 * side;
}
/** Wrap an angle into (-PI, PI]. */
export function wrapPi(a) { a %= TAU; if (a > Math.PI) a -= TAU; else if (a <= -Math.PI) a += TAU; return a; }
/** Head yaw/pitch needed to face a point, clamped. relYaw is the target's bearing minus the body yaw. */
export function headTurn(relYaw, dy, dist, maxYaw = 0.9, maxPitch = 0.45) {
  const y = Math.max(-maxYaw, Math.min(maxYaw, wrapPi(relYaw)));
  const p = Math.max(-maxPitch, Math.min(maxPitch, -Math.atan2(dy, Math.max(0.5, dist)) * 0.8));
  return [y, p];
}
/** Idle head yaw when nothing is nearby: a gentle sway plus a slow glance to one side every ~6 s. */
export function idleLook(id, sec) {
  const sway = Math.sin(sec * 0.7 + id) * 0.08;
  const period = 6, w = Math.floor(sec / period + hash01(id, 4) * 5), local = sec / period + hash01(id, 4) * 5 - w;
  const dir = hash01(id, 500 + w) < 0.5 ? -1 : 1, amp = hash01(id, 600 + w) < 0.6 ? 0.55 : 0;
  const glance = local < 0.3 ? Math.sin(local / 0.3 * Math.PI) * amp * dir : 0;
  return sway + glance;
}
/** Tail wag angle: wide and fast when happy, a lazy swish when walking, still otherwise. */
export function tailWag(id, sec, happy, moving) {
  if (happy) return Math.sin(sec * 11 + id) * 0.45;
  if (moving) return Math.sin(sec * 5 + id) * 0.2;
  return 0;
}
/** Death tip over (0..PI/2): eases out with a tiny settle bounce once down. deathTime counts ticks from 1. */
export function deathTipAngle(deathTime, alpha = 0) {
  const t = Math.min(1, Math.max(0, (deathTime + alpha) / 10));
  const e = 1 - (1 - t) * (1 - t);
  const bounce = t >= 1 ? 0 : Math.sin(t * Math.PI) * 0.03;
  return Math.min(Math.PI / 2, e * Math.PI / 2) + bounce;
}
/** How far (blocks) a corpse sinks into the ground as it fades. */
export function deathSink(deathTime, alpha = 0, height = 1) { return Math.min(1, Math.max(0, (deathTime + alpha) / 20)) * Math.min(0.25, height * 0.18); }
/** Backward lean (radians, about the body's x axis) as a hurt flinch decays from hurtTime 10. */
export function hurtLean(hurtTime) { return hurtTime > 0 ? Math.sin(Math.min(1, hurtTime / 10) * Math.PI * 0.5) * -0.2 : 0; }
/** Vertical bob (blocks) synced with limb swing: two bobs per stride. */
export function walkBob(limbSwing, limbAmount) { return Math.abs(Math.cos(limbSwing * 0.6662)) * 0.035 * limbAmount; }

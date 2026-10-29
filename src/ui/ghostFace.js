// The Elder Deepeye's curse apparition (reference: the elder guardian's ghost): when an elder lays
// Mining Fatigue on a player, a pale ghost of its face swells out of the screen for three seconds.
// The picture is drawn from a small procedural pixel map (no assets) and the animation curve is
// pure maths so it can be tested; HUD.showGhostFace() plays it on a canvas over the view.

export const GHOST_TICKS = 60;      // length of the apparition (reference: 60 ticks)
export const GHOST_SIZE = 48;       // pixels of the face map
/** Palette indices of the face map. */
export const GHOST_PALETTE = [null, '#1d1b24', '#5a5870', '#8b89a6', '#bdbbd6', '#e4e2f2', '#f6f4ff', '#d98a2a', '#2a1218', '#6b4a9a'];
const [, OUT, DARK, MID, LIGHT, PALE, WHITE, IRIS, PUPIL, SPIKE] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

let cached = null;

/** The face as GHOST_SIZE x GHOST_SIZE palette indices (0 = clear), symmetrical left to right. */
export function ghostFacePixels() {
  if (cached) return cached;
  const N = GHOST_SIZE, c = (N - 1) / 2;
  const px = new Uint8Array(N * N);
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < N && y < N) px[y * N + x] = v; };
  const sym = (x, y, v) => { set(x, y, v); set(N - 1 - x, y, v); };
  // thorn spikes first: they sit behind the body, fanning out from its rim
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + 0.2;
    for (let r = 14; r < 22; r++) {
      const w = (22 - r) / 8 * 1.6;
      for (let s = -w; s <= w; s += 0.5) {
        const x = Math.round(c + Math.cos(a) * r - Math.sin(a) * s), y = Math.round(c + Math.sin(a) * r * 0.9 + Math.cos(a) * s);
        if (!px[y * N + x]) set(x, y, SPIKE);
      }
    }
  }
  // the body: a flat ellipse shaded from the top left
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x - c) / 17, dy = (y - c) / 14, d = dx * dx + dy * dy;
    if (d > 1) continue;
    if (d > 0.82) { px[y * N + x] = OUT; continue; }
    const lit = 1 - (dx * 0.6 + dy * 0.8 + 1) / 2 + ((x * 7 + y * 13) % 5) * 0.03;
    px[y * N + x] = lit > 0.62 ? PALE : lit > 0.45 ? LIGHT : lit > 0.28 ? MID : DARK;
  }
  // brow ridges and a gaping mouth below the eye (x counts from the left edge; sym mirrors it)
  for (let x = 8; x < 20; x++) sym(x, 14 + Math.round((19 - x) * 0.25), OUT);
  for (let x = 19; x < 24; x++) sym(x, 35, OUT);
  for (let x = 20; x < 24; x++) sym(x, 36, DARK);
  // the great eye, in the middle
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x - c) / 8.5, dy = (y - 23) / 7, d = dx * dx + dy * dy;
    if (d <= 1) px[y * N + x] = d > 0.8 ? OUT : WHITE;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x - c, y - 23);
    if (d <= 4.2 && px[y * N + x] !== OUT) px[y * N + x] = d <= 2.1 ? PUPIL : IRIS;
  }
  cached = px;
  return px;
}

/**
 * How the apparition looks `t` ticks in: { alpha 0..1, scale (fraction of the view height, 0.25..~1.3),
 * dx, dy (shake, fractions of the view) }. It rushes in, hangs there trembling and fades out.
 * Outside 0..GHOST_TICKS nothing shows (alpha 0).
 */
export function ghostPose(t) {
  if (!(t >= 0) || t >= GHOST_TICKS) return { alpha: 0, scale: 0.25, dx: 0, dy: 0 };
  const p = t / GHOST_TICKS;
  const rush = 1 - (1 - Math.min(1, p / 0.45)) ** 3;       // ease-out over the first 45 %
  const scale = 0.25 + 0.75 * rush + 0.35 * p;
  const alpha = Math.min(1, p / 0.12) * Math.min(1, (1 - p) / 0.4) * 0.92;
  const shake = 0.012 * (1 - p);
  return { alpha, scale, dx: Math.sin(t * 2.7) * shake, dy: Math.cos(t * 3.9) * shake };
}

/** Should the apparition play for this player right now? Only when the curse really lands (not in creative, not when already cursed). */
export const ghostShouldPlay = (landed) => !!landed;

/** Paint the face map onto a GHOST_SIZE-wide canvas context (one pixel per map cell). */
export function paintGhostFace(ctx) {
  const px = ghostFacePixels(), N = GHOST_SIZE;
  const img = ctx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const col = GHOST_PALETTE[px[i]];
    if (!col) continue;
    img.data[i * 4] = parseInt(col.slice(1, 3), 16);
    img.data[i * 4 + 1] = parseInt(col.slice(3, 5), 16);
    img.data[i * 4 + 2] = parseInt(col.slice(5, 7), 16);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

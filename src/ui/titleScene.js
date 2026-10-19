// Animated title-screen backdrop drawn on a 2D canvas: twinkling stars, the
// ringed gas giant with drifting cloud bands, three suns moving along their
// arcs and a blocky landscape scrolling by. Stops when the game starts.
import { mulberry32, Simplex } from '../world/noise.js';

export const SPLASHES = [
  'Three suns, zero sunsets off!', 'Now with weather!', 'Ringed and ready!', 'Mind the Fizzlers!',
  'Breed your Mooxen!', 'Try /help!', 'Sleep when all suns set!', 'Also try farming!', '100% procedural!',
  'Keplerian rings!', 'Night is rare here!', 'Watch out for Voidwalkers!', 'Cloud layer included!',
];

export function startTitleScene(canvas) {
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(7);
  const noise = new Simplex(99);
  const stars = Array.from({ length: 220 }, () => ({ x: rng(), y: rng() * 0.75, s: rng() < 0.15 ? 2 : 1, p: rng() * 6.28 }));
  let raf = 0, running = true;
  const t0 = performance.now();

  const resize = () => { canvas.width = Math.ceil(window.innerWidth / 2); canvas.height = Math.ceil(window.innerHeight / 2); };
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    if (!running) return;
    const t = (performance.now() - t0) / 1000;
    const W = canvas.width, H = canvas.height;
    ctx.imageSmoothingEnabled = false;
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#070a1c'); g.addColorStop(0.55, '#1c1838'); g.addColorStop(0.8, '#3a2a48'); g.addColorStop(1, '#5a3a40');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 1.5 + s.p);
      ctx.fillStyle = '#dfe6ff';
      ctx.fillRect(Math.floor(s.x * W), Math.floor(s.y * H), s.s, s.s);
    }
    ctx.globalAlpha = 1;
    // three suns on slow arcs
    const suns = [['#fff1c8', 7, 0.05, 0.2], ['#c8dcff', 5, 0.031, 2.4], ['#ffb070', 4, 0.077, 4.1]];
    for (const [col, r, sp, ph] of suns) {
      const a = t * sp + ph;
      const x = W * (0.5 + 0.55 * Math.cos(a)), y = H * (0.78 - 0.55 * Math.max(0, Math.sin(a)));
      if (Math.sin(a) < -0.05) continue;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
      glow.addColorStop(0, col); glow.addColorStop(0.25, col + '88'); glow.addColorStop(1, col + '00');
      ctx.fillStyle = glow; ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }
    // gas giant with rings (back half, planet, front half)
    const px = W * 0.84, py = H * 0.2, pr = Math.min(W, H) * 0.12, tilt = -0.32;
    const ring = (front) => {
      ctx.save();
      ctx.translate(px, py); ctx.rotate(tilt);
      ctx.beginPath(); ctx.rect(-pr * 3, front ? 0 : -pr * 3, pr * 6, pr * 3); ctx.clip();
      for (let k = 0; k < 26; k++) {
        const rr = pr * (1.3 + k * 0.042);
        const gap = k === 15 || k === 16;
        ctx.strokeStyle = gap ? 'rgba(0,0,0,0)' : `rgba(${220 - k * 2},${196 - k * 2},${160 - k * 3},${0.25 + 0.35 * Math.abs(Math.sin(k * 1.7))})`;
        ctx.lineWidth = pr * 0.042;
        ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * 0.28, 0, 0, 6.283); ctx.stroke();
      }
      ctx.restore();
    };
    ring(false);
    ctx.save();
    ctx.beginPath(); ctx.arc(px, py, pr, 0, 6.283); ctx.clip();
    for (let y = -pr; y < pr; y += 2) {
      const lat = y / pr;
      const n = noise.noise2(lat * 6, t * 0.05) * 0.5 + Math.sin(lat * 14 + t * 0.1) * 0.5;
      const c = n > 0 ? [218, 178, 128] : [176, 132, 92];
      const k = 0.85 + 0.15 * Math.sin(lat * 30);
      ctx.fillStyle = `rgb(${c[0] * k | 0},${c[1] * k | 0},${c[2] * k | 0})`;
      ctx.fillRect(px - pr, py + y, pr * 2, 2);
    }
    const shade = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.2, px, py, pr * 1.05);
    shade.addColorStop(0, 'rgba(255,240,210,0.15)'); shade.addColorStop(0.7, 'rgba(0,0,0,0.1)'); shade.addColorStop(1, 'rgba(0,0,20,0.75)');
    ctx.fillStyle = shade; ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    ctx.restore();
    ring(true);
    // blocky landscape, two parallax layers
    const layer = (scale, speed, base, top, side, off) => {
      const B = Math.max(4, Math.round(H / 60)) * scale;
      const shift = (t * speed) % B;
      const first = Math.floor(t * speed / B);
      for (let i = -1; i < W / B + 2; i++) {
        const col = first + i;
        const h = Math.round((noise.noise2(col * 0.08 + off, off) * 0.5 + 0.5) * 6 + 3);
        const x = Math.round(i * B - shift);
        const y0 = H - h * B * 0.6 - base;
        ctx.fillStyle = side; ctx.fillRect(x, y0, B, H - y0);
        ctx.fillStyle = top; ctx.fillRect(x, y0, B, Math.max(2, B / 4));
      }
    };
    layer(1, 4, H * 0.12, '#2c3a2a', '#1a2018', 10);
    layer(2, 10, 0, '#4f7a32', '#3a2a1c', 40);
    raf = requestAnimationFrame(draw);
  }
  draw();
  return () => { running = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
}

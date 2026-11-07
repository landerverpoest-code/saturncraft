// The F3 frame-time graph: the last couple of seconds of frames as bars, split into the time spent in the game ticks and in
// rendering, with lines at 60 and 30 frames per second. A ring buffer of fixed size, no allocation per frame; the numbers
// (average, 95th percentile, worst) are what debugText prints under the picture. Pure apart from draw(), which takes any
// 2D context, so the tests run it with a stub.

export const FRAME_SAMPLES = 120;
export const BUDGET_60 = 1000 / 60, BUDGET_30 = 1000 / 30;

export class FrameGraph {
  constructor(size = FRAME_SAMPLES) {
    this.size = size;
    this.frame = new Float32Array(size); // whole frame, ms (time since the last one)
    this.tick = new Float32Array(size);  // game ticks run inside that frame, ms
    this.render = new Float32Array(size); // drawing, ms
    this.head = 0; this.count = 0;
    this._sorted = new Float32Array(size);
  }

  push(frameMs, tickMs = 0, renderMs = 0) {
    if (!Number.isFinite(frameMs) || frameMs < 0) return;
    const i = this.head;
    this.frame[i] = Math.min(frameMs, 1000); this.tick[i] = Math.min(tickMs, 1000); this.render[i] = Math.min(renderMs, 1000);
    this.head = (i + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  clear() { this.head = 0; this.count = 0; }

  /** Sample k, oldest first (0 .. count - 1). */
  at(k) { return (this.head - this.count + k + this.size * 2) % this.size; }

  /** { avg, p95, worst, tick, render (averages), slow (frames over 33 ms), fps } of what is in the buffer. */
  stats() {
    const n = this.count;
    if (!n) return { n: 0, avg: 0, p95: 0, worst: 0, tick: 0, render: 0, slow: 0, fps: 0 };
    let sum = 0, tick = 0, render = 0, worst = 0, slow = 0;
    const s = this._sorted;
    for (let k = 0; k < n; k++) {
      const i = this.at(k), f = this.frame[i];
      sum += f; tick += this.tick[i]; render += this.render[i];
      if (f > worst) worst = f;
      if (f > BUDGET_30) slow++;
      s[k] = f;
    }
    const part = s.subarray(0, n).sort();
    const p95 = part[Math.min(n - 1, Math.floor(n * 0.95))];
    const avg = sum / n;
    return { n, avg, p95, worst, tick: tick / n, render: render / n, slow, fps: avg > 0 ? 1000 / avg : 0 };
  }

  /** One text line for the debug screen. */
  line() {
    const s = this.stats();
    if (!s.n) return 'Frame -';
    return `Frame ${s.avg.toFixed(1)} ms  p95 ${s.p95.toFixed(1)}  worst ${s.worst.toFixed(0)}  (ticks ${s.tick.toFixed(1)}, draw ${s.render.toFixed(1)})  slow ${s.slow}/${s.n}`;
  }

  /**
   * Draw into a 2D context of size w x h. The scale tops out at 50 ms. Bars use brightness and a white cap rather than hue to
   * show how bad a frame was: dim under 60 fps, bright under 30, capped over that; the render share is the lower, darker part.
   */
  draw(ctx, w, h) {
    const top = 50, y = (ms) => h - Math.min(1, ms / top) * h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, h);
    const bw = w / this.size;
    for (let k = 0; k < this.count; k++) {
      const i = this.at(k), x = (this.size - this.count + k) * bw;
      const f = this.frame[i], yy = y(f);
      ctx.fillStyle = f > BUDGET_30 ? '#ffffff' : f > BUDGET_60 + 1 ? '#c8c8c8' : '#7a7a7a';
      ctx.fillRect(x, yy, Math.max(1, bw - 0.5), h - yy);
      const ry = y(this.render[i]);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, ry, Math.max(1, bw - 0.5), h - ry);
      if (f > BUDGET_30) { ctx.fillStyle = '#ffd34a'; ctx.fillRect(x, yy, Math.max(1, bw - 0.5), 2); }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const [ms, label] of [[BUDGET_60, '60'], [BUDGET_30, '30']]) {
      ctx.fillRect(0, y(ms), w, 1);
      if (ctx.fillText) ctx.fillText(label, 2, y(ms) - 2);
    }
  }
}

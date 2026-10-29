// Lazy slot contents for long catalogues (the creative inventory lists ~850 items and drawing every
// icon up front took seconds). A slot's content is rendered only when it scrolls near the visible part
// of its scroll box; without IntersectionObserver the queue is drained top-down in time-sliced frames.

/**
 * @param {object} o
 * @param {Element} o.root scroll box the slots live in
 * @param {Function} [o.IO] IntersectionObserver constructor (injectable for tests)
 * @param {Function} [o.schedule] frame scheduler used by the fallback
 * @param {number} [o.budgetMs] fallback work per frame
 * @param {string} [o.margin] how far outside the scroll box slots are prepared
 */
export function createLazyRenderer({ root, IO = typeof IntersectionObserver !== 'undefined' ? IntersectionObserver : null, schedule = (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (f) => setTimeout(f, 16)), budgetMs = 6, margin = '90px 0px' } = {}) {
  const pending = new Map(); // element -> render function
  let io = null, queue = [], qi = 0, scheduled = false, dead = false;
  const run = (el) => { const f = pending.get(el); if (!f) return; pending.delete(el); f(); };
  const make = () => new IO((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); run(e.target); }
  }, { root, rootMargin: margin });
  if (IO) io = make();
  const drain = () => {
    scheduled = false;
    if (dead) return;
    const t0 = performance.now();
    // at least one slot per frame, whatever the budget or a stalled clock: a frame that draws nothing could repeat forever
    if (qi < queue.length) do run(queue[qi++]); while (qi < queue.length && performance.now() - t0 < budgetMs);
    if (qi < queue.length) { scheduled = true; schedule(drain); } else { queue = []; qi = 0; }
  };
  return {
    /** Render `el` through `render()` once it is (nearly) visible. */
    add(el, render) {
      pending.set(el, render);
      if (io) io.observe(el);
      else { queue.push(el); if (!scheduled) { scheduled = true; schedule(drain); } }
    },
    /** Forget everything not rendered yet (the catalogue is being rebuilt). */
    reset() { pending.clear(); queue = []; qi = 0; if (io) { io.disconnect(); io = make(); } },
    /** Render the first `n` waiting slots now (the rows that are in view as soon as the catalogue opens). */
    flush(n) { let i = 0; for (const el of [...pending.keys()]) { if (i++ >= n) break; if (io) io.unobserve(el); run(el); } },
    pending: () => pending.size,
    dispose() { dead = true; pending.clear(); queue = []; qi = 0; if (io) io.disconnect(); },
  };
}

// The Cartographer's Table screen (player/cartographer.js): a chart of the 8 x 8 chunks of the map square the table stands in, inked
// where you have been, and two jobs: draw a map of the explored ground (a Paper; the Compass is kept) or copy the map in your hand.
import { SQUARE_CHUNKS, tableOffers, surveyAtTable, copyHeldMap } from '../player/cartographer.js';

function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
const txt = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e; };

/** Paint the explored-chunk chart: parchment, ink where explored, the table's chunk ringed and the player's chunk dotted. */
export function drawChart(canvas, explored, dim, x0, z0, table, player) {
  const ctx = canvas.getContext('2d'), n = SQUARE_CHUNKS, cell = canvas.width / n;
  ctx.fillStyle = '#e6d8a8'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const seen = explored.has(dim, (x0 >> 4) + i, (z0 >> 4) + j);
    ctx.fillStyle = seen ? ((i + j) & 1 ? '#6a8a4a' : '#78995a') : ((i + j) & 1 ? '#dccd9a' : '#e1d3a2');
    ctx.fillRect(i * cell, j * cell, cell, cell);
  }
  ctx.strokeStyle = 'rgba(90, 58, 34, .55)'; ctx.lineWidth = 1;
  for (let k = 0; k <= n; k++) { ctx.beginPath(); ctx.moveTo(k * cell + .5, 0); ctx.lineTo(k * cell + .5, canvas.height); ctx.moveTo(0, k * cell + .5); ctx.lineTo(canvas.width, k * cell + .5); ctx.stroke(); }
  const at = (wx, wz) => [((Math.floor(wx) - x0) / 16) * cell, ((Math.floor(wz) - z0) / 16) * cell];
  if (table) { const [tx, tz] = at(table.x, table.z); ctx.strokeStyle = '#b02828'; ctx.lineWidth = 2; ctx.strokeRect(Math.floor(tx / cell) * cell + 2, Math.floor(tz / cell) * cell + 2, cell - 4, cell - 4); }
  if (player) {
    const [px, pz] = at(player.x, player.z);
    if (px >= 0 && pz >= 0 && px < canvas.width && pz < canvas.height) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1a1208'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, pz, 4, 0, 6.283); ctx.fill(); ctx.stroke(); }
  }
}

/** The screen for the table at (x, y, z). */
export function openCartographersTable(ui, x, y, z) {
  const g = ui.game;
  g.input.unlock();
  ui.clear();
  ui.open = 'pause';
  const s = el(`<div class="screen pause-screen quest-screen table-screen"><h2>Cartographer's Table</h2><div class="quest-sub"></div>
    <canvas class="table-chart" width="192" height="192" role="img"></canvas>
    <div class="quest-body table-body" tabindex="0"></div><button class="btn" data-a="back">Back</button></div>`);
  const sub = s.querySelector('.quest-sub'), canvas = s.querySelector('canvas'), body = s.querySelector('.table-body');
  const leave = () => { ui.open = null; ui.clear(); g.onUIClosed(); };
  const render = (note) => {
    const offers = tableOffers(g, x, z), dim = g.world.dimension, p = g.player;
    const total = g.explored ? g.explored.count(dim) : 0;
    sub.textContent = `Square ${offers.here.x0} to ${offers.here.x0 + 127}, ${offers.here.z0} to ${offers.here.z0 + 127} · ${offers.chunks} of ${SQUARE_CHUNKS * SQUARE_CHUNKS} chunks explored · ${total} chunk${total === 1 ? '' : 's'} charted in all`;
    canvas.setAttribute('aria-label', `Chart of the map square: ${offers.chunks} of ${SQUARE_CHUNKS * SQUARE_CHUNKS} chunks explored`);
    if (g.explored) drawChart(canvas, g.explored, dim, offers.here.x0, offers.here.z0, { x, z }, p);
    body.replaceChildren();
    const job = (title, desc, label, reason, fn) => {
      const c = document.createElement('div'); c.className = 'quest-card' + (reason ? '' : ' ready');
      const info = document.createElement('div'); info.className = 'quest-info';
      info.append(txt('b', '', title), txt('div', 'd', desc), ...(reason ? [txt('div', 'd', reason)] : []));
      const acts = document.createElement('div'); acts.className = 'quest-acts';
      const b = document.createElement('button'); b.className = 'btn small'; b.type = 'button'; b.textContent = label; b.disabled = !!reason; b.onclick = fn;
      acts.appendChild(b); c.append(info, acts); body.appendChild(c);
    };
    job('Draw a map of where you have been', 'Costs a Paper and needs a Compass in your bag (the Compass is kept). Only the explored chunks are inked in: ground you have since left is charted from the lay of the land, and what you never visited stays blank.', 'Draw map', offers.survey, () => { const r = surveyAtTable(g, x, z); g.hud.toast(r.msg, 2600); render(); });
    job('Copy the map in your hand', 'Costs a Paper. The copy shows the same picture: what either one fills in later shows on both.', 'Copy map', offers.copy, () => { const r = copyHeldMap(g, x, z); g.hud.toast(r.msg, 2200); render(); });
    body.appendChild(txt('div', 'd quest-note', note || 'Walk the land to explore it: every chunk you pass within three chunks of is remembered. The red frame is this table\'s chunk, the white dot is you.'));
  };
  s.querySelector('[data-a=back]').onclick = leave;
  s.addEventListener('keydown', (e) => { if (e.key === 'Backspace') { e.preventDefault(); leave(); } });
  ui.padBack = leave;
  ui.padScroll = (dy) => { body.scrollTop += dy; };
  render();
  ui.layer.appendChild(s);
  g.audio.play('click');
  return s;
}

// Heads-up display: hotbar, health/hunger/air bars, crosshair, attack
// cooldown, sky compass and the F3 debug overlay.
import { iconURL, stackHTML, effectIconURL } from './icons.js';
import { EFFECTS, effectLabel, formatTicks } from '../player/effects.js';
import { hasEnch, enchLines } from '../world/enchantments.js';
import { ITEMS } from '../world/items.js';
import { armorTotals } from '../player/armor.js';
import { xpToNextLevel } from '../player/experience.js';
import { PlayerMarkers } from './playerMarkers.js';
import { dashGauge } from '../mobs/duneStrider.js';
import { paintGhostFace, ghostPose, GHOST_TICKS } from './ghostFace.js';
import { hudPalette, motionScales } from './accessibility.js';

const svg = (inner) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" shape-rendering="crispEdges">${inner}</svg>`)}`;
const heartPath = 'M9 16 L2 9 Q0 6 2 3.5 Q4.5 1 7 3 L9 5 L11 3 Q13.5 1 16 3.5 Q18 6 16 9 Z';
/** The status-bar icons in a palette (ui/accessibility.js hudPalette); `marks` adds shape cues for colour-blind modes. */
export function buildIcons(c) {
  const cross = (col) => `<path d="M5 5 L13 13 M13 5 L5 13" stroke="${col}" stroke-width="2"/>`;
  const marks = !!c.marks;
  return {
    heartEmpty: svg(`<path d="${heartPath}" fill="${c.heartEmpty}" stroke="#000" stroke-width="1.2"/>`),
    heartFull: svg(`<path d="${heartPath}" fill="${c.heart}" stroke="#000" stroke-width="1.2"/><path d="M4 5 L6 4" stroke="${c.heartShine}" stroke-width="1.5"/>`),
    heartHalf: svg(`<defs><clipPath id="c"><rect x="0" y="0" width="9" height="18"/></clipPath></defs><path d="${heartPath}" fill="${c.heartEmpty}" stroke="#000" stroke-width="1.2"/><path d="${heartPath}" fill="${c.heart}" clip-path="url(#c)"/>`),
    heartGold: svg(`<path d="${heartPath}" fill="${c.gold}" stroke="#000" stroke-width="1.2"/><path d="M4 5 L6 4" stroke="${c.goldShine}" stroke-width="1.5"/>`),
    heartGoldHalf: svg(`<defs><clipPath id="g"><rect x="0" y="0" width="9" height="18"/></clipPath></defs><path d="${heartPath}" fill="${c.gold}" stroke="#000" stroke-width="1.2" clip-path="url(#g)"/>`),
    heartPoison: svg(`<path d="${heartPath}" fill="${c.poison}" stroke="#000" stroke-width="1.2"/>${marks ? cross('#000') : ''}`),
    foodEmpty: svg(`<rect x="3" y="5" width="12" height="10" rx="3" fill="${c.foodEmpty}" stroke="#000"/><rect x="5" y="2" width="8" height="4" fill="${c.foodEmpty}" stroke="#000"/>`),
    foodFull: svg(`<rect x="3" y="5" width="12" height="10" rx="3" fill="${c.food}" stroke="#000"/><rect x="5" y="2" width="8" height="4" fill="${c.foodTop}" stroke="#000"/><rect x="5" y="7" width="3" height="2" fill="${c.foodShine}"/>`),
    foodHalf: svg(`<defs><clipPath id="c"><rect x="9" y="0" width="9" height="18"/></clipPath></defs><rect x="3" y="5" width="12" height="10" rx="3" fill="${c.foodEmpty}" stroke="#000"/><rect x="3" y="5" width="12" height="10" rx="3" fill="${c.food}" clip-path="url(#c)"/>`),
    foodHunger: svg(`<rect x="3" y="5" width="12" height="10" rx="3" fill="${c.hunger}" stroke="#000"/><rect x="5" y="2" width="8" height="4" fill="${c.hungerTop}" stroke="#000"/>${marks ? cross('#000') : ''}`),
    armorEmpty: svg(`<path d="M3 3 L7 2 L9 4 L11 2 L15 3 L15 9 L12 10 L12 16 L6 16 L6 10 L3 9 Z" fill="#26262c" stroke="#000" stroke-width="1.1"/>`),
    armorFull: svg(`<path d="M3 3 L7 2 L9 4 L11 2 L15 3 L15 9 L12 10 L12 16 L6 16 L6 10 L3 9 Z" fill="#c8ccd4" stroke="#000" stroke-width="1.1"/><path d="M5 4 L7 3.5" stroke="#fff" stroke-width="1.2"/>`),
    armorHalf: svg(`<defs><clipPath id="c"><rect x="0" y="0" width="9" height="18"/></clipPath></defs><path d="M3 3 L7 2 L9 4 L11 2 L15 3 L15 9 L12 10 L12 16 L6 16 L6 10 L3 9 Z" fill="#26262c" stroke="#000" stroke-width="1.1"/><path d="M3 3 L7 2 L9 4 L11 2 L15 3 L15 9 L12 10 L12 16 L6 16 L6 10 L3 9 Z" fill="#c8ccd4" clip-path="url(#c)"/>`),
    bubble: svg(`<circle cx="9" cy="9" r="6" fill="${c.air}" stroke="${c.airEdge}" stroke-width="1.5"/><circle cx="7" cy="7" r="1.6" fill="${c.airShine}"/>`),
  };
}

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('hud');
    this.root.innerHTML = `
      <div id="overlay-water" class="hidden"></div>
      <div id="overlay-lava" class="hidden"></div>
      <div id="overlay-fire" class="hidden"></div>
      <div id="overlay-vignette"></div>
      <div id="overlay-darkness"></div>
      <div id="overlay-scope" class="hidden"></div>
      <canvas id="overlay-ghost" class="hidden" width="48" height="48"></canvas>
      <div id="crosshair"></div>
      <div id="attack-indicator" class="hidden"><div></div></div>
      <div id="skyinfo"><canvas width="192" height="96"></canvas><div><div id="phase-label">Day</div><div id="time-label" style="opacity:.7;font-size:11px"></div></div></div>
      <div id="effects"></div>
      <div id="debug" class="hidden"></div>
      <div id="coords" class="hidden"></div>
      <div id="markers-root"></div>
      <div id="toast"></div>
      <div id="captions" aria-live="polite"></div>
      <div id="raidbar" class="hidden"><div class="rb-name"></div><div class="rb-track"><div class="rb-fill"></div></div></div>
      <div id="item-name"></div>
      <div id="bottom">
        <div id="bars3" style="width:calc(var(--slot) * 9 + 8px);display:none"><div class="bar" id="absorb"></div></div>
        <div id="bars2" style="width:calc(var(--slot) * 9 + 8px);display:flex;justify-content:space-between"><div class="bar" id="armor"></div><div class="bar right" id="air"></div></div>
        <div id="bars"><div class="bar" id="health"></div><div class="bar right" id="food"></div></div>
        <div id="dashbar" class="hidden" title="Dash"><div></div></div>
        <div id="xpbar"><div id="xpfill"></div><span id="xplevel"></span></div>
        <div class="hotbar" id="hotbar"></div>
      </div>`;
    this.hotbar = this.root.querySelector('#hotbar');
    this.slots = [];
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      this.hotbar.appendChild(s);
      this.slots.push(s);
    }
    this.icons = buildIcons(hudPalette(game.settings.colorBlind));
    this.captionsEl = this.root.querySelector('#captions');
    this.captionKey = '';
    this.healthEl = this.root.querySelector('#health');
    this.absorbEl = this.root.querySelector('#absorb');
    this.foodEl = this.root.querySelector('#food');
    this.airEl = this.root.querySelector('#air');
    this.armorEl = this.root.querySelector('#armor');
    this.makeIcons(this.armorEl, 10);
    this.xpFill = this.root.querySelector('#xpfill');
    this.xpLevel = this.root.querySelector('#xplevel');
    this.makeIcons(this.healthEl, 10); this.makeIcons(this.absorbEl, 10); this.makeIcons(this.foodEl, 10); this.makeIcons(this.airEl, 10);
    this.debugEl = this.root.querySelector('#debug');
    this.coordsEl = this.root.querySelector('#coords');
    this.markers = new PlayerMarkers(this.root.querySelector('#markers-root'));
    this.skyCanvas = this.root.querySelector('#skyinfo canvas');
    this.phaseLabel = this.root.querySelector('#phase-label');
    this.timeLabel = this.root.querySelector('#time-label');
    this.toastEl = this.root.querySelector('#toast');
    this.effectsEl = this.root.querySelector('#effects');
    this.effectsKey = '';
    this.itemNameEl = this.root.querySelector('#item-name');
    this.attackEl = this.root.querySelector('#attack-indicator');
    this.ov = {
      water: this.root.querySelector('#overlay-water'), lava: this.root.querySelector('#overlay-lava'),
      fire: this.root.querySelector('#overlay-fire'), vign: this.root.querySelector('#overlay-vignette'),
    };
    this.scopeEl = this.root.querySelector('#overlay-scope');
    this.darkEl = this.root.querySelector('#overlay-darkness');
    this.ghostEl = this.root.querySelector('#overlay-ghost');
    this.ghostT = -1; // ticks into the Elder Deepeye's apparition, -1 when none
    this.frame = 0;
    this.lastHotbarKey = '';
    this.lastSel = -1;
    this.showDebug = false;
    this.visible = true;
  }

  /** Switch the status bars to a colour-blind friendly palette (or back); they redraw on the next update. */
  setColorBlind(mode) {
    this.icons = buildIcons(hudPalette(mode));
    for (const el of [this.healthEl, this.absorbEl, this.foodEl, this.airEl, this.armorEl]) for (const img of el.children) img._src = null;
    this.lastAbsorb = undefined;
  }

  /** Sound captions (bottom right): redrawn only when the list or the fading changes. */
  updateCaptions() {
    const g = this.game, log = g.captions, el = this.captionsEl;
    if (!g.settings.captions) { if (this.captionKey !== '') { this.captionKey = ''; el.textContent = ''; log.clear(); } return; }
    const now = performance.now();
    log.prune(now);
    const rows = log.view(now);
    const key = rows.map((r) => `${r.text}${r.dir}${Math.round(r.fade * 4)}`).join('|');
    if (key === this.captionKey) return;
    this.captionKey = key;
    el.textContent = '';
    for (const r of rows) {
      const d = document.createElement('div');
      d.className = 'caption';
      d.style.opacity = String(0.35 + 0.65 * r.fade);
      d.textContent = `${r.left}${r.text}${r.right}`;
      el.appendChild(d);
    }
  }

  makeIcons(el, n) { for (let i = 0; i < n; i++) { const img = document.createElement('img'); img.className = 'icon'; el.appendChild(img); } }

  setVisible(v) { this.visible = v; this.root.style.display = v ? '' : 'none'; }
  /** The dark ring of a Farglass while looking through it (also hides the crosshair). */
  /** The Elder Deepeye's curse: its pale ghost swells out of the screen for three seconds (ui/ghostFace.js). */
  showGhostFace() {
    if (!this.ghostEl || !this.ghostEl.getContext) return;
    const ctx = this.ghostEl.getContext('2d');
    if (!ctx) return;
    if (!this.ghostPainted) { paintGhostFace(ctx); this.ghostPainted = true; }
    this.ghostStart = performance.now();
    this.ghostT = 0;
  }

  /** Draw the apparition for the time that has passed (20 ticks a second); called every frame from update(). */
  tickGhostFace() {
    if (this.ghostT < 0) return;
    const el = this.ghostEl;
    this.ghostT = (performance.now() - this.ghostStart) / 50;
    if (this.ghostT >= GHOST_TICKS) { this.ghostT = -1; el.classList.add('hidden'); return; }
    const pose = ghostPose(this.ghostT);
    const calm = motionScales(this.game.settings).apparitionShake;
    pose.dx *= calm; pose.dy *= calm; // reduced motion: the face still appears but does not tremble
    el.classList.remove('hidden');
    const size = pose.scale * 100;
    el.style.opacity = String(pose.alpha);
    el.style.width = el.style.height = `${size}vh`;
    el.style.transform = `translate(calc(-50% + ${pose.dx * 100}vh), calc(-50% + ${pose.dy * 100}vh))`;
  }

  setScope(on) {
    if (on === this.scoped) return;
    this.scoped = on;
    this.scopeEl.classList.toggle('hidden', !on);
    this.root.querySelector('#crosshair').style.opacity = on ? '0' : '';
  }

  /** Slide-in card for a reached milestone. */
  milestone(m) {
    const card = document.createElement('div');
    card.className = 'milestone';
    card.innerHTML = `<img src="${iconURL(m.icon)}"><div><div class="m-head">Milestone reached!</div><div class="m-title"></div></div>`;
    card.querySelector('.m-title').textContent = m.title;
    this.root.appendChild(card);
    setTimeout(() => card.classList.add('out'), 4500);
    setTimeout(() => card.remove(), 5200);
  }

  /** The raid bar (mobs/raids.js): { label, progress 0..1, state } or null to hide it. */
  raidBar(info) {
    const el = this.raidEl || (this.raidEl = this.root.querySelector('#raidbar'));
    if (!el) return;
    el.classList.toggle('hidden', !info);
    if (!info) return;
    const name = el.firstChild, fill = el.lastChild.firstChild;
    if (name.textContent !== info.label) name.textContent = info.label;
    fill.style.width = `${Math.round(info.progress * 1000) / 10}%`;
    el.classList.toggle('won', info.state === 'won');
  }

  toast(msg, ms = 2500) {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = 1;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { this.toastEl.style.opacity = 0; }, ms);
  }

  renderSlot(el, st) {
    el.innerHTML = stackHTML(st);
  }

  update() {
    const g = this.game, p = g.player;
    const inv = p.inventory;
    const key = inv.slots.slice(0, 9).map((s) => (s ? `${s.id}:${s.count}:${s.damage}:${s.ench ? JSON.stringify(s.ench) : ''}` : '-')).join('|');
    if (key !== this.lastHotbarKey) {
      this.lastHotbarKey = key;
      for (let i = 0; i < 9; i++) this.renderSlot(this.slots[i], inv.slots[i]);
    }
    if (inv.selected !== this.lastSel) {
      this.slots.forEach((s, i) => s.classList.toggle('sel', i === inv.selected));
      this.lastSel = inv.selected;
      const st = inv.selectedStack;
      this.itemNameEl.textContent = st ? ITEMS[st.id].name : '';
      if (st && hasEnch(st)) { const e = document.createElement('span'); e.className = 'ench-list'; e.textContent = enchLines(st).join(', '); this.itemNameEl.appendChild(e); }
      this.itemNameEl.style.opacity = 1;
      clearTimeout(this._nameT);
      this._nameT = setTimeout(() => { this.itemNameEl.style.opacity = 0; }, 1800);
    }
    // health
    const hp = Math.ceil(p.health);
    const poison = !!p.effects.poison;
    const ms = motionScales(g.settings);
    const blink = ms.flash === 1 && p.hurtTime > 0 && (p.hurtTime >> 1) % 2 === 0; // reduced flashing: hearts do not flash white
    const jitter = ms.bob > 0 && p.health <= 4;
    [...this.healthEl.children].forEach((img, i) => {
      const v = hp - i * 2;
      let src = v >= 2 ? (poison ? this.icons.heartPoison : this.icons.heartFull) : v === 1 ? this.icons.heartHalf : this.icons.heartEmpty;
      if (img._src !== src) { img.src = src; img._src = src; }
      img.style.transform = jitter ? `translateY(${Math.round(Math.sin(performance.now() / 60 + i * 2) * 1.5)}px)` : '';
      img.style.filter = blink ? 'brightness(2.2)' : '';
    });
    // Absorption: a row of golden hearts above the red ones
    const ab = Math.ceil(p.absorption || 0);
    if (ab !== this.lastAbsorb) {
      this.lastAbsorb = ab;
      this.absorbEl.parentElement.style.display = ab > 0 && !p.creative ? 'flex' : 'none';
      [...this.absorbEl.children].forEach((img, i) => {
        const v = ab - i * 2;
        img.style.display = v > 0 ? '' : 'none';
        if (v > 0) img.src = v >= 2 ? this.icons.heartGold : this.icons.heartGoldHalf;
      });
    }
    const food = p.hunger.food;
    const hungerFx = !!p.effects.hunger;
    [...this.foodEl.children].forEach((img, i) => {
      const v = food - i * 2;
      let src = v >= 2 ? (hungerFx ? this.icons.foodHunger : this.icons.foodFull) : v === 1 ? this.icons.foodHalf : this.icons.foodEmpty;
      if (img._src !== src) { img.src = src; img._src = src; }
      img.style.transform = p.hunger.saturation <= 0 && g.ticks % (food * 3 + 1) === 0 ? 'translateY(-2px)' : '';
    });
    const showAir = p.air < 300 || p.body.eyeInWater;
    const bubbles = Math.ceil(Math.max(0, p.air) * 10 / 300);
    [...this.airEl.children].forEach((img, i) => {
      if (!img._src) { img.src = this.icons.bubble; img._src = true; }
      const v = showAir && i < bubbles ? 'visible' : 'hidden';
      if (img.style.visibility !== v) img.style.visibility = v;
    });
    this.root.classList.toggle('creative', p.creative);
    // armour (2 points per icon, shown only when wearing some)
    const { points } = armorTotals(inv.armor);
    [...this.armorEl.children].forEach((img, i) => {
      const v = points - i * 2;
      const src = v >= 2 ? this.icons.armorFull : v === 1 ? this.icons.armorHalf : this.icons.armorEmpty;
      if (img._src !== src) { img.src = src; img._src = src; }
      const vis = points > 0 ? 'visible' : 'hidden';
      if (img.style.visibility !== vis) img.style.visibility = vis;
    });
    // experience
    const xp = p.xp, frac = xp.points / xpToNextLevel(xp.level);
    this.xpFill.style.width = `${Math.min(1, frac) * 100}%`;
    const lv = xp.level > 0 ? String(xp.level) : '';
    if (this.xpLevel.textContent !== lv) this.xpLevel.textContent = lv;
    // attack cooldown indicator
    const cd = g.interaction ? g.interaction.attackCooldownProgress() : 1;
    this.attackEl.classList.toggle('hidden', cd >= 1);
    this.attackEl.firstChild.style.width = `${cd * 100}%`;
    // riding a Dune Strider: the dash charging (gold) and its cooldown (grey until ready)
    const mount = p.riding && p.riding.def && p.riding.def.strider && !p.riding.netProxy ? p.riding : null;
    const dashEl = this.dashEl || (this.dashEl = this.root.querySelector('#dashbar'));
    dashEl.classList.toggle('hidden', !mount);
    if (mount) {
      const gge = dashGauge(mount.dash);
      dashEl.firstChild.style.width = `${Math.round((gge.charging ? gge.charge : gge.ready) * 100)}%`;
      dashEl.classList.toggle('charging', gge.charging);
      dashEl.classList.toggle('cooling', !gge.charging && gge.ready < 1);
    }
    // overlays
    const b = p.body;
    this.ov.water.classList.toggle('hidden', !b.eyeInWater);
    this.ov.lava.classList.toggle('hidden', !b.eyeInLava);
    this.ov.fire.classList.toggle('hidden', !(p.fireTicks > 0 && !b.inWater));
    const vign = this.ov.vign;
    vign.style.background = p.hurtTime > 0 ? `radial-gradient(ellipse at center, transparent 50%, rgba(200,0,0,${p.hurtTime / 22}) 100%)` : (p.health <= 4 ? 'radial-gradient(ellipse at center, transparent 60%, rgba(120,0,0,.35) 100%)' : '');
    this.tickGhostFace();
    this.updateCaptions();
    // Darkness from Hush Shriekers: black closing in from the edges in waves (game.render works out how dark)
    const dk = g.darkness || 0;
    if (Math.abs(dk - (this.lastDark || 0)) > 0.004) { this.lastDark = dk; this.darkEl.style.opacity = String(dk); }
    if (this.frame % 5 === 0) this.drawEffects();
    if (this.frame++ % 10 === 0) this.drawSky();
    if (this.showDebug && this.frame % 6 === 0) this.debugEl.textContent = g.debugText();
    if (g.net) this.markers.update(g);
    else this.markers.clear();
    // coordinates (pause menu setting); the F3 screen already shows them
    const coords = !!g.settings.showCoords && !this.showDebug;
    this.coordsEl.classList.toggle('hidden', !coords);
    if (coords && this.frame % 3 === 0) {
      const yaw = ((p.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const facing = ['North', 'West', 'South', 'East'][Math.round(yaw / (Math.PI / 2)) % 4];
      this.coordsEl.textContent = `XYZ: ${Math.floor(p.x)} / ${Math.floor(p.y)} / ${Math.floor(p.z)}  ·  ${facing}`;
    }
  }

  /** Active effects, top right under the sky widget: badge, level and time left (blinking near the end). */
  drawEffects() {
    const fx = this.game.player.effects;
    const names = Object.keys(fx).sort((a, b) => (EFFECTS[b].good - EFFECTS[a].good) || a.localeCompare(b));
    const key = names.map((n) => n + fx[n].amp).join();
    if (key !== this.effectsKey) {
      this.effectsKey = key;
      this.effectsEl.innerHTML = '';
      for (const n of names) {
        const row = document.createElement('div');
        row.className = 'fx ' + (EFFECTS[n].good ? 'good' : 'bad');
        row.innerHTML = `<img src="${effectIconURL(n)}"><div><div class="fx-name"></div><div class="fx-time"></div></div>`;
        row.querySelector('.fx-name').textContent = effectLabel(n, fx[n].amp);
        row.dataset.fx = n;
        this.effectsEl.appendChild(row);
      }
    }
    for (const row of this.effectsEl.children) {
      const e = fx[row.dataset.fx];
      if (!e) continue;
      const t = formatTicks(e.ticks);
      const tEl = row.lastChild.lastChild;
      if (tEl.textContent !== t) tEl.textContent = t;
      row.classList.toggle('ending', e.ticks < 200 && Math.floor(e.ticks / 10) % 2 === 0);
    }
  }

  drawSky() {
    const st = this.game.sky.state;
    const c = this.skyCanvas, ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(40,60,110,0.5)';
    ctx.beginPath(); ctx.arc(w / 2, h - 6, h - 12, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(4, h - 6); ctx.lineTo(w - 4, h - 6); ctx.stroke();
    for (const s of st.suns) {
      // azimuth projected left-right (east -> west), elevation up
      const x = w / 2 + s.dir[0] * (w / 2 - 12); // east to the right
      const y = h - 6 - s.elevation * (h - 16);
      const [r, g, bl] = s.color;
      ctx.globalAlpha = s.isUp ? 1 : 0.3;
      ctx.fillStyle = `rgb(${r * 255},${g * 255},${bl * 255})`;
      ctx.beginPath(); ctx.arc(x, Math.min(h - 2, y), 4 + s.sun.size * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const label = { day: 'Day', twilight: 'Twilight', night: 'Night' }[st.phase];
    if (this.phaseLabel.textContent !== label) this.phaseLabel.textContent = label;
    this.timeLabel.textContent = `${st.aboveCount}/3 suns up · light ${15 - st.skyDarken}`;
  }
}

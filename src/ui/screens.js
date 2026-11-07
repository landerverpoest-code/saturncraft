// Menus and container screens (inventory, workbench, furnace).
import { doubleChestHalves, doubleChestView } from '../world/chests.js';
import { createLazyRenderer } from './lazyIcons.js';
import { iconURL, stackHTML, stackIconURL, tooltipHTML, effectIconURL, setWornArmor } from './icons.js';
import { EFFECTS, effectLabel, formatTicks } from '../player/effects.js';
import { isIngredient, isVial, VIAL_SLOTS, INGREDIENT_SLOT, FUEL_SLOT, BREW_TICKS, BREWS_PER_POWDER } from '../world/brewing.js';
import { ITEMS, I, maxStack } from '../world/items.js';
import { canStack, hasEnch, isEnchantable, countBookshelves, tableOffers, rollOffer, applyOffer, enchName, anvilCombine, ANVIL_MAX_COST, cleanLabel, LABEL_MAX } from '../world/enchantments.js';
import { bundleInsert, bundleTakeLast } from '../world/bundles.js';
import { isBook, bookPages, cleanPage, cleanPages, cleanTitle, signBook, BOOK_MAX_PAGES, PAGE_MAX, TITLE_MAX } from '../world/books.js';
import { spendLevels } from '../player/experience.js';
import { mulberry32 } from '../world/noise.js';
import { craft, consumeCraft, RECIPES, recipeLayout, chooseIngredients } from '../player/crafting.js';
import { B, BLOCKS, isBox } from '../world/blocks.js';
import { canTrade, affordableTimes, doTrade, offerPrice, MAX_USES, recordTrades, levelProgress, LEVEL_NAMES, giftValue, GIFT_COOLDOWN } from '../mobs/trades.js';
import { getRep, standing, repHint, refusesTrade, REP } from '../mobs/reputation.js';
import { tradeMarket } from '../world/events.js';
import { repEvent } from '../mobs/villageRep.js';
import { championDiscount } from '../mobs/raids.js';
import { MILESTONES } from '../player/milestones.js';
import { statRows, killRows, formatTime } from '../player/stats.js';
import { guideOf, recordOf, LEVEL, TABS } from '../player/fieldGuide.js';
import { entriesOf, guideProgress, guideRows, TAB_LABELS, itemName } from '../player/fieldGuideEntries.js';
import { creatureIcon, structureIcon } from './guideArt.js';
import { MOBS } from '../mobs/mobTypes.js';
import { ACTIONS, GROUPS, SLOT_KINDS, SLOT_NAMES, resolveBindings, toOverrides, setBinding, codeLabel } from './bindings.js';
import { COLOR_BLIND_LABELS, nextColorBlind, priceCue } from './accessibility.js';
import { MenuNav, labelScreens, AUTOFOCUS_SCREENS } from './menuNav.js';
import { buildTopics, searchTopics } from './helpTopics.js';
import { isTrinket, TRINKET_SLOTS } from '../player/trinkets.js';
import { wornSets, SET_PIECES } from '../player/setBonuses.js';
import { TOUCH_MODE_LABELS, SIZE_RANGE, OPACITY_RANGE, nextTouchMode, normalizeTouch, detectTouch, readTouchEnv } from './touchMath.js';
import { loadPlayerName, MAX_PLAYERS } from '../net/protocol.js';
import { EMOTES, EMOTE_LABELS } from '../net/social.js';
import { grindstoneAccepts, grindstoneResult, grindstoneXp, stonecutterOutputs, stonecutterAccepts, loomResult, loomAcceptsCloth, loomAcceptsDye, LOOM_BATCH } from '../world/workstations.js';
import { BEACON_POWERS, POWER_LEVEL, SECONDARY, BEACON_PAYMENT, beaconLevel, beamColor, beaconMeta, beaconRange } from '../world/beacons.js';

function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

/** A strip of made-up glyphs for an enchanting offer (procedural, seeded): a data URL. */
const runeCache = new Map();
function runeStrip(seed, n = 9) {
  if (runeCache.has(seed)) return runeCache.get(seed);
  const rng = mulberry32(seed);
  const c = document.createElement('canvas'); c.width = n * 7; c.height = 9;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a3a6a';
  const P = [];
  for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 3; gx++) P.push([gx * 2, gy * 2]);
  for (let k = 0; k < n; k++) {
    const ox = k * 7 + 1, oy = 1;
    const strokes = 2 + Math.floor(rng() * 3);
    for (let s = 0; s < strokes; s++) {
      const a = P[Math.floor(rng() * P.length)], b = P[Math.floor(rng() * P.length)];
      const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
      for (let t = 0; t <= steps; t++) ctx.fillRect(ox + Math.round(a[0] + (b[0] - a[0]) * t / steps), oy + Math.round(a[1] + (b[1] - a[1]) * t / steps), 1, 1);
    }
  }
  const url = c.toDataURL();
  runeCache.set(seed, url);
  return url;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.layer = document.getElementById('screens');
    this.open = null;        // 'inventory' | 'workbench' | 'furnace' | 'pause' | 'death' | null
    this.cursor = null;      // stack held by the mouse
    this.craftGrid = [];
    this.craftW = 2;
    this.cursorEl = el('<div class="cursor-stack hidden"></div>');
    this.tooltipEl = el('<div class="tooltip hidden"></div>');
    setWornArmor(() => this.game.player.inventory.armor); // (set-bonus tooltips read what is worn)
    document.body.appendChild(this.cursorEl);
    document.body.appendChild(this.tooltipEl);
    // Enter, Space and the gamepad's A press a button with a click that has no mouse position (detail 0); many screens act on
    // mousedown, so that click is preceded by the mousedown a mouse would have sent
    this.layer.addEventListener('click', (e) => {
      if (e.detail !== 0 || !e.target.closest) return;
      const b = e.target.closest('button');
      if (b && !b.disabled) b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: e.shiftKey, button: 0 }));
    }, true);
    this.nav = new MenuNav(this.layer); // gamepad focus movement and the first control's focus (ui/menuNav.js)
    // the slot cursor: the tooltip of the slot under it shows beside it, and a stack held with A rides next to it
    this.layer.addEventListener('focusin', (e) => this.slotCursorMoved(e.target, true));
    this.layer.addEventListener('focusout', (e) => this.slotCursorMoved(e.target, false));
    if (typeof MutationObserver !== 'undefined') {
      // every screen gets its dialog role and labels, and the ones that read as menus open with focus on their first control
      new MutationObserver(() => { labelScreens(this.layer); if (AUTOFOCUS_SCREENS.has(this.open)) this.nav.autoFocus(); }).observe(this.layer, { childList: true });
    }
    window.addEventListener('mousemove', (e) => {
      this.cursorEl.style.left = e.clientX + 'px'; this.cursorEl.style.top = e.clientY + 'px';
      this.tooltipEl.style.left = e.clientX + 14 + 'px'; this.tooltipEl.style.top = e.clientY - 26 + 'px';
    });
  }

  get blocking() { return this.open !== null; }

  /** The slot cursor (a slot has focus) arrived on / left `el`: show or hide its tooltip, and park the held stack beside it. */
  slotCursorMoved(el, on) {
    if (!el || !el.classList || !el.classList.contains('slot')) return;
    if (!on) { el.dispatchEvent(new MouseEvent('mouseleave')); return; }
    const r = el.getBoundingClientRect();
    this.cursorEl.style.left = r.left + r.width * 0.72 + 'px'; this.cursorEl.style.top = r.top + r.height * 0.72 + 'px';
    el.dispatchEvent(new MouseEvent('mouseenter')); // (the same tooltip the mouse would show)
    if (this.tooltipEl.classList.contains('hidden')) return;
    const t = this.tooltipEl, tw = t.offsetWidth, th = t.offsetHeight;
    let x = r.right + 6, y = r.top;
    if (x + tw > innerWidth - 4) x = Math.max(4, r.left - tw - 6);
    if (y + th > innerHeight - 4) y = Math.max(4, innerHeight - th - 4);
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }

  /** Is the slot cursor on a slot of the open screen? (Y then quick-moves instead of closing the inventory.) */
  slotCursorActive() { return this.nav.onSlot(); }

  clear() { if (this.game.input) this.game.input.capture = null; /* a controls screen waiting for a key */ if (this.lazy) { this.lazy.dispose(); this.lazy = null; } this.layer.innerHTML = ''; this.padBack = null; this.padScroll = null; this.padTab = null; this.inGuide = false; this.inHelp = false; this.touchPreview = false; this.tooltipEl.classList.add('hidden'); }

  /** Gamepad on a sub-screen of the pause menu: B or Back returns to it, the left stick or D-pad scrolls. */
  padNav(pressed, ly) {
    if (this.padBack && (pressed.has('PadB') || pressed.has('PadBack'))) { const f = this.padBack; f(); return; }
    if (this.padTab && (pressed.has('PadLB') || pressed.has('PadRB'))) { this.padTab(pressed.has('PadRB') ? 1 : -1); return; }
    const step = ((pressed.has('PadDown') ? 1 : 0) - (pressed.has('PadUp') ? 1 : 0)) * 60 + (ly || 0) * 14;
    if (this.padScroll && step) this.padScroll(step);
  }

  /**
   * Gamepad on any open screen (called each frame from Game.loop): D-pad or left stick moves focus, A presses the focused
   * control, X presses it as a Shift-click (trade as often as affordable), B or Back goes back. Screens with a scrolling list
   * (Statistics, Milestones, Field Guide) keep their own scrolling and tab keys (padNav).
   */
  padMenu(pressed, pad) {
    if (!this.layer.firstChild || this.open === 'chat') return;
    const scrolling = !!this.padScroll;
    if (scrolling) this.padNav(pressed, pad.ly);
    if (!this.layer.firstChild) return;
    const r = this.nav.frame(pressed, pad, scrolling);
    if (r === 'back' && !scrolling) this.goBack();
  }

  /** What B does: the sub-screen's own way back, else resume from the pause menu, else close the screen. */
  goBack() {
    if (this.padBack) { const f = this.padBack; f(); return; }
    if (this.open === 'pause') { this.open = null; this.clear(); this.game.onUIClosed(); return; }
    if (this.open === 'death' || this.open === 'chat') return;
    this.close();
  }

  close() {
    if (this.open === 'death') return;
    if (this.open === 'sleep') { this.game.wakeUp(false); return; }
    if (this.open === 'chat') { this.game.chat.close(); this.open = null; this.game.onUIClosed(); return; }
    const g = this.game;
    // return crafting grid + cursor items
    const inv = g.player.inventory;
    const give = (st) => { if (!st) return; const left = inv.add(st); if (left) g.entities.spawnItem(g.player.x, g.player.y + 1, g.player.z, { ...st, count: left }); };
    for (const st of this.craftGrid) give(st);
    this.craftGrid = [];
    if (this.work) { for (const st of this.work) give(st); this.work = null; } // enchanting table / anvil inputs
    give(this.cursor); this.cursor = null;
    this.renderCursor();
    this.open = null;
    if ((this.chest || this.furnace || this.brewing) && g.net && g.net.isClient) g.net.closeContainer();
    if (this.chest) {
      this.game.audio.play('chest_close', [this.chest.x + 0.5, this.chest.y + 0.5, this.chest.z + 0.5]);
      if (this.game.hush) this.game.hush.emit('close', this.chest.x + 0.5, this.chest.y + 0.5, this.chest.z + 0.5); // a vibration (world/vibrations.js)
    }
    this.furnace = null;
    this.brewing = null;
    this.fxRefresh = null;
    this.chest = null;
    this.lectern = null;
    this.enchTick = null;
    this.refreshers = []; this.slotRefs = [];
    this.clear();
    g.onUIClosed();
  }

  // ---- generic slot handling -------------------------------------------------
  slotHTML(st) { return stackHTML(st); }

  renderCursor() {
    if (!this.cursor) { this.cursorEl.classList.add('hidden'); return; }
    this.cursorEl.classList.remove('hidden');
    const c = this.cursor, url = stackIconURL(c);
    this.cursorEl.innerHTML = `<img src="${url}">${hasEnch(c) ? `<div class="glint-fx" style="-webkit-mask-image:url(${url});mask-image:url(${url})"></div>` : ''}${c.count > 1 ? `<span class="count">${c.count}</span>` : ''}`;
  }

  showTooltip(html) { this.tooltipEl.innerHTML = html; this.tooltipEl.classList.remove('hidden'); }

  makeSlot(get, set, opts = {}) {
    const s = document.createElement('div');
    s.className = 'slot';
    s.tabIndex = -1; s.setAttribute('role', 'button'); // the slot cursor (ui/menuNav.js): D-pad / arrows move focus over the slots
    const refresh = () => {
      const st = get();
      s.innerHTML = this.slotHTML(st);
      s.setAttribute('aria-label', st && ITEMS[st.id] ? `${ITEMS[st.id].name}${st.count > 1 ? ' x' + st.count : ''}` : 'Empty slot');
    };
    if (!opts.lazy) refresh();
    const ref = { get, set, opts };
    (this.slotRefs = this.slotRefs || []).push(ref);
    s.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (this.game.net && this.game.net.uiBefore) this.game.net.uiBefore(); // shared containers: remember the state before the click
      const now = performance.now(), dbl = e.button === 0 && this.lastSlotClick && this.lastSlotClick.ref === ref && now - this.lastSlotClick.t < 300;
      this.lastSlotClick = { ref, t: now };
      if (dbl && this.cursor && !opts.onClick) this.gatherToCursor();
      else if (opts.onClick) opts.onClick(e); else this.clickSlot(get, set, e.button === 2, e.shiftKey, opts);
      this.dragPlaced = new Set([ref]);
      this.refreshAll();
    });
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    s.addEventListener('mouseenter', (e) => {
      // dragging with the right button held drops one item in every slot passed over
      if ((e.buttons & 2) && this.cursor && !opts.onClick && !opts.takeOnly && this.dragPlaced && !this.dragPlaced.has(ref)) {
        const st = get(), c = this.cursor;
        if ((!opts.filter || opts.filter(c)) && (!st || (canStack(st, c) && st.count < maxStack(st.id)))) {
          if (this.game.net && this.game.net.uiBefore) this.game.net.uiBefore();
          this.dragPlaced.add(ref);
          if (!st) set({ ...c, count: 1 }); else { st.count++; set(st); }
          c.count--;
          if (c.count <= 0) this.cursor = null;
          this.refreshAll();
        }
      }
      const st = get();
      if (st) this.showTooltip(tooltipHTML(st));
    });
    s.addEventListener('mouseleave', () => this.tooltipEl.classList.add('hidden'));
    if (opts.lazy) opts.lazy.add(s, refresh); // static catalogue slot: drawn when scrolled into view, never refreshed
    else this.refreshers.push(refresh);
    return s;
  }

  /** Double-click with a stack in hand: gather matching items from every slot on the screen into it. */
  gatherToCursor() {
    const c = this.cursor, max = maxStack(c.id);
    for (const r of this.slotRefs || []) {
      if (c.count >= max) break;
      if (r.opts.onClick || r.opts.takeOnly) continue;
      const st = r.get();
      if (!st || !canStack(st, c)) continue;
      const n = Math.min(st.count, max - c.count);
      c.count += n; st.count -= n;
      r.set(st.count > 0 ? st : null);
    }
  }

  clickSlot(get, set, right, shift, opts) {
    const st = get();
    if (shift && st && opts.quickMove) { opts.quickMove(); return; }
    const c = this.cursor;
    if (c && opts.filter && !opts.filter(c)) return; // e.g. only armour of the right kind fits an armour slot
    if (opts.takeOnly) { if (st && (!c || (canStack(c, st) && c.count + st.count <= maxStack(st.id)))) { this.cursor = c ? { ...c, count: c.count + st.count } : st; set(null); } return; }
    if (opts.single && c) {
      // one-item slots (enchanting table, anvil): place a single item, swap only single items
      if (!st) { set({ ...c, count: 1 }); c.count--; if (c.count <= 0) this.cursor = null; }
      else if (c.count === 1) { set(c); this.cursor = st; }
      return;
    }
    // Bundles (world/bundles.js): right-click a bundle with a stack to put it in, or with an empty
    // hand to take out the last thing put in; right-click a stack while carrying a bundle to scoop it up
    if (right) {
      const isB = (x) => !!(x && ITEMS[x.id] && ITEMS[x.id].bundle);
      if (isB(st) && c && (!isB(c) || (c !== st && !(c.bundle && c.bundle.length)))) {
        if (bundleInsert(st, c) > 0) { if (c.count <= 0) this.cursor = null; set(st); this.game.audio.play('pop'); }
        return;
      }
      if (isB(st) && !c) {
        const out = bundleTakeLast(st);
        if (out) { this.cursor = out; set(st); this.game.audio.play('pop'); }
        return;
      }
      if (isB(c) && st && !isB(st)) {
        if (bundleInsert(c, st) > 0) { set(st.count > 0 ? st : null); this.game.audio.play('pop'); }
        return;
      }
    }
    if (!right) {
      if (!c) { this.cursor = st; set(null); }
      else if (!st) { set(c); this.cursor = null; }
      else if (canStack(st, c)) {
        const n = Math.min(c.count, maxStack(st.id) - st.count);
        st.count += n; c.count -= n;
        if (c.count <= 0) this.cursor = null;
        set(st);
      } else { set(c); this.cursor = st; }
    } else {
      if (!c && st) {
        const half = Math.ceil(st.count / 2);
        this.cursor = { ...st, count: half };
        st.count -= half;
        set(st.count > 0 ? st : null);
      } else if (c && (!st || (canStack(st, c) && st.count < maxStack(st.id)))) {
        if (!st) set({ ...c, count: 1 }); else { st.count++; set(st); }
        c.count--;
        if (c.count <= 0) this.cursor = null;
      }
    }
  }

  refreshAll(fromNet = false) {
    for (const r of this.refreshers) r();
    this.renderCursor();
    this.game.player.inventory.changed();
    if (!fromNet && this.game.net && this.game.net.uiAfter) this.game.net.uiAfter(); // shared containers: send what changed
  }

  inventoryGrid(container) {
    const inv = this.game.player.inventory;
    const main = el('<div class="grid" style="grid-template-columns:repeat(9,var(--slot));margin-bottom:8px"></div>');
    const hot = el('<div class="grid" style="grid-template-columns:repeat(9,var(--slot))"></div>');
    const quick = (i) => () => {
      const st = inv.slots[i];
      if (!st) return;
      // armour goes straight to its (empty) armour slot
      const ad = ITEMS[st.id].armor;
      if (!container && ad && !inv.armor[ad.slot]) { inv.armor[ad.slot] = st; inv.slots[i] = null; this.game.audio.play('equip'); return; }
      // a trinket goes to a free trinket slot (not one of the same kind already worn)
      if (!container && isTrinket(st)) {
        const free = inv.trinkets.findIndex((t) => !t);
        if (free >= 0 && !inv.trinkets.some((t) => t && t.id === st.id)) { inv.trinkets[free] = { ...st, count: 1 }; if (--st.count <= 0) inv.slots[i] = null; this.game.audio.play('trinket_equip'); return; }
      }
      if (container && container.accept) {
        const r = container.accept(st); // true: all taken, 'partial': some taken (st.count reduced)
        if (r === true) { inv.slots[i] = null; return; }
        if (r === 'partial') return;
      }
      // hotbar <-> main
      const range = i < 9 ? [9, 36] : [0, 9];
      inv.slots[i] = null;
      let left = st.count;
      for (let k = range[0]; k < range[1] && left; k++) {
        const s = inv.slots[k];
        if (canStack(s, st)) { const n = Math.min(left, maxStack(s.id) - s.count); s.count += n; left -= n; }
      }
      for (let k = range[0]; k < range[1] && left; k++) if (!inv.slots[k]) { inv.slots[k] = { ...st, count: left }; left = 0; }
      if (left) inv.slots[i] = { ...st, count: left };
    };
    for (let i = 9; i < 36; i++) main.appendChild(this.makeSlot(() => inv.slots[i], (v) => { inv.slots[i] = v; }, { quickMove: quick(i) }));
    for (let i = 0; i < 9; i++) {
      const hs = this.makeSlot(() => inv.slots[i], (v) => { inv.slots[i] = v; }, { quickMove: quick(i) });
      if (i === inv.selected && this.open === 'inventory') hs.dataset.padStart = '1'; // the bag's slot cursor starts on the held slot (other screens: on their first control)
      hot.appendChild(hs);
    }
    const wrap = document.createElement('div');
    wrap.appendChild(main); wrap.appendChild(hot);
    return wrap;
  }

  craftingSection(w) {
    this.craftW = w;
    this.craftGrid = new Array(w * w).fill(null);
    const box = el('<div class="inv-top"></div>');
    const grid = el(`<div class="grid" style="grid-template-columns:repeat(${w},var(--slot))"></div>`);
    for (let i = 0; i < w * w; i++) grid.appendChild(this.makeSlot(() => this.craftGrid[i], (v) => { this.craftGrid[i] = v; }));
    box.appendChild(grid);
    box.appendChild(el('<div class="arrow">➜</div>'));
    const result = () => craft(this.craftGrid, w);
    // (a milk bucket leaves its empty bucket behind in the grid, a copied book stays)
    const consume = () => consumeCraft(this.craftGrid);
    this.side = this.recipeBook(w);
    box.appendChild(this.makeSlot(result, () => {}, {
      onClick: (e) => {
        const r = result();
        if (!r) return;
        const inv = this.game.player.inventory;
        if (e.shiftKey) {
          for (let n = 0; n < 64; n++) {
            const rr = result();
            if (!rr || !canStack(rr, r)) break;
            const left = inv.add({ ...rr, damage: 0 });
            consume();
            if (left) { this.game.entities.spawnItem(this.game.player.x, this.game.player.y + 1, this.game.player.z, { ...rr, count: left }); break; }
          }
        } else {
          const c = this.cursor;
          if (!c) this.cursor = { ...r, damage: 0 }; // (keeps a box's contents, a pot's sherds)
          else if (canStack(c, r) && c.count + r.count <= maxStack(r.id)) c.count += r.count;
          else return;
          consume();
        }
        this.game.audio.play('click');
      },
    }));
    return box;
  }

  /** Recipe book beside a crafting grid: green = craftable now; click lays the ingredients in. */
  recipeBook(w) {
    const inv = this.game.player.inventory;
    const book = el('<div class="panel recipe-book"><h3>Recipes</h3></div>');
    const opt = el('<label class="recipe-opt"><input type="checkbox" checked> Craftable only</label>');
    const list = el('<div class="grid recipe-list" style="grid-template-columns:repeat(5,var(--slot))"></div>');
    book.append(opt, list);
    const fits = RECIPES.map((r) => ({ r, layout: recipeLayout(r, w) })).filter((e) => e.layout);
    const available = () => [...inv.slots, ...this.craftGrid];
    const render = () => {
      list.innerHTML = '';
      const only = opt.firstChild.checked;
      for (const { r, layout } of fits) {
        const ok = !!chooseIngredients(layout, available());
        if (only && !ok) continue;
        const s = el(`<div class="slot recipe ${ok ? 'craftable' : 'missing'}">${this.slotHTML({ id: r.result, count: r.count })}</div>`);
        s.tabIndex = -1; s.setAttribute('role', 'button'); s.setAttribute('aria-label', 'Recipe: ' + ITEMS[r.result].name + (ok ? '' : ' (missing ingredients)'));
        s.addEventListener('mouseenter', () => { this.tooltipEl.textContent = ITEMS[r.result].name + (ok ? '' : ' (missing ingredients)'); this.tooltipEl.classList.remove('hidden'); });
        s.addEventListener('mouseleave', () => this.tooltipEl.classList.add('hidden'));
        s.addEventListener('mousedown', (e) => { e.preventDefault(); this.fillRecipe(layout, e.shiftKey ? 64 : 1); this.refreshAll(); });
        list.appendChild(s);
      }
    };
    opt.firstChild.addEventListener('change', render);
    const refresh = () => { const key = available().map((s) => (s ? s.id + ':' + s.count : '-')).join(); if (key !== refresh.key) { refresh.key = key; render(); } };
    this.refreshers.push(refresh);
    render();
    return book;
  }

  /** Move the grid back to the inventory and lay out `times` sets of a recipe's ingredients. */
  fillRecipe(layout, times) {
    const g = this.game, inv = g.player.inventory;
    for (let i = 0; i < this.craftGrid.length; i++) if (this.craftGrid[i]) { const left = inv.add(this.craftGrid[i]); if (left) g.entities.spawnItem(g.player.x, g.player.y + 1, g.player.z, { ...this.craftGrid[i], count: left }); this.craftGrid[i] = null; }
    for (let n = 0; n < times; n++) {
      const pick = chooseIngredients(layout, inv.slots);
      if (!pick) break;
      if (pick.some((id, i) => id != null && this.craftGrid[i] && this.craftGrid[i].count >= maxStack(id))) break;
      pick.forEach((id, i) => {
        if (id == null) return;
        const k = inv.slots.findIndex((s) => s && s.id === id);
        inv.slots[k].count--;
        if (inv.slots[k].count <= 0) inv.slots[k] = null;
        if (this.craftGrid[i]) this.craftGrid[i].count++; else this.craftGrid[i] = { id, count: 1, damage: 0 };
      });
    }
    g.audio.play('click');
  }

  showContainer(kind, title, inner) {
    this.clear();
    this.refreshers = []; this.slotRefs = [];
    this.open = kind;
    const panel = el(`<div class="panel"><h3>${title}</h3></div>`);
    const screen = el('<div class="screen" style="background:rgba(0,0,0,.35)"></div>');
    this.side = null; this.sideRight = null;
    inner(panel);
    if (this.side || this.sideRight) {
      const row = el('<div class="cont-row"></div>'); // (a phone in portrait stacks the recipe book under the panel: see style.css)
      if (this.side) row.append(this.side);
      row.append(panel);
      if (this.sideRight) row.append(this.sideRight);
      screen.appendChild(row);
    } else screen.appendChild(panel);
    screen.addEventListener('mousedown', (e) => {
      // clicking outside the panel drops the cursor stack
      if (e.target === screen && this.cursor) {
        const g = this.game, p = g.player;
        const [dx, , dz] = p.lookDir();
        g.entities.spawnItem(p.x, p.y + 1.3, p.z, this.cursor, [dx * 0.3, 0.1, dz * 0.3]).pickupDelay = 40;
        this.cursor = null; this.renderCursor();
      }
    });
    this.layer.appendChild(screen);
  }

  /** Four armour slots (helmet .. boots) that only accept matching armour. */
  armorColumn() {
    const inv = this.game.player.inventory;
    const col = el('<div class="grid armor-slots" style="grid-template-columns:var(--slot)"></div>');
    const labels = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
    for (let i = 0; i < 4; i++) {
      const s = this.makeSlot(() => inv.armor[i], (v) => { inv.armor[i] = v; if (v) this.game.audio.play('equip'); }, {
        filter: (st) => !!(ITEMS[st.id].armor && ITEMS[st.id].armor.slot === i),
        quickMove: () => { const st = inv.armor[i]; if (st && !inv.add(st)) inv.armor[i] = null; },
      });
      s.title = labels[i];
      s.classList.add('armor-slot', 'armor-' + i);
      col.appendChild(s);
    }
    return col;
  }

  /** Two trinket slots (player/trinkets.js): they only take trinkets. */
  trinketColumn() {
    const inv = this.game.player.inventory;
    if (!inv.trinkets) inv.trinkets = new Array(TRINKET_SLOTS).fill(null);
    const col = el('<div class="grid trinket-slots" style="grid-template-columns:var(--slot)"></div>');
    for (let i = 0; i < TRINKET_SLOTS; i++) {
      const s = this.makeSlot(() => inv.trinkets[i], (v) => { inv.trinkets[i] = v; if (v) this.game.audio.play('trinket_equip'); inv.changed(); }, {
        filter: (st) => isTrinket(st) && !inv.trinkets.some((t, j) => t && j !== i && t.id === st.id), // (a kind works once: no use wearing two)
        quickMove: () => { const st = inv.trinkets[i]; if (st && !inv.add(st)) inv.trinkets[i] = null; },
      });
      s.title = 'Trinket';
      s.classList.add('armor-slot', 'trinket-slot');
      col.appendChild(s);
    }
    return col;
  }

  /** The armour sets worn and the bonuses they have reached, and what the trinkets add. */
  setBonusPanel() {
    const inv = this.game.player.inventory;
    const box = el('<div class="set-bonuses"></div>');
    const render = () => {
      const sets = wornSets(inv.armor);
      let h = '';
      for (const set of sets) {
        h += `<div class="sb-head">${set.name} <span>${set.count}/${SET_PIECES}</span></div>`;
        for (const t of set.tiers) h += `<div class="sb-line${t.active ? ' on' : ''}">(${t.n}) ${t.text}</div>`;
      }
      box.innerHTML = h;
      box.style.display = h ? '' : 'none';
    };
    render();
    (this.refreshers = this.refreshers || []).push(render);
    return box;
  }

  openInventory() {
    this.showContainer('inventory', 'Inventory', (panel) => {
      const top = el('<div class="inv-top-row"></div>');
      top.appendChild(this.armorColumn());
      top.appendChild(this.trinketColumn());
      top.appendChild(this.craftingSection(2));
      panel.appendChild(top);
      panel.appendChild(this.setBonusPanel());
      panel.appendChild(this.inventoryGrid());
      panel.appendChild(el('<div class="recipes-hint">Tip: logs → planks → sticks / workbench. Shift-click moves stacks, right-click splits.</div>'));
      this.sideRight = this.effectPanel();
    });
  }

  /** The player's active effects beside the inventory (null when there are none). */
  effectPanel() {
    const fx = this.game.player.effects;
    if (!Object.keys(fx).length) return null;
    const box = el('<div class="panel effect-panel"><h3>Effects</h3></div>');
    const rows = new Map();
    const render = () => {
      for (const [n, e] of Object.entries(fx)) {
        let r = rows.get(n);
        if (!r) {
          r = el(`<div class="fx-row ${EFFECTS[n].good ? 'good' : 'bad'}"><img src="${effectIconURL(n)}"><div><div class="fx-name"></div><div class="fx-time"></div></div></div>`);
          rows.set(n, r); box.appendChild(r);
        }
        r.querySelector('.fx-name').textContent = effectLabel(n, e.amp);
        r.querySelector('.fx-time').textContent = formatTicks(e.ticks);
      }
      for (const [n, r] of rows) if (!fx[n]) { r.remove(); rows.delete(n); }
    };
    render();
    this.fxRefresh = render;
    return box;
  }

  /** Brewing Alembic: three vial slots, an ingredient, Ember Powder fuel; brews on the host in multiplayer. */
  openBrewing(x, y, z) {
    this.game.input.unlock();
    const s = this.game.getBrewingStand(x, y, z);
    this.brewing = s;
    if (this.game.net && this.game.net.isClient) this.game.net.openContainer('brewing', x, y, z, s); // the host's alembic
    const slot = (i, cls, filter) => {
      const e = this.makeSlot(() => s.slots[i], (v) => { s.slots[i] = v; }, {
        filter,
        quickMove: () => { const st = s.slots[i]; if (!st) return; const left = this.game.player.inventory.add(st); s.slots[i] = left ? { ...st, count: left } : null; },
      });
      e.classList.add(cls);
      return e;
    };
    this.showContainer('brewing', 'Brewing Alembic', (panel) => {
      const top = el('<div class="brew-top"></div>');
      const fuel = el('<div class="brew-fuel"></div>');
      const fuelSlot = slot(FUEL_SLOT, 'fuel', (st) => st.id === I.EMBER_POWDER);
      fuelSlot.title = 'Ember Powder (20 brews each)';
      const fuelBar = el('<div class="brew-fuelbar"><div></div></div>');
      fuel.append(fuelSlot, fuelBar);
      const main = el('<div class="brew-main"></div>');
      const bubbles = el('<div class="brew-bubbles"><div></div></div>');
      const arrow = el('<div class="brew-arrow"><div></div></div>');
      main.append(bubbles, slot(INGREDIENT_SLOT, 'ing', (st) => isIngredient(st.id)), arrow, el('<div class="brew-tubes"></div>'));
      for (const i of VIAL_SLOTS) main.appendChild(slot(i, 'v' + i, (st) => isVial(st.id) && st.count === 1));
      top.append(fuel, main);
      panel.appendChild(top);
      panel.appendChild(el('<div class="brew-hint">Water Vials + Cinderroot make a Murky Elixir, the base for effects.</div>'));
      panel.appendChild(this.inventoryGrid({
        accept: (st) => {
          if (st.id === I.EMBER_POWDER && (!s.slots[FUEL_SLOT] || s.slots[FUEL_SLOT].id === st.id)) {
            const cur = s.slots[FUEL_SLOT];
            const n = Math.min(st.count, 64 - (cur ? cur.count : 0));
            if (!n) return false;
            s.slots[FUEL_SLOT] = { ...st, count: (cur ? cur.count : 0) + n };
            if (n === st.count) return true;
            st.count -= n; return 'partial';
          }
          if (isVial(st.id)) {
            const i = VIAL_SLOTS.find((k) => !s.slots[k]);
            if (i === undefined) return false;
            s.slots[i] = { ...st, count: 1 };
            if (st.count === 1) return true;
            st.count -= 1; return 'partial';
          }
          if (isIngredient(st.id)) {
            const cur = s.slots[INGREDIENT_SLOT];
            if (cur && cur.id !== st.id) return false;
            const n = Math.min(st.count, 64 - (cur ? cur.count : 0));
            if (!n) return false;
            s.slots[INGREDIENT_SLOT] = { ...st, count: (cur ? cur.count : 0) + n };
            if (n === st.count) return true;
            st.count -= n; return 'partial';
          }
          return false;
        },
      }));
      this.refreshers.push(() => {
        fuelBar.firstChild.style.width = `${(s.fuel / BREWS_PER_POWDER) * 100}%`;
        const f = s.brewTime > 0 ? 1 - s.brewTime / BREW_TICKS : 0;
        arrow.firstChild.style.height = `${f * 100}%`;
        bubbles.firstChild.style.height = s.brewTime > 0 ? `${((BREW_TICKS - s.brewTime) % 60) / 60 * 100}%` : '0%';
      });
    });
  }

  openWorkbench() {
    this.game.input.unlock();
    this.showContainer('workbench', 'Workbench', (panel) => {
      panel.appendChild(this.craftingSection(3));
      panel.appendChild(this.inventoryGrid());
    });
  }

  openFurnace(x, y, z) {
    this.game.input.unlock();
    const f = this.game.getFurnace(x, y, z);
    this.furnace = f;
    if (this.game.net && this.game.net.isClient) this.game.net.openContainer('furnace', x, y, z, f); // the host's furnace
    const fuelOf = (st) => st && ITEMS[st.id] && ITEMS[st.id].fuel;
    const fid = this.game.world.getBlock(x, y, z), fname = BLOCKS[fid] ? BLOCKS[fid].name.replace(/^Lit /, '') : 'Furnace';
    this.showContainer('furnace', fname, (panel) => {
      const top = el('<div class="inv-top"></div>');
      const mid = el('<div class="furnace-mid"></div>');
      mid.appendChild(this.makeSlot(() => f.input, (v) => { f.input = v; }));
      const flame = el('<div class="flame"><div></div></div>');
      mid.appendChild(flame);
      mid.appendChild(this.makeSlot(() => f.fuel, (v) => { f.fuel = v; }));
      top.appendChild(mid);
      const prog = el('<div class="progress"><div></div></div>');
      top.appendChild(prog);
      top.appendChild(this.makeSlot(() => f.output, (v) => { f.output = v; }, { takeOnly: true }));
      panel.appendChild(top);
      panel.appendChild(this.inventoryGrid({
        accept: (st) => {
          if (fuelOf(st) && !f.fuel) { f.fuel = st; return true; }
          if (!f.input) { f.input = st; return true; }
          return false;
        },
      }));
      this.refreshers.push(() => {
        flame.firstChild.style.height = `${f.burnTotal ? (f.burnTime / f.burnTotal) * 100 : 0}%`;
        prog.firstChild.style.width = `${(f.cookTime / 200) * 100}%`;
      });
    });
  }

  openChest(x, y, z) {
    this.game.input.unlock();
    const halves = doubleChestHalves(this.game.world, x, y, z);
    const here = this.game.world.getBlock(x, y, z), hopper = here === B.HOPPER, disp = here === B.DISPENSER || here === B.DROPPER;
    if (!hopper && !disp && this.game.onboarding) this.game.onboarding.trigger('chest'); // first-time hint (player/onboarding.js)
    const c = halves ? doubleChestView(...halves.map((h) => this.game.getChest(h.x, h.y, h.z))) : hopper ? this.game.getHopper(x, y, z) : disp ? this.game.getDispenser(x, y, z) : this.game.getChest(x, y, z);
    const n = c.slots.length;
    const inv = this.game.player.inventory;
    /** Move a stack into a range of slots (merging first); returns what is left. */
    const insert = (slots, from, to, st) => {
      let left = st.count;
      for (let k = from; k < to && left; k++) {
        const s = slots[k];
        if (canStack(s, st)) { const n = Math.min(left, maxStack(s.id) - s.count); s.count += n; left -= n; }
      }
      for (let k = from; k < to && left; k++) if (!slots[k]) { slots[k] = { ...st, count: left }; left = 0; }
      return left;
    };
    // a Gloomshell Box holds anything but other boxes
    const box = isBox(this.game.world.getBlock(x, y, z));
    const fits = (st) => !box || !isBox(st.id);
    this.showContainer('chest', disp ? (here === B.DISPENSER ? 'Dispenser' : 'Dropper') : hopper ? 'Hopper' : box ? BLOCKS[this.game.world.getBlock(x, y, z)].name : halves ? 'Large Chest' : this.game.world.getBlock(x, y, z) === B.BARREL ? 'Barrel' : 'Chest', (panel) => {
      const grid = el(`<div class="grid" style="grid-template-columns:repeat(${disp ? 3 : Math.min(9, n)},var(--slot));margin:0 auto 12px;width:max-content"></div>`);
      for (let i = 0; i < n; i++) {
        grid.appendChild(this.makeSlot(() => c.slots[i], (v) => { c.slots[i] = v; }, {
          filter: fits,
          quickMove: () => {
            const st = c.slots[i];
            const left = insert(inv.slots, 0, 36, st);
            c.slots[i] = left ? { ...st, count: left } : null;
          },
        }));
      }
      panel.appendChild(grid);
      panel.appendChild(this.inventoryGrid({
        accept: (st) => {
          if (!fits(st)) return false;
          const left = insert(c.slots, 0, n, st);
          if (left === st.count) return false;
          if (left) { st.count = left; return 'partial'; }
          return true;
        },
      }));
    });
    this.chest = c;
    if (this.game.net && this.game.net.isClient) this.game.net.openContainer(halves ? 'chest2' : 'chest', c.x, c.y, c.z, c); // the host's chest
  }

  /** The 27-slot storage of a Chest Boat or a Minecart with Chest (the same screen as a chest; a guest asks the host through the 'cargo' container). */
  openCargo(boat) {
    const c = boat.cargo;
    if (!c) return;
    this.game.input.unlock();
    const inv = this.game.player.inventory, n = c.slots.length;
    /** Move a stack into the cargo (merging first); returns what is left. */
    const insert = (slots, from, to, st) => {
      let left = st.count;
      for (let k = from; k < to && left; k++) {
        const s = slots[k];
        if (canStack(s, st)) { const q = Math.min(left, maxStack(s.id) - s.count); s.count += q; left -= q; }
      }
      for (let k = from; k < to && left; k++) if (!slots[k]) { slots[k] = { ...st, count: left }; left = 0; }
      return left;
    };
    this.showContainer('chest', boat.cart ? 'Minecart with Chest' : 'Chest Boat', (panel) => {
      const grid = el(`<div class="grid" style="grid-template-columns:repeat(9,var(--slot));margin:0 auto 12px;width:max-content"></div>`);
      for (let i = 0; i < n; i++) {
        grid.appendChild(this.makeSlot(() => c.slots[i], (v) => { c.slots[i] = v; }, {
          quickMove: () => { const st = c.slots[i]; const left = insert(inv.slots, 0, 36, st); c.slots[i] = left ? { ...st, count: left } : null; },
        }));
      }
      panel.appendChild(grid);
      panel.appendChild(this.inventoryGrid({
        accept: (st) => {
          const left = insert(c.slots, 0, n, st);
          if (left === st.count) return false;
          if (left) { st.count = left; return 'partial'; }
          return true;
        },
      }));
    });
    c.x = boat.x - 0.5; c.y = boat.y; c.z = boat.z - 0.5; // (where the closing sound comes from; the screen reads a chest's position)
    this.chest = c;
    this.game.audio.play('chest_open', [boat.x, boat.y + 0.5, boat.z]);
    if (this.game.net && this.game.net.isClient) this.game.net.openContainer('cargo', boat.netId, 0, 0, c); // the host's cargo
  }

  /** A single-item work slot (enchanting table / anvil) whose stack lives in this.work[i]. */
  workSlot(i, opts = {}) {
    const inv = this.game.player.inventory;
    return this.makeSlot(() => this.work[i], (v) => { this.work[i] = v; }, {
      single: opts.single, filter: opts.filter,
      quickMove: () => { const st = this.work[i]; if (!st) return; const left = inv.add(st); this.work[i] = left ? { ...st, count: left } : null; },
    });
  }

  /** Enchanting table: an item, Azurite and three offers powered by nearby bookshelves. */
  openEnchanting(x, y, z) {
    this.game.input.unlock();
    const g = this.game, p = g.player, inv = p.inventory;
    this.work = [null, null]; // [item, azurite]
    const shelves = () => countBookshelves((a, b, c) => g.world.getBlock(a, b, c), x, y, z);
    this.showContainer('enchanting', 'Enchant', (panel) => {
      const top = el('<div class="ench-top"></div>');
      const left = el('<div class="ench-inputs"></div>');
      const book = el('<div class="ench-book"><div class="pg l"></div><div class="pg r"></div></div>');
      left.appendChild(book);
      const slots = el('<div class="ench-slots"></div>');
      const itemSlot = this.workSlot(0, { single: true, filter: (st) => isEnchantable({ ...st, count: 1 }) });
      itemSlot.title = 'Item to enchant';
      const azSlot = this.workSlot(1, { filter: (st) => st.id === I.AZURITE });
      azSlot.classList.add('azurite-slot');
      azSlot.title = 'Azurite';
      slots.append(itemSlot, azSlot);
      left.appendChild(slots);
      top.appendChild(left);
      const offersEl = el('<div class="ench-offers"></div>');
      top.appendChild(offersEl);
      panel.appendChild(top);
      const info = el('<div class="recipes-hint ench-info"></div>');
      panel.appendChild(info);
      const rows = [0, 1, 2].map((slot) => {
        const row = el(`<button class="ench-offer"><img class="runes"><span class="req"><span class="az">${slot + 1}</span></span><span class="cost"></span></button>`);
        row.addEventListener('mouseenter', () => { if (row.tip) this.showTooltip(row.tip); });
        row.addEventListener('mouseleave', () => this.tooltipEl.classList.add('hidden'));
        row.addEventListener('mousedown', (e) => { e.preventDefault(); this.enchantPick(slot, shelves()); this.refreshAll(); if (row.tip) this.showTooltip(row.tip); });
        offersEl.appendChild(row);
        return row;
      });
      let key = '';
      this.refreshers.push(() => {
        const st = this.work[0], n = shelves();
        info.textContent = `Bookshelves: ${Math.min(15, n)} / 15  ·  Level ${p.xp.level}`;
        const k = `${st ? st.id : -1}:${p.enchSeed}:${n}:${p.xp.level}:${this.work[1] ? this.work[1].count : 0}`;
        if (k === key) return;
        key = k;
        const offers = st && isEnchantable(st) ? tableOffers(st.id, p.enchSeed, n) : [null, null, null];
        const az = this.work[1] ? this.work[1].count : 0;
        rows.forEach((row, slot) => {
          const o = offers[slot];
          const ok = !!o && (p.creative || (az >= slot + 1 && p.xp.level >= o.cost));
          row.disabled = !o;
          row.classList.toggle('locked', !!o && !ok);
          row.querySelector('.cost').textContent = o ? o.cost : '';
          const runes = row.querySelector('.runes');
          if (o) runes.src = runeStrip(p.enchSeed * 3 + slot); else runes.removeAttribute('src');
          runes.style.visibility = o ? 'visible' : 'hidden';
          row.querySelector('.req').style.visibility = o ? 'visible' : 'hidden';
          if (!o) { row.tip = null; return; }
          const lack = [];
          if (!p.creative && p.xp.level < o.cost) lack.push(`Level ${o.cost} required`);
          if (!p.creative && az < slot + 1) lack.push(`${slot + 1} Azurite needed`);
          row.tip = `<div class="tt-name ench">${enchName(o.hint[0], o.hint[1])} . . . ?</div>`
            + `<div class="tt-ench">${slot + 1} Azurite, ${slot + 1} Level${slot ? 's' : ''}</div>`
            + lack.map((l) => `<div class="tt-bad">${l}</div>`).join('');
        });
      });
      panel.appendChild(this.inventoryGrid({
        accept: (st) => {
          if (st.id === I.AZURITE) {
            if (!this.work[1]) { this.work[1] = st; return true; }
            if (canStack(this.work[1], st)) {
              const n = Math.min(st.count, maxStack(st.id) - this.work[1].count);
              this.work[1].count += n; st.count -= n;
              return st.count <= 0 ? true : n ? 'partial' : false;
            }
            return false;
          }
          if (!this.work[0] && isEnchantable({ ...st, count: 1 })) {
            this.work[0] = { ...st, count: 1 };
            st.count--;
            return st.count <= 0 ? true : 'partial';
          }
          return false;
        },
      }));
      // the little book on the screen flutters its pages
      this.enchTick = () => { book.style.setProperty('--flip', String(Math.sin(performance.now() / 380) * 0.5 + 0.5)); };
    });
    this.refreshAll();
  }

  /** Take enchanting offer `slot`: pay levels and azurite, roll the enchantments. */
  enchantPick(slot, shelves) {
    const g = this.game, p = g.player, st = this.work[0];
    if (!st || !isEnchantable(st)) return;
    const o = tableOffers(st.id, p.enchSeed, shelves)[slot];
    if (!o) return;
    const az = this.work[1] ? this.work[1].count : 0;
    if (!p.creative && (az < slot + 1 || p.xp.level < o.cost)) return;
    this.work[0] = applyOffer(st, rollOffer(st.id, p.enchSeed, slot, o.cost));
    if (!p.creative) {
      spendLevels(p.xp, slot + 1);
      this.work[1].count -= slot + 1;
      if (this.work[1].count <= 0) this.work[1] = null;
    }
    p.enchSeed = (Math.random() * 0x7fffffff) | 0;
    g.audio.play('enchant');
    if (g.milestones) g.milestones.event('enchant');
  }

  /** Anvil: repair two of the same item (or with its material) and apply enchanted books. */
  openAnvil(x, y, z) {
    this.game.input.unlock();
    const g = this.game, p = g.player, inv = p.inventory;
    this.work = [null, null];
    const combine = () => (this.work ? anvilCombine(this.work[0], this.work[1]) : null);
    this.showContainer('anvil', 'Repair &amp; Enchant', (panel) => {
      const top = el('<div class="inv-top anvil-top"></div>');
      const a = this.workSlot(0, { single: true }), b = this.workSlot(1);
      top.append(a, el('<div class="plus">+</div>'), b, el('<div class="arrow">➜</div>'));
      const out = this.makeSlot(() => { const r = combine(); return r ? r.result : null; }, () => {}, {
        onClick: (e) => this.anvilTake(x, y, z, e.shiftKey),
      });
      out.classList.add('anvil-out');
      top.appendChild(out);
      panel.appendChild(top);
      const cost = el('<div class="anvil-cost"></div>');
      panel.appendChild(cost);
      this.refreshers.push(() => {
        const r = combine();
        const too = r && r.cost >= ANVIL_MAX_COST && !p.creative;
        cost.className = 'anvil-cost' + (!r ? '' : too || (!p.creative && p.xp.level < r.cost) ? ' bad' : ' ok');
        cost.textContent = !r ? (this.work && this.work[0] && this.work[1] ? 'These cannot be combined' : 'Put an item on the left, and a matching item, its material, a tempering material (Slagsteel Ingots, Dirge Crystals, a Colossus Core) or an Enchanted Book on the right')
          : too ? 'Too Expensive!' : `Level cost: ${r.cost}`;
        out.classList.toggle('blocked', !!r && (too || (!p.creative && p.xp.level < r.cost)));
      });
      panel.appendChild(this.inventoryGrid({
        accept: (st) => {
          if (!this.work[0] && ITEMS[st.id] && (ITEMS[st.id].durability || st.id === I.ENCHANTED_BOOK)) { this.work[0] = { ...st, count: 1 }; st.count--; return st.count <= 0 ? true : 'partial'; }
          if (!this.work[1]) { this.work[1] = st; return true; }
          return false;
        },
      }));
    });
    this.refreshAll();
  }

  anvilTake(x, y, z, shift) {
    const g = this.game, p = g.player, inv = p.inventory;
    const r = this.work && anvilCombine(this.work[0], this.work[1]);
    if (!r) return;
    if (!p.creative && (r.cost >= ANVIL_MAX_COST || p.xp.level < r.cost)) return;
    if (shift) { if (inv.add(r.result)) return; } // no room: nothing happens
    else if (this.cursor) return;
    else this.cursor = r.result;
    this.work[0] = null;
    const right = this.work[1];
    right.count -= r.use;
    if (right.count <= 0) this.work[1] = null;
    if (!p.creative) spendLevels(p.xp, r.cost);
    g.audio.play('anvil', [x + 0.5, y + 0.5, z + 0.5]);
    if (g.milestones) { g.milestones.event('anvil'); if (r.temper) g.milestones.event('temper'); }
    // 12 % chance the anvil wears a step (meta bits 1-2); worn out three times, it breaks
    const w = g.world;
    if (!p.creative && w.getBlock(x, y, z) === B.ANVIL && Math.random() < 0.12) {
      const m = w.getMeta(x, y, z), wear = ((m >> 1) & 3) + 1;
      if (wear > 2) {
        w.setBlockUrgent(x, y, z, B.AIR);
        g.audio.play('break_metal', [x + 0.5, y + 0.5, z + 0.5]);
        this.close();
      } else w.setBlockUrgent(x, y, z, B.ANVIL, (m & 1) | (wear << 1));
    }
  }

  /** Beacon: pick a primary power (and at level 4 a secondary one), paying an ingot, diamond or beryl. */
  openBeacon(x, y, z) {
    this.game.input.unlock();
    const g = this.game, w = g.world;
    this.work = [null];
    const cur = w.getMeta(x, y, z);
    let primary = BEACON_POWERS[cur & 7], secondary = (cur >> 3) & 3;
    this.showContainer('beacon', 'Beacon', (panel) => {
      const info = el('<div class="recipes-hint beacon-info"></div>');
      panel.appendChild(info);
      const rows = el('<div class="beacon-powers"></div>');
      const prim = el('<div class="beacon-col"><div class="beacon-head">Primary Power</div></div>');
      const sec = el('<div class="beacon-col"><div class="beacon-head">Secondary Power</div></div>');
      const button = (name, label, onPick) => {
        const b = el(`<button class="beacon-power" title="${label}"><img src="${effectIconURL(name)}"></button>`);
        b.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(); this.refreshAll(); });
        return b;
      };
      const primBtns = BEACON_POWERS.slice(1).map((name) => {
        const b = button(name, EFFECTS[name].name, () => { primary = name; });
        b.dataset.power = name; prim.appendChild(b); return b;
      });
      const regen = button('regeneration', 'Regeneration', () => { secondary = SECONDARY.REGENERATION; });
      const boost = el('<button class="beacon-power boost" title="Primary power II"><b>II</b></button>');
      boost.addEventListener('mousedown', (e) => { e.preventDefault(); secondary = SECONDARY.BOOST; this.refreshAll(); });
      sec.append(regen, boost);
      rows.append(prim, sec);
      panel.appendChild(rows);
      const pay = el('<div class="beacon-pay"></div>');
      const slot = this.workSlot(0, { single: true, filter: (st) => BEACON_PAYMENT.has(st.id) });
      slot.title = 'Payment: an iron or gold ingot, a diamond or a beryl';
      const ok = el('<button class="btn beacon-ok">Confirm</button>');
      ok.addEventListener('click', () => {
        const level = beaconLevel(w, x, y, z);
        if (!this.work[0] || !primary || POWER_LEVEL[primary] > level) return;
        w.setBlockUrgent(x, y, z, B.BEACON, beaconMeta(primary, level >= 4 ? secondary : 0));
        this.work[0] = null;
        g.audio.play('levelup', [x + 0.5, y + 0.5, z + 0.5]);
        if (g.milestones) g.milestones.event('beacon');
        this.close();
      });
      pay.append(slot, ok);
      panel.appendChild(pay);
      this.refreshers.push(() => {
        const level = beaconLevel(w, x, y, z), lit = level > 0 && !!beamColor(w, x, y, z);
        info.textContent = !level ? 'Build a pyramid of iron, gold, diamond or beryl blocks under the beacon' : `Pyramid level ${level}${lit ? '' : ' · the beam is blocked'}  ·  range ${beaconRange(level)} blocks`;
        for (const b of primBtns) { b.disabled = POWER_LEVEL[b.dataset.power] > level; b.classList.toggle('on', primary === b.dataset.power); }
        regen.disabled = boost.disabled = level < 4;
        regen.classList.toggle('on', level >= 4 && secondary === SECONDARY.REGENERATION);
        boost.classList.toggle('on', level >= 4 && secondary === SECONDARY.BOOST);
        ok.disabled = !this.work[0] || !primary || POWER_LEVEL[primary] > level;
      });
      panel.appendChild(this.inventoryGrid({
        accept: (st) => { if (!this.work[0] && BEACON_PAYMENT.has(st.id)) { this.work[0] = { ...st, count: 1 }; st.count--; return st.count <= 0 ? true : 'partial'; } return false; },
      }));
    });
    this.refreshAll();
  }

  /** Grindstone: two of a kind merge (with a 5 % bonus); enchantments other than curses come off for some experience. */
  openGrindstone(x, y, z) {
    this.game.input.unlock();
    this.work = [null, null];
    const result = () => (this.work ? grindstoneResult(this.work[0], this.work[1]) : null);
    this.showContainer('grindstone', 'Repair &amp; Disenchant', (panel) => {
      const top = el('<div class="inv-top grind-top"></div>');
      const ins = el('<div class="grind-ins"></div>');
      for (const i of [0, 1]) ins.appendChild(this.workSlot(i, { single: true, filter: grindstoneAccepts }));
      top.append(ins, el('<div class="arrow">➜</div>'));
      const out = this.makeSlot(() => { const r = result(); return r ? r.result : null; }, () => {}, { onClick: (e) => this.grindstoneTake(x, y, z, e.shiftKey) });
      top.appendChild(out);
      panel.appendChild(top);
      const hint = el('<div class="recipes-hint grind-hint"></div>');
      panel.appendChild(hint);
      this.refreshers.push(() => {
        const r = result(), w = this.work || [];
        hint.textContent = r ? (r.xp[1] > 0 ? `Removes enchantments · ${r.xp[0]}–${r.xp[1]} experience` : 'Repairs the pair (+5 %)')
          : w[0] || w[1] ? 'These cannot be ground' : 'Two of the same item to repair them, or one enchanted item to strip it';
      });
      panel.appendChild(this.inventoryGrid({
        accept: (st) => {
          if (!grindstoneAccepts(st)) return false;
          const i = !this.work[0] ? 0 : !this.work[1] ? 1 : -1;
          if (i < 0) return false;
          this.work[i] = { ...st, count: 1 }; st.count--;
          return st.count <= 0 ? true : 'partial';
        },
      }));
    });
    this.refreshAll();
  }

  grindstoneTake(x, y, z, shift) {
    const g = this.game, inv = g.player.inventory;
    const r = this.work && grindstoneResult(this.work[0], this.work[1]);
    if (!r) return;
    if (shift) { if (inv.add({ ...r.result })) return; } // no room: nothing happens
    else if (this.cursor) return;
    else this.cursor = r.result;
    this.work[0] = this.work[1] = null;
    const xp = grindstoneXp(r);
    if (xp > 0) g.entities.spawnXp(x + 0.5, y + 1.1, z + 0.5, xp);
    g.audio.play('grind', [x + 0.5, y + 0.5, z + 0.5]);
  }

  /** Loom: wool or carpets and a dye in, up to eight of the cloth in the dye's colour out. */
  openLoom(x, y, z) {
    this.game.input.unlock();
    const g = this.game, inv = g.player.inventory;
    this.work = [null, null]; // [cloth, dye]
    const result = () => (this.work ? loomResult(this.work[0], this.work[1]) : null);
    const take = (shift) => {
      const r = result();
      if (!r) return;
      if (shift) { const left = inv.add({ ...r.result }); if (left) g.entities.spawnItem(g.player.x, g.player.y + 1, g.player.z, { ...r.result, count: left }); }
      else if (!this.cursor) this.cursor = { ...r.result };
      else if (canStack(this.cursor, r.result) && this.cursor.count + r.result.count <= maxStack(r.result.id)) this.cursor.count += r.result.count;
      else return;
      if ((this.work[0].count -= r.cloth) <= 0) this.work[0] = null;
      if (--this.work[1].count <= 0) this.work[1] = null;
      g.audio.play('shear', [x + 0.5, y + 0.5, z + 0.5]);
    };
    this.showContainer('loom', 'Loom', (panel) => {
      const top = el('<div class="inv-top grind-top loom-top"></div>');
      const ins = el('<div class="grind-ins"></div>');
      const cloth = this.workSlot(0, { filter: loomAcceptsCloth }), dye = this.workSlot(1, { filter: loomAcceptsDye });
      cloth.title = 'Wool or carpets'; dye.title = 'A dye (Bone Meal bleaches)';
      ins.append(cloth, dye);
      top.append(ins, el('<div class="arrow">➜</div>'));
      top.appendChild(this.makeSlot(() => { const r = result(); return r ? r.result : null; }, () => {}, { onClick: (e) => take(e.shiftKey) }));
      panel.appendChild(top);
      const hint = el('<div class="recipes-hint grind-hint"></div>');
      panel.appendChild(hint);
      this.refreshers.push(() => {
        const w = this.work || [];
        hint.textContent = result() ? `One dye recolours up to ${LOOM_BATCH}` : w[0] && w[1] ? 'Already that colour' : 'Wool or carpets above, a dye below';
      });
      panel.appendChild(this.inventoryGrid({
        accept: (st) => {
          const i = loomAcceptsCloth(st) ? 0 : loomAcceptsDye(st) ? 1 : -1;
          if (i < 0) return false;
          if (!this.work[i]) { this.work[i] = st; return true; }
          if (canStack(this.work[i], st)) {
            const n = Math.min(st.count, maxStack(st.id) - this.work[i].count);
            this.work[i].count += n; st.count -= n;
            return st.count <= 0 ? true : n ? 'partial' : false;
          }
          return false;
        },
      }));
    });
    this.refreshAll();
  }

  /** Stonecutter: one stone block in, pick one of the shapes it cuts into. */
  openStonecutter(x, y, z) {
    this.game.input.unlock();
    const g = this.game, inv = g.player.inventory;
    this.work = [null];
    let sel = -1, selFor = null;
    const options = () => (this.work && this.work[0] ? stonecutterOutputs(this.work[0].id) : []);
    const chosen = () => { const o = options(); return this.work && this.work[0] && selFor === this.work[0].id && o[sel] ? o[sel] : null; };
    this.showContainer('stonecutter', 'Stonecutter', (panel) => {
      const top = el('<div class="inv-top cutter-top"></div>');
      top.appendChild(this.workSlot(0, { filter: stonecutterAccepts }));
      const list = el('<div class="cutter-list"></div>');
      top.append(list, el('<div class="arrow">➜</div>'));
      const take = (shift) => {
        const o = chosen();
        if (!o) return;
        for (let n = 0; n < (shift ? 64 : 1) && this.work[0]; n++) {
          const st = { id: o.id, count: o.count, damage: 0 };
          if (shift) { const left = inv.add(st); if (left) { g.entities.spawnItem(g.player.x, g.player.y + 1, g.player.z, { ...st, count: left }); n = 64; } }
          else if (!this.cursor) this.cursor = st;
          else if (this.cursor.id === o.id && !this.cursor.ench && this.cursor.count + o.count <= maxStack(o.id)) this.cursor.count += o.count;
          else return;
          if (--this.work[0].count <= 0) this.work[0] = null;
        }
        g.audio.play('saw', [x + 0.5, y + 0.5, z + 0.5]);
      };
      top.appendChild(this.makeSlot(() => { const o = chosen(); return o ? { id: o.id, count: o.count, damage: 0 } : null; }, () => {}, { onClick: (e) => take(e.shiftKey) }));
      panel.appendChild(top);
      const hint = el('<div class="recipes-hint cutter-hint"></div>');
      panel.appendChild(hint);
      let key = '';
      this.refreshers.push(() => {
        const st = this.work && this.work[0], o = options();
        if (st && selFor !== st.id) { selFor = st.id; sel = -1; }
        hint.textContent = !st ? 'Put in a stone block to cut' : sel < 0 ? 'Pick what to cut it into' : `${ITEMS[o[sel].id].name}${o[sel].count > 1 ? ' ×' + o[sel].count : ''}`;
        const k = `${st ? st.id : -1}:${sel}`;
        if (k === key) return;
        key = k;
        list.innerHTML = '';
        o.forEach((r, i) => {
          const b = el(`<div class="slot cutter-opt${i === sel ? ' on' : ''}">${this.slotHTML({ id: r.id, count: r.count })}</div>`);
          b.tabIndex = -1; b.setAttribute('role', 'button'); b.setAttribute('aria-label', ITEMS[r.id].name + (r.count > 1 ? ' x' + r.count : ''));
          b.addEventListener('mouseenter', () => this.showTooltip(ITEMS[r.id].name + (r.count > 1 ? ' ×' + r.count : '')));
          b.addEventListener('mouseleave', () => this.tooltipEl.classList.add('hidden'));
          b.addEventListener('mousedown', (e) => { e.preventDefault(); sel = i; g.audio.play('click'); this.refreshAll(); });
          list.appendChild(b);
        });
      });
      panel.appendChild(this.inventoryGrid({
        accept: (st) => {
          if (!stonecutterAccepts(st)) return false;
          if (!this.work[0]) { this.work[0] = st; return true; }
          if (canStack(this.work[0], st)) {
            const n = Math.min(st.count, maxStack(st.id) - this.work[0].count);
            this.work[0].count += n; st.count -= n;
            return st.count <= 0 ? true : n ? 'partial' : false;
          }
          return false;
        },
      }));
    });
    this.refreshAll();
  }

  /** The emote wheel (V): click an emote or press its number. */
  openEmotes() {
    this.clear();
    this.open = 'emotes';
    this.game.input.unlock();
    const s = el('<div class="screen emote-screen"><h2>Emote</h2><div class="emote-wheel" role="group" aria-label="Emotes"></div><p class="sub">Click one or press 1-3, or use the D-pad and A - they show on your body for the others</p></div>');
    const wheel = s.querySelector('.emote-wheel');
    EMOTES.forEach((k, i) => {
      const b = el(`<button class="btn emote-btn" style="--a:${Math.round(-90 + i * 360 / EMOTES.length)}deg"><b>${i + 1}</b> ${EMOTE_LABELS[k]}</button>`);
      b.onclick = () => this.pickEmote(k);
      wheel.appendChild(b);
    });
    this.layer.appendChild(s);
  }

  pickEmote(kind) {
    this.close();
    if (this.game.net) this.game.net.emote(kind);
  }

  openChat(prefix = '') {
    this.open = 'chat';
    this.game.input.unlock();
    this.game.chat.open(prefix);
  }

  /** Creative mode: every item, a search box and the hotbar. Click takes a full stack. */
  openCreative() {
    this.game.input.unlock();
    const g = this.game, inv = g.player.inventory;
    const CREATIVE_FIRST_ROWS = 6; // rows drawn at once on opening; the rest follow as they scroll into view
    const hidden = new Set([B.AIR, B.CINDERROOT, B.WATER, B.LAVA, B.FURNACE_LIT, B.SMOKER_LIT, B.BLAST_FURNACE_LIT, B.WHEAT, B.CARROTS, B.POTATOES, B.BEETROOTS, B.MELON_STEM, B.PUMPKIN_STEM, B.DOOR, B.BED, B.FIRE, B.PAINTING, B.PAINTING_B, B.OAK_WALL_SIGN, B.COCOA, B.FROSTROOTS, B.SUNGOURD_STEM]);
    for (const b of BLOCKS) if (b && b.doorItem) hidden.add(b.id); // doors are placed from their door items
    const all = ITEMS.filter((d) => d && d.id && !hidden.has(d.id) && !(d.block && BLOCKS[d.block] && BLOCKS[d.block].hidden));
    this.showContainer('creative', 'Creative Inventory', (panel) => {
      const search = el('<input class="creative-search" placeholder="Search items...">');
      search.addEventListener('keydown', (e) => e.stopPropagation());
      search.addEventListener('keyup', (e) => e.stopPropagation());
      const grid = el('<div class="grid creative-grid" style="grid-template-columns:repeat(9,var(--slot))"></div>');
      const lazy = this.lazy = createLazyRenderer({ root: grid }); // icons are drawn only for the rows in view
      const fill = () => {
        lazy.reset();
        this.slotRefs = this.slotRefs.filter((r) => !r.opts.catalog);
        grid.innerHTML = '';
        const q = search.value.trim().toLowerCase();
        for (const d of all) {
          if (q && !d.name.toLowerCase().includes(q)) continue;
          grid.appendChild(this.makeSlot(() => ({ id: d.id, count: 1 }), () => {}, {
            lazy, catalog: true,
            onClick: (e) => {
              if (this.cursor) { this.cursor = null; return; } // clicking the catalogue deletes the held stack
              const st = { id: d.id, count: e.button === 2 ? 1 : maxStack(d.id), damage: 0 };
              if (e.shiftKey) { inv.add(st); return; }
              this.cursor = st;
            },
          }));
        }
        lazy.flush(CREATIVE_FIRST_ROWS * 9);
      };
      search.addEventListener('input', () => { fill(); this.refreshAll(); });
      fill();
      panel.appendChild(search);
      panel.appendChild(grid);
      const hot = el('<div class="grid" style="grid-template-columns:repeat(9,var(--slot))"></div>');
      for (let i = 0; i < 9; i++) hot.appendChild(this.makeSlot(() => inv.slots[i], (v) => { inv.slots[i] = v; }));
      panel.appendChild(hot);
      setTimeout(() => search.focus(), 0);
    });
  }

  /**
   * Trading with a settler: each offer row shows price -> goods; click to trade. Under the title: the settler's level with a
   * bar towards the next one (more trades unlock better offers), what the village thinks of you (it moves prices) and a
   * button to give the settler the item in your hand. Prices climb with every use of an offer until the next restock.
   */
  openTrade(mob) {
    this.game.input.unlock();
    if (this.game.onboarding) this.game.onboarding.trigger('trade'); // first-time hint (player/onboarding.js)
    const g = this.game, inv = g.player.inventory, trader = !!mob.def.trader;
    const title = trader ? mob.def.name : `${mob.profession[0].toUpperCase() + mob.profession.slice(1)} Settler`;
    // Village Champions pay less (a guest pays from its own inventory, so its own effect sets the price)
    const cut = championDiscount(g.player.effects);
    const key = trader ? null : (mob.villageId ? mob.villageId(g) : mob.village) || null;
    const market = () => tradeMarket(g, key, g.player); // reputation, and the Lantern Festival's cut (world/events.js)
    const price = (o) => offerPrice(o, cut, market());
    this.showContainer('trade', title, (panel) => {
      let bar = null, repLine = null, gift = null;
      if (!trader) {
        const head = el('<div class="trade-head"><div class="trade-level"><span class="trade-level-name"></span><div class="trade-bar" role="progressbar" aria-label="Progress to the next settler level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="trade-bar-fill"></div></div><span class="trade-level-count"></span></div><div class="trade-rep" role="status"></div></div>');
        bar = head.querySelector('.trade-level');
        repLine = head.querySelector('.trade-rep');
        gift = el('<button class="btn trade-gift"></button>');
        head.appendChild(gift);
        panel.appendChild(head);
      }
      const list = el('<div class="trade-list"></div>');
      mob.trades.forEach((o) => {
        const row = el(`<div class="trade-row" role="group">
          <div class="slot price"></div><span class="price-cue" aria-hidden="true"></span>
          <div class="arrow" aria-hidden="true">➜</div>
          <div class="slot">${this.slotHTML({ id: o.get, count: o.getCount })}</div>
          <span class="trade-name"></span><button class="btn trade-btn">Trade</button></div>`);
        row.querySelector('.trade-name').textContent = ITEMS[o.get].name;
        const btn = row.querySelector('button'), priceSlot = row.querySelector('.price'), cueEl = row.querySelector('.price-cue');
        btn.addEventListener('click', (e) => { // (a click, not a mousedown: Enter, Space and the gamepad's A press it too; Shift trades as often as affordable)
          const times = e.shiftKey ? 64 : 1;
          if (mob.netProxy) { const n = affordableTimes(o, inv, cut, times, market()); if (n > 0) g.net.requestTrade(mob, mob.trades.indexOf(o), n); return; } // the host keeps count (and is asked only for trades we can pay for)
          let done = 0;
          for (let k = 0; k < times && canTrade(o, inv, cut, market()); k++) {
            const got = doTrade(o, inv, cut, market());
            const left = inv.add(got);
            if (left) g.entities.spawnItem(g.player.x, g.player.y + 1, g.player.z, { ...got, count: left });
            done++;
          }
          if (done) {
            mob.traded = true;
            const up = recordTrades(mob, done); // trades count towards the settler's level
            if (key) repEvent(g, g.player, key, REP.trade * done, 'trade');
            g.player.stats.trades += done; g.milestones.event('trade'); if (trader) g.milestones.event('peddler'); g.audio.play('hmm', [mob.x, mob.y + 1.5, mob.z]); g.entities.spawnXp(g.player.x, g.player.y + 1, g.player.z, 3 * done);
            if (up) {
              if (g.hud) g.hud.toast(`The settler is now a ${LEVEL_NAMES[mob.level - 1]}: new offers`, 3500);
              g.audio.play('levelup', [mob.x, mob.y + 1.5, mob.z]);
              this.openTrade(mob); // (the list grew)
              return;
            }
          }
          this.refreshAll();
        });
        this.refreshers.push(() => {
          const base = o.giveCount, now = price(o);
          priceSlot.innerHTML = this.slotHTML({ id: o.give, count: now });
          const cue = priceCue(now, base); // colour is not the only signal: a mark and a word sit beside the price, and the row is named for screen readers
          priceSlot.classList.toggle('discounted', cue.cls === 'discounted');
          priceSlot.classList.toggle('pricey', cue.cls === 'pricey');
          priceSlot.title = cue.text;
          cueEl.textContent = cue.mark ? `${cue.mark} ${cue.word}` : '';
          cueEl.className = 'price-cue' + (cue.cls ? ' ' + cue.cls : '');
          row.setAttribute('aria-label', `${ITEMS[o.get].name} x${o.getCount} for ${ITEMS[o.give].name} x${now}. ${cue.text}${o.uses >= MAX_USES ? '. Sold out' : ''}`);
          const refused = refusesTrade(market().rep);
          const ok = canTrade(o, inv, cut, market());
          btn.disabled = !ok;
          row.classList.toggle('sold-out', o.uses >= MAX_USES);
          btn.textContent = o.uses >= MAX_USES ? 'Sold out' : refused ? 'Refused' : 'Trade';
        });
        list.appendChild(row);
      });
      if (bar) {
        this.refreshers.push(() => {
          const lp = levelProgress(mob.tradeCount | 0), lv = Math.max(lp.level, mob.level | 0);
          bar.querySelector('.trade-level-name').textContent = `${LEVEL_NAMES[lv - 1]} (level ${lv})`;
          bar.querySelector('.trade-bar-fill').style.width = `${Math.round(lp.frac * 100)}%`;
          bar.querySelector('.trade-bar').setAttribute('aria-valuenow', String(Math.round(lp.frac * 100)));
          bar.querySelector('.trade-level-count').textContent = lp.max ? 'Master' : `${lp.done} / ${lp.need} trades to ${LEVEL_NAMES[lp.level]}`;
          const mk = market(), rep = mk.rep, st = standing(rep);
          repLine.textContent = key ? `Standing: ${st.name} (${rep > 0 ? '+' : ''}${Math.round(rep)}) - ${repHint(rep)}${mk.festival ? `; Lantern Festival: a further ${Math.round(mk.festival * 100)} % off` : ''}` : 'No village to speak for this settler';
          repLine.dataset.standing = String(st.index);
          const sel = inv.selectedStack, worth = sel && key ? giftValue(mob.profession, sel.id) : 0;
          gift.disabled = !key || !worth || g.time - mob.lastGift < GIFT_COOLDOWN;
          gift.textContent = worth ? (g.time - mob.lastGift < GIFT_COOLDOWN ? 'Already given a gift' : `Gift: ${ITEMS[sel.id].name}`) : 'Gift (hold goods it wants)';
        });
        gift.addEventListener('click', () => {
          if (gift.disabled) return;
          if (mob.netProxy) { g.net.requestGift(mob); return; } // the host decides
          const sel = inv.selectedStack, worth = sel ? giftValue(mob.profession, sel.id) : 0;
          if (!worth || !key) return;
          if (!g.player.creative) inv.removeFromSlot(inv.selected, 1);
          mob.lastGift = g.time;
          repEvent(g, g.player, key, worth);
          if (g.hud) g.hud.toast('The settler is delighted', 2500);
          g.audio.play('hmm', [mob.x, mob.y + 1.5, mob.z]);
          this.refreshAll();
        });
      }
      panel.appendChild(list);
      panel.appendChild(el(`<div class="recipes-hint">Shift-click trades as often as you can afford. ${trader ? 'The pack does not refill, and the peddler moves on after a day.' : 'Offers restock every half day; until then each use makes an offer a little dearer. More trades raise the settler\'s level and unlock better offers.'}</div>`));
      panel.appendChild(this.inventoryGrid());
    });
    this.refreshAll();
  }

  /** Sleeping: the screen fades to black; "Leave Bed" (or Esc) gets up early. */
  showSleep() {
    this.clear();
    this.open = 'sleep';
    const s = el('<div class="screen sleep-screen" style="justify-content:flex-end;padding-bottom:12vh"><button class="btn">Leave Bed</button></div>');
    s.querySelector('button').onclick = () => this.game.wakeUp(false);
    this.layer.appendChild(s);
    this.sleepEl = s;
  }

  /** Called each frame while a furnace screen is open */
  tickOpen() {
    if (this.open === 'furnace' || this.open === 'brewing') for (const r of this.refreshers) r();
    if (this.open === 'inventory' && this.fxRefresh && this.game.ticks !== this.fxTick) { this.fxTick = this.game.ticks; this.fxRefresh(); }
    if (this.open === 'enchanting' && this.enchTick) this.enchTick();
    if (this.open === 'sleep' && this.sleepEl) {
      const s = this.game.player.sleeping;
      this.sleepEl.style.background = `rgba(4,6,14,${s ? Math.min(1, s.ticks / 70) : 0})`;
    }
  }

  showPause() {
    this.clear();
    this.open = 'pause';
    const g = this.game;
    const s = el(`<div class="screen pause-screen">
      <h2>Paused</h2>
      <button class="btn" data-a="resume">Back to Game</button>
      <button class="btn" data-a="save">Save Game</button>
      <div class="btn-row"><button class="btn" data-a="help">Help (${codeLabel(resolveBindings(g.settings.keys).help[0])})</button>
      <button class="btn" id="hints">Hints: ${g.settings.hints !== false ? 'On' : 'Off'}</button></div>
      <div class="field"><label>Render distance: <b id="rdv">${g.settings.renderDistance}</b> chunks</label><input type="range" min="2" max="16" value="${g.settings.renderDistance}" id="rd"></div>
      <div class="field"><label>Field of view: <b id="fovv">${g.settings.fov}</b></label><input type="range" min="50" max="110" value="${g.settings.fov}" id="fov"></div>
      <div class="field"><label>Look sensitivity (mouse and touch): <b id="msv">${g.settings.sensitivity}</b></label><input type="range" min="10" max="200" value="${g.settings.sensitivity}" id="ms"></div>
      <div class="field"><label>Volume: <b id="volv">${Math.round(g.settings.volume * 100)}</b>%</label><input type="range" min="0" max="100" value="${Math.round(g.settings.volume * 100)}" id="vol"></div>
      <div class="field"><label>Music: <b id="musv">${Math.round((g.settings.music ?? 0.5) * 100)}</b>%</label><input type="range" min="0" max="100" value="${Math.round((g.settings.music ?? 0.5) * 100)}" id="mus"></div>
      <div class="field"><label><input type="checkbox" id="sh" ${g.settings.shadows ? 'checked' : ''}> Sun shadows (3 shadow-casting lights)</label></div>
      <div class="btn-row"><button class="btn" id="fx">Shaders: ${g.settings.shaders !== false ? 'On' : 'Off'}</button>
      <button class="btn" id="fast">Low-lag graphics</button></div>
      <div class="sub" style="font-size:12px;opacity:.7;margin:-4px 0 6px">Laggy? Turn shaders off here or press F7 at any time</div>
      <div class="btn-row"><button class="btn" id="dlc">Day/night cycle: ${g.settings.daylightCycle !== false ? 'On' : 'Off'}</button>
      <button class="btn" id="hm">Hostile mobs: ${g.settings.hostileMobs !== false ? 'On' : 'Off'}</button></div>
      <button class="btn" id="sea">Seasons: ${g.settings.seasons !== false ? 'On' : 'Off'}</button>
      <button class="btn" id="crd">Show coordinates: ${g.settings.showCoords ? 'On' : 'Off'}</button>
      <button class="btn" id="diff">Difficulty: ${cap(g.difficulty)}</button>
      <div class="btn-row"><button class="btn" data-a="controls">Controls</button>
      <button class="btn" data-a="access">Accessibility</button></div>
      <div class="btn-row"><button class="btn" data-a="ms">Milestones</button>
      <button class="btn" data-a="stats">Statistics</button></div>
      <button class="btn" data-a="guide">Field Guide (${codeLabel(resolveBindings(g.settings.keys).guide[0])})</button>
      <button class="btn" data-a="touch">Touch controls: ${g.touch ? 'On' : 'Off'}</button>
      <div class="net-box"></div>
      <button class="btn" data-a="title">${g.net && g.net.isClient ? 'Disconnect' : 'Save &amp; Quit to Title'}</button>
    </div>`);
    this.fillNetBox(s.querySelector('.net-box'));
    const bind = (id, lbl, fn) => s.querySelector('#' + id).addEventListener('input', (e) => { s.querySelector('#' + lbl).textContent = fn(+e.target.value); });
    bind('rd', 'rdv', (v) => { g.setSetting('renderDistance', v); return v; });
    bind('fov', 'fovv', (v) => { g.setSetting('fov', v); return v; });
    bind('ms', 'msv', (v) => { g.setSetting('sensitivity', v); return v; });
    bind('vol', 'volv', (v) => { g.setSetting('volume', v / 100); return v; });
    bind('mus', 'musv', (v) => { g.setSetting('music', v / 100); return v; });
    s.querySelector('#sh').addEventListener('change', (e) => g.setSetting('shadows', e.target.checked));
    const toggle = (id, key, label) => {
      const b = s.querySelector('#' + id);
      b.onclick = () => { const on = g.settings[key] === false; g.setSetting(key, on); b.textContent = `${label}: ${on ? 'On' : 'Off'}`; };
    };
    toggle('dlc', 'daylightCycle', 'Day/night cycle');
    toggle('sea', 'seasons', 'Seasons');
    toggle('hints', 'hints', 'Hints');
    toggle('fx', 'shaders', 'Shaders');
    s.querySelector('#fast').onclick = () => {
      // everything that costs the most frames off at once: shaders, sun shadows, high pixel density, far chunks
      g.setSetting('shaders', false); g.setSetting('shadows', false); g.setSetting('pixelRatioCap', 1);
      if (g.settings.renderDistance > 6) { g.setSetting('renderDistance', 6); s.querySelector('#rd').value = 6; s.querySelector('#rdv').textContent = 6; }
      s.querySelector('#fx').textContent = 'Shaders: Off'; s.querySelector('#sh').checked = false;
      g.hud.toast('Low-lag graphics: shaders and shadows off');
    };
    toggle('hm', 'hostileMobs', 'Hostile mobs');
    toggle('crd', 'showCoords', 'Show coordinates');
    const db = s.querySelector('#diff');
    if (g.net && g.net.isClient) db.disabled = true; // the host decides
    db.onclick = () => { const order = ['peaceful', 'easy', 'normal', 'hard']; g.setSetting('difficulty', order[(order.indexOf(g.difficulty) + 1) % 4]); db.textContent = `Difficulty: ${cap(g.difficulty)}`; };
    s.querySelector('[data-a=resume]').onclick = () => { this.open = null; this.clear(); g.onUIClosed(); };
    s.querySelector('[data-a=title]').onclick = () => g.quitToTitle();
    const sv = s.querySelector('[data-a=save]');
    if (g.net && g.net.isClient) sv.disabled = true; // the host saves a friend's world
    sv.onclick = async () => {
      sv.disabled = true; sv.textContent = 'Saving…';
      const ok = await g.save();
      sv.textContent = ok ? 'Saved ✓' : 'Save failed';
      setTimeout(() => { sv.disabled = false; sv.textContent = 'Save Game'; }, 1500);
    };
    s.querySelector('[data-a=ms]').onclick = () => this.showMilestones();
    s.querySelector('[data-a=stats]').onclick = () => this.showStats();
    s.querySelector('[data-a=guide]').onclick = () => this.showGuide();
    s.querySelector('[data-a=help]').onclick = () => this.showHelp();
    s.querySelector('[data-a=controls]').onclick = () => this.showControls();
    s.querySelector('[data-a=access]').onclick = () => this.showAccessibility();
    s.querySelector('[data-a=touch]').onclick = () => this.showTouchSettings();
    this.layer.appendChild(s);
  }

  /** Touch controls: Auto / On / Off, button size and opacity, left-handed layout (ui/touch.js). */
  showTouchSettings() {
    this.clear();
    this.open = 'pause';
    const g = this.game, t = normalizeTouch(g.settings);
    const detected = detectTouch(readTouchEnv());
    this.touchPreview = true; // the on-screen buttons stay visible behind this screen so size and opacity can be judged
    const s = el(`<div class="screen pause-screen touch-settings"><h2>Touch controls</h2>
      <button class="btn" data-a="mode">Touch controls: ${TOUCH_MODE_LABELS[t.touchMode]}</button>
      <p class="sub">Auto turns them on for phones and tablets${detected ? ' (this device looks like one)' : ' (this device does not look like one)'}.</p>
      <div class="field"><label>Button size: <b id="tsv">${t.touchSize}</b>%</label><input type="range" min="${SIZE_RANGE[0]}" max="${SIZE_RANGE[1]}" step="5" value="${t.touchSize}" id="ts"></div>
      <div class="field"><label>Button opacity: <b id="tov">${t.touchOpacity}</b>%</label><input type="range" min="${OPACITY_RANGE[0]}" max="${OPACITY_RANGE[1]}" step="5" value="${t.touchOpacity}" id="to"></div>
      <button class="btn" data-a="left">Left-handed layout: ${t.touchLeft ? 'On' : 'Off'}</button>
      <p class="sub">Left thumb moves (push far to sprint), drag the other side to look, hold to mine. Double-tap Jump to fly in creative mode. Hold a slot for a right click; Split and Quick change the next taps.</p>
      <button class="btn" data-a="back">Back</button></div>`);
    const mode = s.querySelector('[data-a=mode]');
    mode.onclick = () => { const m = nextTouchMode(normalizeTouch(g.settings).touchMode); g.setSetting('touchMode', m); mode.textContent = `Touch controls: ${TOUCH_MODE_LABELS[m]}`; };
    const bind = (id, lbl, key) => s.querySelector('#' + id).addEventListener('input', (e) => { s.querySelector('#' + lbl).textContent = e.target.value; g.setSetting(key, +e.target.value); });
    bind('ts', 'tsv', 'touchSize');
    bind('to', 'tov', 'touchOpacity');
    const left = s.querySelector('[data-a=left]');
    left.onclick = () => { const on = !g.settings.touchLeft; g.setSetting('touchLeft', on); left.textContent = `Left-handed layout: ${on ? 'On' : 'Off'}`; };
    s.querySelector('[data-a=back]').onclick = () => this.showPause();
    this.padBack = () => this.showPause();
    this.layer.appendChild(s);
  }

  /**
   * Controls: every action has a main key, a spare key and a gamepad button. Click a slot, then press
   * the new key or button (Backspace / the gamepad Back button clears it, Esc cancels). A code that is
   * already used swaps places with the slot's old one, so nothing is left unbound by accident.
   */
  showControls() {
    this.clear();
    this.open = 'pause';
    const g = this.game, inp = g.input;
    let table = resolveBindings(g.settings.keys);
    let waiting = null; // { id, slot }
    let note = '';
    const s = el(`<div class="screen pause-screen controls-screen"><h2>Controls</h2>
      <p class="sub controls-pad"></p><p class="sub controls-note"></p><div class="controls-list"></div>
      <div class="btn-row"><button class="btn" data-a="reset">Reset all</button><button class="btn" data-a="back">Back</button></div></div>`);
    const list = s.querySelector('.controls-list'), noteEl = s.querySelector('.controls-note');
    const stop = () => { waiting = null; inp.capture = null; };
    const label = (id) => ACTIONS.find((a) => a.id === id).label;
    const commit = (next) => { table = next; g.setSetting('keys', toOverrides(table)); };
    const onCode = (code) => {
      if (!waiting) return;
      const { id, slot } = waiting;
      if (code === 'Escape') { stop(); note = ''; render(); return; }
      const clear = code === 'Backspace' || code === 'PadBack';
      const r = setBinding(table, id, slot, clear ? null : code);
      if (r.error) { note = r.error; render(); return; } // keep waiting for a fitting key
      stop();
      commit(r.table);
      note = clear ? `${label(id)} cleared`
        : r.swapped ? `${codeLabel(code)} was ${label(r.swapped.id)}'s ${SLOT_NAMES[r.swapped.slot].toLowerCase()}: the two swapped places`
        : `${label(id)}: ${codeLabel(code)}`;
      render();
    };
    const render = () => {
      const keep = [...list.querySelectorAll('.control-key')].indexOf(document.activeElement); // (the list is rebuilt: keep the keyboard's place)
      list.textContent = '';
      noteEl.textContent = note;
      noteEl.setAttribute('role', 'status');
      s.querySelector('.controls-pad').textContent = inp.pad.connected
        ? 'Gamepad connected: left stick moves, right stick looks. Inventories still need the mouse.'
        : 'Plug in a gamepad and press any button to play with it.';
      for (const group of GROUPS) {
        list.appendChild(el(`<div class="world-head">${group}</div>`));
        for (const a of ACTIONS.filter((x) => x.group === group)) {
          const row = el('<div class="control-row"><span class="control-name"></span></div>');
          row.firstChild.textContent = a.label;
          for (let slot = 0; slot < 3; slot++) {
            const b = el('<button class="btn control-key"></button>');
            const on = waiting && waiting.id === a.id && waiting.slot === slot;
            b.textContent = on ? (SLOT_KINDS[slot] === 'pad' ? 'Press a button…' : 'Press a key…') : codeLabel(table[a.id][slot]);
            b.title = `${a.label} · ${SLOT_NAMES[slot]}: click to change, right-click to clear`;
            b.classList.toggle('waiting', !!on);
            b.classList.toggle('unbound', !table[a.id][slot]);
            b.onclick = () => { waiting = { id: a.id, slot }; note = ''; inp.capture = onCode; render(); };
            b.oncontextmenu = (e) => { e.preventDefault(); stop(); commit(setBinding(table, a.id, slot, null).table); note = `${a.label} cleared`; render(); };
            row.appendChild(b);
          }
          list.appendChild(row);
        }
      }
      if (keep >= 0) { const again = list.querySelectorAll('.control-key')[keep]; if (again) again.focus(); }
    };
    s.querySelector('[data-a=reset]').onclick = () => { stop(); commit(resolveBindings(null)); note = 'Controls reset to the defaults'; render(); };
    s.querySelector('[data-a=back]').onclick = () => { stop(); this.showPause(); };
    this.padBack = () => { stop(); this.showPause(); };
    this.layer.appendChild(s);
    render();
  }

  /** Accessibility: sound captions, reduced motion / flashing and colour-blind friendly status bars. */
  showAccessibility() {
    this.clear();
    this.open = 'pause';
    const g = this.game;
    const onOff = (k) => (g.settings[k] ? 'On' : 'Off');
    const s = el(`<div class="screen pause-screen"><h2>Accessibility</h2>
      <button class="btn" data-k="captions">Sound captions: ${onOff('captions')}</button>
      <p class="sub">Shows what you hear, and from which side, at the bottom right.</p>
      <button class="btn" data-k="reduceMotion">Reduce motion: ${onOff('reduceMotion')}</button>
      <p class="sub">No head bob, hurt tilt, sprint zoom or trembling apparitions; Veilfire drifts slowly, falling stars and meteorite trails are left out and fewer grains blow in a dust storm.</p>
      <button class="btn" data-k="reduceFlashing">Reduce flashing: ${onOff('reduceFlashing')}</button>
      <p class="sub">Lightning only brightens the sky a little, hearts stop flashing, stars stay steady and fireworks and meteorite impacts throw fewer sparks with no white twinkles.</p>
      <button class="btn" data-a="cb">Colour-blind HUD: ${COLOR_BLIND_LABELS[g.settings.colorBlind] || 'Off'}</button>
      <p class="sub">Moves the status-bar colours apart and marks poison and hunger with a cross.</p>
      <button class="btn" data-k="highContrast">High contrast: ${onOff('highContrast')}</button>
      <p class="sub">Black and white menus with thick outlines, and brighter text on the screen.</p>
      <button class="btn" data-k="largeText">Large text: ${onOff('largeText')}</button>
      <p class="sub">Makes menu and screen text about a third bigger; menus scroll when they no longer fit.</p>
      <button class="btn" data-a="back">Back</button></div>`);
    s.querySelectorAll('[data-k]').forEach((b) => {
      const k = b.dataset.k, name = b.textContent.split(':')[0];
      b.setAttribute('aria-pressed', String(!!g.settings[k]));
      b.onclick = () => {
        g.setSetting(k, !g.settings[k]);
        b.textContent = `${name}: ${onOff(k)}`;
        b.setAttribute('aria-pressed', String(!!g.settings[k]));
        if (k === 'captions' && g.settings.captions) g.captions.add('click', [g.player.x + 3, g.player.y, g.player.z], 1, [g.player.x, g.player.y, g.player.z, 0], performance.now());
      };
    });
    const cb = s.querySelector('[data-a=cb]');
    cb.onclick = () => { g.setSetting('colorBlind', nextColorBlind(g.settings.colorBlind)); cb.textContent = `Colour-blind HUD: ${COLOR_BLIND_LABELS[g.settings.colorBlind]}`; };
    s.querySelector('[data-a=back]').onclick = () => this.showPause();
    this.padBack = () => this.showPause();
    this.layer.appendChild(s);
  }

  /** Multiplayer part of the pause menu: open to friends, or the room code and who is here. */
  fillNetBox(box) {
    const g = this.game, net = g.net;
    if (!net) {
      const b = el('<button class="btn" data-a="host">Open to Friends (host)</button>');
      const msg = el('<p class="sub net-msg"></p>');
      b.onclick = async () => {
        b.disabled = true; b.textContent = 'Opening…';
        try { await g.openToFriends(loadPlayerName()); if (this.open === 'pause') this.showPause(); }
        catch (e) { b.disabled = false; b.textContent = 'Open to Friends (host)'; msg.textContent = e.message || String(e); }
      };
      box.append(b, msg);
      return;
    }
    if (net.isHost) {
      const info = el(`<div class="net-room"><p class="sub">Open to friends · room code <b class="net-code"></b></p>
        <div class="join-row"><input type="text" readonly class="net-link"><button class="btn" data-a="copy">Copy Link</button></div></div>`);
      info.querySelector('.net-code').textContent = net.code;
      const link = info.querySelector('.net-link');
      link.value = net.link;
      link.onclick = () => link.select();
      info.querySelector('[data-a=copy]').onclick = (e) => this.copyText(link, net.link, e.target);
      const codeRow = el('<div class="join-row" style="justify-content:center"><button class="btn" data-a="copycode">Copy Code</button></div>');
      codeRow.querySelector('button').onclick = (e) => this.copyText(link, net.code, e.target);
      info.append(codeRow);
      box.append(info);
      // host options: PvP and guest commands
      const opts = el('<div class="btn-row"></div>');
      const opt = (label, key, get) => {
        const b = el('<button class="btn"></button>');
        const show = () => { b.textContent = `${label}: ${get() ? 'On' : 'Off'}`; };
        b.onclick = () => { net.setOptions({ [key]: !get() }); show(); };
        show();
        opts.appendChild(b);
      };
      opt('PvP', 'pvp', () => net.pvp);
      opt('Guest commands', 'gc', () => net.guestCommands);
      opt('Team friendly fire (all)', 'ffa', () => net.friendlyFireAll);
      // how many players fit (2 to 8, the host included): lowering it never removes anybody who is here
      const mp = el('<button class="btn"></button>');
      const showMp = () => { mp.textContent = `Max players: ${net.maxPlayers}`; };
      mp.onclick = () => { net.setOptions({ mp: net.maxPlayers >= MAX_PLAYERS ? 2 : net.maxPlayers + 1 }); showMp(); };
      showMp();
      opts.appendChild(mp);
      box.append(opts);
    } else {
      const info = el('<p class="sub"></p>');
      info.textContent = `Playing in ${net.welcome.hostName}'s world as ${net.name}`;
      box.append(info);
      if (net.code) {
        // the room code, to pass on to somebody else
        const row = el('<div class="join-row"><input type="text" readonly class="net-link"><button class="btn" data-a="copycode">Copy Code</button></div>');
        const inp = row.querySelector('input');
        inp.value = net.code;
        inp.onclick = () => inp.select();
        row.querySelector('button').onclick = (e) => this.copyText(inp, net.code, e.target);
        box.append(row);
      }
    }
    // who is here, with their team; the host (and ops) can remove guests
    const can = net.isHost || net.social.isOp(net.name, net.hostName());
    const list = el('<div class="net-list"></div>');
    for (const r of net.playerRows()) {
      const row = el('<div class="net-row"><span class="nm"></span><span class="tm"></span></div>');
      row.querySelector('.nm').textContent = r.name + (r.host ? ' (host)' : r.op ? ' (op)' : '') + (r.you ? ' - you' : '');
      if (r.color) row.querySelector('.nm').style.color = r.color;
      row.querySelector('.tm').textContent = r.team ? `[${r.team}]` : '';
      if (can && !r.you && net.social.canKick(net.name, r.name, net.hostName())) {
        const k = el('<button class="btn net-kick">Kick</button>');
        k.onclick = () => { for (const l of [].concat(net.socialCommand(`/kick ${r.name}`))) this.game.chat.add(l); this.showPause(); };
        row.append(k);
      }
      list.append(row);
    }
    box.append(list);
  }

  /** Copy `text` to the clipboard (selecting `input` as a fallback) and say so on `button`. */
  copyText(input, text, button) {
    input.select();
    const done = () => { const was = button.textContent; button.textContent = 'Copied'; setTimeout(() => { button.textContent = was; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => { document.execCommand('copy'); done(); });
    else { document.execCommand('copy'); done(); }
  }

  /** Name Tag: type the name the tag (in hotbar slot `slot`) gives the mob it is used on. */
  openNameTag(slot) {
    this.clear();
    this.open = 'nametag';
    const g = this.game, inv = g.player.inventory;
    g.input.unlock();
    const st = inv.slots[slot];
    if (!st) return;
    const s = el(`<div class="screen"><h2>Name Tag</h2><p class="sub">Write a name, then use the tag on a mob</p><input class="nametag-input" maxlength="${LABEL_MAX}" spellcheck="false"><button class="btn">Done</button></div>`);
    const inp = s.querySelector('input');
    inp.value = st.label || '';
    const done = () => {
      const cur = inv.slots[slot];
      if (cur && cur.id === st.id) {
        const label = cleanLabel(inp.value);
        if (cur.count > 1 && label !== (cur.label || null)) {
          // only one tag of a stack gets the name; the rest stay as they were
          const one = { ...cur, count: 1 };
          if (label) one.label = label; else delete one.label;
          cur.count--;
          if (inv.add(one)) g.entities.spawnItem(g.player.x, g.player.y + 1, g.player.z, one);
        } else if (label) cur.label = label; else delete cur.label;
        inv.changed();
      }
      this.open = null; this.clear(); g.onUIClosed();
    };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') done(); };
    s.querySelector('button').onclick = done;
    this.layer.appendChild(s);
    setTimeout(() => inp.focus(), 0);
  }

  /** Write on a sign: four lines of up to 15 characters, saved as you type. */
  openSignEditor(x, y, z) {
    this.clear();
    this.open = 'sign';
    const g = this.game, k = `${x},${y},${z}`;
    g.input.unlock();
    const lines = (g.signs.get(k) || ['', '', '', '']).slice();
    const s = el('<div class="screen"><h2>Edit Sign</h2><div class="sign-edit"></div><button class="btn">Done</button></div>');
    const box = s.querySelector('.sign-edit');
    const inputs = lines.map((l, i) => {
      const inp = el('<input maxlength="15" spellcheck="false">');
      inp.value = l;
      inp.oninput = () => { lines[i] = inp.value; g.setSignText(x, y, z, lines); };
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { if (i < 3) inputs[i + 1].focus(); else done(); } if (e.key === 'Escape') done(); };
      box.appendChild(inp);
      return inp;
    });
    const done = () => { g.setSignText(x, y, z, lines); this.open = null; this.clear(); g.onUIClosed(); };
    s.querySelector('button').onclick = done;
    this.layer.appendChild(s);
    setTimeout(() => inputs[0].focus(), 0);
  }

  /**
   * A book in hotbar slot `slot`: a Writable Book opens to write in (pages turn, a new page is added past
   * the last one, up to 50; Sign gives it a title and makes it a Written Book), a Written Book to read.
   */
  openBook(slot) {
    this.clear();
    this.open = 'book';
    const g = this.game, inv = g.player.inventory;
    g.input.unlock();
    const st = inv.slots[slot];
    if (!st || !isBook(st.id)) { this.open = null; return; }
    const writable = st.id === I.WRITABLE_BOOK;
    const pages = bookPages(st).slice();
    let page = 0;
    const s = el(`<div class="screen book-screen"><div class="book"><div class="book-head"></div>${writable ? `<textarea class="book-page" maxlength="${PAGE_MAX}" spellcheck="false"></textarea>` : '<div class="book-page book-read"></div>'}
      <div class="book-nav"><button class="btn book-prev">&lt;</button><span class="book-num"></span><button class="btn book-next">&gt;</button></div></div>
      <div class="book-actions">${writable ? '<button class="btn book-sign">Sign</button>' : ''}<button class="btn book-done">Done</button></div></div>`);
    const head = s.querySelector('.book-head'), text = s.querySelector('.book-page'), num = s.querySelector('.book-num');
    const prev = s.querySelector('.book-prev'), next = s.querySelector('.book-next');
    const current = () => { const cur = inv.slots[slot]; return cur && cur.id === st.id ? cur : null; };
    const save = () => {
      // the text lives on the stack (cleaned like anything that reaches a save or the network)
      const cur = current();
      if (!cur) return;
      const clean = cleanPages(pages);
      if (clean) cur.pages = clean; else delete cur.pages;
      inv.changed();
    };
    const show = () => {
      head.textContent = writable ? 'Writable Book' : `${st.title || 'Untitled'}${st.author ? ' by ' + st.author : ''}`;
      if (writable) text.value = pages[page]; else text.textContent = pages[page];
      num.textContent = `Page ${page + 1} of ${pages.length}`;
      prev.disabled = page === 0;
      next.disabled = writable ? page >= BOOK_MAX_PAGES - 1 : page >= pages.length - 1;
    };
    const close = () => { save(); this.open = null; this.clear(); g.onUIClosed(); };
    const turn = (d) => {
      const to = page + d;
      if (to < 0 || to >= BOOK_MAX_PAGES || (!writable && to >= pages.length)) return;
      if (to >= pages.length) pages.push(''); // writing past the last page starts a new one
      page = to;
      g.audio.play('page');
      show();
      if (writable) text.focus();
    };
    prev.onclick = () => turn(-1);
    next.onclick = () => turn(1);
    s.querySelector('.book-done').onclick = close;
    if (writable) {
      text.oninput = () => { pages[page] = cleanPage(text.value); if (text.value !== pages[page]) text.value = pages[page]; save(); };
      text.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'PageDown') turn(1); if (e.key === 'PageUp') turn(-1); };
      s.querySelector('.book-sign').onclick = () => this.signBookScreen(slot, pages);
    }
    this.layer.appendChild(s);
    show();
    if (writable) setTimeout(() => text.focus(), 0);
  }

  /** Signing a Writable Book: a title, the author (this player's name), and it becomes a Written Book. */
  signBookScreen(slot, pages) {
    this.clear();
    this.open = 'book';
    const g = this.game, inv = g.player.inventory;
    const author = cleanTitle(g.player.netName || loadPlayerName()) || 'Unknown';
    const s = el(`<div class="screen book-screen"><div class="book book-signing"><div class="book-head">Sign the book</div><input class="nametag-input book-title" maxlength="${TITLE_MAX}" spellcheck="false" placeholder="Title"><p class="sub">by ${author.replace(/[<>&"]/g, '')}</p><p class="sub">Once signed, the book can only be read.</p></div>
      <div class="book-actions"><button class="btn book-ok" disabled>Sign and Close</button><button class="btn book-cancel">Cancel</button></div></div>`);
    const inp = s.querySelector('input'), ok = s.querySelector('.book-ok');
    inp.oninput = () => { ok.disabled = !cleanTitle(inp.value); };
    const finish = () => {
      const cur = inv.slots[slot];
      const signed = cur && cur.id === I.WRITABLE_BOOK ? signBook({ ...cur, pages }, inp.value, author) : null;
      if (!signed) return;
      inv.slots[slot] = signed;
      inv.changed();
      g.audio.play('page');
      this.open = null; this.clear(); g.onUIClosed();
    };
    ok.onclick = finish;
    s.querySelector('.book-cancel').onclick = () => this.openBook(slot);
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(); if (e.key === 'Escape') this.openBook(slot); };
    this.layer.appendChild(s);
    setTimeout(() => inp.focus(), 0);
  }

  /** Read the book on a Lectern: turning its pages is shared (and pulses); Take Book puts it in the inventory. */
  openLectern(x, y, z) {
    this.clear();
    this.open = 'lectern';
    const g = this.game, k = `${x},${y},${z}`;
    g.input.unlock();
    const s = el(`<div class="screen book-screen"><div class="book"><div class="book-head"></div><div class="book-page book-read"></div>
      <div class="book-nav"><button class="btn book-prev">&lt;</button><span class="book-num"></span><button class="btn book-next">&gt;</button></div></div>
      <div class="book-actions"><button class="btn book-take">Take Book</button><button class="btn book-done">Done</button></div></div>`);
    const head = s.querySelector('.book-head'), text = s.querySelector('.book-page'), num = s.querySelector('.book-num');
    const prev = s.querySelector('.book-prev'), next = s.querySelector('.book-next');
    const close = () => { this.lectern = null; this.open = null; this.clear(); g.onUIClosed(); };
    const refresh = () => {
      const l = g.lecterns.get(k);
      if (!l) { close(); return; } // someone else took the book
      const pages = bookPages(l.book);
      head.textContent = l.book.id !== I.WRITABLE_BOOK ? `${l.book.title || 'Untitled'}${l.book.author ? ' by ' + l.book.author : ''}` : 'Writable Book';
      text.textContent = pages[l.page] || '';
      num.textContent = `Page ${l.page + 1} of ${pages.length}`;
      prev.disabled = l.page === 0;
      next.disabled = l.page >= pages.length - 1;
    };
    const turn = (d) => {
      const l = g.lecterns.get(k);
      if (!l) return;
      const to = l.page + d;
      if (to < 0 || to >= bookPages(l.book).length) return;
      g.setLectern(x, y, z, { book: l.book, page: to }); // (the page turn pulses on the host)
      g.audio.play('page', [x + 0.5, y + 1, z + 0.5]);
      refresh();
    };
    prev.onclick = () => turn(-1);
    next.onclick = () => turn(1);
    s.querySelector('.book-take').onclick = () => {
      const l = g.lecterns.get(k);
      if (l) {
        g.setLectern(x, y, z, null);
        const book = { ...l.book, count: 1 };
        if (g.player.inventory.add(book)) g.entities.spawnItem(x + 0.5, y + 1.1, z + 0.5, book, [0, 0.15, 0]);
      }
      close();
    };
    s.querySelector('.book-done').onclick = close;
    this.lectern = { k, refresh };
    this.layer.appendChild(s);
    refresh();
  }

  showMilestones() {
    this.clear();
    this.open = 'pause';
    const g = this.game, done = g.milestones.done;
    const s = el(`<div class="screen pause-screen"><h2>Milestones (${done.size}/${MILESTONES.length})</h2><div class="milestone-list"></div><button class="btn">Back</button></div>`);
    const list = s.querySelector('.milestone-list');
    for (const m of MILESTONES) {
      const row = el(`<div class="milestone-row ${done.has(m.id) ? 'done' : ''}"><img src="${iconURL(m.icon)}"><div><b></b><div class="d"></div></div></div>`);
      row.querySelector('b').textContent = m.title;
      row.querySelector('.d').textContent = m.desc;
      list.appendChild(row);
    }
    s.querySelector('button').onclick = () => this.showPause();
    this.padBack = () => this.showPause();
    this.padScroll = (dy) => { list.scrollTop += dy; };
    this.layer.appendChild(s);
  }

  /**
   * Help (F1, or pause menu > Help): how-to topics you can search (ui/helpTopics.js). Typing filters the
   * list, Down moves from the search box into it, Enter opens a topic. Gamepad: the bumpers change topic, the
   * D-pad scrolls and B goes back; touch: it is all plain buttons.
   */
  showHelp(fromKey = false, topicId = 'start') {
    this.clear();
    this.open = 'pause';
    this.inHelp = true;
    const g = this.game, onb = g.onboarding;
    const topics = buildTopics({ table: resolveBindings(g.settings.keys), touch: !!g.touch, pad: !!(g.input.pad && g.input.pad.connected) });
    const s = el(`<div class="screen pause-screen help-screen"><h2>Help</h2>
      <input type="search" class="help-search" placeholder="Search: crafting, sprint, /time, bed…" aria-label="Search help topics" autocomplete="off" spellcheck="false">
      <div class="help-layout"><div class="help-list" role="listbox" aria-label="Topics"></div>
      <div class="help-body" tabindex="0" role="region" aria-label="Topic"></div></div>
      <button class="btn" data-a="back">Back</button></div>`);
    const search = s.querySelector('.help-search'), list = s.querySelector('.help-list'), body = s.querySelector('.help-body');
    let shown = [], current = topics.some((t) => t.id === topicId) ? topicId : topics[0].id;
    const leave = () => { if (fromKey) { this.open = null; this.clear(); g.onUIClosed(); } else this.showPause(); };
    const hr = (tag, text) => { const e = document.createElement(tag); e.textContent = text; return e; };
    const renderBody = () => {
      const t = topics.find((x) => x.id === current);
      body.replaceChildren();
      body.setAttribute('aria-label', t ? t.title : 'Topic');
      if (!t) { body.appendChild(hr('p', 'No topic selected.')); return; }
      body.appendChild(hr('h3', t.title));
      for (const b of t.blocks) {
        if (b.p) body.appendChild(hr('p', b.p));
        else if (b.h) body.appendChild(hr('h4', b.h));
        else if (b.list || b.cmds) {
          const ul = document.createElement('ul');
          if (b.cmds) ul.className = 'help-cmds';
          for (const line of b.list || b.cmds) {
            const li = document.createElement('li');
            if (b.cmds) li.appendChild(hr('code', line)); else li.textContent = line;
            ul.appendChild(li);
          }
          body.appendChild(ul);
        } else if (b.keys) {
          const grid = document.createElement('div');
          grid.className = 'help-keys';
          for (const [a, k] of b.keys) { grid.appendChild(hr('span', a)); grid.appendChild(hr('span', k)); }
          body.appendChild(grid);
        }
      }
      if (t.id === 'hints' && onb) body.appendChild(this.helpHintButtons(onb));
      body.scrollTop = 0;
    };
    const renderList = () => {
      shown = searchTopics(topics, search.value);
      if (shown.length && !shown.some((t) => t.id === current)) { current = shown[0].id; renderBody(); }
      list.replaceChildren();
      if (!shown.length) { const m = hr('div', 'No topics match. Try another word.'); m.className = 'help-empty'; list.appendChild(m); return; }
      let group = null;
      for (const t of shown) {
        if (!search.value.trim() && t.group !== group) { group = t.group; const h = hr('div', group); h.className = 'world-head'; list.appendChild(h); }
        const b = hr('button', t.title);
        b.className = 'btn help-topic' + (t.id === current ? ' on' : ''); b.type = 'button'; b.dataset.topic = t.id;
        b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(t.id === current));
        b.onclick = () => select(t.id, true);
        list.appendChild(b);
      }
    };
    const select = (id, focusIt) => {
      current = id; renderBody();
      for (const b of list.querySelectorAll('.help-topic')) { const on = b.dataset.topic === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); if (on && focusIt) b.focus(); }
    };
    const step = (d) => { if (shown.length) select(shown[(Math.max(0, shown.findIndex((t) => t.id === current)) + d + shown.length) % shown.length].id, false); };
    search.addEventListener('input', renderList);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); const f = list.querySelector('.help-topic'); if (f) f.focus(); }
      else if (e.key === 'Enter' && shown.length) { e.preventDefault(); select(shown[0].id, false); body.focus(); }
    });
    list.addEventListener('keydown', (e) => {
      const btns = [...list.querySelectorAll('.help-topic')], i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && i >= 0) { e.preventDefault(); (btns[i + 1] || btns[i]).focus(); }
      else if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); if (i > 0) btns[i - 1].focus(); else search.focus(); }
    });
    s.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && e.target !== search) { e.preventDefault(); leave(); } });
    s.querySelector('[data-a=back]').onclick = leave;
    this.padBack = leave;
    this.padScroll = (dy) => { body.scrollTop += dy; };
    this.padTab = (d) => step(d);
    this.layer.appendChild(s);
    renderBody();
    renderList();
    this.inHelp = true;
    setTimeout(() => { if (this.open === 'pause' && this.inHelp && search.isConnected) search.focus(); }, 0);
  }

  /** The switches at the foot of the "Hints and First Steps" topic. */
  helpHintButtons(onb) {
    const g = this.game, box = el('<div class="help-actions"></div>');
    const mk = (text, fn) => { const b = el('<button class="btn" type="button"></button>'); b.textContent = text; b.onclick = fn; box.appendChild(b); return b; };
    const hintsLabel = () => `Hints: ${g.settings.hints !== false ? 'On' : 'Off'}`;
    const stepsLabel = () => `First Steps: ${g.settings.firstSteps !== false && !onb.finished ? 'Shown' : 'Hidden'}`;
    const hb = mk(hintsLabel(), () => { g.setSetting('hints', g.settings.hints === false); hb.textContent = hintsLabel(); });
    mk('Show every hint again', () => { onb.resetHints(); g.hud.toast('Hints will show again'); });
    const sb = mk(stepsLabel(), () => {
      if (g.settings.firstSteps !== false && !onb.finished) onb.skipSteps(); else onb.showSteps();
      sb.textContent = stepsLabel();
    });
    return box;
  }

  /**
   * Statistics (player/stats.js): blocks, distances, play time, deaths, trades and the creatures
   * defeated by kind. Reachable by keyboard (Tab to the list, arrows scroll, Backspace or Enter on Back
   * returns) and gamepad (B or Back returns, the left stick or D-pad scrolls; see Game.loop -> padNav).
   */
  showStats() {
    this.clear();
    this.open = 'pause';
    const g = this.game, st = g.player.stats;
    const s = el(`<div class="screen pause-screen stats-screen"><h2>Statistics</h2>
      <div class="stats-body" tabindex="0" role="region" aria-label="Statistics">
        <table class="stats-table"><caption class="world-head">General</caption><tbody class="stats-general"></tbody></table>
        <table class="stats-table"><caption class="world-head">Field Guide</caption><tbody class="stats-guide"></tbody></table>
        <table class="stats-table"><caption class="world-head">Defeated</caption><tbody class="stats-kills"></tbody></table>
      </div>
      <button class="btn" data-a="back">Back</button></div>`);
    const fill = (tbody, rows) => {
      for (const [label, value] of rows) {
        const tr = document.createElement('tr'), th = document.createElement('th'), td = document.createElement('td'); // (a <tr> cannot go through el(): a div drops it)
        th.scope = 'row'; th.textContent = label; td.textContent = value;
        tr.append(th, td);
        tbody.appendChild(tr);
      }
    };
    fill(s.querySelector('.stats-general'), statRows(st));
    fill(s.querySelector('.stats-guide'), guideRows(guideOf(st)));
    const kills = killRows(st, MOBS);
    fill(s.querySelector('.stats-kills'), kills.length ? kills.map((k) => [k.name, String(k.count)]) : [['Nothing yet', '0']]);
    const back = s.querySelector('[data-a=back]');
    const body = s.querySelector('.stats-body');
    back.onclick = () => this.showPause();
    s.addEventListener('keydown', (e) => { if (e.key === 'Backspace') { e.preventDefault(); this.showPause(); } });
    this.padBack = () => this.showPause();
    this.padScroll = (dy) => { body.scrollTop += dy; };
    this.layer.appendChild(s);
    setTimeout(() => { if (this.open === 'pause' && back.isConnected) back.focus(); }, 0);
  }

  /**
   * The Field Guide (player/fieldGuide.js, fieldGuideEntries.js): Creatures, Biomes, Structures and Items of note,
   * generated from the game's data tables, with silhouettes for what is not yet discovered. Each tab is built the
   * first time it is shown. Keyboard: Left / Right on the tabs, Tab to the list (arrows and Page keys scroll),
   * Backspace or the Back button returns (and the Field Guide key closes it). Gamepad: LB / RB switch tabs, the
   * D-pad or left stick scrolls, B or Back returns.
   */
  showGuide(tab = 'creatures', fromKey = false) {
    this.clear();
    this.open = 'pause';
    this.inGuide = true;
    const g = this.game, guide = guideOf(g.player.stats);
    const s = el(`<div class="screen pause-screen guide-screen"><h2>Field Guide</h2>
      <div class="guide-tabs" role="tablist" aria-label="Field Guide tabs"></div>
      <div class="guide-body" tabindex="0" role="tabpanel" aria-label="Entries"></div>
      <button class="btn" data-a="back">Back</button></div>`);
    const tabsEl = s.querySelector('.guide-tabs'), body = s.querySelector('.guide-body');
    const built = new Map(); // tab -> its cards, built on first view
    const leave = () => { if (fromKey) { this.open = null; this.clear(); g.onUIClosed(); } else this.showPause(); };
    const buttons = new Map();
    const labelOf = (p) => `${p.label} ${p.found}/${p.total}`;
    const refreshLabels = () => { for (const p of guideProgress(guide)) buttons.get(p.tab).textContent = labelOf(p); };
    let current = TABS.includes(tab) ? tab : 'creatures';
    const select = (t, focus = false) => {
      current = t;
      for (const [k, b] of buttons) { b.setAttribute('aria-selected', String(k === t)); b.tabIndex = k === t ? 0 : -1; b.classList.toggle('on', k === t); }
      if (!built.has(t)) built.set(t, this.buildGuideTab(t, guide));
      body.replaceChildren(built.get(t));
      body.scrollTop = 0;
      body.setAttribute('aria-label', TAB_LABELS[t]);
      if (focus) buttons.get(t).focus();
    };
    for (const p of guideProgress(guide)) {
      const b = document.createElement('button');
      b.className = 'btn guide-tab'; b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = labelOf(p);
      b.onclick = () => select(p.tab);
      buttons.set(p.tab, b); tabsEl.appendChild(b);
    }
    tabsEl.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); select(TABS[(TABS.indexOf(current) + d + TABS.length) % TABS.length], true); }
    });
    s.addEventListener('keydown', (e) => { if (e.key === 'Backspace') { e.preventDefault(); leave(); } });
    s.querySelector('[data-a=back]').onclick = leave;
    this.padBack = leave;
    this.padScroll = (dy) => { body.scrollTop += dy; };
    this.padTab = (d) => select(TABS[(TABS.indexOf(current) + d + TABS.length) % TABS.length]);
    refreshLabels();
    select(current);
    this.layer.appendChild(s);
    this.inGuide = true;
    setTimeout(() => { if (this.open === 'pause' && this.inGuide && buttons.get(current).isConnected) buttons.get(current).focus(); }, 0);
  }

  /** The cards of one Field Guide tab as a fragment (see showGuide). */
  buildGuideTab(tab, guide) {
    const frag = document.createDocumentFragment();
    const list = (names) => names.join(', ');
    const when = (rec) => `First entry after ${formatTime(rec.t)} of play`;
    for (const e of entriesOf(tab)) {
      const rec = recordOf(guide, tab, e.key);
      const card = document.createElement('div');
      card.className = 'guide-card' + (rec ? '' : ' unknown');
      const img = document.createElement('img'); img.alt = ''; img.width = img.height = 56;
      const info = document.createElement('div'); info.className = 'guide-info';
      const h = document.createElement('b'); h.textContent = rec ? e.name : '???';
      const lines = [];
      if (tab === 'creatures') {
        img.src = creatureIcon(e.key, MOBS[e.key]);
        if (rec) {
          lines.push(`${e.kind}${e.traits.length ? ': ' + list(e.traits) : ''}`, `Lives in: ${list(e.habitat)}`);
          if (e.feeds.length) lines.push(`Likes: ${list(e.feeds.map(itemName))}`);
          if (e.tames.length) lines.push(`Tamed with: ${list(e.tames.map(itemName))}`);
          lines.push(rec.l >= LEVEL.KILLED ? `Drops: ${e.drops.length ? list(e.drops.map(itemName)) : 'nothing'}` : 'Defeat one to learn what it drops.', when(rec));
        } else lines.push('Not yet seen.');
      } else if (tab === 'biomes') {
        img.src = swatch(e.climate);
        if (rec) {
          lines.push(`${e.climate} (temperature ${e.temp}), humidity ${e.humid}`, list(e.features));
          if (e.wildlife.length) lines.push(`Wildlife: ${list(e.wildlife)}`);
          lines.push(when(rec));
        } else lines.push('Not yet visited.');
      } else if (tab === 'structures') {
        img.src = structureIcon(e.shape, e.color);
        if (rec) {
          lines.push(e.note, rec.l >= LEVEL.FOUND ? 'Visited' : 'Located with an Explorer Chart, not yet visited');
          if (Number.isFinite(rec.x)) lines.push(`Seen at x ${rec.x}, z ${rec.z}`);
          if (e.chart) lines.push(`Found with: ${e.chart}`);
        } else lines.push('Not yet found.');
      } else {
        img.src = iconURL(e.id);
        if (rec) {
          lines.push(e.from.length ? `Dropped by: ${list(e.from)}` : 'A rare find.', `First obtained after ${formatTime(rec.t)} of play`);
        } else lines.push('Not yet obtained.');
      }
      info.appendChild(h);
      for (const t of lines) { const d = document.createElement('div'); d.className = 'd'; d.textContent = t; info.appendChild(d); }
      card.append(img, info);
      frag.appendChild(card);
    }
    return frag;
  }

  showDeath(cause) {
    this.clear();
    this.cursor = null; this.renderCursor();
    this.open = 'death';
    const msgs = {
      fall: 'hit the ground too hard', lava: 'tried to swim in lava', fire: 'burned to death', drown: 'drowned',
      starve: 'starved to death', cactus: 'was pricked to death', berry_bush: 'was poked to death by a sweet berry bush', void: 'fell out of the world', explosion: 'was blown up',
      arrow: 'was shot by a Rattler', poison: 'succumbed to poison', magic: 'was killed by magic', wither: 'withered away',
      wall: 'experienced kinetic energy',
    };
    const text = msgs[cause] || (cause && cause.startsWith('mob:') ? `was slain by a ${cause.slice(4)}` : cause && cause.startsWith('player:') ? `was slain by ${cause.slice(7)}` : 'died');
    const s = el(`<div class="screen" id="death-screen"><h2>You Died!</h2><p class="sub">Player ${text}</p><button class="btn">Respawn</button></div>`);
    s.querySelector('button').onclick = () => { this.open = null; this.clear(); this.game.respawn(); };
    const net = this.game.net;
    if (net && net.spectateCandidates().length) {
      // dead in a shared world: watch a friend instead of respawning right away
      const w = el('<button class="btn">Spectate a Friend</button>');
      w.onclick = () => { this.open = null; this.clear(); this.game.spectateAfterDeath(); };
      s.appendChild(w);
    }
    this.layer.appendChild(s);
  }
}

const CLIMATE_COLOR = { Frozen: '#cfeaff', Cold: '#8fb8d0', Temperate: '#6aaa4a', Warm: '#cbb850', Hot: '#d2894a' };
const swatchCache = new Map();
/** A plain colour square for a biome's climate (a data URL, so the card can use an image like the others). */
function swatch(climate) {
  if (swatchCache.has(climate)) return swatchCache.get(climate);
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d'); x.fillStyle = CLIMATE_COLOR[climate] || '#888'; x.fillRect(0, 0, 8, 8);
  x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(0, 5, 8, 3);
  const url = c.toDataURL(); swatchCache.set(climate, url);
  return url;
}

function cap(w) { return w[0].toUpperCase() + w.slice(1); }

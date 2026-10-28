// Menus and container screens (inventory, workbench, furnace).
import { doubleChestHalves, doubleChestView } from '../world/chests.js';
import { createLazyRenderer } from './lazyIcons.js';
import { iconURL, stackHTML, stackIconURL, tooltipHTML, effectIconURL } from './icons.js';
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
import { canTrade, doTrade, offerPrice, MAX_USES } from '../mobs/trades.js';
import { championDiscount } from '../mobs/raids.js';
import { MILESTONES } from '../player/milestones.js';
import { loadPlayerName } from '../net/protocol.js';
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
    document.body.appendChild(this.cursorEl);
    document.body.appendChild(this.tooltipEl);
    window.addEventListener('mousemove', (e) => {
      this.cursorEl.style.left = e.clientX + 'px'; this.cursorEl.style.top = e.clientY + 'px';
      this.tooltipEl.style.left = e.clientX + 14 + 'px'; this.tooltipEl.style.top = e.clientY - 26 + 'px';
    });
  }

  get blocking() { return this.open !== null; }

  clear() { if (this.lazy) { this.lazy.dispose(); this.lazy = null; } this.layer.innerHTML = ''; this.tooltipEl.classList.add('hidden'); }

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
    const refresh = () => { s.innerHTML = this.slotHTML(get()); };
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
    for (let i = 0; i < 9; i++) hot.appendChild(this.makeSlot(() => inv.slots[i], (v) => { inv.slots[i] = v; }, { quickMove: quick(i) }));
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
            if (!rr || rr.id !== r.id) break;
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
      const row = el('<div style="display:flex;gap:10px;align-items:stretch"></div>');
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

  openInventory() {
    this.showContainer('inventory', 'Inventory', (panel) => {
      const top = el('<div style="display:flex;gap:28px;align-items:center;justify-content:center"></div>');
      top.appendChild(this.armorColumn());
      top.appendChild(this.craftingSection(2));
      panel.appendChild(top);
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
        cost.textContent = !r ? (this.work && this.work[0] && this.work[1] ? 'These cannot be combined' : 'Put an item on the left, and a matching item, its material or an Enchanted Book on the right')
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
    if (g.milestones) g.milestones.event('anvil');
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
    const hidden = new Set([B.AIR, B.CINDERROOT, B.WATER, B.LAVA, B.FURNACE_LIT, B.SMOKER_LIT, B.BLAST_FURNACE_LIT, B.WHEAT, B.CARROTS, B.POTATOES, B.BEETROOTS, B.MELON_STEM, B.PUMPKIN_STEM, B.DOOR, B.BED, B.FIRE, B.PAINTING, B.PAINTING_B, B.OAK_WALL_SIGN, B.COCOA]);
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

  /** Trading with a settler: each offer row shows price -> goods; click to trade. */
  openTrade(mob) {
    this.game.input.unlock();
    const g = this.game, inv = g.player.inventory;
    const title = `${mob.profession[0].toUpperCase() + mob.profession.slice(1)} Settler`;
    // Village Champions pay less (a guest pays from its own inventory, so its own effect sets the price)
    const cut = championDiscount(g.player.effects);
    this.showContainer('trade', title, (panel) => {
      const list = el('<div class="trade-list"></div>');
      mob.trades.forEach((o) => {
        const row = el(`<div class="trade-row">
          <div class="slot${offerPrice(o, cut) < o.giveCount ? ' discounted' : ''}">${this.slotHTML({ id: o.give, count: offerPrice(o, cut) })}</div>
          <div class="arrow">➜</div>
          <div class="slot">${this.slotHTML({ id: o.get, count: o.getCount })}</div>
          <span class="trade-name"></span><button class="btn trade-btn">Trade</button></div>`);
        row.querySelector('.trade-name').textContent = ITEMS[o.get].name;
        const btn = row.querySelector('button');
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const times = e.shiftKey ? 64 : 1;
          if (mob.netProxy) { if (canTrade(o, inv, cut)) g.net.requestTrade(mob, mob.trades.indexOf(o), times); return; } // the host keeps count
          let done = 0;
          for (let k = 0; k < times && canTrade(o, inv, cut); k++) {
            const got = doTrade(o, inv, cut);
            const left = inv.add(got);
            if (left) g.entities.spawnItem(g.player.x, g.player.y + 1, g.player.z, { ...got, count: left });
            done++;
          }
          if (done) { mob.traded = true; g.milestones.event('trade'); g.audio.play('hmm', [mob.x, mob.y + 1.5, mob.z]); g.entities.spawnXp(g.player.x, g.player.y + 1, g.player.z, 3 * done); }
          this.refreshAll();
        });
        this.refreshers.push(() => {
          const ok = canTrade(o, inv, cut);
          btn.disabled = !ok;
          row.classList.toggle('sold-out', o.uses >= MAX_USES);
          btn.textContent = o.uses >= MAX_USES ? 'Sold out' : 'Trade';
        });
        list.appendChild(row);
      });
      panel.appendChild(list);
      panel.appendChild(el('<div class="recipes-hint">Shift-click trades as often as you can afford. Offers restock every half day.</div>'));
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
      <div class="field"><label>Render distance: <b id="rdv">${g.settings.renderDistance}</b> chunks</label><input type="range" min="2" max="16" value="${g.settings.renderDistance}" id="rd"></div>
      <div class="field"><label>Field of view: <b id="fovv">${g.settings.fov}</b></label><input type="range" min="50" max="110" value="${g.settings.fov}" id="fov"></div>
      <div class="field"><label>Mouse sensitivity: <b id="msv">${g.settings.sensitivity}</b></label><input type="range" min="10" max="200" value="${g.settings.sensitivity}" id="ms"></div>
      <div class="field"><label>Volume: <b id="volv">${Math.round(g.settings.volume * 100)}</b>%</label><input type="range" min="0" max="100" value="${Math.round(g.settings.volume * 100)}" id="vol"></div>
      <div class="field"><label>Music: <b id="musv">${Math.round((g.settings.music ?? 0.5) * 100)}</b>%</label><input type="range" min="0" max="100" value="${Math.round((g.settings.music ?? 0.5) * 100)}" id="mus"></div>
      <div class="field"><label><input type="checkbox" id="sh" ${g.settings.shadows ? 'checked' : ''}> Sun shadows (3 shadow-casting lights)</label></div>
      <div class="btn-row"><button class="btn" id="fx">Shaders: ${g.settings.shaders !== false ? 'On' : 'Off'}</button>
      <button class="btn" id="fast">Low-lag graphics</button></div>
      <div class="sub" style="font-size:12px;opacity:.7;margin:-4px 0 6px">Laggy? Turn shaders off here or press F7 at any time</div>
      <div class="btn-row"><button class="btn" id="dlc">Day/night cycle: ${g.settings.daylightCycle !== false ? 'On' : 'Off'}</button>
      <button class="btn" id="hm">Hostile mobs: ${g.settings.hostileMobs !== false ? 'On' : 'Off'}</button></div>
      <button class="btn" id="crd">Show coordinates: ${g.settings.showCoords ? 'On' : 'Off'}</button>
      <button class="btn" id="diff">Difficulty: ${cap(g.difficulty)}</button>
      <button class="btn" data-a="ms">Milestones</button>
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
    const players = el('<p class="sub net-players"></p>');
    players.textContent = `Players: ${net.playerNames().join(', ')}`;
    if (net.isHost) {
      const info = el(`<div class="net-room"><p class="sub">Open to friends · room code <b class="net-code"></b></p>
        <div class="join-row"><input type="text" readonly class="net-link"><button class="btn" data-a="copy">Copy Link</button></div></div>`);
      info.querySelector('.net-code').textContent = net.code;
      const link = info.querySelector('.net-link');
      link.value = net.link;
      link.onclick = () => link.select();
      info.querySelector('[data-a=copy]').onclick = (e) => {
        link.select();
        const done = () => { e.target.textContent = 'Copied'; };
        if (navigator.clipboard) navigator.clipboard.writeText(net.link).then(done, () => document.execCommand('copy'));
        else { document.execCommand('copy'); done(); }
      };
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
      box.append(opts);
    } else {
      const info = el('<p class="sub"></p>');
      info.textContent = `Playing in ${net.welcome.hostName}'s world as ${net.name}`;
      box.append(info);
    }
    box.append(players);
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
      head.textContent = l.book.id === I.WRITTEN_BOOK ? `${l.book.title || 'Untitled'}${l.book.author ? ' by ' + l.book.author : ''}` : 'Writable Book';
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
    const s = el(`<div class="screen"><h2>Milestones (${done.size}/${MILESTONES.length})</h2><div class="milestone-list"></div><button class="btn">Back</button></div>`);
    const list = s.querySelector('.milestone-list');
    for (const m of MILESTONES) {
      const row = el(`<div class="milestone-row ${done.has(m.id) ? 'done' : ''}"><img src="${iconURL(m.icon)}"><div><b></b><div class="d"></div></div></div>`);
      row.querySelector('b').textContent = m.title;
      row.querySelector('.d').textContent = m.desc;
      list.appendChild(row);
    }
    s.querySelector('button').onclick = () => this.showPause();
    this.layer.appendChild(s);
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
    this.layer.appendChild(s);
  }
}

function cap(w) { return w[0].toUpperCase() + w.slice(1); }

// Menus and container screens (inventory, workbench, furnace).
import { iconURL } from './icons.js';
import { ITEMS, maxStack } from '../world/items.js';
import { craft, RECIPES, recipeLayout, chooseIngredients } from '../player/crafting.js';
import { B } from '../world/blocks.js';
import { canTrade, doTrade, MAX_USES } from '../mobs/trades.js';

function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

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

  clear() { this.layer.innerHTML = ''; this.tooltipEl.classList.add('hidden'); }

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
    give(this.cursor); this.cursor = null;
    this.renderCursor();
    this.open = null;
    if (this.chest) this.game.audio.play('chest_close', [this.chest.x + 0.5, this.chest.y + 0.5, this.chest.z + 0.5]);
    this.furnace = null;
    this.chest = null;
    this.clear();
    g.onUIClosed();
  }

  // ---- generic slot handling -------------------------------------------------
  slotHTML(st) {
    if (!st) return '';
    const d = ITEMS[st.id];
    let h = `<img src="${iconURL(st.id)}">`;
    if (st.count > 1) h += `<span class="count">${st.count}</span>`;
    if (d && d.durability && st.damage > 0) {
      const f = 1 - st.damage / d.durability;
      h += `<div class="dura"><div style="width:${f * 100}%;background:hsl(${f * 120},90%,50%)"></div></div>`;
    }
    return h;
  }

  renderCursor() {
    if (!this.cursor) { this.cursorEl.classList.add('hidden'); return; }
    this.cursorEl.classList.remove('hidden');
    this.cursorEl.innerHTML = `<img src="${iconURL(this.cursor.id)}">${this.cursor.count > 1 ? `<span class="count">${this.cursor.count}</span>` : ''}`;
  }

  makeSlot(get, set, opts = {}) {
    const s = document.createElement('div');
    s.className = 'slot';
    const refresh = () => { s.innerHTML = this.slotHTML(get()); };
    refresh();
    s.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (opts.onClick) opts.onClick(e); else this.clickSlot(get, set, e.button === 2, e.shiftKey, opts);
      this.refreshAll();
    });
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    s.addEventListener('mouseenter', () => {
      const st = get();
      if (st) { this.tooltipEl.textContent = ITEMS[st.id].name; this.tooltipEl.classList.remove('hidden'); }
    });
    s.addEventListener('mouseleave', () => this.tooltipEl.classList.add('hidden'));
    this.refreshers.push(refresh);
    return s;
  }

  clickSlot(get, set, right, shift, opts) {
    const st = get();
    if (shift && st && opts.quickMove) { opts.quickMove(); return; }
    const c = this.cursor;
    if (c && opts.filter && !opts.filter(c)) return; // e.g. only armour of the right kind fits an armour slot
    if (opts.takeOnly) { if (st && (!c || (c.id === st.id && c.count + st.count <= maxStack(st.id)))) { this.cursor = c ? { ...c, count: c.count + st.count } : st; set(null); } return; }
    if (!right) {
      if (!c) { this.cursor = st; set(null); }
      else if (!st) { set(c); this.cursor = null; }
      else if (st.id === c.id && !ITEMS[st.id].durability) {
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
      } else if (c && (!st || (st.id === c.id && st.count < maxStack(st.id) && !ITEMS[st.id].durability))) {
        if (!st) set({ ...c, count: 1 }); else { st.count++; set(st); }
        c.count--;
        if (c.count <= 0) this.cursor = null;
      }
    }
  }

  refreshAll() { for (const r of this.refreshers) r(); this.renderCursor(); this.game.player.inventory.changed(); }

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
        if (s && s.id === st.id && !ITEMS[s.id].durability) { const n = Math.min(left, maxStack(s.id) - s.count); s.count += n; left -= n; }
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
    const consume = () => { for (let i = 0; i < this.craftGrid.length; i++) { const s = this.craftGrid[i]; if (s) { s.count--; if (s.count <= 0) this.craftGrid[i] = null; } } };
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
          if (!c) this.cursor = { id: r.id, count: r.count, damage: 0 };
          else if (c.id === r.id && c.count + r.count <= maxStack(r.id)) c.count += r.count;
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
    this.refreshers = [];
    this.open = kind;
    const panel = el(`<div class="panel"><h3>${title}</h3></div>`);
    const screen = el('<div class="screen" style="background:rgba(0,0,0,.35)"></div>');
    this.side = null;
    inner(panel);
    if (this.side) {
      const row = el('<div style="display:flex;gap:10px;align-items:stretch"></div>');
      row.append(this.side, panel);
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
    const fuelOf = (st) => st && ITEMS[st.id] && ITEMS[st.id].fuel;
    this.showContainer('furnace', 'Furnace', (panel) => {
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
    const c = this.game.getChest(x, y, z);
    const inv = this.game.player.inventory;
    /** Move a stack into a range of slots (merging first); returns what is left. */
    const insert = (slots, from, to, st) => {
      let left = st.count;
      for (let k = from; k < to && left; k++) {
        const s = slots[k];
        if (s && s.id === st.id && !ITEMS[s.id].durability) { const n = Math.min(left, maxStack(s.id) - s.count); s.count += n; left -= n; }
      }
      for (let k = from; k < to && left; k++) if (!slots[k]) { slots[k] = { ...st, count: left }; left = 0; }
      return left;
    };
    this.showContainer('chest', 'Chest', (panel) => {
      const grid = el('<div class="grid" style="grid-template-columns:repeat(9,var(--slot));margin-bottom:12px"></div>');
      for (let i = 0; i < 27; i++) {
        grid.appendChild(this.makeSlot(() => c.slots[i], (v) => { c.slots[i] = v; }, {
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
          const left = insert(c.slots, 0, 27, st);
          if (left === st.count) return false;
          if (left) { st.count = left; return 'partial'; }
          return true;
        },
      }));
    });
    this.chest = c;
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
    const hidden = new Set([B.AIR, B.WATER, B.LAVA, B.FURNACE_LIT, B.WHEAT, B.CARROTS, B.DOOR, B.BED]);
    const all = ITEMS.filter((d) => d && d.id && !hidden.has(d.id));
    this.showContainer('creative', 'Creative Inventory', (panel) => {
      const search = el('<input class="creative-search" placeholder="Search items...">');
      search.addEventListener('keydown', (e) => e.stopPropagation());
      search.addEventListener('keyup', (e) => e.stopPropagation());
      const grid = el('<div class="grid creative-grid" style="grid-template-columns:repeat(9,var(--slot))"></div>');
      const fill = () => {
        grid.innerHTML = '';
        const q = search.value.trim().toLowerCase();
        for (const d of all) {
          if (q && !d.name.toLowerCase().includes(q)) continue;
          grid.appendChild(this.makeSlot(() => ({ id: d.id, count: 1 }), () => {}, {
            onClick: (e) => {
              if (this.cursor) { this.cursor = null; return; } // clicking the catalogue deletes the held stack
              const st = { id: d.id, count: e.button === 2 ? 1 : maxStack(d.id), damage: 0 };
              if (e.shiftKey) { inv.add(st); return; }
              this.cursor = st;
            },
          }));
        }
      };
      search.addEventListener('input', () => { this.refreshers = this.refreshers.filter((r) => !r.catalog); fill(); this.refreshAll(); });
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
    this.showContainer('trade', title, (panel) => {
      const list = el('<div class="trade-list"></div>');
      mob.trades.forEach((o) => {
        const row = el(`<div class="trade-row">
          <div class="slot">${this.slotHTML({ id: o.give, count: o.giveCount })}</div>
          <div class="arrow">➜</div>
          <div class="slot">${this.slotHTML({ id: o.get, count: o.getCount })}</div>
          <span class="trade-name"></span><button class="btn trade-btn">Trade</button></div>`);
        row.querySelector('.trade-name').textContent = ITEMS[o.get].name;
        const btn = row.querySelector('button');
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const times = e.shiftKey ? 64 : 1;
          let done = 0;
          for (let k = 0; k < times && canTrade(o, inv); k++) {
            const got = doTrade(o, inv);
            const left = inv.add(got);
            if (left) g.entities.spawnItem(g.player.x, g.player.y + 1, g.player.z, { ...got, count: left });
            done++;
          }
          if (done) { g.audio.play('hmm', [mob.x, mob.y + 1.5, mob.z]); g.entities.spawnXp(g.player.x, g.player.y + 1, g.player.z, 3 * done); }
          this.refreshAll();
        });
        this.refreshers.push(() => {
          const ok = canTrade(o, inv);
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
    if (this.open === 'furnace') for (const r of this.refreshers) r();
    if (this.open === 'sleep' && this.sleepEl) {
      const s = this.game.player.sleeping;
      this.sleepEl.style.background = `rgba(4,6,14,${s ? Math.min(1, s.ticks / 70) : 0})`;
    }
  }

  showPause() {
    this.clear();
    this.open = 'pause';
    const g = this.game;
    const s = el(`<div class="screen">
      <h2>Paused</h2>
      <button class="btn" data-a="resume">Back to Game</button>
      <div class="field"><label>Render distance: <b id="rdv">${g.settings.renderDistance}</b> chunks</label><input type="range" min="2" max="16" value="${g.settings.renderDistance}" id="rd"></div>
      <div class="field"><label>Field of view: <b id="fovv">${g.settings.fov}</b></label><input type="range" min="50" max="110" value="${g.settings.fov}" id="fov"></div>
      <div class="field"><label>Mouse sensitivity: <b id="msv">${g.settings.sensitivity}</b></label><input type="range" min="10" max="200" value="${g.settings.sensitivity}" id="ms"></div>
      <div class="field"><label>Volume: <b id="volv">${Math.round(g.settings.volume * 100)}</b>%</label><input type="range" min="0" max="100" value="${Math.round(g.settings.volume * 100)}" id="vol"></div>
      <div class="field"><label>Music: <b id="musv">${Math.round((g.settings.music ?? 0.5) * 100)}</b>%</label><input type="range" min="0" max="100" value="${Math.round((g.settings.music ?? 0.5) * 100)}" id="mus"></div>
      <div class="field"><label><input type="checkbox" id="sh" ${g.settings.shadows ? 'checked' : ''}> Sun shadows (3 shadow-casting lights)</label></div>
      <button class="btn" data-a="title">Save &amp; Quit to Title</button>
    </div>`);
    const bind = (id, lbl, fn) => s.querySelector('#' + id).addEventListener('input', (e) => { s.querySelector('#' + lbl).textContent = fn(+e.target.value); });
    bind('rd', 'rdv', (v) => { g.setSetting('renderDistance', v); return v; });
    bind('fov', 'fovv', (v) => { g.setSetting('fov', v); return v; });
    bind('ms', 'msv', (v) => { g.setSetting('sensitivity', v); return v; });
    bind('vol', 'volv', (v) => { g.setSetting('volume', v / 100); return v; });
    bind('mus', 'musv', (v) => { g.setSetting('music', v / 100); return v; });
    s.querySelector('#sh').addEventListener('change', (e) => g.setSetting('shadows', e.target.checked));
    s.querySelector('[data-a=resume]').onclick = () => { this.open = null; this.clear(); g.onUIClosed(); };
    s.querySelector('[data-a=title]').onclick = () => g.quitToTitle();
    this.layer.appendChild(s);
  }

  showDeath(cause) {
    this.clear();
    this.cursor = null; this.renderCursor();
    this.open = 'death';
    const msgs = {
      fall: 'hit the ground too hard', lava: 'tried to swim in lava', fire: 'burned to death', drown: 'drowned',
      starve: 'starved to death', cactus: 'was pricked to death', void: 'fell out of the world', explosion: 'was blown up',
      arrow: 'was shot by a Rattler', poison: 'succumbed to poison',
    };
    const text = msgs[cause] || (cause && cause.startsWith('mob:') ? `was slain by a ${cause.slice(4)}` : 'died');
    const s = el(`<div class="screen" id="death-screen"><h2>You Died!</h2><p class="sub">Player ${text}</p><button class="btn">Respawn</button></div>`);
    s.querySelector('button').onclick = () => { this.open = null; this.clear(); this.game.respawn(); };
    this.layer.appendChild(s);
  }
}

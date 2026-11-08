// Touch controls: a thumbstick, drag-to-look, action buttons, a swipeable hotbar and a small tools bar
// for the inventory screens. Everything is fed into ui/input.js the way the gamepad is (whole actions
// are pressed and released, the stick and the look delta are added to the same movement), so the game
// code is not duplicated. This module is only loaded (and its DOM and listeners only exist) on a touch
// device or when the setting forces it. The maths is in ui/touchMath.js.
import {
  STICK_RADIUS, HOLD_MS, TAP_SLOP, stickVector, knobOffset, inStickZone, classifyGesture, lookDelta,
  swipeSlot, hotbarIndexAt, buttonScale, controlOpacity, normalizeTouch, toolsFor,
} from './touchMath.js';

/** Buttons held while the finger is down ('hold'), switched by a tap ('toggle') or pressed once ('tap'). */
const BUTTONS = [
  { id: 'jump', label: 'Jump', mode: 'hold', action: 'jump' },
  { id: 'use', label: 'Use', mode: 'hold', action: 'use', hint: 'Place / use' },
  { id: 'attack', label: 'Mine', mode: 'hold', action: 'attack', hint: 'Break (hold to mine)' },
  { id: 'sneak', label: 'Sneak', mode: 'toggle', action: 'sneak' },
];
const TOP = [
  { id: 'pause', label: 'Menu', mode: 'tap', action: 'pause', hint: 'Pause' },
  { id: 'inventory', label: 'Bag', mode: 'tap', action: 'inventory', hint: 'Inventory' },
  { id: 'chat', label: 'Chat', mode: 'tap', chat: true },
  { id: 'guide', label: 'Guide', mode: 'tap', action: 'guide', hint: 'Field Guide' },
  { id: 'journal', label: 'Quests', mode: 'tap', action: 'journal', hint: 'Quest Journal' },
  { id: 'waypoint', label: 'Mark', mode: 'tap', action: 'waypoint', hint: 'Mark a waypoint here' },
  { id: 'full', label: 'Full', mode: 'tap', fullscreen: true, hint: 'Full screen' },
];
const LONG_PRESS_MS = 450;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const canFullscreen = () => { const d = document.documentElement; return !!(d.requestFullscreen || d.webkitRequestFullscreen); };

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.cleanups = [];
    this.stick = null;      // { id, ox, oy }
    this.look = null;       // { id, x, y, sx, sy, t0, state, timer }
    this.held = new Map();  // pointerId -> button record (hold buttons)
    this.mod = { right: false, shift: false }; // the Split / Quick tools of the inventory screens
    this.swallow = false;   // eat the compatibility mouse click that follows a long press
    this.lastOpen = undefined; this.lastScreen = null;
    this.scale = 1;

    this.input.noLock = true; // no pointer lock without a pointer
    document.body.classList.add('touch-on');

    this.pad = el('div'); this.pad.id = 'tc-pad';
    this.ui = el('div'); this.ui.id = 'tc-ui';
    this.tools = el('div', 'tc-tools hidden'); this.tools.id = 'tc-tools';
    this.stickEl = el('div', 'tc-stick'); this.knobEl = el('div', 'tc-knob'); this.stickEl.append(this.knobEl);
    this.ui.append(this.stickEl);
    this.buildButtons();
    this.buildTools();
    document.body.append(this.pad, this.ui, this.tools);

    this.listen(this.pad, 'pointerdown', (e) => this.padDown(e));
    this.listen(this.pad, 'pointermove', (e) => this.padMove(e));
    this.listen(this.pad, 'pointerup', (e) => this.padUp(e, true));
    this.listen(this.pad, 'pointercancel', (e) => this.padUp(e, false));
    // no page zoom, scroll or context menu while playing
    this.listen(document, 'contextmenu', (e) => { if (!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) e.preventDefault(); });
    for (const ev of ['gesturestart', 'gesturechange']) this.listen(document, ev, (e) => e.preventDefault());
    this.listen(document, 'fullscreenchange', () => this.syncFullscreen());
    this.listen(window, 'resize', () => this.layout());
    this.listen(window, 'blur', () => this.releaseAll());
    // hotbar: tap a slot, or slide along it
    const hb = game.hud.hotbar;
    this.hb = null;
    this.listen(hb, 'pointerdown', (e) => this.hotbarDown(e));
    this.listen(hb, 'pointermove', (e) => this.hotbarMove(e));
    this.listen(hb, 'pointerup', (e) => { if (this.hb && this.hb.id === e.pointerId) this.hb = null; });
    this.listen(hb, 'pointercancel', (e) => { if (this.hb && this.hb.id === e.pointerId) this.hb = null; });
    // inventory screens: a long press is a right click; the Split / Quick tools change the next taps
    const layer = game.ui.layer;
    this.listen(layer, 'pointerdown', (e) => this.screenDown(e), true);
    this.listen(layer, 'pointermove', (e) => this.screenMove(e), true);
    this.listen(layer, 'pointerup', (e) => this.screenUp(e), true);
    this.listen(layer, 'pointercancel', (e) => this.screenUp(e), true);
    this.listen(layer, 'mousedown', (e) => this.screenMouse(e), true);

    this.applySettings();
    this.syncFullscreen();
  }

  listen(target, type, fn, capture = false) {
    target.addEventListener(type, fn, { capture, passive: false });
    this.cleanups.push(() => target.removeEventListener(type, fn, { capture }));
  }

  // ---- DOM ------------------------------------------------------------------
  buildButtons() {
    this.btn = {};
    const make = (b, parent) => {
      const e = el('button', 'tc-btn tc-' + b.id, b.label);
      e.type = 'button';
      e.setAttribute('aria-label', b.hint || b.label);
      if (b.fullscreen && !canFullscreen()) e.classList.add('hidden');
      const rec = { ...b, el: e };
      this.btn[b.id] = rec;
      this.listen(e, 'pointerdown', (ev) => this.buttonDown(ev, rec));
      this.listen(e, 'pointerup', (ev) => this.buttonUp(ev, rec));
      this.listen(e, 'pointercancel', (ev) => this.buttonUp(ev, rec));
      this.listen(e, 'contextmenu', (ev) => ev.preventDefault());
      parent.appendChild(e);
    };
    for (const b of BUTTONS) make(b, this.ui);
    const top = el('div', 'tc-top');
    for (const b of TOP) make(b, top);
    this.ui.appendChild(top);
  }

  buildTools() {
    const mk = (id, text, fn) => {
      const b = el('button', 'tc-tool tc-tool-' + id, text);
      b.type = 'button';
      this.listen(b, 'pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
      this.tools.appendChild(b);
      return b;
    };
    this.toolSplit = mk('split', 'Split', () => { this.mod.right = !this.mod.right; this.syncMods(); });
    this.toolQuick = mk('quick', 'Quick', () => { this.mod.shift = !this.mod.shift; this.syncMods(); });
    mk('close', 'Close', () => { const ui = this.game.ui; if (ui.open && ui.open !== 'death') ui.close(); });
  }

  syncMods() {
    this.toolSplit.classList.toggle('on', this.mod.right);
    this.toolQuick.classList.toggle('on', this.mod.shift);
  }

  /** Size, opacity and handedness from the settings (pause menu > Touch controls). */
  applySettings() {
    const s = normalizeTouch(this.game.settings);
    this.scale = buttonScale(s.touchSize);
    const root = document.documentElement.style;
    root.setProperty('--tc-scale', String(this.scale));
    root.setProperty('--tc-opacity', String(controlOpacity(s.touchOpacity)));
    document.body.classList.toggle('tc-left', s.touchLeft);
    this.left = s.touchLeft;
    this.layout();
  }

  /** Where the idle thumbstick ring sits (it moves to the thumb while held). */
  layout() {
    if (this.stick) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.placeStick(this.left ? w * 0.86 : w * 0.14, h * 0.7, false);
  }

  placeStick(x, y, active) {
    this.stickEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    this.stickEl.classList.toggle('active', active);
    if (!active) this.knobEl.style.transform = 'translate(-50%, -50%)';
  }

  /** Once per frame (cheap): show the playing controls or the screen tools, whichever fits what is open. */
  sync() {
    const ui = this.game.ui, open = ui.open;
    const screen = open ? ui.layer.firstElementChild : null;
    if (open === this.lastOpen && screen === this.lastScreen) return;
    const wasOpen = !!this.lastOpen;
    this.lastOpen = open; this.lastScreen = screen;
    const t = toolsFor(open, !!(screen && ui.layer.querySelector('.slot')));
    const preview = !!(open && ui.touchPreview); // the touch settings screen shows the buttons, untouchable
    this.ui.classList.toggle('hidden', !!open && !preview);
    this.ui.classList.toggle('preview', preview);
    this.pad.classList.toggle('hidden', !!open);
    this.tools.classList.toggle('hidden', !t.close);
    this.toolSplit.classList.toggle('hidden', !t.slots);
    this.toolQuick.classList.toggle('hidden', !t.slots);
    if (open && !wasOpen) this.releaseAll();
    if (!t.slots || !open) { this.mod.right = this.mod.shift = false; this.syncMods(); }
    this.btn.sneak.el.classList.toggle('on', this.input.vdown.has('sneak'));
  }

  /** Let go of everything that is held (a screen opens, the page loses focus, the controls go away). */
  releaseAll() {
    if (this.look) { clearTimeout(this.look.timer); this.look = null; }
    this.stick = null;
    this.input.setTouchStick(0, 0, false);
    this.layout();
    for (const rec of this.held.values()) { this.input.releaseAction(rec.action); rec.el.classList.remove('down'); }
    this.held.clear();
    this.input.releaseAction('attack');
    this.hb = null;
  }

  destroy() {
    this.releaseAll();
    this.input.releaseAction('sneak');
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    this.pad.remove(); this.ui.remove(); this.tools.remove();
    document.body.classList.remove('touch-on', 'tc-left');
    const root = document.documentElement.style;
    root.removeProperty('--tc-scale'); root.removeProperty('--tc-opacity');
    this.input.noLock = false;
  }

  // ---- the look / stick area ----------------------------------------------------
  padDown(e) {
    e.preventDefault();
    this.game.wakeAudio();
    const w = window.innerWidth, h = window.innerHeight;
    try { this.pad.setPointerCapture(e.pointerId); } catch { /* the pointer is gone already */ }
    if (!this.stick && inStickZone(e.clientX, e.clientY, w, h, this.left)) {
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.placeStick(e.clientX, e.clientY, true);
    } else if (!this.look) {
      const look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), state: 'pending', timer: 0 };
      look.timer = setTimeout(() => {
        // held in place long enough: mine until the finger lifts (it may still turn the view)
        if (this.look === look && look.state === 'pending' && classifyGesture({ travel: Math.hypot(look.x - look.sx, look.y - look.sy), duration: HOLD_MS }) === 'hold') {
          look.state = 'hold';
          this.input.pressAction('attack');
          if (navigator.vibrate) { try { navigator.vibrate(8); } catch { /* not allowed */ } }
        }
      }, HOLD_MS);
      this.look = look;
    }
  }

  padMove(e) {
    if (this.stick && e.pointerId === this.stick.id) {
      const r = STICK_RADIUS * this.scale, dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const v = stickVector(dx, dy, r);
      this.input.setTouchStick(v.x, v.y, v.sprint);
      const k = knobOffset(dx, dy, r);
      this.knobEl.style.transform = `translate(calc(-50% + ${k.x.toFixed(1)}px), calc(-50% + ${k.y.toFixed(1)}px))`;
      this.stickEl.classList.toggle('sprint', v.sprint);
    } else if (this.look && e.pointerId === this.look.id) {
      const l = this.look, dx = e.clientX - l.x, dy = e.clientY - l.y;
      l.x = e.clientX; l.y = e.clientY;
      if (l.state === 'pending' && classifyGesture({ travel: Math.hypot(l.x - l.sx, l.y - l.sy), duration: 0 }) === 'drag') l.state = 'drag';
      if (l.state !== 'pending') {
        const d = lookDelta(dx, dy);
        this.input.dx += d.dx; this.input.dy += d.dy; // the sensitivity setting scales it in game.js, like the mouse
      }
    }
  }

  padUp(e, released) {
    if (this.stick && e.pointerId === this.stick.id) {
      this.stick = null;
      this.input.setTouchStick(0, 0, false);
      this.stickEl.classList.remove('sprint');
      this.layout();
    } else if (this.look && e.pointerId === this.look.id) {
      const l = this.look;
      clearTimeout(l.timer);
      this.look = null;
      if (l.state === 'hold') this.input.releaseAction('attack');
      else if (released && classifyGesture({ travel: Math.hypot(l.x - l.sx, l.y - l.sy), duration: performance.now() - l.t0, released: true }) === 'tap') {
        // a tap is one swing: pressed and let go again before the next frame
        this.input.pressAction('attack'); this.input.releaseAction('attack');
      }
    }
  }

  // ---- buttons ---------------------------------------------------------------
  buttonDown(e, rec) {
    e.preventDefault(); e.stopPropagation();
    this.game.wakeAudio();
    try { rec.el.setPointerCapture(e.pointerId); } catch { /* ignored */ }
    const g = this.game;
    if (rec.mode === 'hold') {
      this.input.pressAction(rec.action);
      this.held.set(e.pointerId, rec);
      rec.el.classList.add('down');
    } else if (rec.mode === 'toggle') {
      if (this.input.vdown.has(rec.action)) this.input.releaseAction(rec.action); else this.input.pressAction(rec.action);
      rec.el.classList.toggle('on', this.input.vdown.has(rec.action));
    } else if (rec.chat) {
      if (g.running && !g.ui.blocking) g.openChatFrom('');
    } else if (rec.fullscreen) {
      this.toggleFullscreen();
    } else {
      this.input.pressAction(rec.action); this.input.releaseAction(rec.action);
    }
  }

  buttonUp(e, rec) {
    const held = this.held.get(e.pointerId);
    if (!held) return;
    this.held.delete(e.pointerId);
    this.input.releaseAction(held.action);
    held.el.classList.remove('down');
  }

  toggleFullscreen() {
    const d = document.documentElement;
    if (fsElement()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const req = d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : d.webkitRequestFullscreen();
    if (req && req.then) req.then(() => { try { const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (p && p.catch) p.catch(() => {}); } catch { /* not supported */ } }).catch(() => {});
  }

  syncFullscreen() { if (this.btn.full) this.btn.full.el.textContent = fsElement() ? 'Exit' : 'Full'; }

  // ---- hotbar -----------------------------------------------------------------
  hotbarMetrics() {
    const s = this.game.hud.slots;
    const a = s[0].getBoundingClientRect(), b = s[1].getBoundingClientRect();
    return { left: a.left, pitch: b.left - a.left };
  }

  hotbarDown(e) {
    e.preventDefault(); e.stopPropagation();
    this.game.wakeAudio();
    const inv = this.game.player.inventory, m = this.hotbarMetrics();
    const i = hotbarIndexAt(e.clientX, m.left, m.pitch);
    const start = i >= 0 ? i : inv.selected;
    inv.selected = start;
    this.hb = { id: e.pointerId, x0: e.clientX, start };
    try { this.game.hud.hotbar.setPointerCapture(e.pointerId); } catch { /* ignored */ }
  }

  hotbarMove(e) {
    if (!this.hb || this.hb.id !== e.pointerId) return;
    e.preventDefault();
    const m = this.hotbarMetrics();
    this.game.player.inventory.selected = swipeSlot(this.hb.start, e.clientX - this.hb.x0, m.pitch);
  }

  // ---- inventory screens ------------------------------------------------------------
  /** Dispatch a mouse press at a slot as if the player had clicked it (button 2 = right, shift = quick move). */
  clickAs(target, button, shift) {
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button, buttons: button === 2 ? 2 : 1, shiftKey: shift, clientX: this.lastX || 0, clientY: this.lastY || 0, view: window });
    target.dispatchEvent(ev);
  }

  screenDown(e) {
    if (e.pointerType === 'mouse') return;
    this.swallow = false;
    this.lastX = e.clientX; this.lastY = e.clientY;
    const slot = e.target.closest && e.target.closest('.slot');
    clearTimeout(this.press && this.press.timer);
    this.press = null;
    if (!slot) return;
    const press = { id: e.pointerId, x: e.clientX, y: e.clientY, slot, timer: 0 };
    press.timer = setTimeout(() => {
      if (this.press !== press) return;
      this.press = null;
      this.swallow = true; // the compatibility click that may still follow is not wanted
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch { /* not allowed */ } }
      this.clickAs(slot, 2, false);
    }, LONG_PRESS_MS);
    this.press = press;
  }

  screenMove(e) {
    const p = this.press;
    if (p && p.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP * 1.5) { clearTimeout(p.timer); this.press = null; }
  }

  screenUp(e) {
    const p = this.press;
    if (p && p.id === e.pointerId) { clearTimeout(p.timer); this.press = null; }
  }

  /** Real (trusted) presses on a slot: eaten after a long press, or turned into a right / shift click by the tools. */
  screenMouse(e) {
    if (!e.isTrusted) return;
    if (this.swallow) { this.swallow = false; e.stopImmediatePropagation(); e.preventDefault(); return; }
    if (!(this.mod.right || this.mod.shift)) return;
    const slot = e.target.closest && e.target.closest('.slot');
    if (!slot) return;
    e.stopImmediatePropagation(); e.preventDefault();
    this.lastX = e.clientX; this.lastY = e.clientY;
    this.clickAs(slot, this.mod.right ? 2 : 0, this.mod.shift);
  }
}

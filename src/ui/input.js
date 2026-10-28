// Keyboard + mouse input with pointer lock.
export const KEYS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], sneak: ['ShiftLeft', 'ShiftRight'], crawl: ['KeyC'], sprint: ['ControlLeft', 'ControlRight', 'KeyR'],
  inventory: ['KeyE'], drop: ['KeyQ'], debug: ['F3'], hud: ['F1'], pause: ['Escape'], perspective: ['F5'], shaders: ['F7'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();   // keys pressed since last consume
    this.mouse = { left: false, right: false, middle: false, leftPressed: false, rightPressed: false, middlePressed: false };
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.sensitivity = 0.0022;
    this.locked = false;
    this.lastForwardTap = 0;
    this.lastJumpTap = 0;
    this.flyToggle = false;     // double-tapped jump (creative flight)
    this.doubleTapSprint = false;
    this.onKey = null;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (this.locked) e.preventDefault(); return; }
      if (['Space', 'F1', 'F3', 'F5', 'F7', 'Tab', 'Slash'].includes(e.code) || (e.ctrlKey && e.code === 'KeyW')) e.preventDefault();
      if (KEYS.jump.includes(e.code)) {
        const now = performance.now();
        if (now - this.lastJumpTap < 280) { this.flyToggle = true; this.lastJumpTap = 0; } else this.lastJumpTap = now;
      }
      if (KEYS.forward.includes(e.code)) {
        const now = performance.now();
        if (now - this.lastForwardTap < 280) this.doubleTapSprint = true;
        this.lastForwardTap = now;
      }
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (this.onKey) this.onKey(e);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      if (KEYS.forward.includes(e.code)) this.doubleTapSprint = false;
    });
    window.addEventListener('blur', () => { this.down.clear(); this.mouse.left = this.mouse.right = this.mouse.middle = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
      if (e.button === 1) { this.mouse.middle = true; this.mouse.middlePressed = true; e.preventDefault(); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
      if (e.button === 1) this.mouse.middle = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  lock() {
    if (this.locked || !this.canvas.requestPointerLock) return;
    // Browsers refuse to re-lock for ~1 s after Esc; the next click locks instead.
    try { const r = this.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* ignored */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  is(action) { return KEYS[action].some((k) => this.down.has(k)); }
  wasPressed(action) { return KEYS[action].some((k) => this.pressed.has(k)); }
  codePressed(code) { return this.pressed.has(code); }

  consumeMouse() {
    const r = { dx: this.dx, dy: this.dy, wheel: this.wheel };
    this.dx = 0; this.dy = 0; this.wheel = 0;
    return r;
  }
  endFrame() {
    this.pressed.clear();
    this.mouse.leftPressed = this.mouse.rightPressed = this.mouse.middlePressed = false;
  }

  movement() {
    return {
      forward: (this.is('forward') ? 1 : 0) - (this.is('back') ? 1 : 0),
      strafe: (this.is('right') ? 1 : 0) - (this.is('left') ? 1 : 0),
      jump: this.is('jump'),
      sneak: this.is('sneak'),
      crawl: this.is('crawl'),
      sprint: this.is('sprint') || this.doubleTapSprint,
    };
  }
}

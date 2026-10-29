import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ACTIONS, ACTION_IDS, SLOT_KINDS, defaultTable, resolveBindings, toOverrides, setBinding, findBinding, keyLists, codeLabel, codeKind,
} from '../src/ui/bindings.js';
import { applyDeadzone, readPad, buttonEdges, lookPixels, lookCurve, firstPad, PAD_BUTTONS, LOOK_RATE, MOUSE_RAD_PER_PX } from '../src/ui/gamepad.js';
import {
  ACCESS_DEFAULTS, COLOR_BLIND_MODES, nextColorBlind, motionScales, captionText, soundDirection, CaptionLog,
  CAPTION_MS, CAPTION_MAX, HUD_PALETTES, hudPalette,
} from '../src/ui/accessibility.js';
import { Input } from '../src/ui/input.js';

describe('rebindable controls', () => {
  it('every action has a key, spare and gamepad slot and the defaults never share a code', () => {
    const seen = new Set();
    for (const a of ACTIONS) {
      expect(a.def).toHaveLength(3);
      a.def.forEach((c, s) => {
        if (c === null) return;
        expect(codeKind(c)).toBe(SLOT_KINDS[s]);
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      });
    }
    expect(new Set(ACTION_IDS).size).toBe(ACTION_IDS.length);
  });

  it('keeps the classic layout by default', () => {
    const k = keyLists(defaultTable());
    expect(k.forward).toEqual(['KeyW', 'ArrowUp']);
    expect(k.sprint).toContain('ControlLeft');
    expect(k.slot5).toEqual(['Digit5']);
    expect(k.jump).toEqual(['Space', 'PadA']);
    expect(k.pause).toEqual(['Escape', 'PadStart']);
  });

  it('only saves what differs from the defaults', () => {
    expect(toOverrides(defaultTable())).toEqual({});
    const r = setBinding(defaultTable(), 'drop', 0, 'KeyG');
    expect(toOverrides(r.table)).toEqual({ drop: ['KeyG', null, 'PadB'] });
    expect(resolveBindings(toOverrides(r.table)).drop[0]).toBe('KeyG');
  });

  it('an unused code just replaces the slot', () => {
    const r = setBinding(defaultTable(), 'inventory', 0, 'KeyI');
    expect(r.swapped).toBeNull();
    expect(r.table.inventory).toEqual(['KeyI', null, 'PadY']);
  });

  it('a code in use swaps places so nothing is left unbound', () => {
    const r = setBinding(defaultTable(), 'inventory', 0, 'KeyQ'); // Q belonged to "drop"
    expect(r.swapped).toEqual({ id: 'drop', slot: 0 });
    expect(r.table.inventory[0]).toBe('KeyQ');
    expect(r.table.drop[0]).toBe('KeyE');
    expect(findBinding(r.table, 'KeyQ')).toEqual({ id: 'inventory', slot: 0 });
  });

  it('swapping inside one action exchanges its own slots', () => {
    const r = setBinding(defaultTable(), 'forward', 0, 'ArrowUp');
    expect(r.table.forward).toEqual(['ArrowUp', 'KeyW', null]);
  });

  it('a gamepad button can swap with another action too', () => {
    const r = setBinding(defaultTable(), 'jump', 2, 'PadB'); // B was "drop"
    expect(r.table.jump[2]).toBe('PadB');
    expect(r.table.drop[2]).toBe('PadA');
  });

  it('refuses reserved codes and the wrong kind of code, and can unbind', () => {
    const t = defaultTable();
    expect(setBinding(t, 'jump', 0, 'Escape').error).toBeTruthy();
    expect(setBinding(t, 'jump', 2, 'PadStart').error).toBeTruthy();
    expect(setBinding(t, 'jump', 0, 'PadX').error).toBeTruthy();
    expect(setBinding(t, 'jump', 2, 'KeyJ').error).toBeTruthy();
    expect(setBinding(t, 'nonsense', 0, 'KeyJ').error).toBeTruthy();
    const r = setBinding(t, 'crawl', 0, null);
    expect(r.table.crawl[0]).toBeNull();
    expect(keyLists(r.table).crawl).toEqual(['PadDown']);
    expect(t.crawl[0]).toBe('KeyC'); // the input table is never changed
  });

  it('survives garbage in saved settings', () => {
    for (const bad of [null, 5, 'x', [], { forward: 'W' }, { forward: [1, 2, 3] }, { nope: ['KeyZ', null, null] }, { jump: ['Escape', 'PadA', 'KeyX'] }]) {
      const t = resolveBindings(bad);
      expect(Object.keys(t)).toEqual(ACTION_IDS);
      for (const a of ACTIONS) expect(t[a.id]).toHaveLength(3);
    }
    expect(resolveBindings({ jump: ['Escape', 'PadA', 'KeyX'] }).jump).toEqual(['Space', null, 'KeyX'].map((c, i) => (i === 2 ? 'PadA' : c)));
  });

  it('a code saved twice ends up in only one place', () => {
    const t = resolveBindings({ drop: ['KeyW', null, 'PadB'] }); // W is still forward's
    expect(t.forward[0]).toBe('KeyW');
    expect(t.drop[0]).toBeNull();
  });

  it('names keys and buttons for humans', () => {
    expect(codeLabel('KeyW')).toBe('W');
    expect(codeLabel('Digit7')).toBe('7');
    expect(codeLabel('Space')).toBe('Space');
    expect(codeLabel('ArrowLeft')).toBe('Left');
    expect(codeLabel('F3')).toBe('F3');
    expect(codeLabel('PadRT')).toBe('Right trigger');
    expect(codeLabel('Numpad4')).toBe('Num 4');
    expect(codeLabel(null)).toBe('Unbound');
  });
});

describe('gamepad', () => {
  const pad = (over = {}) => ({
    connected: true,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
    ...over,
  });

  it('drops small stick drift and rescales the rest', () => {
    expect(applyDeadzone(0.1, 0.1)).toEqual([0, 0]);
    const [x, y] = applyDeadzone(1, 0);
    expect(x).toBeCloseTo(1); expect(y).toBeCloseTo(0);
    const [hx] = applyDeadzone(0.59, 0); // halfway through the live range
    expect(hx).toBeCloseTo(0.5, 1);
    const [dx, dy] = applyDeadzone(1, 1); // corners are clamped to the unit circle
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(1.0001);
  });

  it('reads buttons, analog triggers and sticks from a standard snapshot', () => {
    const p = pad({ axes: [0.9, -0.9, 0, 0.5] });
    p.buttons[0] = { pressed: true, value: 1 };
    p.buttons[7] = { pressed: false, value: 0.6 };  // right trigger pulled
    p.buttons[6] = { pressed: false, value: 0.1 };  // left trigger barely touched
    p.buttons[12] = { pressed: true, value: 1 };
    const r = readPad(p);
    expect(r.buttons.has('PadA')).toBe(true);
    expect(r.buttons.has('PadRT')).toBe(true);
    expect(r.buttons.has('PadLT')).toBe(false);
    expect(r.buttons.has('PadUp')).toBe(true);
    expect(r.lx).toBeGreaterThan(0.5); expect(r.ly).toBeLessThan(-0.5);
    expect(r.rx).toBe(0); expect(r.ry).toBeGreaterThan(0);
    expect(readPad(null)).toBeNull();
    expect(PAD_BUTTONS).toHaveLength(16);
  });

  it('finds edges between polls', () => {
    const e = buttonEdges(new Set(['PadA', 'PadB']), new Set(['PadB', 'PadX']));
    expect(e.down).toEqual(['PadX']);
    expect(e.up).toEqual(['PadA']);
  });

  it('look speed matches the documented rate and keeps small pushes fine', () => {
    const full = lookPixels(1, 0, 1);
    expect(full.dx * MOUSE_RAD_PER_PX).toBeCloseTo(LOOK_RATE);
    expect(lookPixels(0.3, 0, 1).dx).toBeLessThan(full.dx * 0.3); // curve: gentler than linear
    expect(lookPixels(-1, 0, 0.5).dx).toBeLessThan(0);
    expect(lookCurve(-0.5)).toBeLessThan(0);
  });

  it('picks the first connected pad', () => {
    expect(firstPad([null, pad({ connected: false }), pad()])).not.toBeNull();
    expect(firstPad([null, pad({ connected: false })])).toBeNull();
    expect(firstPad(null)).toBeNull();
  });
});

describe('Input with a gamepad and rebinding', () => {
  let saved;
  let current;
  const setPad = (p) => { current = p; };
  const mkPad = (buttons = [], axes = [0, 0, 0, 0]) => {
    const b = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    for (const i of buttons) b[i] = { pressed: true, value: 1 };
    return { connected: true, buttons: b, axes };
  };
  beforeAll(() => {
    saved = { window: globalThis.window, document: globalThis.document, nav: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
    const noop = () => {};
    globalThis.window = { addEventListener: noop };
    globalThis.document = { addEventListener: noop, pointerLockElement: null };
    Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [current] }, configurable: true });
  });
  afterAll(() => {
    globalThis.window = saved.window; globalThis.document = saved.document;
    if (saved.nav) Object.defineProperty(globalThis, 'navigator', saved.nav); else delete globalThis.navigator;
  });
  const canvas = { addEventListener() {} };

  it('buttons act like keys and the left stick moves', () => {
    const inp = new Input(canvas);
    setPad(mkPad([0], [0.5, -1, 0, 0])); // A held, stick pushed up and right
    inp.beginFrame(0.016, true);
    expect(inp.is('jump')).toBe(true);
    expect(inp.wasPressed('jump')).toBe(true);
    const mv = inp.movement();
    expect(mv.forward).toBeGreaterThan(0.8);
    expect(mv.strafe).toBeGreaterThan(0.1);
    inp.endFrame();
    setPad(mkPad([], [0, 0, 0, 0]));
    inp.beginFrame(0.016, true);
    expect(inp.is('jump')).toBe(false);
    expect(inp.wasPressed('jump')).toBe(false);
    expect(inp.movement().forward).toBe(0);
  });

  it('the right stick turns the camera and the trigger clicks', () => {
    const inp = new Input(canvas);
    setPad(mkPad([7], [0, 0, 1, 0]));
    inp.beginFrame(0.1, true);
    expect(inp.dx).toBeGreaterThan(0);
    expect(inp.mouse.left).toBe(true);
    expect(inp.mouse.leftPressed).toBe(true);
    inp.endFrame();
    inp.beginFrame(0.1, true);
    expect(inp.mouse.left).toBe(true);
    expect(inp.mouse.leftPressed).toBe(false); // held, not a new click
    setPad(mkPad());
    inp.beginFrame(0.1, true);
    expect(inp.mouse.left).toBe(false);
  });

  it('nothing clicks or turns while a screen is open', () => {
    const inp = new Input(canvas);
    setPad(mkPad([7], [0, 0, 1, 1]));
    inp.beginFrame(0.1, false);
    expect(inp.mouse.left).toBe(false);
    expect(inp.dx).toBe(0);
  });

  it('a clicked stick keeps sprinting until you stop pushing forward', () => {
    const inp = new Input(canvas);
    setPad(mkPad([10], [0, -1, 0, 0]));
    inp.beginFrame(0.016, true);
    expect(inp.movement().sprint).toBe(true);
    setPad(mkPad([], [0, -1, 0, 0]));
    inp.beginFrame(0.016, true);
    expect(inp.movement().sprint).toBe(true); // latched after the click is released
    setPad(mkPad([], [0, 0, 0, 0]));
    inp.beginFrame(0.016, true);
    expect(inp.movement().sprint).toBe(false);
  });

  it('rebound keys replace the old ones, and a key can be bound to attack', () => {
    const inp = new Input(canvas);
    setPad(null);
    const r = setBinding(setBinding(defaultTable(), 'jump', 0, 'KeyJ').table, 'attack', 0, 'KeyF');
    inp.setBindings(r.table);
    expect(inp.matches('jump', 'KeyJ')).toBe(true);
    expect(inp.matches('jump', 'Space')).toBe(false);
    inp.noteDown('KeyJ');
    expect(inp.is('jump')).toBe(true);
    inp.noteDown('KeyF');
    inp.beginFrame(0.016, true);
    expect(inp.mouse.left).toBe(true);
    expect(inp.mouse.leftPressed).toBe(true);
  });

  it('while the controls screen waits, buttons go to it instead of the game', () => {
    const inp = new Input(canvas);
    const got = [];
    inp.capture = (c) => got.push(c);
    setPad(mkPad([2]));
    inp.beginFrame(0.016, true);
    expect(got).toEqual(['PadX']);
    expect(inp.wasPressed('inventory')).toBe(false);
  });

  it('works without any gamepad', () => {
    const inp = new Input(canvas);
    setPad(null);
    inp.beginFrame(0.016, true);
    expect(inp.pad.connected).toBe(false);
    expect(inp.movement().forward).toBe(0);
  });
});

describe('sound captions', () => {
  const L = [0, 0, 0, 0]; // at the origin, looking down -z

  it('names sounds, skipping footsteps and block hits', () => {
    expect(captionText('explode')).toBe('Explosion');
    expect(captionText('break_stone')).toBe('Block broken');
    expect(captionText('place_wood')).toBe('Block placed');
    expect(captionText('chime_7')).toBe('Chime plays');
    expect(captionText('step_grass')).toBeNull();
    expect(captionText('hit_stone')).toBeNull();
    expect(captionText('sonic_hum')).toBe('Sonic hum'); // unknown names are still readable
    expect(captionText(null)).toBeNull();
  });

  it('ignores interface clicks that have no place in the world', () => {
    expect(captionText('click', false)).toBeNull();
    expect(captionText('pop', false)).toBeNull();
    expect(captionText('click', true)).toBe('Click');
    expect(captionText('explode', false)).toBe('Explosion');
  });

  it('every synthesised sound in audio.js has a caption', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/audio/audio.js', import.meta.url), 'utf8');
    const names = [...src.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(60);
    for (const n of names) expect(captionText(n), n).toBeTruthy();
  });

  it('says which side a sound comes from', () => {
    expect(soundDirection(null, L)).toBe('here');
    expect(soundDirection([0, 0, -8], L)).toBe('ahead');
    expect(soundDirection([0, 0, 8], L)).toBe('behind');
    expect(soundDirection([8, 0, 0], L)).toBe('right');
    expect(soundDirection([-8, 0, 0], L)).toBe('left');
    expect(soundDirection([0.5, 0, 0.5], L)).toBe('here');
    expect(soundDirection([0, 10, 0], L)).toBe('above');
    expect(soundDirection([0, -10, 1], L)).toBe('below');
  });

  it('follows the way the listener faces', () => {
    // turned a quarter turn (yaw pi/2): forward is -x and right is -z
    const yaw = Math.PI / 2;
    expect(soundDirection([-8, 0, 0], [0, 0, 0, yaw])).toBe('ahead');
    expect(soundDirection([8, 0, 0], [0, 0, 0, yaw])).toBe('behind');
    expect(soundDirection([0, 0, -8], [0, 0, 0, yaw])).toBe('right');
    expect(soundDirection([0, 0, 8], [0, 0, 0, yaw])).toBe('left');
  });

  it('agrees with the stereo panning of the audio engine', async () => {
    const { Audio } = await import('../src/audio/audio.js');
    const a = new Audio();
    for (const yaw of [0, 1, 2.5, -1.3]) {
      a.setListener(0, 0, 0, yaw);
      for (const pos of [[6, 0, 2], [-5, 0, 4], [3, 0, -7]]) {
        const pan = a.spatial(pos)[1];
        const dir = soundDirection(pos, [0, 0, 0, yaw]);
        if (dir === 'right') expect(pan).toBeGreaterThan(0);
        if (dir === 'left') expect(pan).toBeLessThan(0);
      }
    }
  });

  it('collects, merges, limits and expires captions', () => {
    const log = new CaptionLog();
    expect(log.add('explode', [0, 0, -4], 1, L, 1000)).toBeTruthy();
    expect(log.add('explode', [4, 0, 0], 1, L, 1500).count).toBe(2); // merged, newest direction wins
    expect(log.items).toHaveLength(1);
    expect(log.items[0].dir).toBe('right');
    expect(log.add('step_grass', [1, 0, 1], 1, L, 1000)).toBeNull();
    expect(log.add('explode', [40, 0, 0], 1, L, 1000)).toBeNull();     // too far to hear
    expect(log.add('hurt', [3, 0, 0], 0.001, L, 1000)).toBeNull();     // too quiet to hear
    expect(log.add('hurt', null, 1, L, 1000).dir).toBe('here');
    const view = log.view(1500);
    expect(view.map((r) => r.text)).toEqual(['Explosion', 'Ouch']);
    expect(view[0].right).toContain('▶');
    expect(view[0].fade).toBe(1);
    expect(log.view(1000 + CAPTION_MS - 200)[1].fade).toBeCloseTo(0.2);
    expect(log.prune(1000 + CAPTION_MS - 100)).toBe(false);
    expect(log.prune(1000 + CAPTION_MS + 1)).toBe(true); // 'Ouch' (1000) expired, 'Explosion' (1500) not yet
    expect(log.items.map((c) => c.text)).toEqual(['Explosion']);
    log.clear();
    expect(log.items).toHaveLength(0);
    for (let i = 0; i < CAPTION_MAX + 3; i++) log.add('sound_' + i, null, 1, L, 0);
    expect(log.items).toHaveLength(CAPTION_MAX);
  });

  it('Audio.play reports every sound to the caption hook even before the audio context exists', async () => {
    const { Audio } = await import('../src/audio/audio.js');
    const a = new Audio();
    const heard = [];
    a.onPlay = (n, p, v) => heard.push([n, p, v]);
    a.play('thunder', null, 0.5);
    a.play('break_stone', [1, 2, 3]);
    expect(heard).toEqual([['thunder', null, 0.5], ['break_stone', [1, 2, 3], 1]]);
  });
});

describe('reduced motion and flashing', () => {
  it('leaves everything on by default and calms what was asked for', () => {
    expect(motionScales({})).toEqual({ bob: 1, tilt: 1, sprintFov: 1, apparitionShake: 1, flash: 1 });
    expect(motionScales({ reduceMotion: true })).toEqual({ bob: 0, tilt: 0, sprintFov: 0, apparitionShake: 0, flash: 1 });
    expect(motionScales({ reduceFlashing: true }).flash).toBeLessThan(0.5);
    expect(motionScales({ reduceFlashing: true }).bob).toBe(1);
    expect(motionScales(undefined).bob).toBe(1);
  });
  it('has defaults that are all off', () => {
    expect(ACCESS_DEFAULTS).toEqual({ captions: false, reduceMotion: false, reduceFlashing: false, colorBlind: 'off' });
  });
});

describe('colour-blind HUD palettes', () => {
  // Machado et al. 2009 simulation matrices (severity 1.0) applied in linear RGB
  const MATS = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
  };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const rgb = (hex) => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
  const sim = (hex, kind) => { const c = rgb(hex), m = MATS[kind]; return m.map((r) => Math.max(0, Math.min(1, r[0] * c[0] + r[1] * c[1] + r[2] * c[2]))); };
  const dist = (a, b, kind) => { const x = sim(a, kind), y = sim(b, kind); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

  it('all modes define the same colours as valid hex', () => {
    const keys = Object.keys(HUD_PALETTES.off);
    for (const mode of COLOR_BLIND_MODES) {
      expect(Object.keys(HUD_PALETTES[mode])).toEqual(keys);
      for (const [k, v] of Object.entries(HUD_PALETTES[mode])) if (k !== 'marks') expect(v, `${mode}.${k}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(hudPalette('bogus')).toBe(HUD_PALETTES.off);
  });

  it('red-green mode pulls poison and hunger away from health and food for protan and deutan eyes', () => {
    for (const kind of ['protan', 'deutan']) {
      const base = HUD_PALETTES.off, p = HUD_PALETTES.redgreen;
      expect(dist(p.heart, p.poison, kind)).toBeGreaterThan(dist(base.heart, base.poison, kind) * 1.5);
      expect(dist(p.heart, p.poison, kind)).toBeGreaterThan(0.25);
      expect(dist(p.food, p.hunger, kind)).toBeGreaterThan(dist(base.food, base.hunger, kind) * 1.5);
    }
  });

  it('blue-yellow mode keeps the air bubble apart from the sea-green poison for tritan eyes', () => {
    const base = HUD_PALETTES.off, p = HUD_PALETTES.blueyellow;
    expect(dist(p.air, p.poison, 'tritan')).toBeGreaterThan(dist(base.air, base.poison, 'tritan'));
    expect(dist(p.gold, p.heart, 'tritan')).toBeGreaterThan(0.1);
  });

  it('adds shape cues only in the friendly modes', () => {
    expect(HUD_PALETTES.off.marks).toBe(false);
    expect(HUD_PALETTES.redgreen.marks).toBe(true);
    expect(HUD_PALETTES.blueyellow.marks).toBe(true);
  });

  it('cycles through the modes and wraps around', () => {
    expect(nextColorBlind('off')).toBe('redgreen');
    expect(nextColorBlind('redgreen')).toBe('blueyellow');
    expect(nextColorBlind('blueyellow')).toBe('off');
    expect(nextColorBlind('nonsense')).toBe('redgreen');
  });
});

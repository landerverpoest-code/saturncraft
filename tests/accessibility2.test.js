// Accessibility round 2: the features added after ui/accessibility.js (Veilfire, falling stars, meteorites, dust storms,
// fireworks, touch controls, Field Guide, statistics, trading, the player list, emotes, help) against captions,
// reduced motion and flashing, high contrast / large text, colour-independent cues, and keyboard / gamepad use.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CAPTION_TEXT, captionText, motionScales, scaledCount, accessClasses, ACCESS_CLASSES, ACCESS_DEFAULTS, priceCue, fxOf, FULL_FX, CaptionLog,
} from '../src/ui/accessibility.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { suppressDefault } from '../src/ui/input.js';
import { pickNext, stickDirection, menuIntent, stepRange, AUTOFOCUS_SCREENS, FOCUSABLE } from '../src/ui/menuNav.js';
import { ACTIONS, resolveBindings, keyLists, defaultTable } from '../src/ui/bindings.js';
import { SkyRocket } from '../src/entities/skyRocket.js';
import { playerRowLabel } from '../src/ui/playerList.js';
import { offerPrice } from '../src/mobs/trades.js';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const AUDIO = src('src/audio/audio.js');
const CSS = src('src/ui/style.css');
const SCREENS = src('src/ui/screens.js');

/** Every sound name audio.js can synthesise: its `case 'name':` labels. */
const audioNames = () => [...AUDIO.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]);
/** Names that are built from a prefix (materials, chimes) and captioned by rule. */
const PREFIXED = /^(step_|hit_|break_|place_|chime_)/;

describe('every sound has a caption', () => {
  const names = audioNames();

  it('finds the sounds in audio.js', () => {
    expect(names.length).toBeGreaterThan(90);
    for (const n of ['meteor_boom', 'rocket_twinkle', 'void_whisper', 'ember_snap', 'parry', 'shield_break', 'spear_throw']) expect(names).toContain(n);
  });

  it('each one has its own entry in the caption table (not just a made-up fallback)', () => {
    const missing = names.filter((n) => !PREFIXED.test(n) && !Object.prototype.hasOwnProperty.call(CAPTION_TEXT, n));
    expect(missing).toEqual([]);
  });

  it('and each caption is a readable, non-empty phrase that is not just the raw sound name', () => {
    for (const n of names) {
      if (PREFIXED.test(n)) continue;
      const t = captionText(n, true);
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(2);
      expect(t).not.toContain('_');
    }
  });

  it('every creature voice is a sound audio.js plays (not the default beep) and is captioned', () => {
    const voices = new Set();
    for (const def of Object.values(MOBS)) if (def.sound) voices.add(def.sound);
    expect(voices.size).toBeGreaterThan(10);
    for (const v of voices) {
      expect(names, `mob voice ${v}`).toContain(v);
      expect(CAPTION_TEXT[v], `caption for ${v}`).toBeTruthy();
    }
  });

  it('sounds played by name elsewhere in the game are all captioned', () => {
    const played = new Set();
    for (const f of ['src/game.js', 'src/world/events.js', 'src/entities/skyRocket.js', 'src/net/session.js', 'src/player/interaction.js', 'src/world/dispensers.js', 'src/ui/screens.js', 'src/entities/fireball.js']) {
      for (const m of src(f).matchAll(/audio\.play\('([a-z_]+)'/g)) played.add(m[1]);
    }
    expect(played.size).toBeGreaterThan(15);
    for (const n of played) {
      if (PREFIXED.test(n)) continue;
      expect(CAPTION_TEXT[n], `caption for ${n}`).toBeTruthy();
    }
  });

  it('block sounds and chimes are captioned by rule, footsteps are not', () => {
    expect(captionText('break_stone')).toBe('Block broken');
    expect(captionText('place_wood')).toBe('Block placed');
    expect(captionText('step_grass')).toBeNull();
    expect(captionText('hit_wood')).toBeNull();
    expect(captionText('chime_bell_12')).toBeTruthy();
  });

  it('the new world sounds reach the caption log with their direction', () => {
    const log = new CaptionLog();
    const listener = [0, 0, 0, 0];
    log.add('meteor_boom', [0, 0, -10], 1, listener, 0); // forward is -z at yaw 0
    log.add('rocket_twinkle', [10, 0, 0], 1, listener, 0);
    const view = log.view(0);
    expect(view.map((v) => v.text)).toEqual(['Meteorite booms', 'Sparks crackle']);
    expect(view[0].dir).toBe('ahead');
    expect(view[1].dir).toBe('right');
  });
});

describe('reduced motion and reduced flashing reach the newer effects', () => {
  it('motionScales has a scale for every new effect, all at full by default', () => {
    const m = motionScales({});
    for (const k of ['twinkle', 'skyDrift', 'streaks', 'sparks', 'sand']) expect(m[k]).toBe(1);
    expect(FULL_FX).toEqual(m);
    expect(fxOf(null)).toBe(FULL_FX);
    expect(fxOf({ fx: { sparks: 0.5 } }).sparks).toBe(0.5);
  });

  it('reduce motion: slow Veilfire, no falling stars, steady stars, less blown sand', () => {
    const m = motionScales({ reduceMotion: true });
    expect(m.skyDrift).toBeLessThan(0.2);
    expect(m.streaks).toBe(0);
    expect(m.twinkle).toBe(0);
    expect(m.sand).toBeLessThan(0.5);
    expect(m.sparks).toBe(1); // (motion and flashing are separate settings)
  });

  it('reduce flashing: steady stars, fewer sparks, dimmer streaks, lightning capped', () => {
    const m = motionScales({ reduceFlashing: true });
    expect(m.twinkle).toBe(0);
    expect(m.sparks).toBeLessThan(0.5);
    expect(m.streaks).toBeGreaterThan(0);
    expect(m.streaks).toBeLessThan(1);
    expect(m.flash).toBeLessThanOrEqual(0.2);
    expect(m.skyDrift).toBe(1);
  });

  it('scaledCount keeps at least one particle while the effect is on and none when it is off', () => {
    expect(scaledCount(24, 1)).toBe(24);
    expect(scaledCount(24, 0.4)).toBe(10);
    expect(scaledCount(1, 0.25)).toBe(1);
    expect(scaledCount(24, 0)).toBe(0);
  });

  const burst = (fx) => {
    let emitted = 0;
    const game = { fx, particles: { emit() { emitted++; } }, audio: { play() {} }, net: null, entities: { list: [] } };
    const r = new SkyRocket(0, 10, 0, null, Math.random, 4);
    r.burst(game);
    return { emitted, r };
  };

  it('a firework burst throws fewer sparks with reduced flashing', () => {
    const full = burst(motionScales({})).emitted;
    const calm = burst(motionScales({ reduceFlashing: true })).emitted;
    expect(full).toBeGreaterThan(5);
    expect(calm).toBeLessThan(full * 0.6);
    expect(calm).toBeGreaterThan(0);
  });

  it('firework twinkles (the white crackle) are skipped with reduced flashing but the sound still plays for captions', () => {
    for (const [settings, wantSparks] of [[{}, true], [{ reduceFlashing: true }, false], [{ reduceMotion: true }, false]]) {
      let emitted = 0, played = 0;
      const game = { fx: motionScales(settings), particles: { emit() { emitted++; } }, audio: { play() { played++; } } };
      const r = new SkyRocket(0, 10, 0, null, Math.random, 4);
      r.heads = [{ x: 0, y: 10, z: 0, vx: 0, vy: 0, vz: 0, rgb: [1, 1, 1], fade: null, trail: 0, twinkleAt: 1 }];
      r.tickSparks(game); // fxAge 1: the twinkle's time
      expect(emitted > 0).toBe(wantSparks);
      expect(played).toBe(1);
    }
  });

  it('the sky shader takes the Veilfire clock and the star twinkle from uniforms the settings drive', () => {
    const shader = src('src/sky/skyShader.js'), sky = src('src/sky/sky.js');
    expect(shader).toMatch(/uniform float uAuroraTime/);
    expect(shader).toMatch(/uniform float uTwinkle/);
    const vf = shader.slice(shader.indexOf('vec3 veilfire'), shader.indexOf('return c * a'));
    expect(vf).not.toMatch(/uTime/); // the curtains run on their own clock
    expect(shader).toMatch(/0\.25 \* uTwinkle \* sin\(uTime/);
    expect(sky).toMatch(/auroraClock \+= dtS \* this\.fx\.skyDrift/);
    expect(sky).toMatch(/m\.glow \* this\.fx\.streaks/);
    expect(src('src/game.js')).toMatch(/this\.sky\.fx = fxScale/);
  });

  it('world events scale the dust storm sand, the meteorite trail and the impact sparks', () => {
    const ev = src('src/world/events.js');
    expect(ev).toMatch(/scaledCount\(Math\.ceil\(this\.lv\.dust \* 6\), fxOf\(g\)\.sand\)/);
    expect(ev).toMatch(/fxOf\(g\)\.streaks > 0/);
    expect(ev).toMatch(/scaledCount\(24, fxOf\(g\)\.sparks\)/);
  });

  it('the fire overlay and every CSS animation stop with reduced motion (the setting and the system preference)', () => {
    expect(CSS).toMatch(/html\.reduce-motion \*[^{]*\{[^}]*animation: none !important/);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*[^{]*\{[^}]*animation: none !important/);
    expect(CSS).toMatch(/html\.reduce-flash #overlay-fire \{ animation: none/);
  });

  it('Game keeps game.fx and the root classes in step with the settings', () => {
    const g = src('src/game.js');
    expect(g).toMatch(/this\.fx = motionScales\(this\.settings\)/);
    expect(g).toMatch(/ACCESS_KEYS\.has\(k\)\)\s*\{\s*this\.fx = motionScales/);
    expect(src('src/main.js')).toMatch(/prefers-reduced-motion: reduce/);
  });
});

describe('high contrast and large text', () => {
  it('are saved settings, off by default, and map to root classes', () => {
    expect(ACCESS_DEFAULTS.highContrast).toBe(false);
    expect(ACCESS_DEFAULTS.largeText).toBe(false);
    expect(accessClasses({})).toEqual([]);
    expect(accessClasses({ highContrast: true, largeText: true })).toEqual(['high-contrast', 'large-text']);
    expect(accessClasses({ reduceMotion: true, reduceFlashing: true, colorBlind: 'redgreen' })).toEqual(['reduce-motion', 'reduce-flash', 'cb-redgreen']);
    expect(accessClasses({}, true)).toEqual(['reduce-motion']); // the system asks for less motion
    for (const c of accessClasses({ reduceMotion: true, reduceFlashing: true, highContrast: true, largeText: true, colorBlind: 'blueyellow' })) expect(ACCESS_CLASSES).toContain(c);
  });

  it('the accessibility screen offers both switches', () => {
    expect(SCREENS).toMatch(/data-k="highContrast"/);
    expect(SCREENS).toMatch(/data-k="largeText"/);
    expect(src('src/game.js')).toMatch(/'highContrast', 'largeText'/);
  });

  it('screens scroll instead of clipping, so 200 % zoom and large text never hide a control', () => {
    expect(CSS).toMatch(/^\.screen \{ overflow: auto; justify-content: safe center; \}/m);
  });

  it('widths in viewport units are divided by the large-text zoom so nothing overflows sideways', () => {
    expect(CSS).toMatch(/html\.large-text \{ --tz: 1\.3; \}/);
    expect(CSS).toMatch(/html\.large-text \.screen > \* \{ zoom: 1\.3; \}/);
    const wide = CSS.split('\n').filter((l) => /^\.(stats-body|guide-tabs, \.guide-body|help-layout|help-search|world-list|controls-list)\b/.test(l) && /\d+vw/.test(l));
    expect(wide.length).toBeGreaterThan(4);
    for (const l of wide) expect(l, l).toMatch(/var\(--tz, 1\)/);
  });

  it('every screen has high contrast rules and the new screens (trade, guide, stats, player list, help, hints) are covered', () => {
    for (const sel of ['\\.btn', '\\.panel', '\\.trade-row', '\\.trade-bar', '\\.guide-card', '\\.stats-table', '#tablist', '#captions', '#hint-card', '\\.help-body']) {
      expect(CSS).toMatch(new RegExp(`html\\.high-contrast ${sel}`));
    }
  });

  it('HUD text grows with large text (captions, toast, player list, markers, chat)', () => {
    for (const sel of ['#captions \\.caption', '#toast', '#tablist', '\\.marker', '#chat', '#hint-card', '#steps']) expect(CSS).toMatch(new RegExp(`html\\.large-text ${sel}`));
  });
});

describe('colour is never the only cue', () => {
  it('a discounted or dearer trade price has a mark, a word and a sentence', () => {
    const cheaper = priceCue(3, 5), dearer = priceCue(8, 5), usual = priceCue(5, 5);
    expect(cheaper).toMatchObject({ cls: 'discounted', mark: '▼', word: 'cheaper' });
    expect(dearer).toMatchObject({ cls: 'pricey', mark: '▲', word: 'dearer' });
    expect(cheaper.text).toContain('5');
    expect(usual).toMatchObject({ cls: '', mark: '', word: '' });
    expect(new Set([cheaper.mark, dearer.mark, usual.mark]).size).toBe(3);
  });

  it('a Champion discount on a real offer produces the cheaper cue', () => {
    const offer = { give: 1, giveCount: 10, get: 2, getCount: 1, uses: 0 };
    const now = offerPrice(offer, 0.5, null);
    expect(now).toBeLessThan(10);
    expect(priceCue(now, offer.giveCount).word).toBe('cheaper');
  });

  it('the trade screen draws the cue next to the price and names each row for screen readers', () => {
    expect(SCREENS).toMatch(/class="price-cue" aria-hidden="true"/);
    expect(SCREENS).toMatch(/priceCue\(now, base\)/);
    expect(SCREENS).toMatch(/row\.setAttribute\('aria-label'/);
    expect(CSS).toMatch(/\.trade-row \.slot\.pricey \{ outline-style: dashed; \}/); // a surcharge is dashed, a discount solid
  });

  it('colour-blind modes swap green / red for blue / orange on trade prices, standing and ping', () => {
    for (const sel of ['\\.trade-row \\.slot\\.discounted', '\\.trade-row \\.slot\\.pricey', '\\.price-cue\\.discounted', '\\.trade-rep\\[data-standing="0"\\]', '#tablist \\.tl-ping\\.good']) {
      expect(CSS).toMatch(new RegExp(`html\\.cb-redgreen ${sel}`));
    }
  });

  it('reputation and trade level are spoken as text and a progress bar, not just a coloured bar', () => {
    expect(SCREENS).toMatch(/Standing: \$\{st\.name\}/);
    expect(SCREENS).toMatch(/role="progressbar"/);
    expect(SCREENS).toMatch(/aria-valuenow/);
  });

  it('team and "you" are written out in the player list and above players, not only coloured', () => {
    const row = playerRowLabel({ name: 'Mira', you: true, team: 'Red', gamemode: 'creative', ping: 42, host: false, op: true });
    expect(row).toContain('Mira (you)');
    expect(row).toContain('team Red');
    expect(row).toContain('operator');
    expect(row).toContain('Creative');
    expect(row).toContain('42 milliseconds');
    expect(playerRowLabel({ name: 'Bo', team: null, gamemode: 'survival', ping: -1, host: true })).toContain('no team');
    const list = src('src/ui/playerList.js');
    expect(list).toMatch(/role', 'list'/);
    expect(list).toMatch(/\(you\)/);
    expect(src('src/ui/playerMarkers.js')).toMatch(/\[\$\{team\.name\}\]/);
  });

  it('the season is a word with a day count, and the HUD labels carry roles', () => {
    expect(src('src/ui/hud.js')).toMatch(/\$\{sg\.state\.name\} · day/);
    const hud = src('src/ui/hud.js');
    expect(hud).toMatch(/id="toast" role="status"/);
    expect(hud).toMatch(/id="captions" role="log"/);
    expect(hud).toMatch(/id="steps" class="hidden" role="region"/);
  });
});

describe('keyboard: Tab and Space keep their meaning while a screen is open', () => {
  it('are swallowed while playing but left alone in a menu', () => {
    expect(suppressDefault('Tab', false, false)).toBe(true);
    expect(suppressDefault('Space', false, false)).toBe(true);
    expect(suppressDefault('Tab', false, true)).toBe(false);
    expect(suppressDefault('Space', false, true)).toBe(false);
  });

  it('other game keys are still suppressed in a menu, and Ctrl+W always', () => {
    expect(suppressDefault('F5', false, true)).toBe(true);
    expect(suppressDefault('Slash', false, true)).toBe(true);
    expect(suppressDefault('KeyW', true, true)).toBe(true);
    expect(suppressDefault('KeyW', false, true)).toBe(false);
    expect(suppressDefault('KeyE', false, false)).toBe(false);
  });

  it('the game tells the input when a screen is open', () => {
    expect(src('src/game.js')).toMatch(/this\.input\.menuOpen = \(\) => !!\(this\.ui && this\.ui\.blocking\)/);
  });

  it('trade buttons act on click (Enter, Space, A) and keep Shift for "as often as affordable"', () => {
    const trade = SCREENS.slice(SCREENS.indexOf('openTrade(mob)'), SCREENS.indexOf('/** Sleeping:'));
    expect(trade).toMatch(/btn\.addEventListener\('click'/);
    expect(trade).toMatch(/gift\.addEventListener\('click'/);
    expect(trade).not.toMatch(/addEventListener\('mousedown'/);
    expect(trade).toMatch(/e\.shiftKey \? 64 : 1/);
  });

  it('a keyboard or gamepad click (detail 0) first sends the mousedown that mousedown-only buttons wait for', () => {
    expect(SCREENS).toMatch(/e\.detail !== 0/);
    expect(SCREENS).toMatch(/new MouseEvent\('mousedown'/);
  });

  it('sliders and fields are labelled, dialogs are named by their heading (labelScreens runs on every screen)', () => {
    const nav = src('src/ui/menuNav.js');
    expect(nav).toMatch(/setAttribute\('role', 'dialog'\)/);
    expect(nav).toMatch(/aria-modal/);
    expect(nav).toMatch(/aria-labelledby/);
    expect(SCREENS).toMatch(/labelScreens\(this\.layer\)/);
  });

  it('the controls list keeps keyboard focus when it redraws', () => {
    expect(SCREENS).toMatch(/const keep = \[\.\.\.list\.querySelectorAll\('\.control-key'\)\]\.indexOf\(document\.activeElement\)/);
  });

  it('visible focus rings are drawn for keyboard and gamepad focus', () => {
    expect(CSS).toMatch(/button:focus-visible[^{]*\.pad-focus \{\s*outline: 3px solid/);
    expect(FOCUSABLE).toContain('button');
  });

  it('the Controls, Accessibility and Touch screens toggle with aria-pressed or plain buttons and have a Back', () => {
    expect(SCREENS).toMatch(/b\.setAttribute\('aria-pressed'/);
    for (const fn of ['showAccessibility()', 'showTouchSettings()', 'showControls()']) {
      const body = SCREENS.slice(SCREENS.indexOf(`  ${fn} {`));
      expect(body.slice(0, 6000)).toMatch(/this\.padBack = /);
    }
  });
});

describe('gamepad: the D-pad, A, X and B work on every screen', () => {
  const rect = (x, y, w = 100, h = 30) => ({ x, y, w, h });

  it('moves focus to the nearest control in the pressed direction', () => {
    const col = [rect(0, 0), rect(0, 40), rect(0, 80)];
    expect(pickNext(col, 0, 'down')).toBe(1);
    expect(pickNext(col, 1, 'down')).toBe(2);
    expect(pickNext(col, 2, 'down')).toBe(-1);
    expect(pickNext(col, 2, 'up')).toBe(1);
    expect(pickNext(col, 0, 'left')).toBe(-1);
  });

  it('prefers the control straight ahead over a nearer one off to the side', () => {
    const grid = [rect(0, 0), rect(110, 5), rect(0, 70)]; // 0: here, 1: right and level, 2: below
    expect(pickNext(grid, 0, 'right')).toBe(1);
    expect(pickNext(grid, 0, 'down')).toBe(2);
    const wheel = [rect(100, 0), rect(200, 90), rect(100, 180), rect(0, 90)]; // the emote wheel: N, E, S, W
    expect(pickNext(wheel, 0, 'down')).toBe(2);
    expect(pickNext(wheel, 0, 'right')).toBe(1);
    expect(pickNext(wheel, 0, 'left')).toBe(3);
    expect(pickNext(wheel, 3, 'right')).toBe(1);
  });

  it('starts at the first control when nothing is focused', () => {
    expect(pickNext([rect(0, 0), rect(0, 50)], -1, 'down')).toBe(0);
    expect(pickNext([], -1, 'down')).toBe(-1);
  });

  it('every control of a tall screen can be reached one step at a time (trade list, pause menu, touch settings)', () => {
    const rows = Array.from({ length: 12 }, (_, i) => (i % 2 ? rect(0, i * 36, 300) : rect(0, i * 36, 150))); // full-width and half-width buttons in turn
    let at = 0;
    for (let i = 0; i < 11; i++) { const n = pickNext(rows, at, 'down'); expect(n).toBe(at + 1); at = n; }
  });

  it('a stick push counts as a D-pad press once', () => {
    expect(stickDirection(0, -0.9)).toBe('up');
    expect(stickDirection(0.1, 0.8)).toBe('down');
    expect(stickDirection(-0.9, 0.2)).toBe('left');
    expect(stickDirection(0.4, 0.2)).toBeNull();
    const none = new Set();
    expect(menuIntent(none, { lx: 0, ly: -1 }, null).move).toBe('up');
    expect(menuIntent(none, { lx: 0, ly: -1 }, 'up').move).toBeNull(); // still held
    expect(menuIntent(new Set(['PadDown']), { lx: 0, ly: 0 }, null).move).toBe('down');
  });

  it('A presses, X presses as a Shift-click, B and Back go back', () => {
    const none = { lx: 0, ly: 0 };
    expect(menuIntent(new Set(['PadA']), none, null)).toMatchObject({ press: true, pressMany: false, back: false });
    expect(menuIntent(new Set(['PadX']), none, null)).toMatchObject({ press: false, pressMany: true });
    expect(menuIntent(new Set(['PadB']), none, null).back).toBe(true);
    expect(menuIntent(new Set(['PadBack']), none, null).back).toBe(true);
  });

  it('left and right change a slider by its step and stay inside its range', () => {
    const events = [];
    const input = { step: '5', min: '10', max: '100', value: '12', dispatchEvent(e) { events.push(e.type); } };
    expect(stepRange(input, 'right')).toBe(true);
    expect(input.value).toBe('17');
    expect(stepRange(input, 'left')).toBe(true);
    stepRange(input, 'left');
    expect(input.value).toBe('10'); // clamped
    expect(stepRange(input, 'left')).toBe(false);
    expect(events).toContain('input');
  });

  it('menus that read as a list of choices open with focus on their first control', () => {
    for (const k of ['pause', 'trade', 'emotes', 'death', 'sleep']) expect(AUTOFOCUS_SCREENS.has(k)).toBe(true);
    expect(AUTOFOCUS_SCREENS.has('chat')).toBe(false); // never steal the typing focus
  });

  it('the game loop feeds every open screen to the gamepad menu', () => {
    expect(src('src/game.js')).toMatch(/this\.ui\.blocking && !inp\.capture\) this\.ui\.padMenu\(inp\.pressed, inp\.pad\)/);
  });

  it('B goes back from the trade screen, emote wheel, pause sub-screens and the Field Guide / statistics / touch screens', () => {
    expect(SCREENS).toMatch(/goBack\(\) \{/);
    const back = SCREENS.slice(SCREENS.indexOf('  goBack() {'), SCREENS.indexOf('  close() {'));
    expect(back).toMatch(/this\.padBack/); // the sub-screens' own way back
    expect(back).toMatch(/this\.close\(\)/); // trade, emotes, containers
    for (const fn of ['showStats()', 'showGuide(', 'showTouchSettings()', 'showMilestones()']) {
      const body = SCREENS.slice(SCREENS.indexOf(`  ${fn}`));
      expect(body.slice(0, 7000)).toMatch(/this\.padBack = /);
    }
  });

  it('opening the Field Guide, the player list and the emote wheel has a gamepad button by default', () => {
    const k = keyLists(defaultTable());
    expect(k.guide).toContain('PadX');
    expect(k.players.some((c) => c.startsWith('Pad'))).toBe(true);
    expect(k.emote.some((c) => c.startsWith('Pad'))).toBe(true);
    expect(k.pause).toContain('PadStart');
  });

  it('no gamepad button is bound to two actions after the new defaults', () => {
    const seen = new Map();
    for (const a of ACTIONS) {
      const pad = a.def[2];
      if (!pad) continue;
      expect(seen.has(pad), `${pad} used by ${seen.get(pad)} and ${a.id}`).toBe(false);
      seen.set(pad, a.id);
    }
    const t = resolveBindings(null);
    expect(t.players[2]).toBe('PadRight');
    expect(t.emote[2]).toBe('PadLeft');
  });
});

// Status effects (pure logic, unit tested). A creature's effects live in a map
//   name -> { amp, ticks, hidden }
// amp is the amplifier (0 = level I). `hidden` is a weaker but longer effect of
// the same kind that resumes when the stronger one runs out (the reference
// game's stacking rule). Effect numbers follow the reference game.

export const EFFECTS = {
  speed:           { name: 'Speed', color: '#7cafc6', good: true, glyph: 'speed' },
  slowness:        { name: 'Slowness', color: '#5a6c81', good: false, glyph: 'slow' },
  haste:           { name: 'Haste', color: '#d9c043', good: true, glyph: 'pick' },
  strength:        { name: 'Strength', color: '#932423', good: true, glyph: 'sword' },
  weakness:        { name: 'Weakness', color: '#484d48', good: false, glyph: 'brokensword' },
  instant_health:  { name: 'Instant Health', color: '#f82423', good: true, instant: true, glyph: 'heart' },
  instant_damage:  { name: 'Instant Damage', color: '#430a09', good: false, instant: true, glyph: 'skull' },
  jump_boost:      { name: 'Jump Boost', color: '#22ff4c', good: true, glyph: 'jump' },
  regeneration:    { name: 'Regeneration', color: '#cd5cab', good: true, glyph: 'heart' },
  poison:          { name: 'Poison', color: '#4e9331', good: false, glyph: 'drop' },
  fire_resistance: { name: 'Fire Resistance', color: '#e49a3a', good: true, glyph: 'flame' },
  water_breathing: { name: 'Water Breathing', color: '#2e5299', good: true, glyph: 'bubble' },
  night_vision:    { name: 'Night Vision', color: '#1f1fa1', good: true, glyph: 'eye' },
  invisibility:    { name: 'Invisibility', color: '#7f8392', good: true, glyph: 'ghost' },
  slow_falling:    { name: 'Slow Falling', color: '#f3cfb9', good: true, glyph: 'feather' },
  hunger:          { name: 'Hunger', color: '#587653', good: false, glyph: 'food' },
  levitation:      { name: 'Levitation', color: '#ceffff', good: false, glyph: 'feather' },
};
export const EFFECT_KEYS = Object.keys(EFFECTS);

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = (n) => ROMAN[n] || String(n);

/** "Speed II" for an amplifier (level I shows no numeral). */
export function effectLabel(name, amp = 0) {
  const d = EFFECTS[name];
  return (d ? d.name : name) + (amp > 0 ? ' ' + roman(amp + 1) : '');
}

/** m:ss for a duration in ticks ("**:**" for very long ones, as the reference). */
export function formatTicks(ticks) {
  if (ticks >= 32767 * 20) return '**:**';
  const s = Math.max(0, Math.floor(ticks / 20));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Add an effect with the reference stacking rule: a higher amplifier replaces
 * (keeping the old one hidden if it would outlast it); the same amplifier only
 * extends; a lower amplifier with a longer duration waits hidden underneath.
 * Returns true if anything changed.
 */
export function addEffect(map, name, ticks, amp = 0) {
  ticks = Math.max(0, Math.floor(ticks)); amp = Math.max(0, amp | 0);
  if (!ticks) return false;
  const cur = map[name];
  if (!cur) { map[name] = { amp, ticks, hidden: null }; return true; }
  if (amp > cur.amp) {
    const old = { amp: cur.amp, ticks: cur.ticks, hidden: cur.hidden };
    map[name] = { amp, ticks, hidden: old.ticks > ticks ? old : old.hidden };
    return true;
  }
  if (amp === cur.amp) {
    if (ticks > cur.ticks) { cur.ticks = ticks; return true; }
    return false;
  }
  // weaker: keep it for later if it lasts longer than what is active
  if (ticks > cur.ticks) {
    if (!cur.hidden) { cur.hidden = { amp, ticks, hidden: null }; return true; }
    return addEffect(cur, 'hidden', ticks, amp);
  }
  return false;
}

/** Count every effect (and the hidden ones under it) down by a tick; expired ones end or uncover the hidden one. */
export function tickEffects(map) {
  for (const k of Object.keys(map)) {
    let e = map[k];
    for (let h = e.hidden; h; h = h.hidden) h.ticks--;
    if (--e.ticks > 0) continue;
    // uncover the next hidden effect that is still running
    let h = e.hidden;
    while (h && h.ticks <= 0) h = h.hidden;
    if (h) map[k] = h; else delete map[k];
  }
}

/** 0 when the effect is not active, otherwise its level (amplifier + 1). */
export function effectLevel(map, name) { const e = map && map[name]; return e ? e.amp + 1 : 0; }

/** Movement speed multiplier: Speed +20 % per level, Slowness -15 % per level. */
export function speedFactor(map) {
  return Math.max(0, 1 + 0.2 * effectLevel(map, 'speed') - 0.15 * effectLevel(map, 'slowness'));
}

/** Jump velocity bonus: +0.1 blocks/tick per Jump Boost level. */
export function jumpBonus(map) { return 0.1 * effectLevel(map, 'jump_boost'); }

/** Fall damage after Jump Boost (each level absorbs one more block). */
export function fallDamageWithEffects(dmg, map) { return Math.max(0, dmg - effectLevel(map, 'jump_boost')); }

/**
 * Vertical velocity under Levitation (reference): instead of gravity the body eases
 * towards rising 0.05 x level blocks/tick (then the usual 0.98 air drag), about
 * 0.9 blocks/s at level I. Returns the new velocity before drag.
 */
export function levitationVelocity(vy, level) { return vy + (0.05 * level - vy) * 0.2; }

/** Melee damage: Strength +3 per level, Weakness -4 per level (never below 0). */
export function meleeWithEffects(dmg, map) {
  return Math.max(0, dmg + 3 * effectLevel(map, 'strength') - 4 * effectLevel(map, 'weakness'));
}

/** Mining speed multiplier from Haste (+20 % per level). */
export function miningFactor(map) { return 1 + 0.2 * effectLevel(map, 'haste'); }

/** Ticks between poison / regeneration pulses at an amplifier (25 >> amp, 50 >> amp). */
export function poisonInterval(amp) { return Math.max(1, 25 >> amp); }
export function regenInterval(amp) { return Math.max(1, 50 >> amp); }

/** Instant Health heals 4 << amp, Instant Damage hurts 6 << amp, scaled by a splash factor. */
export function instantAmount(name, amp, factor = 1) {
  const base = name === 'instant_health' ? 4 << amp : 6 << amp;
  return Math.floor(factor * base + 0.5);
}

/**
 * What one tick of the periodic effects does to its holder: [{type: 'heal'|'hurt', amount, source}].
 * `ticksLeft` is the effect's remaining time *before* this tick (reference: pulses when ticks % interval == 0).
 */
export function periodicActions(map, { health, undead = false } = {}) {
  const out = [];
  const r = map.regeneration;
  if (r && r.ticks % regenInterval(r.amp) === 0 && !undead) out.push({ type: 'heal', amount: 1 });
  const p = map.poison;
  if (p && p.ticks % poisonInterval(p.amp) === 0 && !undead && health > 1) out.push({ type: 'hurt', amount: 1, source: 'poison' });
  return out;
}

/** Mob detection range multiplier for an invisible target: 0.7 x armour coverage (at least 0.1). */
export function visibilityFactor(map, armorPieces = 0) {
  if (!effectLevel(map, 'invisibility')) return 1;
  return 0.7 * Math.max(0.1, armorPieces / 4);
}

/**
 * Splash potion strength for an entity at `dist` blocks from the impact
 * (4-block radius; a direct hit counts fully). 0 means unaffected.
 */
export function splashFactor(dist, direct = false) {
  if (direct) return 1;
  if (dist * dist >= 16) return 0;
  return 1 - dist / 4;
}

/** Average colour of a list of effects (as [r,g,b] 0..1), weighted by level. */
export function effectsColor(list) {
  let r = 0, g = 0, b = 0, n = 0;
  for (const [name, amp = 0] of list) {
    const d = EFFECTS[name];
    if (!d) continue;
    const v = parseInt(d.color.slice(1), 16), w = amp + 1;
    r += ((v >> 16) & 255) / 255 * w; g += ((v >> 8) & 255) / 255 * w; b += (v & 255) / 255 * w; n += w;
  }
  return n ? [r / n, g / n, b / n] : null;
}

/** A clean effect map from untrusted data (saves, network). */
export function cleanEffects(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  const clean = (e, depth) => {
    if (!e || typeof e !== 'object' || depth > 4) return null;
    const ticks = Math.floor(+e.ticks), amp = Math.floor(+e.amp || 0);
    if (!(ticks > 0) || amp < 0 || amp > 255) return null;
    return { amp, ticks: Math.min(ticks, 1e7), hidden: clean(e.hidden, depth + 1) };
  };
  for (const [k, v] of Object.entries(data)) {
    if (!EFFECTS[k]) continue;
    // older saves stored plain tick counts
    const e = typeof v === 'number' ? clean({ ticks: v, amp: 0 }, 0) : clean(v, 0);
    if (e) out[k] = e;
  }
  return out;
}

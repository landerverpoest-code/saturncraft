// The world border: a square wall around a centre that keeps players in. Off by default (as wide as the world); the host
// narrows it with /worldborder. It can move to a new size over time (red while it closes in, green while it opens).
//   /worldborder                      what it is now
//   /worldborder set <size> [seconds] the width of the square, at once or over that many seconds
//   /worldborder add <blocks> [seconds]
//   /worldborder center <x> <z>       (or `center here`)
//   /worldborder off                  back to no border
// A player who walks into the wall is stopped. One the wall has passed over (it shrank) is hurt once a second until they are
// back inside: 1, plus 1 for every 5 blocks beyond the first 5. Saved with the world; guests get it from the host.

export const BORDER_MAX = 59999968; // "no border"
export const BORDER_MIN = 1;
/** How far past the wall a player is still simply pushed back. */
export const BORDER_GRACE = 1;
/** The wall is drawn when the player is this close. */
export const BORDER_SHOW = 24;

const num = (v) => typeof v === 'number' && Number.isFinite(v);

export class WorldBorder {
  constructor() { this.cx = 0; this.cz = 0; this.size = BORDER_MAX; this.from = BORDER_MAX; this.to = BORDER_MAX; this.left = 0; this.total = 0; }

  get active() { return this.size < BORDER_MAX; }
  get half() { return this.size / 2; }
  /** -1 closing in, 1 opening, 0 still. */
  get moving() { return this.left > 0 ? Math.sign(this.to - this.from) : 0; }

  /** Set the width, at once or over `seconds`. */
  set(size, seconds = 0) {
    size = Math.max(BORDER_MIN, Math.min(BORDER_MAX, size));
    const ticks = Math.max(0, Math.round(seconds * 20));
    if (!ticks) { this.size = this.from = this.to = size; this.left = this.total = 0; return; }
    this.from = this.size; this.to = size; this.left = this.total = ticks;
  }

  setCenter(x, z) { this.cx = x; this.cz = z; }

  tick() {
    if (this.left <= 0) return;
    this.left--;
    this.size = this.left === 0 ? this.to : this.to + (this.from - this.to) * (this.left / this.total);
  }

  /** How far (x, z) is outside the wall (0 or less: inside; the absolute value is then the distance to the nearest wall). */
  outside(x, z) { return Math.max(Math.abs(x - this.cx), Math.abs(z - this.cz)) - this.half; }
  contains(x, z) { return this.outside(x, z) <= 0; }

  /** The nearest point inside, `pad` blocks clear of the wall. */
  clamp(x, z, pad = 0.3) {
    const h = Math.max(0, this.half - pad);
    return [Math.max(this.cx - h, Math.min(this.cx + h, x)), Math.max(this.cz - h, Math.min(this.cz + h, z))];
  }

  /** Damage per second for someone `d` blocks outside. */
  static damage(d) { return d <= 0 ? 0 : 1 + Math.floor(Math.max(0, d - 5) / 5); }

  save() { return this.active || this.cx || this.cz ? { cx: this.cx, cz: this.cz, size: this.size, to: this.to, left: this.left, total: this.total, from: this.from } : null; }

  load(d) {
    this.cx = 0; this.cz = 0; this.set(BORDER_MAX);
    if (!d || typeof d !== 'object') return;
    if (num(d.cx) && num(d.cz)) { this.cx = d.cx; this.cz = d.cz; }
    if (num(d.size)) this.set(d.size);
    if (num(d.to) && num(d.from) && Number.isInteger(d.left) && Number.isInteger(d.total) && d.left > 0 && d.total >= d.left) {
      this.from = Math.max(BORDER_MIN, Math.min(BORDER_MAX, d.from)); this.to = Math.max(BORDER_MIN, Math.min(BORDER_MAX, d.to)); this.left = d.left; this.total = d.total;
    }
  }
}

/**
 * Keep a player inside: returns { x, z, hurt } - the position to put them at (unchanged when fine) and the damage due this
 * tick (`tick` is any running tick counter; damage comes once every 20).
 */
export function enforceBorder(border, x, z, tick) {
  if (!border.active) return { x, z, hurt: 0 };
  const d = border.outside(x, z);
  if (d <= -0.3) return { x, z, hurt: 0 };
  if (d <= BORDER_GRACE) { const [nx, nz] = border.clamp(x, z); return { x: nx, z: nz, hurt: 0 }; }
  return { x, z, hurt: tick % 20 === 0 ? WorldBorder.damage(d) : 0 };
}

const fmt = (n) => (n >= BORDER_MAX ? 'off' : String(Math.round(n * 10) / 10));

/** /worldborder: returns the line to print. `pos` is where the caller stands (for `center here`). */
export function borderCommand(border, args, pos = { x: 0, z: 0 }) {
  const usage = 'Usage: /worldborder [set <size> [seconds] | add <blocks> [seconds] | center <x> <z> | center here | off]';
  const sub = (args[0] || '').toLowerCase();
  if (!sub || sub === 'get') {
    if (!border.active) return 'The world has no border  [/worldborder set <size>]';
    const mv = border.moving ? `, ${border.moving < 0 ? 'closing in on' : 'opening to'} ${fmt(border.to)} in ${Math.ceil(border.left / 20)} s` : '';
    return `The world border is ${fmt(border.size)} blocks wide around ${Math.round(border.cx)}, ${Math.round(border.cz)}${mv}`;
  }
  if (sub === 'off') { border.set(BORDER_MAX); return 'The world border is off'; }
  if (sub === 'set' || sub === 'add') {
    const n = Number(args[1]), sec = args[2] === undefined ? 0 : Number(args[2]);
    if (!Number.isFinite(n) || !Number.isFinite(sec) || sec < 0 || sec > 86400) return usage;
    const size = sub === 'add' ? (border.active ? border.size : 0) + n : n;
    if (size < BORDER_MIN || size > BORDER_MAX) return `The border can be ${BORDER_MIN} to ${BORDER_MAX} blocks wide`;
    if (sec > 0 && !border.active) border.set(Math.max(size, 2 * Math.max(Math.abs(pos.x - border.cx), Math.abs(pos.z - border.cz)) + 32)); // start from just outside the caller
    border.set(size, sec);
    return sec > 0 ? `The world border moves to ${fmt(size)} blocks wide over ${sec} s` : `The world border is now ${fmt(size)} blocks wide`;
  }
  if (sub === 'center' || sub === 'centre') {
    const here = (args[1] || '').toLowerCase() === 'here';
    const x = here ? Math.floor(pos.x) + 0.5 : Number(args[1]), z = here ? Math.floor(pos.z) + 0.5 : Number(args[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 3e7 || Math.abs(z) > 3e7) return usage;
    border.setCenter(x, z);
    return `The world border is centred on ${Math.round(x * 10) / 10}, ${Math.round(z * 10) / 10}`;
  }
  return usage;
}

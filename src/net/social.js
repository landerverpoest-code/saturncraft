// Multiplayer social layer: teams, private messages, ping beacons, emotes, the player list,
// the host's kick / ban / op lists and the reconnect rules. Everything here is pure (no
// network, no DOM, no THREE) so it can be unit-tested; net/session.js wires it to the wire.
//
// Wire compatibility (PROTOCOL_VERSION stays 2): every message type here is new and unknown
// types are ignored by older peers, `hello.tok` / `welcome.soc` / `welcome.teams` are optional
// fields, so old and new builds still join each other - they just lack the social features.
//
//   client -> host: hello.tok (guest token), pg (ping + gamemode), scmd (a social command),
//                   ping (beacon at x y z), emote
//   host -> client: welcome.soc/.teams, pong, roster, teams, pm, ping, emote, bye.kick

/** Same rule as protocol.js cleanName (kept here so this module stays free of imports). */
function cleanName(name) {
  const s = String(name || '').replace(/[^\w\- .]/g, '').trim().slice(0, 16);
  return s || 'Player';
}

// ---- teams ----------------------------------------------------------------------------
export const TEAM_COLORS = {
  red: '#ff5555', orange: '#ffaa33', yellow: '#ffdd44', green: '#55dd55', aqua: '#44dddd',
  blue: '#6688ff', purple: '#bb66ff', pink: '#ff88cc', white: '#ffffff',
};
export const TEAM_COLOR_KEYS = Object.keys(TEAM_COLORS);
export const MAX_TEAMS = 8;
export const MAX_TEAM_NAME = 12;

export const MAX_WAYPOINTS = 32;
export function cleanWaypointName(s) { return String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16); }
export const nameKey = (n) => String(n || '').trim().toLowerCase();
export function cleanTeamName(s) { return String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, MAX_TEAM_NAME); }
/** A colour key or "#rrggbb" -> "#rrggbb" (or null). */
export function teamColor(s) {
  const k = nameKey(s);
  if (TEAM_COLORS[k]) return TEAM_COLORS[k];
  return /^#[0-9a-f]{6}$/.test(k) ? k : null;
}

/** A guest's anonymous identity: stays the same in this browser so a name can't be taken over. */
export function cleanToken(t) { return typeof t === 'string' && /^[A-Za-z0-9]{8,40}$/.test(t) ? t : null; }
export function makeToken(rand = Math.random) {
  const A = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 20; i++) s += A[Math.floor(rand() * A.length)];
  return s;
}
const TOKEN_KEY = 'saturncraft.token';
export function loadClientToken(rand = Math.random) {
  let t = null;
  try { t = cleanToken(localStorage.getItem(TOKEN_KEY)); } catch { /* storage unavailable */ }
  if (!t) { t = makeToken(rand); try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ } }
  return t;
}

/**
 * Teams, the op list, bans and guest identities of one world. The host's copy is the true one
 * (it is part of the save); guests keep a read-only mirror of the teams for colours and friendly fire.
 */
export class SocialState {
  constructor() {
    this.teams = new Map();   // lower-case team name -> { name, color, ff, owner, members: [name] }
    this.ops = new Map();     // lower-case player name -> display name
    this.bans = new Map();    // lower-case player name -> { name, reason, by, tok }
    this.ids = new Map();     // lower-case player name -> guest token (first come, first served)
    this.reply = new Map();   // lower-case player name -> who last wrote to them (not saved)
    this.waypoints = new Map(); // lower-case waypoint name -> { name, x, y, z, dim, by, team }: shared places everybody (or one team) sees
  }

  // ---- teams
  teamOf(name) {
    const k = nameKey(name);
    for (const t of this.teams.values()) if (t.members.some((m) => nameKey(m) === k)) return t;
    return null;
  }
  colorOf(name) { const t = this.teamOf(name); return t ? t.color : null; }
  /** True when `attacker` may not hurt `victim`: same team and friendly fire is off. */
  blocksDamage(attacker, victim) {
    if (!attacker || !victim || nameKey(attacker) === nameKey(victim)) return false;
    const t = this.teamOf(attacker);
    return !!t && !t.ff && t === this.teamOf(victim);
  }
  /** Who gets a ping / team message from `name`: their team's members, or null (everyone) without a team. */
  teammatesOf(name) { const t = this.teamOf(name); return t ? t.members.slice() : null; }

  create(player, teamName, colorName) {
    const n = cleanTeamName(teamName);
    if (!n) return { ok: false, msg: 'Usage: /team create <name> [color]' };
    if (this.teams.has(nameKey(n))) return { ok: false, msg: `A team called ${n} already exists` };
    if (this.teams.size >= MAX_TEAMS) return { ok: false, msg: `There can be at most ${MAX_TEAMS} teams` };
    let color = null;
    if (colorName) { color = teamColor(colorName); if (!color) return { ok: false, msg: `Unknown colour. Try: ${TEAM_COLOR_KEYS.join(', ')}` }; }
    if (!color) {
      const used = new Set([...this.teams.values()].map((t) => t.color));
      color = TEAM_COLOR_KEYS.map((k) => TEAM_COLORS[k]).find((c) => !used.has(c)) || TEAM_COLORS.white;
    }
    this.leave(player);
    this.teams.set(nameKey(n), { name: n, color, ff: false, owner: player, members: [player] });
    return { ok: true, msg: `Created team ${n} and joined it` };
  }
  join(player, teamName) {
    const t = this.teams.get(nameKey(cleanTeamName(teamName)));
    if (!t) return { ok: false, msg: `No team called ${teamName || ''}. /team list shows the teams` };
    if (this.teamOf(player) === t) return { ok: false, msg: `You are already in ${t.name}` };
    this.leave(player);
    t.members.push(player);
    return { ok: true, msg: `You joined team ${t.name}`, team: t };
  }
  leave(player) {
    const t = this.teamOf(player);
    if (!t) return { ok: false, msg: 'You are not in a team' };
    t.members = t.members.filter((m) => nameKey(m) !== nameKey(player));
    if (!t.members.length) this.teams.delete(nameKey(t.name));
    else if (nameKey(t.owner) === nameKey(player)) t.owner = t.members[0];
    return { ok: true, msg: `You left team ${t.name}` };
  }
  /** The team's owner (or an op) switches friendly fire. */
  setFriendlyFire(player, on, isOp = false) {
    const t = this.teamOf(player);
    if (!t) return { ok: false, msg: 'You are not in a team' };
    if (nameKey(t.owner) !== nameKey(player) && !isOp) return { ok: false, msg: `Only ${t.owner} (the team's owner) can change friendly fire` };
    t.ff = !!on;
    return { ok: true, msg: `Friendly fire in ${t.name} is ${t.ff ? 'on' : 'off'}` };
  }
  setColor(player, colorName, isOp = false) {
    const t = this.teamOf(player), c = teamColor(colorName);
    if (!t) return { ok: false, msg: 'You are not in a team' };
    if (nameKey(t.owner) !== nameKey(player) && !isOp) return { ok: false, msg: `Only ${t.owner} (the team's owner) can change the colour` };
    if (!c) return { ok: false, msg: `Unknown colour. Try: ${TEAM_COLOR_KEYS.join(', ')}` };
    t.color = c;
    return { ok: true, msg: `Team ${t.name} is now ${colorName}` };
  }
  disband(player, isOp = false) {
    const t = this.teamOf(player);
    if (!t) return { ok: false, msg: 'You are not in a team' };
    if (nameKey(t.owner) !== nameKey(player) && !isOp) return { ok: false, msg: `Only ${t.owner} (the team's owner) can disband it` };
    this.teams.delete(nameKey(t.name));
    return { ok: true, msg: `Team ${t.name} was disbanded` };
  }
  teamLines() {
    if (!this.teams.size) return ['There are no teams. /team create <name> [color] makes one'];
    return [...this.teams.values()].map((t) => `${t.name} (${t.members.length}): ${t.members.join(', ')}${t.ff ? '  [friendly fire]' : ''}`);
  }
  /** Teams for the wire (guests mirror them): [[name, color, ff, owner, [members]]]. */
  teamsToWire() { return [...this.teams.values()].map((t) => [t.name, t.color, t.ff ? 1 : 0, t.owner, t.members.slice()]); }
  teamsFromWire(list) {
    this.teams.clear();
    if (!Array.isArray(list)) return;
    for (const a of list.slice(0, MAX_TEAMS)) {
      if (!Array.isArray(a)) continue;
      const name = cleanTeamName(a[0]), color = teamColor(a[1]);
      if (!name || !color || !Array.isArray(a[4])) continue;
      const members = a[4].slice(0, 16).map(cleanName);
      if (members.length) this.teams.set(nameKey(name), { name, color, ff: !!a[2], owner: cleanName(a[3]), members });
    }
  }

  // ---- shared waypoints: a named place that stays (unlike a ping), for the sender's team or, without a team, for everybody
  addWaypoint(by, name, pos) {
    const n = cleanWaypointName(name);
    if (!n) return { ok: false, msg: 'Usage: /wp add <name>  (marks the place you stand at)' };
    if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite)) return { ok: false, msg: 'Cannot tell where you are' };
    const k = nameKey(n), old = this.waypoints.get(k);
    if (old && nameKey(old.by) !== nameKey(by)) return { ok: false, msg: `${n} already marks another place (made by ${old.by})` };
    if (!old && this.waypoints.size >= MAX_WAYPOINTS) return { ok: false, msg: `There can be at most ${MAX_WAYPOINTS} waypoints` };
    const t = this.teamOf(by);
    const r1 = (v) => Math.round(v * 10) / 10;
    this.waypoints.set(k, { name: n, x: r1(pos.x), y: r1(pos.y), z: r1(pos.z), dim: pos.dim || 'overworld', by: cleanName(by), team: t ? t.name : null });
    return { ok: true, msg: `${old ? 'Moved' : 'Marked'} waypoint ${n}${t ? ' for team ' + t.name : ' for everybody'}` };
  }
  delWaypoint(by, name, isOp = false) {
    const k = nameKey(cleanWaypointName(name)), w = this.waypoints.get(k);
    if (!w) return { ok: false, msg: `No waypoint called ${name || ''}. /wp list shows them` };
    if (nameKey(w.by) !== nameKey(by) && !isOp) return { ok: false, msg: `Only ${w.by} (or an op) can remove ${w.name}` };
    this.waypoints.delete(k);
    return { ok: true, msg: `Removed waypoint ${w.name}` };
  }
  /** The waypoints `player` may see: those for everybody and those of their own team. */
  waypointsFor(player) {
    const t = this.teamOf(player);
    return [...this.waypoints.values()].filter((w) => !w.team || (t && nameKey(t.name) === nameKey(w.team)));
  }
  waypointsToWire(player) { return this.waypointsFor(player).map((w) => [w.name, w.x, w.y, w.z, w.dim, w.by]); }
  static waypointsFromWire(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const a of list.slice(0, MAX_WAYPOINTS)) {
      if (!Array.isArray(a) || ![a[1], a[2], a[3]].every(Number.isFinite)) continue;
      const name = cleanWaypointName(a[0]);
      if (name) out.push({ name, x: a[1], y: a[2], z: a[3], dim: typeof a[4] === 'string' ? a[4].slice(0, 24) : 'overworld', by: cleanName(a[5]) });
    }
    return out;
  }

  // ---- ops, bans and identities (host only; saved with the world)
  isOp(name, hostName = null) { const k = nameKey(name); return (!!hostName && k === nameKey(hostName)) || this.ops.has(k); }
  op(name) { this.ops.set(nameKey(name), cleanName(name)); }
  deop(name) { return this.ops.delete(nameKey(name)); }
  /** May `actor` remove `target`? The host always; ops only guests who are not ops themselves. */
  canKick(actor, target, hostName) {
    if (nameKey(target) === nameKey(hostName)) return false;
    if (nameKey(actor) === nameKey(hostName)) return true;
    return this.isOp(actor, hostName) && !this.isOp(target, hostName) && nameKey(actor) !== nameKey(target);
  }
  ban(name, reason = '', by = '', tok = null) { this.bans.set(nameKey(name), { name: cleanName(name), reason: String(reason || '').slice(0, 80), by: cleanName(by), tok: cleanToken(tok) }); }
  pardon(name) { return this.bans.delete(nameKey(name)); }
  /** Banned by name, or (once a ban has seen the guest's token) by the browser identity. */
  banOf(name, tok = null) {
    const b = this.bans.get(nameKey(name));
    if (b) return b;
    const t = cleanToken(tok);
    if (t) for (const e of this.bans.values()) if (e.tok === t) return e;
    return null;
  }
  /** A name is free for this guest unless another browser already uses it. */
  identityFree(name, tok) {
    const have = this.ids.get(nameKey(name));
    return !have || have === cleanToken(tok);
  }
  bindIdentity(name, tok) { const t = cleanToken(tok); if (t && !this.ids.has(nameKey(name))) this.ids.set(nameKey(name), t); }
  tokenOf(name) { return this.ids.get(nameKey(name)) || null; }

  /** The part of the world save: teams, ops, bans and who is who. */
  save() {
    return {
      teams: this.teamsToWire(),
      ops: [...this.ops.values()],
      bans: [...this.bans.values()],
      ids: Object.fromEntries(this.ids),
      waypoints: [...this.waypoints.values()],
    };
  }
  static from(d) {
    const s = new SocialState();
    if (!d || typeof d !== 'object') return s;
    s.teamsFromWire(d.teams);
    for (const n of Array.isArray(d.ops) ? d.ops.slice(0, 64) : []) if (typeof n === 'string') s.op(n);
    for (const b of Array.isArray(d.bans) ? d.bans.slice(0, 256) : []) if (b && typeof b.name === 'string') s.ban(b.name, b.reason, b.by, b.tok);
    for (const w of Array.isArray(d.waypoints) ? d.waypoints.slice(0, MAX_WAYPOINTS) : []) {
      if (!w || ![w.x, w.y, w.z].every(Number.isFinite)) continue;
      const n = cleanWaypointName(w.name);
      if (n) s.waypoints.set(nameKey(n), { name: n, x: w.x, y: w.y, z: w.z, dim: typeof w.dim === 'string' ? w.dim : 'overworld', by: cleanName(w.by), team: typeof w.team === 'string' ? w.team : null });
    }
    if (d.ids && typeof d.ids === 'object') for (const [k, v] of Object.entries(d.ids).slice(0, 512)) if (cleanToken(v)) s.ids.set(nameKey(k), v);
    return s;
  }
}

// ---- commands ---------------------------------------------------------------------------
/** Commands the host runs for everyone (a guest's are sent as 'scmd'). */
export const HOST_SOCIAL_COMMANDS = new Set(['wp', 'waypoint', 'msg', 'w', 'tell', 'm', 'r', 'team', 'tc', 'kick', 'ban', 'pardon', 'banlist', 'op', 'deop', 'oplist']);
export const socialCommandName = (text) => String(text).trim().replace(/^\//, '').split(/\s+/)[0].toLowerCase();

/**
 * Run a social command for `actor` (a player name; the host's own name for the host).
 * env: { social, hostName, online(): [name], teamChanged(), pm(from, to, text), teamSay(from, text), kick(name, reason), ban(name, reason) }
 * Returns the lines to show the actor.
 */
export function runSocial(env, actor, text) {
  const { social, hostName } = env;
  const args = String(text).trim().replace(/^\//, '').split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  const isOp = social.isOp(actor, hostName);
  const find = (n) => { const k = nameKey(n); return k ? env.online().find((o) => nameKey(o) === k) || null : null; };
  const who = (n) => { const f = find(n); return f || null; };
  const rest = (from) => args.slice(from).join(' ').trim();
  switch (cmd) {
    case 'msg': case 'w': case 'tell': case 'm': {
      const to = who(args[0]), msg = rest(1).slice(0, 256);
      if (!args[0] || !msg) return ['Usage: /msg <player> <message>'];
      if (!to) return [`No player called ${args[0]} is here`];
      if (nameKey(to) === nameKey(actor)) return ['You cannot message yourself'];
      env.pm(actor, to, msg);
      social.reply.set(nameKey(to), actor);
      return [];
    }
    case 'r': {
      const to = who(social.reply.get(nameKey(actor)));
      const msg = rest(0).slice(0, 256);
      if (!msg) return ['Usage: /r <message>  (answers the last private message)'];
      if (!to) return ['Nobody has written to you (or they left)'];
      env.pm(actor, to, msg);
      social.reply.set(nameKey(to), actor);
      return [];
    }
    case 'tc': {
      const msg = rest(0).slice(0, 256);
      if (!msg) return ['Usage: /tc <message>  (to your team)'];
      if (!social.teamOf(actor)) return ['You are not in a team'];
      env.teamSay(actor, msg);
      return [];
    }
    case 'team': {
      const sub = (args.shift() || 'list').toLowerCase();
      let r;
      if (sub === 'create') r = social.create(actor, args[0], args[1]);
      else if (sub === 'join') r = social.join(actor, args[0]);
      else if (sub === 'leave') r = social.leave(actor);
      else if (sub === 'disband') r = social.disband(actor, isOp);
      else if (sub === 'color' || sub === 'colour') r = social.setColor(actor, args[0], isOp);
      else if (sub === 'ff' || sub === 'friendlyfire') {
        const v = (args[0] || '').toLowerCase();
        if (v !== 'on' && v !== 'off') return ['Usage: /team ff <on|off>  (can team mates hurt each other?)'];
        r = social.setFriendlyFire(actor, v === 'on', isOp);
      } else if (sub === 'list') return social.teamLines();
      else if (sub === 'msg' || sub === 'say') return runSocial(env, actor, '/tc ' + rest(0));
      else return ['Usage: /team <create <name> [color] | join <name> | leave | list | ff <on|off> | color <color> | disband | msg <text>>'];
      if (r.ok) env.teamChanged();
      return [r.msg];
    }
    case 'wp': case 'waypoint': {
      const sub = (args.shift() || 'list').toLowerCase();
      if (sub === 'list') {
        const list = social.waypointsFor(actor), at = env.posOf ? env.posOf(actor) : null;
        if (!list.length) return ['No waypoints. /wp add <name> marks the place you stand at'];
        return list.map((w) => `${w.name}: ${Math.round(w.x)}, ${Math.round(w.y)}, ${Math.round(w.z)}${w.dim !== 'overworld' ? ' (' + w.dim + ')' : ''}${at && at.dim === w.dim ? ' - ' + Math.round(Math.hypot(w.x - at.x, w.z - at.z)) + ' m' : ''}${w.team ? ' [' + w.team + ']' : ''}`);
      }
      if (sub === 'add' || sub === 'set') {
        const r = social.addWaypoint(actor, args[0], env.posOf ? env.posOf(actor) : null);
        if (r.ok && env.waypointsChanged) env.waypointsChanged();
        return [r.msg];
      }
      if (sub === 'del' || sub === 'remove' || sub === 'rm') {
        const r = social.delWaypoint(actor, args[0], isOp);
        if (r.ok && env.waypointsChanged) env.waypointsChanged();
        return [r.msg];
      }
      return ['Usage: /wp <add <name> | del <name> | list>  (shared places that stay on everyone\'s screen)'];
    }
    case 'kick': case 'ban': {
      const target = who(args[0]), reason = rest(1);
      if (!args[0]) return [`Usage: /${cmd} <player> [reason]`];
      if (!isOp) return ['Only the host and the ops can do that'];
      if (cmd === 'ban' && !target) {
        // banning somebody who is offline works by name
        if (nameKey(args[0]) === nameKey(hostName) || social.isOp(args[0], hostName)) return ['You cannot ban the host or an op'];
        social.ban(args[0], reason, actor);
        return [`Banned ${cleanName(args[0])}`];
      }
      if (!target) return [`No player called ${args[0]} is here`];
      if (!social.canKick(actor, target, hostName)) return [`You cannot ${cmd} ${target}`];
      if (cmd === 'ban') { env.ban(target, reason, actor); return [`Banned ${target}${reason ? ': ' + reason : ''}`]; }
      env.kick(target, reason);
      return [`Kicked ${target}`];
    }
    case 'pardon': {
      if (!isOp) return ['Only the host and the ops can do that'];
      if (!args[0]) return ['Usage: /pardon <player>'];
      return [social.pardon(args[0]) ? `Pardoned ${args[0]}` : `${args[0]} is not banned`];
    }
    case 'banlist': {
      if (!isOp) return ['Only the host and the ops can do that'];
      if (!social.bans.size) return ['Nobody is banned'];
      return [...social.bans.values()].map((b) => `${b.name}${b.reason ? ' - ' + b.reason : ''}${b.by ? ' (by ' + b.by + ')' : ''}`);
    }
    case 'op': case 'deop': {
      if (nameKey(actor) !== nameKey(hostName)) return ['Only the host can change who is an op'];
      if (!args[0]) return [`Usage: /${cmd} <player>`];
      if (cmd === 'op') { social.op(args[0]); return [`${cleanName(args[0])} is now an op`]; }
      return [social.deop(args[0]) ? `${args[0]} is no longer an op` : `${args[0]} is not an op`];
    }
    case 'oplist': return social.ops.size ? [`Ops: ${[...social.ops.values()].join(', ')}`] : ['There are no ops (the host can always do everything)'];
    default: return [`Unknown command '/${cmd}'`];
  }
}

// ---- private messages -----------------------------------------------------------------------
export const PM_FROM = (from, text) => `[${from} -> you] ${text}`;
export const PM_TO = (to, text) => `[you -> ${to}] ${text}`;
export const PM_COLOR = '#d9a8ff';
export const TEAM_CHAT = (team, from, text) => `[${team}] <${from}> ${text}`;

// ---- ping beacons -------------------------------------------------------------------------------
export const PING_TTL_MS = 20000;
export const PING_COOLDOWN_MS = 1000;
export const PING_REACH = 250;      // blocks a beacon may be placed from the sender
export const PING_MAX = 16;
export const PING_FALLBACK = '#ffd35a';

/** Short-lived beacons: one per sender, they fade after PING_TTL_MS. */
export class PingBoard {
  constructor() { this.list = []; this.last = new Map(); }
  /** The sender is allowed to ping again? (rate limit) */
  touch(from, now) { this.last.set(nameKey(from), now); }
  ready(from, now) { return now - (this.last.get(nameKey(from)) || -1e9) >= PING_COOLDOWN_MS; }
  add(p, now) {
    const from = cleanName(p.from);
    this.last.set(nameKey(from), now);
    this.list = this.list.filter((o) => nameKey(o.from) !== nameKey(from));
    this.list.push({ from, x: p.x, y: p.y, z: p.z, dim: p.dim || 'overworld', color: teamColor(p.color) || PING_FALLBACK, at: now });
    if (this.list.length > PING_MAX) this.list.shift();
    return this.list[this.list.length - 1];
  }
  prune(now) { this.list = this.list.filter((o) => now - o.at < PING_TTL_MS); }
  /** Beacons to draw in `dim`: with how much of their life is left (0..1). */
  active(now, dim) {
    this.prune(now);
    return this.list.filter((o) => o.dim === dim).map((o) => ({ ...o, life: 1 - (now - o.at) / PING_TTL_MS }));
  }
  clear() { this.list = []; this.last.clear(); }
}

/**
 * Host: validate a beacon from `sender` and say who sees it. `names` = everybody online.
 * Returns { ok, targets: [names without the sender], ping } (the caller adds it to the boards that should show it) or { ok: false }.
 */
export function routePing(social, board, sender, m, from, names, now, dim) {
  if (![m.x, m.y, m.z].every(Number.isFinite) || Math.abs(m.x) > 3e7 || Math.abs(m.z) > 3e7 || Math.abs(m.y) > 1e4) return { ok: false };
  if (from && Math.hypot(m.x - from.x, m.y - from.y, m.z - from.z) > PING_REACH) return { ok: false };
  if (!board.ready(sender, now)) return { ok: false };
  board.touch(sender, now);
  const mates = social.teammatesOf(sender);
  const keys = mates ? new Set(mates.map(nameKey)) : null;
  const targets = names.filter((n) => nameKey(n) !== nameKey(sender) && (!keys || keys.has(nameKey(n))));
  const r1 = (v) => Math.round(v * 10) / 10;
  return { ok: true, targets, ping: { from: cleanName(sender), x: r1(m.x), y: r1(m.y), z: r1(m.z), dim, color: social.colorOf(sender) } };
}

// ---- emotes --------------------------------------------------------------------------------------
export const EMOTES = ['wave', 'point', 'sit'];
export const EMOTE_LABELS = { wave: 'Wave', point: 'Point', sit: 'Sit' };
export const EMOTE_MS = { wave: 2600, point: 3200, sit: Infinity }; // a seat lasts until the player moves
export const EMOTE_COOLDOWN_MS = 400;
export const SIT_DROP = 0.5;       // blocks the body sinks
export const SIT_BREAK = 0.35;     // blocks of movement that end a seat
export const cleanEmote = (e) => (EMOTES.includes(e) ? e : null);
export function emoteByName(s) {
  const k = nameKey(s);
  return k ? EMOTES.find((e) => e === k) || EMOTES.find((e) => e.startsWith(k)) || null : null;
}

/**
 * Limb angles (radians) of an emote `t` ms in: { armR: [x, z], armL: [x, z], legs: x, drop } or null when it is over.
 * (arm x: -PI/2 straight ahead, -PI straight up; z swings it sideways)
 */
export function emotePose(kind, t) {
  const dur = EMOTE_MS[kind];
  if (!dur || t < 0 || t >= dur) return null;
  const ease = Math.min(1, t / 250), out = dur === Infinity ? 1 : Math.min(1, (dur - t) / 250), k = Math.min(ease, out);
  if (kind === 'wave') return { armR: [-2.7 * k, Math.sin(t / 90) * 0.45 * k], armL: null, legs: 0, drop: 0 };
  if (kind === 'point') return { armR: [-Math.PI / 2 * k, 0], armL: null, legs: 0, drop: 0 };
  return { armR: [-0.35 * ease, 0], armL: [-0.35 * ease, 0], legs: -1.45 * ease, drop: SIT_DROP * ease }; // sit
}

/** Does moving from `a` to `b` end a seat? */
export const breaksSeat = (a, b) => !!a && !!b && Math.hypot(a.x - b.x, a.z - b.z) > SIT_BREAK;

// ---- spectating ------------------------------------------------------------------------------------
/** Dead players and creative-mode (or spectating) ones may follow a friend. */
export const canSpectate = (p) => !!p && (p.dead || p.creative || p.gamemode === 'spectator');
/**
 * Who to follow next: `names` of the candidates (alive, other players), the `current` one, `dir` +1 / -1.
 * Returns a name or null.
 */
export function nextSpectateTarget(names, current, dir = 1) {
  if (!names.length) return null;
  const i = names.findIndex((n) => nameKey(n) === nameKey(current));
  if (i < 0) return names[dir < 0 ? names.length - 1 : 0];
  return names[(i + dir + names.length) % names.length];
}

// ---- the player list (Tab) --------------------------------------------------------------------------
export const GAMEMODE_LABEL = { survival: 'Survival', creative: 'Creative', adventure: 'Adventure', spectator: 'Spectator' };
export const gamemodeLabel = (g) => GAMEMODE_LABEL[g] || 'Survival';
/** 0 (unknown) to 4 lit bars for a ping in ms. */
export function pingBars(ms) { return !Number.isFinite(ms) || ms < 0 ? 0 : ms < 60 ? 4 : ms < 120 ? 3 : ms < 220 ? 2 : 1; }
export function pingClass(ms) { return !Number.isFinite(ms) || ms < 0 ? 'none' : ms < 120 ? 'good' : ms < 300 ? 'ok' : 'bad'; }
/** A ping in ms, or -1 for none / nonsense. */
export const cleanPing = (v) => (Number.isFinite(+v) && +v >= 0 ? Math.min(9999, Math.round(+v)) : -1);

/**
 * Rows of the player list: `roster` = [[id, name, gamemode, ping]] (the host's id is 0, its ping -1),
 * `you` = our name. Teams, op marks and colours come from `social`. Sorted: host first, then by name.
 */
export function playerRows(roster, social, you, hostName) {
  return (roster || []).map((r) => {
    const name = cleanName(r[1]), t = social.teamOf(name);
    return {
      id: r[0] | 0, name, gamemode: GAMEMODE_LABEL[r[2]] ? r[2] : 'survival', ping: cleanPing(r[3]),
      host: nameKey(name) === nameKey(hostName), op: social.isOp(name, hostName), you: nameKey(name) === nameKey(you),
      team: t ? t.name : null, color: t ? t.color : null,
    };
  }).sort((a, b) => (b.host - a.host) || a.name.localeCompare(b.name));
}
export function cleanRoster(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 16).filter((r) => Array.isArray(r) && typeof r[1] === 'string').map((r) => [r[0] | 0, cleanName(r[1]), GAMEMODE_LABEL[r[2]] ? r[2] : 'survival', cleanPing(r[3])]);
}

// ---- disconnect and reconnect --------------------------------------------------------------------------
export const RECONNECT_MAX = 5;
export const RESUME_TTL_MS = 10 * 60 * 1000;
export const RESUME_KEY = 'saturncraft.resume';
/** Seconds to wait before reconnect attempt n (1-based): 2, 3, 5, 8, 10... */
export const reconnectDelay = (n) => [2, 3, 5, 8, 10][Math.max(0, Math.min(4, n - 1))];
/** A refusal is final (banned, kicked, other version, full); a timeout or a closed link is worth another try. */
export function shouldRetryJoin(message) {
  return !/banned|kicked|different version|is full|closed the world|refused/i.test(String(message || ''));
}
/**
 * What a guest keeps when the link drops, to come back with the same place and belongings:
 * { code, name, at, dim, save } (`save` = world/save.js playerSaveData, left out for a dead player
 * whose belongings lie on the ground).
 */
export function makeResume(code, name, dim, save, dead, now = Date.now()) {
  return { code, name: cleanName(name), at: now, dim: dim || 'overworld', save: dead ? null : save };
}
export function validResume(r, now = Date.now()) {
  return !!r && typeof r === 'object' && typeof r.code === 'string' && r.code.length >= 4 && now - r.at >= 0 && now - r.at < RESUME_TTL_MS;
}
export function storeResume(r, storage = globalThis.sessionStorage) { try { storage.setItem(RESUME_KEY, JSON.stringify(r)); return true; } catch { return false; } }
export function takeResume(storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    const raw = storage.getItem(RESUME_KEY);
    storage.removeItem(RESUME_KEY);
    const r = raw ? JSON.parse(raw) : null;
    return validResume(r, now) ? r : null;
  } catch { return null; }
}
/** The saved guest record a rejoin should use: our own newer copy if it is for this dimension, else the host's. */
export function pickGuestRecord(hostRecord, resume, dimNow, now = Date.now()) {
  if (resume && validResume(resume, now) && resume.save && Array.isArray(resume.save.slots) && (resume.dim || 'overworld') === dimNow) return { ...resume.save, dim: resume.dim || 'overworld' };
  return hostRecord || null;
}

// Multiplayer social layer (src/net/social.js and its wiring in net/session.js): teams and friendly fire,
// private messages, ping beacons, emotes, the Tab list, spectating, kick / ban / op persisted in the save,
// guest identities and the reconnect flow. Pure logic is tested directly; the session wiring with a fake
// game and a loopback connection (the transport behind ?net=local).
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/net/remotePlayer.js', () => ({
  heldLights: () => [],
  RemotePlayer: class {
    constructor(scene, id, name, session) {
      this.id = id; this.name = name; this.session = session; this.state = null; this.emotes = [];
      const rp = this;
      this.target = { isPlayer: true, isRemotePlayer: true, remote: rp, netName: name, get x() { return rp.state ? rp.state.x : 0; }, get y() { return rp.state ? rp.state.y : 0; }, get z() { return rp.state ? rp.state.z : 0; }, get dead() { return !!(rp.state && rp.state.dead); }, hurt: vi.fn(() => true) };
    }
    setState(s) { this.state = s; }
    playEmote(k) { this.emotes.push(k); }
    dispose() {}
  },
}));

import {
  SocialState, TEAM_COLORS, MAX_TEAMS, cleanTeamName, teamColor, cleanToken, makeToken, loadClientToken, runSocial, HOST_SOCIAL_COMMANDS,
  PingBoard, routePing, PING_TTL_MS, PING_COOLDOWN_MS, PING_REACH, EMOTES, emotePose, EMOTE_MS, SIT_DROP, SIT_BREAK, breaksSeat, emoteByName, cleanEmote,
  canSpectate, nextSpectateTarget, playerRows, cleanRoster, pingClass, cleanPing, gamemodeLabel,
  makeResume, validResume, pickGuestRecord, storeResume, takeResume, shouldRetryJoin, reconnectDelay, RECONNECT_MAX, RESUME_TTL_MS,
} from '../src/net/social.js';
import { PROTOCOL_VERSION, encodeMessage, Reassembler } from '../src/net/protocol.js';
import { HostSession, ClientSession } from '../src/net/session.js';
import { LoopbackTransport } from '../src/net/transport.js';
import { ACTIONS, resolveBindings } from '../src/ui/bindings.js';
import { HELP } from '../src/ui/commands.js';

const wire = (x) => JSON.parse(JSON.stringify(x));
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// ---- teams ----------------------------------------------------------------------------------------
describe('teams', () => {
  it('creates a team, joins it and picks a free colour', () => {
    const s = new SocialState();
    expect(s.create('Ann', 'Reds', 'red')).toMatchObject({ ok: true });
    expect(s.teamOf('ann').name).toBe('Reds');
    expect(s.colorOf('Ann')).toBe(TEAM_COLORS.red);
    expect(s.create('Bob', 'Blues')).toMatchObject({ ok: true });
    expect(s.colorOf('Bob')).not.toBe(TEAM_COLORS.red); // the next free colour
    expect(s.join('Cy', 'reds')).toMatchObject({ ok: true });
    expect(s.teamOf('Cy')).toBe(s.teamOf('Ann'));
    expect(s.colorOf('Nobody')).toBe(null);
  });
  it('refuses duplicates, bad colours, unknown teams and too many teams', () => {
    const s = new SocialState();
    s.create('Ann', 'Reds');
    expect(s.create('Bob', 'reds').ok).toBe(false);
    expect(s.create('Bob', 'Pink', 'plaid').ok).toBe(false);
    expect(s.create('Bob', '!!!').ok).toBe(false);
    expect(s.join('Bob', 'Nope').ok).toBe(false);
    expect(s.join('Ann', 'Reds').ok).toBe(false); // already in it
    for (let i = 0; s.teams.size < MAX_TEAMS; i++) s.create('P' + i, 'T' + i);
    expect(s.create('Late', 'Extra').ok).toBe(false);
    expect(cleanTeamName('a b/c d')).toBe('abcd');
    expect(teamColor('#AABBCC')).toBe('#aabbcc');
    expect(teamColor('nope')).toBe(null);
  });
  it('moves a player between teams, hands the team on and drops empty ones', () => {
    const s = new SocialState();
    s.create('Ann', 'Reds'); s.join('Bob', 'Reds');
    s.create('Bob', 'Blues'); // leaving Reds
    expect(s.teams.get('reds').members).toEqual(['Ann']);
    s.join('Cy', 'Reds');
    s.leave('Ann');
    expect(s.teams.get('reds').owner).toBe('Cy');
    expect(s.leave('Cy').ok).toBe(true);
    expect(s.teams.has('reds')).toBe(false);
    expect(s.leave('Cy').ok).toBe(false);
  });
  it('friendly fire: team mates cannot hurt each other unless the owner turns it on', () => {
    const s = new SocialState();
    s.create('Ann', 'Reds'); s.join('Bob', 'Reds'); s.create('Cy', 'Blues');
    expect(s.blocksDamage('Ann', 'Bob')).toBe(true);
    expect(s.blocksDamage('Ann', 'Cy')).toBe(false);
    expect(s.blocksDamage('Ann', 'Ann')).toBe(false);
    expect(s.blocksDamage('Ann', 'Stranger')).toBe(false);
    expect(s.setFriendlyFire('Bob', true).ok).toBe(false); // not the owner
    expect(s.setFriendlyFire('Bob', true, true).ok).toBe(true); // an op may
    expect(s.blocksDamage('Ann', 'Bob')).toBe(false);
    expect(s.setFriendlyFire('Ann', false).ok).toBe(true);
    expect(s.blocksDamage('bob', 'ANN')).toBe(true);
  });
  it('only the owner recolours or disbands', () => {
    const s = new SocialState();
    s.create('Ann', 'Reds'); s.join('Bob', 'Reds');
    expect(s.setColor('Bob', 'green').ok).toBe(false);
    expect(s.setColor('Ann', 'green').ok).toBe(true);
    expect(s.colorOf('Bob')).toBe(TEAM_COLORS.green);
    expect(s.disband('Bob').ok).toBe(false);
    expect(s.disband('Ann').ok).toBe(true);
    expect(s.teamOf('Bob')).toBe(null);
  });
  it('travels over the wire and survives garbage', () => {
    const s = new SocialState();
    s.create('Ann', 'Reds', 'red'); s.join('Bob', 'Reds'); s.setFriendlyFire('Ann', true);
    const m = new SocialState();
    m.teamsFromWire(wire(s.teamsToWire()));
    expect(m.teamOf('Bob')).toMatchObject({ name: 'Reds', color: TEAM_COLORS.red, ff: true, owner: 'Ann' });
    m.teamsFromWire([null, 5, ['x'], ['Ok', 'nocolour', 0, 'A', ['A']], ['Fine', '#112233', 0, 'A', ['A', 'B']]]);
    expect([...m.teams.keys()]).toEqual(['fine']);
    m.teamsFromWire('junk');
    expect(m.teams.size).toBe(0);
  });
  it('lists teams', () => {
    const s = new SocialState();
    expect(s.teamLines()[0]).toMatch(/no teams/);
    s.create('Ann', 'Reds'); s.setFriendlyFire('Ann', true);
    expect(s.teamLines()[0]).toBe('Reds (1): Ann  [friendly fire]');
  });
});

// ---- ops, bans, identities, persisted in the save --------------------------------------------------------
describe('kick, ban and op lists', () => {
  it('who may remove whom', () => {
    const s = new SocialState();
    s.op('Olly');
    expect(s.isOp('olly', 'Host')).toBe(true);
    expect(s.isOp('host', 'Host')).toBe(true);
    expect(s.canKick('Host', 'Ann', 'Host')).toBe(true);
    expect(s.canKick('Host', 'Olly', 'Host')).toBe(true);
    expect(s.canKick('Olly', 'Ann', 'Host')).toBe(true);
    expect(s.canKick('Olly', 'Host', 'Host')).toBe(false);
    s.op('Pat');
    expect(s.canKick('Olly', 'Pat', 'Host')).toBe(false); // ops cannot remove ops
    expect(s.canKick('Ann', 'Bob', 'Host')).toBe(false);
    expect(s.deop('Pat')).toBe(true);
    expect(s.canKick('Olly', 'Pat', 'Host')).toBe(true);
  });
  it('bans by name and by the browser identity, and can pardon', () => {
    const s = new SocialState();
    s.ban('Mallory', 'griefing', 'Host', 'tok12345678');
    expect(s.banOf('mallory').reason).toBe('griefing');
    expect(s.banOf('Other', 'tok12345678').name).toBe('Mallory'); // a new name, same browser
    expect(s.banOf('Other', 'differenttok1')).toBe(null);
    expect(s.pardon('MALLORY')).toBe(true);
    expect(s.banOf('Other', 'tok12345678')).toBe(null); // a pardon lifts both
  });
  it('a name belongs to the browser that first used it', () => {
    const s = new SocialState();
    expect(s.identityFree('Ann', 'aaaaaaaa11')).toBe(true);
    s.bindIdentity('Ann', 'aaaaaaaa11');
    expect(s.identityFree('ann', 'aaaaaaaa11')).toBe(true);
    expect(s.identityFree('Ann', 'bbbbbbbb22')).toBe(false);
    expect(s.identityFree('Ann', null)).toBe(false);
    s.bindIdentity('Ann', 'cccccccc33'); // the first one stays
    expect(s.tokenOf('Ann')).toBe('aaaaaaaa11');
    s.bindIdentity('Bob', 'bad'); // not a token
    expect(s.tokenOf('Bob')).toBe(null);
  });
  it('is saved with the world and loaded back clean', () => {
    const s = new SocialState();
    s.create('Ann', 'Reds', 'red'); s.op('Olly'); s.ban('Mallory', 'x', 'Host', 'tok12345678'); s.bindIdentity('Ann', 'aaaaaaaa11');
    const saved = wire(s.save());
    const back = SocialState.from(saved);
    expect(back.teamOf('Ann').name).toBe('Reds');
    expect(back.isOp('olly')).toBe(true);
    expect(back.banOf('Mallory').by).toBe('Host');
    expect(back.identityFree('Ann', 'zzzzzzzz99')).toBe(false);
    expect(wire(back.save())).toEqual(saved);
    expect(SocialState.from(null).teams.size).toBe(0);
    const junk = SocialState.from({ teams: 4, ops: [1, 'ok'], bans: [{ nope: 1 }, { name: 'B' }], ids: { a: 'x', b: 'validtoken1' } });
    expect([...junk.ops.values()]).toEqual(['ok']);
    expect([...junk.bans.keys()]).toEqual(['b']);
    expect([...junk.ids.keys()]).toEqual(['b']);
  });
  it('tokens are well formed', () => {
    expect(cleanToken(makeToken())).toMatch(/^[a-z0-9]{20}$/);
    expect(cleanToken('short')).toBe(null);
    expect(cleanToken('has spaces in it!')).toBe(null);
    expect(cleanToken(5)).toBe(null);
    expect(loadClientToken()).toMatch(/^[A-Za-z0-9]{8,40}$/); // (no storage in node: still a token)
  });
});

// ---- commands -------------------------------------------------------------------------------------------
describe('social commands', () => {
  function env(extra = {}) {
    const log = { pm: [], team: [], kick: [], ban: [], teams: 0 };
    const social = new SocialState();
    const e = {
      social, hostName: 'Host', online: () => ['Host', 'Ann', 'Bob', 'Olly'],
      teamChanged: () => { log.teams++; }, pm: (f, t, m) => log.pm.push([f, t, m]), teamSay: (f, m) => log.team.push([f, m]),
      kick: (n, r) => log.kick.push([n, r]), ban: (n, r, by) => { log.ban.push([n, r, by]); social.ban(n, r, by); },
      ...extra,
    };
    return { e, log, social };
  }
  it('routes private messages and /r answers the last writer', () => {
    const { e, log } = env();
    expect(runSocial(e, 'Ann', '/msg bob hello there')).toEqual([]);
    expect(log.pm).toEqual([['Ann', 'Bob', 'hello there']]);
    expect(runSocial(e, 'Bob', '/r hi back')).toEqual([]);
    expect(log.pm[1]).toEqual(['Bob', 'Ann', 'hi back']);
    expect(runSocial(e, 'Ann', '/w Nobody hi')[0]).toMatch(/No player called Nobody/);
    expect(runSocial(e, 'Ann', '/msg Ann me')[0]).toMatch(/yourself/);
    expect(runSocial(e, 'Ann', '/msg Bob')[0]).toMatch(/Usage/);
    expect(runSocial(e, 'Olly', '/r hi')[0]).toMatch(/Nobody has written/);
    expect(log.pm).toHaveLength(2);
  });
  it('/team create, join, ff, leave and team chat', () => {
    const { e, log, social } = env();
    expect(runSocial(e, 'Ann', '/team create Reds red')[0]).toMatch(/Created team Reds/);
    expect(runSocial(e, 'Bob', '/team join reds')[0]).toMatch(/joined team Reds/);
    expect(log.teams).toBe(2);
    expect(runSocial(e, 'Bob', '/team ff on')[0]).toMatch(/Only Ann/);
    expect(runSocial(e, 'Ann', '/team ff on')[0]).toMatch(/Friendly fire in Reds is on/);
    expect(social.teams.get('reds').ff).toBe(true);
    expect(runSocial(e, 'Ann', '/team ff maybe')[0]).toMatch(/Usage/);
    expect(runSocial(e, 'Bob', '/tc  meet at the gate')).toEqual([]);
    expect(log.team).toEqual([['Bob', 'meet at the gate']]);
    expect(runSocial(e, 'Olly', '/tc hi')[0]).toMatch(/not in a team/);
    expect(runSocial(e, 'Ann', '/team list')[0]).toMatch(/Reds \(2\): Ann, Bob/);
    expect(runSocial(e, 'Bob', '/team leave')[0]).toMatch(/left team Reds/);
    expect(runSocial(e, 'Ann', '/team nonsense')[0]).toMatch(/Usage/);
  });
  it('kick, ban, pardon and op respect who is allowed', () => {
    const { e, log, social } = env();
    expect(runSocial(e, 'Ann', '/kick Bob')[0]).toMatch(/Only the host and the ops/);
    expect(runSocial(e, 'Host', '/op Olly')[0]).toMatch(/Olly is now an op/);
    expect(runSocial(e, 'Olly', '/op Ann')[0]).toMatch(/Only the host can change/);
    expect(runSocial(e, 'Olly', '/kick Bob out of here')[0]).toBe('Kicked Bob');
    expect(log.kick).toEqual([['Bob', 'out of here']]);
    expect(runSocial(e, 'Olly', '/kick Host')[0]).toMatch(/cannot kick Host/);
    expect(runSocial(e, 'Host', '/ban Ann spamming')[0]).toBe('Banned Ann: spamming');
    expect(log.ban).toEqual([['Ann', 'spamming', 'Host']]);
    expect(runSocial(e, 'Host', '/ban Ghost')[0]).toBe('Banned Ghost'); // offline: by name
    expect(social.banOf('ghost')).not.toBe(null);
    expect(runSocial(e, 'Olly', '/ban Host')[0]).toMatch(/cannot ban Host/);
    expect(runSocial(e, 'Olly', '/banlist').length).toBe(2);
    expect(runSocial(e, 'Olly', '/pardon ghost')[0]).toBe('Pardoned ghost');
    expect(runSocial(e, 'Olly', '/pardon ghost')[0]).toMatch(/not banned/);
    expect(runSocial(e, 'Host', '/oplist')[0]).toBe('Ops: Olly');
    expect(runSocial(e, 'Host', '/deop olly')[0]).toMatch(/no longer an op/);
    expect(runSocial(e, 'Host', '/kick Nobody')[0]).toMatch(/No player called/);
  });
  it('knows its commands and lists them in /help', () => {
    for (const c of ['msg', 'team', 'kick', 'ban', 'op']) expect(HOST_SOCIAL_COMMANDS.has(c)).toBe(true);
    const help = HELP.join('\n');
    for (const w of ['/team', '/msg', '/kick', '/spectate', '/emote', '/ping', '/list']) expect(help).toContain(w);
  });
});

// ---- ping beacons ----------------------------------------------------------------------------------------
describe('ping beacons', () => {
  const here = { x: 0, y: 64, z: 0 };
  it('go to the team only, or to everybody without one', () => {
    const s = new SocialState(), board = new PingBoard();
    s.create('Ann', 'Reds', 'red'); s.join('Bob', 'Reds');
    const names = ['Host', 'Ann', 'Bob', 'Cy'];
    const r = routePing(s, board, 'Ann', { x: 10, y: 65, z: 10 }, here, names, 1000, 'overworld');
    expect(r.ok).toBe(true);
    expect(r.targets).toEqual(['Bob']);
    expect(r.ping).toMatchObject({ from: 'Ann', x: 10, y: 65, z: 10, dim: 'overworld', color: TEAM_COLORS.red });
    const r2 = routePing(s, board, 'Cy', { x: 5, y: 65, z: 5 }, here, names, 1000, 'overworld');
    expect(r2.targets).toEqual(['Host', 'Ann', 'Bob']); // no team: everybody
    expect(r2.ping.color).toBe(null);
  });
  it('rejects garbage, far-away points and spam', () => {
    const s = new SocialState(), board = new PingBoard();
    const go = (m, t = 0, from = here) => routePing(s, board, 'Ann', m, from, ['Ann', 'Bob'], t, 'overworld').ok;
    expect(go({ x: NaN, y: 1, z: 1 })).toBe(false);
    expect(go({ x: 1e9, y: 1, z: 1 })).toBe(false);
    expect(go({ x: PING_REACH + 5, y: 64, z: 0 })).toBe(false);
    expect(go({ x: 5, y: 64, z: 0 }, 5000)).toBe(true);
    expect(go({ x: 6, y: 64, z: 0 }, 5000 + PING_COOLDOWN_MS - 1)).toBe(false);
    expect(go({ x: 6, y: 64, z: 0 }, 5000 + PING_COOLDOWN_MS)).toBe(true);
  });
  it('lives for a while, one per sender, per dimension', () => {
    const b = new PingBoard();
    b.add({ from: 'Ann', x: 1, y: 2, z: 3, dim: 'overworld', color: '#ff0000' }, 0);
    b.add({ from: 'Ann', x: 9, y: 2, z: 3, dim: 'overworld', color: '#ff0000' }, 100);
    b.add({ from: 'Bob', x: 4, y: 2, z: 3, dim: 'hollow', color: null }, 100);
    expect(b.list).toHaveLength(2);
    const now = b.active(5000, 'overworld');
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ from: 'Ann', x: 9, color: '#ff0000' });
    expect(now[0].life).toBeGreaterThan(0.7);
    expect(b.active(100 + PING_TTL_MS, 'hollow')).toHaveLength(0);
    expect(b.list).toHaveLength(0);
    b.add({ from: 'Cy', x: 1, y: 1, z: 1 }, 0);
    expect(b.list[0].color).toMatch(/^#/); // a fallback colour
  });
});

// ---- emotes ---------------------------------------------------------------------------------------------------
describe('emotes', () => {
  it('knows wave, point and sit by name or prefix', () => {
    expect(EMOTES).toEqual(['wave', 'point', 'sit']);
    expect(emoteByName('WAVE')).toBe('wave');
    expect(emoteByName('po')).toBe('point');
    expect(emoteByName('s')).toBe('sit');
    expect(emoteByName('')).toBe(null);
    expect(emoteByName('dance')).toBe(null);
    expect(cleanEmote('sit')).toBe('sit');
    expect(cleanEmote('x')).toBe(null);
  });
  it('wave raises the right arm and swings it, then ends', () => {
    const early = emotePose('wave', 300), later = emotePose('wave', 900);
    expect(early.armR[0]).toBeLessThan(-2); // up
    expect(later.armR[1]).not.toBe(early.armR[1]);
    expect(emotePose('wave', EMOTE_MS.wave)).toBe(null);
    expect(emotePose('wave', -1)).toBe(null);
    expect(emotePose('nope', 10)).toBe(null);
  });
  it('point holds the arm straight ahead; sit lowers the body until the player moves', () => {
    expect(emotePose('point', 1000).armR[0]).toBeCloseTo(-Math.PI / 2);
    const sit = emotePose('sit', 5000);
    expect(sit.drop).toBe(SIT_DROP);
    expect(sit.legs).toBeLessThan(-1);
    expect(emotePose('sit', 3.6e6)).not.toBe(null); // no time limit
    expect(emotePose('sit', 0).drop).toBe(0); // eases in
    expect(breaksSeat({ x: 0, z: 0 }, { x: SIT_BREAK / 2, z: 0 })).toBe(false);
    expect(breaksSeat({ x: 0, z: 0 }, { x: 1, z: 0 })).toBe(true);
  });
});

// ---- spectating and the Tab list -----------------------------------------------------------------------------------
describe('spectating', () => {
  it('only dead or creative players follow a friend', () => {
    expect(canSpectate({ dead: true })).toBe(true);
    expect(canSpectate({ creative: true })).toBe(true);
    expect(canSpectate({ gamemode: 'spectator' })).toBe(true);
    expect(canSpectate({ gamemode: 'survival' })).toBe(false);
    expect(canSpectate(null)).toBe(false);
  });
  it('cycles through the candidates both ways', () => {
    const n = ['Ann', 'Bob', 'Cy'];
    expect(nextSpectateTarget(n, null, 1)).toBe('Ann');
    expect(nextSpectateTarget(n, null, -1)).toBe('Cy');
    expect(nextSpectateTarget(n, 'ann', 1)).toBe('Bob');
    expect(nextSpectateTarget(n, 'Cy', 1)).toBe('Ann');
    expect(nextSpectateTarget(n, 'Ann', -1)).toBe('Cy');
    expect(nextSpectateTarget(n, 'Gone', 1)).toBe('Ann');
    expect(nextSpectateTarget([], 'Ann', 1)).toBe(null);
  });
});

describe('player list (Tab)', () => {
  it('builds rows with team colours, host first, and tidy pings', () => {
    const s = new SocialState();
    s.create('Ann', 'Reds', 'red'); s.op('Bob');
    const rows = playerRows([[2, 'Bob', 'creative', 80], [0, 'Host', 'survival', -1], [1, 'Ann', 'spectator', 350], [3, 'Cy', 'bogus', 'x']], s, 'Ann', 'Host');
    expect(rows.map((r) => r.name)).toEqual(['Host', 'Ann', 'Bob', 'Cy']);
    expect(rows[0]).toMatchObject({ host: true, ping: -1, gamemode: 'survival' });
    expect(rows[1]).toMatchObject({ you: true, team: 'Reds', color: TEAM_COLORS.red, gamemode: 'spectator', ping: 350 });
    expect(rows[2]).toMatchObject({ op: true, gamemode: 'creative', ping: 80 });
    expect(rows[3]).toMatchObject({ gamemode: 'survival', ping: -1 });
  });
  it('cleans what arrives and labels pings', () => {
    expect(cleanRoster([[1, 'A<b>', 'creative', 12.7], 'x', [2]])).toEqual([[1, 'Ab', 'creative', 13]]);
    expect(cleanRoster('nope')).toEqual([]);
    expect(cleanPing(-5)).toBe(-1);
    expect(cleanPing(0)).toBe(0);
    expect(cleanPing(1e9)).toBe(9999);
    expect(cleanPing('abc')).toBe(-1);
    expect([40, 200, 900, -1].map(pingClass)).toEqual(['good', 'ok', 'bad', 'none']);
    expect(gamemodeLabel('creative')).toBe('Creative');
    expect(gamemodeLabel('x')).toBe('Survival');
  });
});

// ---- disconnects and reconnecting --------------------------------------------------------------------------------------
describe('reconnect flow', () => {
  const save = { x: 10, y: 70, z: -4, yaw: 1, pitch: 0, slots: [{ id: 5, count: 3 }, null], armor: [] };
  const mem = () => { const m = new Map(); return { setItem: (k, v) => m.set(k, v), getItem: (k) => (m.has(k) ? m.get(k) : null), removeItem: (k) => m.delete(k) }; };
  it('keeps the place and belongings of a dropped guest, but not of a dead one', () => {
    const r = makeResume('ABC234', 'Ann', 'overworld', save, false, 1000);
    expect(r).toMatchObject({ code: 'ABC234', name: 'Ann', dim: 'overworld', save });
    expect(makeResume('ABC234', 'Ann', 'overworld', save, true, 1000).save).toBe(null); // their things lie on the ground
  });
  it('expires and survives a page reload through the session storage', () => {
    const st = mem(), r = makeResume('ABC234', 'Ann', 'overworld', save, false, 1000);
    expect(storeResume(r, st)).toBe(true);
    expect(takeResume(st, 1000 + 5000)).toEqual(r);
    expect(takeResume(st, 1000 + 5000)).toBe(null); // taken once
    storeResume(r, st);
    expect(takeResume(st, 1000 + RESUME_TTL_MS + 1)).toBe(null);
    st.setItem('saturncraft.resume', '{broken');
    expect(takeResume(st)).toBe(null);
    expect(validResume({ code: 'ABC234', at: 5000 }, 1000)).toBe(false); // from the future
    expect(takeResume(null)).toBe(null);
    expect(storeResume(r, null)).toBe(false);
  });
  it('prefers the guest\'s own newer copy in the same dimension, else the host\'s record', () => {
    const host = { x: 1, y: 1, z: 1, slots: [], dim: 'overworld' };
    const r = makeResume('ABC234', 'Ann', 'overworld', save, false, 1000);
    expect(pickGuestRecord(host, r, 'overworld', 2000)).toMatchObject({ x: 10, y: 70, z: -4, dim: 'overworld' });
    expect(pickGuestRecord(host, r, 'hollow', 2000)).toBe(host); // the group moved to another dimension
    expect(pickGuestRecord(host, r, 'overworld', 1000 + RESUME_TTL_MS + 1)).toBe(host);
    expect(pickGuestRecord(host, makeResume('ABC234', 'Ann', 'overworld', save, true, 1000), 'overworld', 2000)).toBe(host);
    expect(pickGuestRecord(null, null, 'overworld')).toBe(null);
  });
  it('retries timeouts but never a ban, a kick or another version', () => {
    for (const m of ['Timed out connecting to the host', 'No world is open with that code', 'Lost connection to the host']) expect(shouldRetryJoin(m)).toBe(true);
    for (const m of ['You are banned from this world: x', 'You were kicked from the world', 'The host runs a different version of Saturncraft', 'This world is full (8 players)', 'The host closed the world']) expect(shouldRetryJoin(m)).toBe(false);
    expect([1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([2, 3, 5, 8, 10, 10]);
    expect(RECONNECT_MAX).toBeGreaterThan(1);
  });
});

// ---- key bindings and compatibility ------------------------------------------------------------------------------------------
describe('controls and protocol compatibility', () => {
  it('binds the Tab list, ping and emote wheel to keys nothing else uses', () => {
    const t = resolveBindings();
    expect(t.players[0]).toBe('Tab'); expect(t.ping[0]).toBe('KeyB'); expect(t.emote[0]).toBe('KeyV');
    const mp = ACTIONS.filter((a) => a.group === 'Multiplayer').map((a) => a.id);
    expect(mp).toEqual(['players', 'ping', 'emote']);
  });
  it('keeps PROTOCOL_VERSION: the social messages are optional additions', () => {
    expect(PROTOCOL_VERSION).toBe(2);
    // every new message is plain JSON with a type an older peer ignores
    const re = new Reassembler();
    for (const m of [{ t: 'pg', ts: 1, rtt: 5, gm: 'creative' }, { t: 'pong', ts: 1 }, { t: 'roster', r: [[0, 'Host', 'survival', -1]] }, { t: 'ping', from: 'Ann', x: 1, y: 2, z: 3, d: 'overworld' }, { t: 'emote', id: 1, e: 'wave' }, { t: 'scmd', text: '/team list' }, { t: 'pm', from: 'A', m: 'hi' }, { t: 'teams', teams: [] }]) {
      expect(re.push(encodeMessage(m)[0])).toEqual(m);
    }
  });
});

// ---- the host wired to a (fake) game ----------------------------------------------------------------------------------------------
function fakeGame() {
  const chat = [];
  const g = {
    seed: 7, time: 100, weather: { save: () => ({}) }, daylightCycle: true, difficulty: 'normal', seasons: { save: () => ({}) }, worldEvents: null,
    worldSpawn: { x: 0, y: 64, z: 0 }, signs: new Map(), frames: new Map(), pots: new Map(), lecterns: new Map(), proving: null, netPlayers: {},
    scene: {}, ticks: 0, audio: { play() {} }, hud: { toast: vi.fn() }, running: false, lastTime: 0,
    chat: { add: (t, c) => chat.push([t, c || null]) }, chatLog: chat,
    player: { isPlayer: true, netName: 'Host', x: 0, y: 64, z: 0, yaw: 0, pitch: 0, gamemode: 'survival', hurt: vi.fn(() => true), eyePos: () => [0, 65.6, 0], lookDir: () => [0, 0, -1], setGamemode(m) { this.gamemode = m; }, setPosition(x, y, z) { Object.assign(this, { x, y, z }); } },
    world: { dimension: 'overworld', saved: new Map(), chunks: new Map(), listeners: { blockChanged: [] }, on(ev, f) { this.listeners[ev].push(f); }, raycast: () => ({ x: 3, y: 64, z: -5, id: 1 }) },
    entities: { list: [] }, chunks: { extraCenters: [] }, strikeLightning() {},
  };
  g.localPlayer = g.player;
  return g;
}
function hostWith(g = fakeGame()) {
  const h = new HostSession('Host', null, 'ABCDEF');
  h.attach(g);
  clearInterval(h.bgTimer);
  return { h, g };
}
/** A guest connection as the host sees it before and after hello. */
function conn(h, id) {
  const sent = [];
  const c = { id, name: null, joined: false, lastSeen: performance.now(), minEp: 0, ch: { send: (m) => sent.push(wire(m)), conn: { send: (str) => sent.push(JSON.parse(str)), peer: 'peer-' + id }, close() {}, backlog: () => 0 }, sent };
  h.clients.set(id, c);
  return c;
}
const hello = (h, c, name, tok) => h.onMessage(c, { t: 'hello', v: PROTOCOL_VERSION, name, tok });
const sentOf = (c, t) => c.sent.filter((m) => m.t === t);

afterEach(() => vi.useRealTimers());

describe('host: joining, identities, bans and reconnecting', () => {
  it('welcomes with the social flag and the teams, and binds the name to the browser', () => {
    const { h, g } = hostWith();
    h.social.create('Host', 'Reds', 'red');
    const c = conn(h, 1);
    hello(h, c, 'Ann', 'annannann1');
    const w = sentOf(c, 'welcome')[0];
    expect(w).toMatchObject({ v: PROTOCOL_VERSION, name: 'Ann', soc: 1 });
    expect(w.teams[0][0]).toBe('Reds');
    expect(sentOf(c, 'ready')).toHaveLength(1);
    expect(h.social.tokenOf('Ann')).toBe('annannann1');
    expect(g.chatLog.map((l) => l[0])).toContain('Ann joined the game');
    expect(sentOf(c, 'roster')[0].r.map((r) => r[1])).toEqual(['Host', 'Ann']);
  });
  it('does not let a second browser take over a name', () => {
    const { h } = hostWith();
    const a = conn(h, 1); hello(h, a, 'Ann', 'annannann1');
    h.drop(a); // Ann left
    const b = conn(h, 2); hello(h, b, 'Ann', 'mallory999');
    expect(sentOf(b, 'welcome')[0].name).toBe('Ann-2');
    const c = conn(h, 3); hello(h, c, 'Ann', 'annannann1');
    expect(sentOf(c, 'welcome')[0].name).toBe('Ann'); // the real Ann
    const d = conn(h, 4); hello(h, d, 'Ann', undefined);
    expect(sentOf(d, 'welcome')[0].name).toBe('Ann-3'); // an old client with no token
  });
  it('a guest who reconnects before the old link times out replaces it and keeps the name', () => {
    const { h } = hostWith();
    const a = conn(h, 1); hello(h, a, 'Ann', 'annannann1');
    expect(h.joined()).toHaveLength(1);
    const a2 = conn(h, 2); hello(h, a2, 'Ann', 'annannann1');
    expect(sentOf(a2, 'welcome')[0].name).toBe('Ann');
    expect(h.clients.has(1)).toBe(false);
    expect(h.joined().map((c) => c.id)).toEqual([2]);
  });
  it('rejects banned names and banned browsers with the reason, and not as a retryable error', () => {
    const { h } = hostWith();
    h.social.ban('Mallory', 'griefing', 'Host', 'malmalmal1');
    vi.useFakeTimers();
    const a = conn(h, 1); hello(h, a, 'mallory');
    expect(sentOf(a, 'reject')[0].reason).toBe('You are banned from this world: griefing');
    const b = conn(h, 2); hello(h, b, 'Other', 'malmalmal1');
    expect(sentOf(b, 'reject')).toHaveLength(1);
    expect(shouldRetryJoin(sentOf(b, 'reject')[0].reason)).toBe(false);
    expect(sentOf(b, 'welcome')).toHaveLength(0);
  });
  it('remembers where a dropped guest stood so a rejoin continues there', () => {
    const { h, g } = hostWith();
    const c = conn(h, 1); hello(h, c, 'Ann', 'annannann1');
    g.netPlayers.Ann = { x: 0, y: 64, z: 0, slots: [{ id: 3, count: 2 }], dim: 'overworld' };
    h.onMessage(c, { t: 'st', s: [41.5, 70, -12, 2, 0, -1, 0, 0] });
    h.drop(c, 'left the game');
    expect(g.netPlayers.Ann).toMatchObject({ x: 41.5, y: 70, z: -12, yaw: 2, dim: 'overworld' });
    expect(g.netPlayers.Ann.slots[0].count).toBe(2); // the belongings stay
    // a dead guest's record is left alone (their things are on the ground)
    const c2 = conn(h, 2); hello(h, c2, 'Bob', 'bobbobbob1');
    g.netPlayers.Bob = { x: 1, y: 64, z: 1, slots: [], dim: 'overworld' };
    h.onMessage(c2, { t: 'st', s: [99, 70, 99, 0, 0, -1, 2, 0] });
    h.drop(c2);
    expect(g.netPlayers.Bob.x).toBe(1);
  });
});

describe('host: messages, teams and beacons for guests', () => {
  function two() {
    const { h, g } = hostWith();
    const a = conn(h, 1); hello(h, a, 'Ann', 'annannann1');
    const b = conn(h, 2); hello(h, b, 'Bob', 'bobbobbob1');
    const cy = conn(h, 3); hello(h, cy, 'Cy', 'cycycycyc1');
    for (const c of [a, b, cy]) { c.rp.state = { x: 0, y: 64, z: 0 }; c.sent.length = 0; }
    return { h, g, a, b, cy };
  }
  it('/msg reaches only the recipient (and echoes to the sender); the host sees its own', () => {
    const { h, g, a, b, cy } = two();
    h.onMessage(a, { t: 'scmd', text: '/msg Bob psst' });
    expect(sentOf(b, 'pm')).toEqual([{ t: 'pm', from: 'Ann', m: 'psst' }]);
    expect(sentOf(a, 'pm')).toEqual([{ t: 'pm', to: 'Bob', m: 'psst' }]);
    expect(sentOf(cy, 'pm')).toHaveLength(0);
    h.onMessage(a, { t: 'scmd', text: '/msg Host hi boss' });
    expect(g.chatLog.some(([t, col]) => t === '[Ann -> you] hi boss' && col)).toBe(true);
    expect(h.socialCommand('/msg Ann welcome')).toEqual([]);
    expect(sentOf(a, 'pm').pop()).toEqual({ t: 'pm', from: 'Host', m: 'welcome' });
    h.onMessage(b, { t: 'scmd', text: '/r thanks' });
    expect(sentOf(a, 'pm').pop()).toEqual({ t: 'pm', from: 'Bob', m: 'thanks' });
  });
  it('answers a guest command with cmdout, and team changes go to everyone', () => {
    const { h, a, b, cy } = two();
    h.onMessage(a, { t: 'scmd', text: '/team create Reds red' });
    expect(sentOf(a, 'cmdout')[0].lines[0]).toMatch(/Created team Reds/);
    for (const c of [a, b, cy]) expect(sentOf(c, 'teams')[0].teams[0]).toEqual(['Reds', TEAM_COLORS.red, 0, 'Ann', ['Ann']]);
    h.onMessage(b, { t: 'scmd', text: '/team join Reds' });
    h.onMessage(b, { t: 'scmd', text: '/tc rally' });
    expect(sentOf(a, 'tchat')).toEqual([{ t: 'tchat', team: 'Reds', from: 'Bob', m: 'rally' }]);
    expect(sentOf(cy, 'tchat')).toHaveLength(0);
    h.onMessage(cy, { t: 'scmd', text: '/kick Bob' });
    expect(sentOf(cy, 'cmdout').pop().lines[0]).toMatch(/Only the host and the ops/);
  });
  it('chat from a team member carries the team colour in the host log', () => {
    const { h, g, a } = two();
    h.social.create('Ann', 'Reds', 'red');
    h.onMessage(a, { t: 'chat', m: 'hello' });
    expect(g.chatLog.pop()).toEqual(['<Ann> hello', TEAM_COLORS.red]);
  });
  it('a beacon goes to the sender\'s team mates only, once a second', () => {
    const { h, g, a, b, cy } = two();
    h.social.create('Ann', 'Reds', 'red'); h.social.join('Bob', 'Reds');
    h.onMessage(a, { t: 'ping', x: 10, y: 65, z: 10 });
    expect(sentOf(b, 'ping')).toEqual([{ t: 'ping', from: 'Ann', x: 10, y: 65, z: 10, d: 'overworld', c: TEAM_COLORS.red }]);
    expect(sentOf(cy, 'ping')).toHaveLength(0);
    expect(sentOf(a, 'ping')).toHaveLength(0);
    expect(h.pings.list).toHaveLength(0); // the host is not on the team: no marker on its side
    h.onMessage(a, { t: 'ping', x: 11, y: 65, z: 10 });
    expect(sentOf(b, 'ping')).toHaveLength(1); // rate limited
    // the host's own key press reaches the (teamless) host's board and everybody
    expect(h.pingAtCrosshair()).toBe(true);
    expect(sentOf(cy, 'ping')[0]).toMatchObject({ from: 'Host', x: 3.5, y: 65, z: -4.5 });
    expect(h.activePings().map((p) => p.from)).toEqual(['Host']);
    expect(g.hud.toast).not.toHaveBeenCalled();
  });
  it('a team beacon also shows on the host when the host is on that team', () => {
    const { h, a } = two();
    h.social.create('Host', 'Reds', 'red'); h.social.join('Ann', 'Reds');
    h.onMessage(a, { t: 'ping', x: 4, y: 65, z: 4 });
    expect(h.activePings().map((p) => p.from)).toEqual(['Ann']);
  });
  it('relays emotes to the others, rate limited and only the known ones', () => {
    const { h, a, b, cy } = two();
    h.onMessage(a, { t: 'emote', e: 'wave' });
    expect(a.rp.emotes).toEqual(['wave']);
    expect(sentOf(b, 'emote')).toEqual([{ t: 'emote', id: 1, e: 'wave' }]);
    expect(sentOf(cy, 'emote')).toHaveLength(1);
    expect(sentOf(a, 'emote')).toHaveLength(0);
    h.onMessage(a, { t: 'emote', e: 'sit' }); // too soon
    h.onMessage(b, { t: 'emote', e: 'moonwalk' });
    expect(a.rp.emotes).toEqual(['wave']);
    expect(b.rp.emotes).toEqual([]);
    expect(h.emote('point')).toBe(true);
    expect(sentOf(cy, 'emote').pop()).toEqual({ t: 'emote', id: 0, e: 'point' });
    expect(h.game.ownEmote.k).toBe('point');
  });
  it('answers pings with a pong and lists ping and game mode in the roster', () => {
    const { h, g, a, b } = two();
    g.player.gamemode = 'creative';
    h.onMessage(a, { t: 'pg', ts: 1234, rtt: 42, gm: 'spectator' });
    expect(sentOf(a, 'pong')).toEqual([{ t: 'pong', ts: 1234 }]);
    h.onMessage(b, { t: 'pg', ts: 1, rtt: -7, gm: 'cheating' });
    expect(h.hostRoster()).toEqual([[0, 'Host', 'creative', -1], [1, 'Ann', 'spectator', 42], [2, 'Bob', 'survival', -1], [3, 'Cy', 'survival', -1]]);
    h.sendRoster();
    expect(sentOf(a, 'roster').pop().r).toHaveLength(4);
    const rows = h.playerRows();
    expect(rows[0]).toMatchObject({ name: 'Host', host: true, you: true });
    expect(rows.find((r) => r.name === 'Ann')).toMatchObject({ gamemode: 'spectator', ping: 42 });
  });
  it('kicks tell the guest why and then let go; bans keep them out', () => {
    vi.useFakeTimers();
    const { h, g, a } = two();
    expect(h.socialCommand('/kick Ann too loud')).toEqual(['Kicked Ann']);
    expect(sentOf(a, 'bye')).toEqual([{ t: 'bye', reason: 'You were kicked from the world: too loud', kick: 1 }]);
    expect(h.clients.has(1)).toBe(true);
    vi.advanceTimersByTime(500);
    expect(h.clients.has(1)).toBe(false);
    expect(g.chatLog.some(([t]) => t.startsWith('Ann was kicked'))).toBe(true);
    const b = [...h.clients.values()][0];
    expect(h.socialCommand('/ban Bob')).toEqual(['Banned Bob']);
    vi.advanceTimersByTime(500);
    expect(h.social.banOf('Bob', 'bobbobbob1')).not.toBe(null);
    expect(b.sent.some((m) => m.t === 'bye')).toBe(true);
    const again = conn(h, 9); hello(h, again, 'Bob2', 'bobbobbob1'); // a new name, same browser
    expect(sentOf(again, 'reject')[0].reason).toMatch(/banned/);
  });
  it('friendly fire: team mates cannot hurt each other with PvP on, unless allowed', () => {
    const { h, g, a, b } = two();
    h.social.create('Ann', 'Reds'); h.social.join('Bob', 'Reds'); h.social.join('Host', 'Reds');
    b.rp.state = { x: 1, y: 64, z: 0 };
    h.onMessage(a, { t: 'pvp', id: 2, d: 4 });
    expect(sentOf(b, 'hurt')).toHaveLength(0);
    h.onMessage(a, { t: 'pvp', id: 0, d: 4 });
    expect(g.player.hurt).not.toHaveBeenCalled();
    expect(h.targetHurt(b.rp, 3, 'player', g.player)).toBe(false); // the host's own blows too
    h.social.setFriendlyFire('Ann', true);
    h.onMessage(a, { t: 'pvp', id: 2, d: 4 });
    expect(sentOf(b, 'hurt')).toHaveLength(1);
    h.onMessage(a, { t: 'pvp', id: 0, d: 4 });
    expect(g.player.hurt).toHaveBeenCalledTimes(1);
    // another team: always fair game
    h.social.setFriendlyFire('Ann', false);
    h.social.create('Cy', 'Blues');
    const cy = h.clientByName('Cy'); cy.rp.state = { x: 1, y: 64, z: 0 };
    h.onMessage(a, { t: 'pvp', id: 3, d: 4 });
    expect(sentOf(cy, 'hurt')).toHaveLength(1);
  });
  it('lets a dead or creative host follow a guest, and ends when they leave', () => {
    const { h, g, a, b } = two();
    expect(h.startSpectate()).toMatch(/dead or in creative/);
    g.player.gamemode = 'creative'; g.player.creative = true;
    a.rp.state = { x: 20, y: 70, z: 5, yaw: 1.5, pitch: 0.2 };
    b.rp.state = { x: -9, y: 64, z: 9, yaw: 0, pitch: 0 };
    expect(h.startSpectate('bob')).toBe(null);
    expect(g.player.gamemode).toBe('spectator');
    h.tickSpectate();
    expect(g.player).toMatchObject({ x: -9, y: 64, z: 9 });
    h.cycleSpectate(1);
    expect(h.spectate.target).toBe('Cy' === h.spectate.target ? 'Cy' : h.spectate.target);
    h.spectate.target = 'Ann';
    h.tickSpectate();
    expect(g.player).toMatchObject({ x: 20, y: 70, z: 5, yaw: 1.5, pitch: 0.2 });
    a.rp.state.dead = true;
    h.tickSpectate(); // Ann died: on to the next friend
    expect(h.spectate.target).not.toBe('Ann');
    expect(h.stopSpectate()).toBe(true);
    expect(g.player.gamemode).toBe('creative'); // back to what they were
    expect(h.startSpectate('Nobody')).toMatch(/No player called/);
  });
  it('a dead player follows a friend and returns to survival afterwards', () => {
    const { h, g, a } = two();
    a.rp.state = { x: 2, y: 64, z: 2, yaw: 0, pitch: 0 };
    g.player.gamemode = 'spectator'; g.player.creative = true; // (the death screen switches first)
    expect(h.startSpectate(null, 'survival')).toBe(null);
    h.tickSpectate();
    expect(h.stopSpectate()).toBe(true);
    expect(g.player.gamemode).toBe('survival');
  });
});

// ---- ?net=local: a real host and guest over the loopback transport ------------------------------------------------------------------
describe('loopback (?net=local)', () => {
  it('joins with a token, gets the social welcome and exchanges messages both ways', async () => {
    const g = fakeGame();
    const h = new HostSession('Host', new LoopbackTransport(), 'LOOP22');
    await h.open(g);
    clearInterval(h.bgTimer);
    const cs = new ClientSession('Ann');
    cs.code = 'LOOP22';
    await cs.connect(new LoopbackTransport(), 'LOOP22');
    clearInterval(cs.bgTimer);
    expect(cs.welcome).toMatchObject({ name: 'Ann', soc: 1, hostName: 'Host' });
    expect(cs.hostSocial).toBe(true);
    expect(h.joined().map((c) => c.name)).toEqual(['Ann']);
    expect(h.social.tokenOf('Ann')).toBe(cs.tok);

    // the guest's game, enough of it for the social messages
    const cg = fakeGame();
    cg.player.netName = 'Ann';
    cs.game = cg;
    cs.name = 'Ann'; cs.id = cs.welcome.id;
    cs.addRemote(0, 'Host');

    cs.socialCommand('/team create Reds red');
    await tick(60);
    expect(cs.social.teamOf('Ann').name).toBe('Reds'); // the host's 'teams' broadcast reached the guest
    expect(h.social.teamOf('Ann').color).toBe(TEAM_COLORS.red);
    cs.socialCommand('/msg Host loopback works');
    await tick(60);
    expect(g.chatLog.some(([t]) => t === '[Ann -> you] loopback works')).toBe(true);
    expect(cg.chatLog.some(([t]) => t === '[you -> Host] loopback works')).toBe(true);
    h.socialCommand('/msg Ann hello guest');
    await tick(60);
    expect(cg.chatLog.some(([t]) => t === '[Host -> you] hello guest')).toBe(true);

    // roster and ping measurement
    h.sendRoster();
    cs.send({ t: 'pg', ts: performance.now(), rtt: cs.rtt, gm: 'creative' });
    await tick(60);
    expect(cs.rtt).toBeGreaterThanOrEqual(0);
    const rows = cs.playerRows();
    expect(rows.map((r) => r.name)).toEqual(['Host', 'Ann']);
    expect(rows[1]).toMatchObject({ you: true, team: 'Reds' });
    expect(rows[1].ping).toBe(cs.rtt);

    // a beacon from the guest reaches nobody (the host is not on the team) but shows for the guest itself
    cg.player.gamemode = 'creative';
    expect(cs.pingAtCrosshair()).toBe(true);
    expect(cs.activePings().map((p) => p.from)).toEqual(['Ann']);
    h.social.join('Host', 'Reds');
    await tick(1100);
    cs.pings.clear();
    expect(cs.pingAtCrosshair()).toBe(true);
    await tick(60);
    expect(h.activePings().map((p) => p.from)).toEqual(['Ann']); // now the host is a team mate
    expect(h.activePings()[0]).toMatchObject({ x: 3.5, y: 65, z: -4.5, color: TEAM_COLORS.red });

    // emotes and a kick
    h.emote('wave');
    await tick(60);
    expect(cs.remotes.get(0).emotes).toEqual(['wave']);
    expect(cs.emote('sit')).toBe(true);
    await tick(60);
    expect(h.clientByName('Ann').rp.emotes).toEqual(['sit']);
    const lost = vi.fn();
    cs.lost = lost;
    h.socialCommand('/kick Ann');
    await tick(600);
    expect(lost).toHaveBeenCalled();
    expect(lost.mock.calls[0][0]).toMatch(/kicked/);
    expect(lost.mock.calls[0][1]).toBeUndefined(); // no automatic reconnect after a kick
    expect(h.joined()).toHaveLength(0);

    cs.closed = true;
    h.close();
    await tick(500);
  });

  it('an old host (no social flag) is told so instead of silently ignoring the command', () => {
    const cs = new ClientSession('Ann');
    expect(cs.socialCommand('/team list')[0]).toMatch(/older version/);
  });
});

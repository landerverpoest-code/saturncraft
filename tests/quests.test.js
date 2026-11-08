import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import '../src/mobs/slagColossus.js'; import '../src/mobs/dimensionMobs.js';
import {
  generateBounties, QuestLog, QuestBus, gain, CHAINS, CHAIN_BY_ID, KINDS, bountyTitle, rewardText, cleanBounty, cleanActive,
  cleanPlayer, directionHint, villageName, elderName, dayOf, MAX_ACTIVE, BOUNTIES_PER_BOARD, COMMONS, rewardStack, DAY_TICKS,
} from '../src/player/quests.js';
import { Quests, CLIENT_EVENTS, takeItems } from '../src/player/questSystem.js';
import { B, BLOCKS, SHAPE, EXT_BASE } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { blockBoxes } from '../src/world/shapes.js';
import { craft } from '../src/player/crafting.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { villageInRegion, stampVillages, boardSpot } from '../src/world/villages.js';
import { cidx } from '../src/world/constants.js';
import { ACTIONS, resolveBindings, findBinding } from '../src/ui/bindings.js';
import { MILESTONES } from '../src/player/milestones.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { buildTopics } from '../src/ui/helpTopics.js';
import { Inventory } from '../src/player/inventory.js';
import { SocialState } from '../src/net/social.js';
import { getRep } from '../src/mobs/reputation.js';
import { LANDMARK_BY_KEY } from '../src/world/landmarkKinds.js';

const CTX = { biome: 'plains', others: [{ key: '640,320', name: 'Oakhaven', dist: 400 }, { key: '-300,900', name: 'Fenwick', dist: 950 }], structs: [{ kind: 'tomb', dist: 600 }, { kind: 'lighthouse', dist: 1200 }] };
const VK = '320,160';

describe('bounty generation', () => {
  it('is deterministic from seed, day and village, with three bounties of different kinds', () => {
    const a = generateBounties(1234, 7, VK, CTX), b = generateBounties(1234, 7, VK, CTX);
    expect(a).toEqual(b);
    expect(a.length).toBe(BOUNTIES_PER_BOARD);
    expect(new Set(a.map((x) => x.kind)).size).toBe(a.length);
    for (const x of a) { expect(KINDS).toContain(x.kind); expect(x.n).toBeGreaterThanOrEqual(1); expect(x.id).toBe(`${VK}|7|${x.slot}`); expect(x.reward.beryl).toBeGreaterThan(0); expect(x.reward.rep).toBeGreaterThan(0); }
  });
  it('rotates with the day, differs by seed and by village', () => {
    const sig = (l) => JSON.stringify(l.map((x) => [x.kind, x.target, x.n]));
    const days = new Set(); for (let d = 0; d < 12; d++) days.add(sig(generateBounties(99, d, VK, CTX)));
    expect(days.size).toBeGreaterThan(8);
    expect(sig(generateBounties(1, 3, VK, CTX))).not.toBe(sig(generateBounties(2, 3, VK, CTX)));
    expect(sig(generateBounties(1, 3, VK, CTX))).not.toBe(sig(generateBounties(1, 3, '999,-40', CTX)));
  });
  it('only offers deliveries and explorations the context supports, and every kind turns up over time', () => {
    const seen = new Set();
    for (let d = 0; d < 80; d++) for (const x of generateBounties(5, d, VK, CTX)) seen.add(x.kind);
    expect(seen.size).toBe(KINDS.length);
    for (let d = 0; d < 60; d++) for (const x of generateBounties(5, d, VK, { biome: null, others: [], structs: [] })) expect(['deliver', 'explore']).not.toContain(x.kind);
  });
  it('deliveries name another village; explorations name a real structure; cross never repeats the home biome', () => {
    for (let d = 0; d < 120; d++) for (const x of generateBounties(8, d, VK, CTX)) {
      if (x.kind === 'deliver') { expect(['640,320', '-300,900']).toContain(x.to); expect(x.toName).toBeTruthy(); }
      if (x.kind === 'explore') { expect(['tomb', 'lighthouse']).toContain(x.target); expect(LANDMARK_BY_KEY[x.target]).toBeTruthy(); }
      if (x.kind === 'cross') expect(x.target).not.toBe('plains');
      expect(bountyTitle(x).length).toBeGreaterThan(5);
      expect(rewardText(x.reward)).toContain('Beryl');
      expect(cleanBounty(x)).toEqual(x);
    }
  });
  it('day numbers come from world ticks', () => { expect(dayOf(0)).toBe(0); expect(dayOf(DAY_TICKS * 3 + 5)).toBe(3); expect(dayOf(-5)).toBe(0); });
  it('names are stable', () => { expect(villageName('1,2')).toBe(villageName('1,2')); expect(elderName('1,2')).toBeTruthy(); });
});

describe('matching events', () => {
  it('each kind reacts to its own event only', () => {
    expect(gain({ kind: 'gather', target: I.COAL }, { type: 'pickup', id: I.COAL, n: 3 })).toBe(3);
    expect(gain({ kind: 'gather', target: I.COAL }, { type: 'pickup', id: I.IRON_INGOT, n: 3 })).toBe(0);
    expect(gain({ kind: 'gather', target: I.COAL }, { type: 'craft', id: I.COAL, n: 3 })).toBe(0);
    expect(gain({ kind: 'slay', target: 'shambler' }, { type: 'kill', mob: 'shambler' })).toBe(1);
    expect(gain({ kind: 'slay', target: 'shambler' }, { type: 'kill', mob: 'rattler' })).toBe(0);
    expect(gain({ kind: 'explore', target: 'tomb' }, { type: 'explore', landmark: 'tomb' })).toBe(1);
    expect(gain({ kind: 'cross', target: 'desert' }, { type: 'cross', biome: 'desert', n: 12 })).toBe(12);
    expect(gain({ kind: 'cook', target: null }, { type: 'cook', id: 99, n: 1 })).toBe(1);
    expect(gain({ kind: 'trade' }, { type: 'trade', n: 2 })).toBe(2);
    expect(gain({ kind: 'deliver', target: I.COAL }, { type: 'pickup', id: I.COAL, n: 2 })).toBe(0);
    expect(gain({ kind: 'gather', target: I.COAL }, { type: 'pickup', id: I.COAL, n: -4 })).toBe(0);
  });
  it('the bus delivers to subscribers and wildcards', () => {
    const bus = new QuestBus(), a = vi.fn(), all = vi.fn();
    bus.on('kill', a); bus.on('*', all);
    bus.emit('kill', { mob: 'x' }); bus.emit('craft', {});
    expect(a).toHaveBeenCalledTimes(1); expect(all).toHaveBeenCalledTimes(2);
  });
});

const bounty = (over = {}) => ({ id: 'b1', vk: VK, day: 1, slot: 0, kind: 'slay', target: 'shambler', n: 3, tier: 0, reward: { beryl: 4, rep: 2, items: [] }, ...over });

describe('the quest log', () => {
  it('accepts once, limits the list, and remembers turned-in bounties for the day', () => {
    const log = new QuestLog();
    expect(log.accept('*', bounty(), 1).ok).toBe(true);
    expect(log.accept('*', bounty(), 1).why).toMatch(/Already/);
    for (let i = 0; i < MAX_ACTIVE - 1; i++) expect(log.accept('*', bounty({ id: 'x' + i }), 1).ok).toBe(true);
    expect(log.accept('*', bounty({ id: 'over' }), 1).why).toMatch(/at a time/);
    expect(log.accept('*', { kind: 'nope' }, 1).ok).toBe(false);
    const e = log.group('*').active[0];
    e.progress = e.n;
    expect(log.turnIn('*', 'b1', 1)).toBeTruthy();
    expect(log.accept('*', bounty(), 1).why).toMatch(/done for today/);
    log.prune(10);
    expect(log.group('*').turned.b1).toBeUndefined();
  });
  it('credits each contributor and caps progress at the goal', () => {
    const log = new QuestLog();
    log.accept('*', bounty(), 1);
    expect(log.apply('*', { type: 'kill', mob: 'shambler' }, 'Ana')[0].gained).toBe(1);
    log.apply('*', { type: 'kill', mob: 'shambler' }, 'Bo');
    const r = log.apply('*', { type: 'kill', mob: 'shambler' }, 'Ana');
    expect(r[0].done).toBe(true);
    expect(log.apply('*', { type: 'kill', mob: 'shambler' }, 'Bo')).toEqual([]);
    const e = log.group('*').active[0];
    expect(e.progress).toBe(3); expect(e.contrib).toEqual({ Ana: 2, Bo: 1 });
    expect(log.apply('team', { type: 'kill', mob: 'shambler' }, 'Cy')).toEqual([]);
  });
  it('groups are separate and deliveries are handed in, not earned by events', () => {
    const log = new QuestLog();
    log.accept('red', bounty({ id: 'd', kind: 'deliver', target: I.COAL, n: 5, to: '640,320', toName: 'Oakhaven' }), 1);
    log.accept('blue', bounty({ id: 'd', kind: 'deliver', target: I.COAL, n: 5, to: '640,320', toName: 'Oakhaven' }), 1);
    expect(log.apply('red', { type: 'pickup', id: I.COAL, n: 5 }, 'A')).toEqual([]);
    expect(log.handIn('red', 'd', 3, 'A')).toBe(3);
    expect(log.handIn('red', 'd', 9, 'B')).toBe(2);
    expect(log.handIn('red', 'd', 1, 'B')).toBe(0);
    expect(log.group('blue').active[0].progress).toBe(0);
    expect(log.turnIn('blue', 'd', 1)).toBeNull();
    expect(log.turnIn('red', 'd', 1).contrib).toEqual({ A: 3, B: 2 });
  });
  it('story chains advance step by step and are claimed once', () => {
    const log = new QuestLog();
    expect(CHAINS.length).toBe(3);
    for (const c of CHAINS) { expect(c.steps.length).toBeGreaterThanOrEqual(3); expect(c.steps.length).toBeLessThanOrEqual(4); expect(c.reward.item.label).toBeTruthy(); expect(c.steps.every((s) => s.text)).toBe(true); }
    expect(log.startChain('Ana', 'lamplight').ok).toBe(true);
    expect(log.startChain('ana', 'lamplight').ok).toBe(false);
    expect(log.startChain('Ana', 'nope').ok).toBe(false);
    log.storyApply('Ana', { type: 'kill', mob: 'shambler' }); // wrong step
    expect(log.chainState('Ana', 'lamplight')).toMatchObject({ step: 0, p: 0 });
    const def = CHAIN_BY_ID.lamplight;
    expect(log.storyApply('Ana', { type: 'craft', id: B.TORCH, n: 12 })[0].advanced).toBe(true);
    expect(log.storyApply('Ana', { type: 'explore', landmark: 'lighthouse' })[0].advanced).toBe(true);
    log.storyApply('Ana', { type: 'kill', mob: 'shambler' });
    expect(log.chainState('Ana', 'lamplight')).toMatchObject({ step: 2, p: 1 });
    for (let i = 0; i < 7; i++) log.storyApply('Ana', { type: 'kill', mob: 'shambler' });
    expect(log.chainState('Ana', 'lamplight').step).toBe(3);
    expect(log.claimChain('Ana', 'lamplight')).toBeNull(); // not finished
    const last = log.storyApply('Ana', { type: 'pickup', id: I.COAL, n: 40 })[0];
    expect(last.ready).toBe(true);
    expect(log.claimChain('Ana', 'lamplight')).toBe(def);
    expect(log.claimChain('Ana', 'lamplight')).toBeNull();
    expect(log.startChain('Ana', 'lamplight').ok).toBe(false); // told
  });
  it('the three chains reach existing structures and bosses with named rewards', () => {
    const kinds = CHAINS.flatMap((c) => c.steps.filter((s) => s.kind === 'explore').map((s) => s.target));
    for (const k of kinds) expect(LANDMARK_BY_KEY[k]).toBeTruthy();
    const slay = CHAINS.flatMap((c) => c.steps.filter((s) => s.kind === 'slay').map((s) => s.target));
    expect(slay).toContain('slag_colossus'); expect(slay).toContain('void_wyrm');
    for (const c of CHAINS) { const st = rewardStack(c.reward.item); expect(st.label).toBeTruthy(); expect(st.id).toBeGreaterThan(0); expect(Object.keys(st.ench).length).toBeGreaterThan(0); }
  });
  it('saves, loads and cleans', () => {
    const log = new QuestLog();
    log.accept('*', bounty(), 1); log.apply('*', { type: 'kill', mob: 'shambler' }, 'Ana'); log.startChain('Ana', 'sunward');
    const data = JSON.parse(JSON.stringify(log.save()));
    const b = new QuestLog(); b.load(data);
    expect(b.group('*').active[0].contrib).toEqual({ Ana: 1 });
    expect(b.chainState('Ana', 'sunward')).toMatchObject({ step: 0 });
    const c = new QuestLog();
    c.load({ groups: { '*': { active: [{ id: 'x', kind: 'gather', target: 99999, n: 3 }, { id: 'ok', kind: 'trade', n: 99999999, progress: -5, contrib: { a: -3, b: 2 } }] } }, players: { Bob: { bounties: 'lots', chains: { lamplight: { step: 99, p: 1e9 }, bogus: {} }, claimed: { coldforge: 1, bogus: 1 } } } });
    expect(c.group('*').active.length).toBe(1);
    expect(c.group('*').active[0]).toMatchObject({ n: 1000, progress: 0, contrib: { b: 2 } });
    expect(c.player('bob').chains.lamplight.step).toBe(CHAINS[0].steps.length - 1);
    expect(c.player('bob').claimed).toEqual({ coldforge: 1 });
    b.load(null); expect(b.group('*').active).toEqual([]);
    expect(cleanActive({ kind: 'slay', target: 'x'.repeat(40), id: 'a', n: 2 })).toBeNull();
    expect(cleanPlayer(7)).toEqual({ bounties: 0, chains: {}, claimed: {} });
  });
  it('a guest takes the host\'s view as its whole log', () => {
    const host = new QuestLog();
    host.accept('red', bounty(), 1); host.apply('red', { type: 'kill', mob: 'shambler' }, 'Ana'); host.startChain('Bo', 'coldforge');
    const wire = JSON.parse(JSON.stringify(host.viewFor('Bo', 'red')));
    const guest = new QuestLog();
    expect(guest.applyView(wire, 'Bo')).toBe(true);
    expect(guest.group('red').active[0].progress).toBe(1);
    expect(guest.chainState('Bo', 'coldforge')).toBeTruthy();
    expect(guest.applyView({ k: 5 }, 'Bo')).toBe(false);
  });
  it('directions read well', () => {
    expect(directionHint(0, 0, 400, 0)).toBe('about 400 blocks east');
    expect(directionHint(0, 0, 0, -1000)).toBe('about 1000 blocks north');
    expect(directionHint(0, 0, 5, 5)).toBe('right here');
  });
});

// ---- the glue, against a stub game -------------------------------------------------------------------------------------
function stubGame(over = {}) {
  const inv = new Inventory();
  const toasts = [];
  const g = {
    seed: 4242, time: DAY_TICKS * 2, ticks: 0, net: null, social: null,
    player: { isPlayer: true, inventory: inv, x: 0, y: 70, z: 0, creative: false, reputation: {}, dead: false },
    hud: { toast: (m) => toasts.push(m) },
    milestones: { event: vi.fn() },
    audio: { play() {} },
    entities: { spawnXp: vi.fn(), spawnItem: vi.fn() },
    ui: { open: null, refreshQuests: vi.fn() },
    world: { dimension: 'overworld', gen: null, getBlock: () => B.BOUNTY_BOARD },
    toasts,
    ...over,
  };
  return g;
}

describe('the quest system', () => {
  it('credits a single player, pays beryl, an item and reputation on turn-in, counts the bounty', () => {
    const g = stubGame(); const q = new Quests(g); g.quests = q;
    const site = q.siteAt(10, 10), offers = q.offersFor(site, 2);
    expect(offers.length).toBe(3);
    const b = { ...offers[0], kind: 'slay', target: 'shambler', n: 2, reward: { beryl: 5, rep: 4, items: [{ id: I.BREAD, count: 3 }] } };
    q.log.accept('*', b, 2);
    q.emit('kill', { mob: 'shambler' }); q.emit('kill', { mob: 'shambler' });
    expect(g.toasts.some((t) => /ready/.test(t))).toBe(true);
    const r = q.handle(g.player, 'You', 'turn', { x: 10, y: 64, z: 10 }, { id: b.id }, true);
    expect(r.ok).toBe(true);
    expect(g.player.inventory.count(I.BERYL)).toBe(5);
    expect(g.player.inventory.count(I.BREAD)).toBe(3);
    expect(getRep(g.player, b.vk)).toBe(4);
    expect(q.mine().player.bounties).toBe(1);
    expect(g.milestones.event).toHaveBeenCalledWith('bounty');
    expect(q.log.group('*').active.length).toBe(0);
  });
  it('refuses to turn in unfinished bounties or at the wrong board', () => {
    const g = stubGame(); const q = new Quests(g);
    const site = q.siteAt(10, 10);
    const b = { ...q.offersFor(site, 2)[0], kind: 'trade', target: null, n: 2 };
    q.log.accept('*', b, 2);
    expect(q.handle(g.player, 'You', 'turn', { x: 10, y: 64, z: 10 }, { id: b.id }, true).msg).toMatch(/not finished/);
    q.emit('trade', { n: 2 });
    const far = { x: 2000, y: 64, z: 2000 };
    expect(q.handle(g.player, 'You', 'turn', far, { id: b.id }, true).msg).toMatch(/Turn this one in at the board of/);
    expect(q.handle(g.player, 'You', 'turn', { x: 10, y: 64, z: 10 }, { id: b.id }, true).ok).toBe(true);
  });
  it('accepts only what the board shows and hands deliveries over', () => {
    const g = stubGame(); const q = new Quests(g);
    const pos = { x: 10, y: 64, z: 10 }, site = q.siteAt(10, 10);
    expect(q.handle(g.player, 'You', 'acc', pos, { id: 'forged' }, true).msg).toMatch(/taken down/);
    const first = q.offersFor(site, q.day())[0];
    expect(q.handle(g.player, 'You', 'acc', pos, { id: first.id }, true).ok).toBe(true);
    const d = { ...first, id: 'del', kind: 'deliver', target: I.COAL, n: 4, to: site.key, toName: 'Here', slot: 9 };
    q.log.accept('*', d, q.day());
    g.player.inventory.add({ id: I.COAL, count: 6, damage: 0 });
    expect(q.handle(g.player, 'You', 'hand', pos, { id: 'del' }, true).ok).toBe(true);
    expect(g.player.inventory.count(I.COAL)).toBe(2); // took the four it needed
    expect(q.log.group('*').turned.del).toBeDefined(); // finished and turned in at its destination
  });
  it('counts a team\'s work together and pays everyone who took part', () => {
    const social = new SocialState(); social.create('Ana', 'red'); social.join('Bo', 'red');
    const ana = { isPlayer: true, inventory: new Inventory(), reputation: {}, netName: 'Ana' };
    const bo = { isPlayer: true, inventory: new Inventory(), reputation: {}, netName: 'Bo', remote: { id: 7 } };
    const cy = { isPlayer: true, inventory: new Inventory(), reputation: {}, netName: 'Cy', remote: { id: 8 } };
    const sent = [];
    const mkClient = (name, rp) => ({ joined: true, name, rp: { target: rp, state: {} }, ch: { send: (m) => sent.push([name, m]) } });
    const clients = new Map([[7, mkClient('Bo', bo)], [8, mkClient('Cy', cy)]]);
    const net = { isHost: true, isClient: false, name: 'Ana', clients, players: () => [{ id: 0, name: 'Ana', obj: ana }, { id: 7, name: 'Bo', obj: bo }, { id: 8, name: 'Cy', obj: cy }], near: () => true, send() {} };
    const g = stubGame({ player: ana, net, social });
    const q = new Quests(g); g.quests = q;
    const b = bounty({ kind: 'slay', n: 4, vk: q.siteAt(5, 5).key });
    q.log.accept('red', b, 2);
    q.log.accept('*', { ...b, id: 'solo' }, 2);
    q.emit('kill', { mob: 'shambler' }, ana); q.emit('kill', { mob: 'shambler' }, bo); q.emit('kill', { mob: 'shambler' }, bo);
    q.emit('kill', { mob: 'shambler' }, cy); // Cy is in no team: their kill belongs to the commons list
    expect(q.log.group('red').active[0].contrib).toEqual({ Ana: 1, Bo: 2 });
    expect(q.log.group('*').active[0].contrib).toEqual({ Cy: 1 });
    q.emit('kill', { mob: 'shambler' }, ana);
    const r = q.handle(ana, 'Ana', 'turn', { x: 5, y: 64, z: 5 }, { id: 'b1' }, true);
    expect(r.ok).toBe(true);
    expect(ana.inventory.count(I.BERYL)).toBe(4);
    const got = sent.filter(([n, m]) => n === 'Bo' && m.t === 'got');
    expect(got.length).toBeGreaterThan(0); // Bo is paid through the host's 'got' message
    expect(sent.some(([n, m]) => n === 'Cy' && m.t === 'got')).toBe(false); // Cy took no part in this team's bounty
    expect(sent.some(([n, m]) => n === 'Bo' && m.t === 'q' && m.op === 'toast' && m.ev === 'bounty')).toBe(true);
    // syncing: Bo hears their group's list once, then nothing until it changes
    sent.length = 0;
    q.syncGuests(); q.syncGuests();
    expect(sent.filter(([n, m]) => n === 'Bo' && m.op === 'sync').length).toBe(1);
    expect(sent.find(([n, m]) => n === 'Cy' && m.op === 'sync')[1].k).toBe('*');
  });
  it('host: validates a guest\'s messages (reach, board block, rate, event data)', () => {
    const ana = { isPlayer: true, inventory: new Inventory(), reputation: {}, netName: 'Ana' };
    const bo = { isPlayer: true, inventory: new Inventory(), reputation: {}, netName: 'Bo', remote: { id: 7 } };
    const sent = [];
    const c = { joined: true, name: 'Bo', rp: { target: bo, state: {} }, ch: { send: (m) => sent.push(m) } };
    let near = true;
    const net = { isHost: true, isClient: false, name: 'Ana', clients: new Map([[7, c]]), players: () => [{ id: 0, name: 'Ana', obj: ana }, { id: 7, name: 'Bo', obj: bo }], near: () => near };
    const g = stubGame({ player: ana, net });
    const q = new Quests(g);
    q.log.accept('*', bounty({ id: 'c', kind: 'craft', target: B.TORCH, n: 5 }), 2);
    q.onGuestMessage(c, { t: 'q', op: 'ev', e: 'craft', id: B.TORCH, n: 3 });
    expect(q.log.group('*').active[0].contrib).toEqual({ Bo: 3 });
    q.onGuestMessage(c, { t: 'q', op: 'ev', e: 'craft', id: 'x', n: 3 });
    q.onGuestMessage(c, { t: 'q', op: 'ev', e: 'kill', mob: 'shambler' }); // hosts see kills themselves
    q.onGuestMessage(c, { t: 'q', op: 'ev', e: 'explore', k: 'not_a_place' });
    expect(q.log.group('*').active[0].progress).toBe(3);
    near = false;
    const first = q.offersFor(q.siteAt(5, 5), q.day())[0];
    q.onGuestMessage(c, { t: 'q', op: 'acc', x: 5, y: 64, z: 5, id: first.id });
    expect(q.log.group('*').active.length).toBe(1); // too far from the board
    near = true;
    q.onGuestMessage(c, { t: 'q', op: 'acc', x: 5, y: 64, z: 5, id: first.id });
    expect(q.log.group('*').active.length).toBe(2);
    expect(sent.some((m) => m.op === 'toast' && /Accepted/.test(m.m))).toBe(true);
    expect([...CLIENT_EVENTS].sort()).toEqual(['cook', 'craft', 'cross', 'explore', 'trade']);
  });
  it('a guest forwards the events only its machine sees, and applies the host\'s view', () => {
    const sent = [];
    const net = { isClient: true, isHost: false, name: 'Bo', send: (m) => sent.push(m) };
    const g = stubGame({ net });
    const q = new Quests(g);
    q.emit('craft', { id: B.TORCH, n: 4 }); q.emit('kill', { mob: 'x' }); q.emit('pickup', { id: 1, n: 1 }); q.emit('cross', { biome: 'desert', n: 7 });
    expect(sent.map((m) => m.e)).toEqual(['craft', 'cross']);
    expect(sent[0]).toMatchObject({ t: 'q', op: 'ev', id: B.TORCH, n: 4 });
    const host = new QuestLog(); host.accept('red', bounty(), 1);
    q.onHostMessage({ t: 'q', op: 'sync', ...host.viewFor('Bo', 'red') });
    expect(q.mine().key).toBe('red');
    expect(q.mine().group.active.length).toBe(1);
    expect(g.ui.refreshQuests).toHaveBeenCalled();
    q.onHostMessage({ t: 'q', op: 'toast', m: 'Hello', ev: 'bounty' });
    expect(g.toasts).toContain('Hello'); expect(g.milestones.event).toHaveBeenCalledWith('bounty');
    // a hand-over takes the items on the guest and asks the host
    q.log.group('red').active.push({ ...bounty({ id: 'dd', kind: 'deliver', target: I.COAL, n: 5, to: '1,1', toName: 'X' }), progress: 0, contrib: {}, acc: 0 });
    g.player.inventory.add({ id: I.COAL, count: 9, damage: 0 });
    sent.length = 0;
    q.act('hand', { x: 1, y: 2, z: 3 }, { id: 'dd' });
    expect(sent[0]).toMatchObject({ op: 'hand', n: 5, iid: I.COAL }); expect(g.player.inventory.count(I.COAL)).toBe(4);
  });
  it('the host hands excess or misplaced delivery items back to a guest', () => {
    const ana = { isPlayer: true, inventory: new Inventory(), reputation: {}, netName: 'Ana' };
    const bo = { isPlayer: true, inventory: new Inventory(), reputation: {}, netName: 'Bo', remote: { id: 7 } };
    const sent = [];
    const c = { joined: true, name: 'Bo', rp: { target: bo, state: {} }, ch: { send: (m) => sent.push(m) } };
    const net = { isHost: true, isClient: false, name: 'Ana', clients: new Map([[7, c]]), players: () => [{ id: 0, name: 'Ana', obj: ana }, { id: 7, name: 'Bo', obj: bo }], near: () => true };
    const g = stubGame({ player: ana, net }); const q = new Quests(g);
    const site = q.siteAt(5, 5);
    q.log.accept('*', bounty({ id: 'dd', kind: 'deliver', target: I.COAL, n: 3, to: site.key, toName: 'X' }), 2);
    q.onGuestMessage(c, { t: 'q', op: 'hand', x: 5, y: 64, z: 5, id: 'dd', n: 5, iid: I.COAL });
    expect(sent.find((m) => m.t === 'got')).toMatchObject({ st: { id: I.COAL, count: 2 } });
    sent.length = 0;
    q.log.accept('*', bounty({ id: 'ee', kind: 'deliver', target: I.COAL, n: 3, to: '99,99', toName: 'Y' }), 2);
    q.onGuestMessage(c, { t: 'q', op: 'hand', x: 5, y: 64, z: 5, id: 'ee', n: 2, iid: I.COAL });
    expect(sent.find((m) => m.t === 'got')).toMatchObject({ st: { id: I.COAL, count: 2 } });
  });
  it('story rewards give the named item and tell the player', () => {
    const g = stubGame(); const q = new Quests(g);
    q.log.startChain('You', 'coldforge');
    q.log.player('You').chains.coldforge = { step: 3, p: 0, ready: true };
    const r = q.handle(g.player, 'You', 'claim', { x: 3, y: 64, z: 3 }, { id: 'coldforge' }, true);
    expect(r.ok).toBe(true);
    const axe = g.player.inventory.slots.find((s) => s && s.label === 'Colossus-Breaker');
    expect(axe).toBeTruthy(); expect(axe.ench.keen).toBe(4);
    expect(g.milestones.event).toHaveBeenCalledWith('tale');
    expect(q.mine().player.claimed.coldforge).toBe(1);
  });
  it('takeItems removes across slots', () => {
    const inv = new Inventory(); inv.add({ id: I.COAL, count: 64, damage: 0 }); inv.add({ id: I.COAL, count: 10, damage: 0 });
    expect(takeItems(inv, I.COAL, 70)).toBe(70); expect(inv.count(I.COAL)).toBe(4); expect(takeItems(inv, I.COAL, 9)).toBe(4);
  });
  it('exploring and crossing are watched once a second', () => {
    const gen = new TerrainGenerator(4242);
    let v = null;
    for (let rx = -3; rx <= 3 && !v; rx++) for (let rz = -3; rz <= 3 && !v; rz++) v = villageInRegion(gen, rx, rz);
    const g = stubGame({ ticks: 9 });
    g.world = { dimension: 'overworld', gen, biomeAt: () => 8 /* desert */, getBlock: () => 0 };
    g.player.x = v.cx; g.player.z = v.cz;
    const q = new Quests(g);
    q.log.accept('*', bounty({ id: 'x1', kind: 'explore', target: 'village', n: 1 }), 2);
    q.log.accept('*', bounty({ id: 'x2', kind: 'cross', target: 'desert', n: 30 }), 2);
    q.scan(); // first sample
    g.player.x += 10; g.ticks = 29; q.scan(); g.player.x += 10; q.scan();
    const [e, c] = q.log.group('*').active;
    expect(c.progress).toBe(20);
    expect(e.progress).toBe(1); // standing in the village: found
  });
});

describe('the Bounty Board block', () => {
  it('is appended at the end of the extension ids, drawn as boxes, crafted and usable', () => {
    expect(B.BOUNTY_BOARD).toBeGreaterThanOrEqual(EXT_BASE);
    const extIds = Object.values(B).filter((v) => v >= EXT_BASE);
    expect(B.BOUNTY_BOARD).toBe(1356); // (later packs append after it)
    expect(Math.max(...extIds)).toBeGreaterThanOrEqual(B.BOUNTY_BOARD);
    expect(BLOCKS[B.BOUNTY_BOARD].shape).toBe(SHAPE.BOXES);
    expect(blockBoxes(B.BOUNTY_BOARD, 0)).not.toEqual(blockBoxes(B.BOUNTY_BOARD, 1));
    const st = (id) => (id == null ? null : { id, count: 1, damage: 0 });
    expect(craft([B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS, I.BOOK, B.OAK_PLANKS, I.STICK, null, I.STICK].map(st), 3)).toEqual({ id: B.BOUNTY_BOARD, count: 1 });
    const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    expect(src('src/player/interaction.js')).toMatch(/B\.BOUNTY_BOARD\) \{ g\.ui\.openBoard/);
    expect(src('src/player/interaction.js')).toMatch(/LOOM, B\.BOUNTY_BOARD/);
  });
  it('stands beside the well of a newly generated village', () => {
    const gen = new TerrainGenerator(4242);
    let v = null;
    for (let r = 0; r <= 4 && !v; r++) for (let rx = -r; rx <= r && !v; rx++) for (let rz = -r; rz <= r && !v; rz++) v = villageInRegion(gen, rx, rz);
    expect(v).toBeTruthy();
    const [bx, bz] = boardSpot(v);
    const cx = Math.floor(bx / 16), cz = Math.floor(bz / 16);
    const c = gen.generate(cx, cz);
    stampVillages(gen, c.blocks, c.meta, cx, cz);
    let found = false;
    for (let y = v.y - 8; y <= v.y + 6; y++) if (c.blocks[cidx(bx - cx * 16, y, bz - cz * 16)] === B.BOUNTY_BOARD) found = true;
    expect(found).toBe(true);
  });
});

describe('integration points', () => {
  it('the journal key is free and the protocol version is unchanged', () => {
    const a = ACTIONS.find((x) => x.id === 'journal');
    expect(a.def[0]).toBe('KeyK');
    const t = resolveBindings({});
    expect(findBinding(t, 'KeyK').id).toBe('journal');
    expect(PROTOCOL_VERSION).toBe(2);
  });
  it('has milestones, a help topic and doc notes', () => {
    for (const id of ['bounty', 'bounty_ten', 'tale', 'tale_all']) expect(MILESTONES.some((m) => m.id === id)).toBe(true);
    const topics = buildTopics({ table: resolveBindings({}) });
    const t = topics.find((x) => x.id === 'quests');
    expect(t).toBeTruthy(); expect(t.text).toContain('quest journal');
    const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    expect(read('README.md')).toContain('Bounty Board and quests');
    expect(read('src/player/fieldGuideEntries.js')).toContain('Bounty Board');
  });
  it('quest code avoids the forbidden words', () => {
    for (const f of ['src/player/quests.js', 'src/player/questSystem.js', 'src/ui/questScreens.js', 'src/world/boardTextures.js']) {
      expect(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')).not.toMatch(/minecraft|nether|redstone|\bend\b dimension/i);
    }
  });
});

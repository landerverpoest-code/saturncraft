// The quest system's glue with the game (player/quests.js holds the rules). One per game, host, guest or alone:
//  * game systems call `quests.emit(type, payload[, actor])` ('kill', 'pickup', 'craft', 'cook', 'trade', 'explore', 'cross');
//    alone and on a host that credits the bounties of the actor's group (a team, or everybody without one) and the actor's
//    own story chains; on a guest the events its own machine sees (craft, cook, trade, explore, cross) go to the host as
//    `{ t: 'q', op: 'ev' }`, while kills and pickups happen on the host anyway.
//  * the host is authoritative: it keeps the QuestLog (saved with the world), pays out rewards, and tells each guest its
//    group's list and its own story record with `{ t: 'q', op: 'sync' }` whenever they change (hostTick).
//  * board actions (accept, turn in, hand in a delivery, abandon, start / claim a tale) are `{ t: 'q', op }` messages from a
//    guest; the host re-derives the board's offers from the seed, so a guest can only ever pick from what the board shows.
import { B } from '../world/blocks.js';
import { I, ITEMS } from '../world/items.js';
import { BIOMES } from '../world/biomes.js';
import { villagesNear } from '../world/villages.js';
import { landmarksInBox, nearestLandmark, SIGHT } from '../world/landmarks.js';
import { LANDMARK_BY_KEY } from '../world/landmarkKinds.js';
import { villageKey, getRep, standing } from '../mobs/reputation.js';
import { repEvent } from '../mobs/villageRep.js';
import { TokenBucket } from '../net/guard.js';
import {
  QuestLog, QuestBus, CHAINS, CHAIN_BY_ID, COMMONS, BOARD_RANGE, EXPLORE_KINDS, MAX_ACTIVE,
  generateBounties, bountyTitle, rewardText, rewardStack, dayOf, villageName, elderName, nameKey, gain, nameOfId,
} from './quests.js';

const STRUCT_RANGE = 1200;         // how far from a board a bounty may send you to a structure
const NEIGHBOUR_RANGE = 900;       // ... and to another village's board
const SITE_RANGE = 700;            // a board belongs to the nearest village within this many blocks
const BOARD_REACH = 8;             // how near a guest must stand to act on a board
/** Events a guest's own machine sees and the host cannot. */
export const CLIENT_EVENTS = new Set(['craft', 'cook', 'trade', 'explore', 'cross']);
/** Every event the bus carries. */
export const EVENTS = ['kill', 'pickup', 'craft', 'cook', 'trade', 'explore', 'cross'];

const finite = (...v) => v.every((x) => Number.isFinite(x));

/** Take up to `n` of an item out of an inventory; returns how many came out. */
export function takeItems(inv, id, n) {
  let left = n;
  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    const s = inv.slots[i];
    if (!s || s.id !== id) continue;
    const k = Math.min(left, s.count);
    s.count -= k; left -= k;
    if (s.count <= 0) inv.slots[i] = null;
  }
  if (left !== n) inv.changed();
  return n - left;
}

export class Quests {
  constructor(game) {
    this.game = game;
    this.log = new QuestLog();
    this.bus = new QuestBus();
    this.cache = new Map();        // board contexts and offers
    this.lastDay = -1;
    this.lastPos = null;
    this.crossAcc = 0;
    this.sentAt = new WeakMap();
    for (const t of EVENTS) this.bus.on(t, (p) => this.credit(p.actor, { ...p, type: t }));
  }

  // ---- who is who ----------------------------------------------------------------------------------------------------
  get net() { return this.game.net; }
  isClient() { return !!(this.net && this.net.isClient); }
  myName() { return this.net && this.net.name ? this.net.name : 'You'; }
  nameOf(actor) { return !actor || actor === this.game.player ? this.myName() : actor.netName || 'Player'; }
  /** The group a player's bounties belong to: their team, or everybody without one. */
  groupOf(name) {
    const soc = this.game.social;
    const t = soc && soc.teamOf ? soc.teamOf(name) : null;
    return t ? nameKey(t.name) : COMMONS;
  }
  /** Online players of a group: [{ name, actor }] (the host's view; alone, just the player). */
  members(key) {
    const g = this.game;
    if (!this.net || !this.net.players) return [{ name: this.myName(), actor: g.player }];
    return this.net.players().filter((p) => p.obj && this.groupOf(p.name) === key).map((p) => ({ name: p.name, actor: p.obj }));
  }
  /** My group's key, list and story record. */
  mine() {
    const name = this.myName();
    const key = this.isClient() ? (Object.keys(this.log.groups)[0] || COMMONS) : this.groupOf(name);
    return { name, key, group: this.log.group(key), player: this.log.player(name) };
  }
  day() { return dayOf(this.game.time); }

  // ---- boards ---------------------------------------------------------------------------------------------------------
  /** The village a board at (x, z) belongs to: { key, name, cx, cz, biome, wild }. */
  siteAt(x, z) {
    const w = this.game.world, gen = w.dimension === 'overworld' ? w.gen : null;
    if (gen) {
      let best = null;
      for (const v of villagesNear(gen, x - SITE_RANGE, z - SITE_RANGE, x + SITE_RANGE, z + SITE_RANGE)) {
        const d = Math.hypot(v.cx - x, v.cz - z);
        if (d <= SITE_RANGE && (!best || d < best.d)) best = { v, d };
      }
      if (best) {
        const key = villageKey(best.v.cx, best.v.cz), b = BIOMES[best.v.biome];
        return { key, name: villageName(key), cx: best.v.cx, cz: best.v.cz, biome: b ? b.key : null, wild: false };
      }
    }
    // no village near: the board belongs to its 320-block region
    const rx = Math.floor(x / 320), rz = Math.floor(z / 320), cx = rx * 320 + 160, cz = rz * 320 + 160, key = villageKey(cx, cz);
    return { key, name: villageName(key), cx, cz, biome: null, wild: true };
  }

  /** What a board near its village can send you to: other villages and structures (the same on every machine). */
  contextFor(site) {
    const ck = `ctx|${site.key}|${this.game.world.dimension}`;
    if (this.cache.has(ck)) return this.cache.get(ck);
    const w = this.game.world, gen = w.dimension === 'overworld' ? w.gen : null;
    const ctx = { biome: site.biome, others: [], structs: [] };
    if (gen) {
      try {
        for (const v of villagesNear(gen, site.cx - NEIGHBOUR_RANGE, site.cz - NEIGHBOUR_RANGE, site.cx + NEIGHBOUR_RANGE, site.cz + NEIGHBOUR_RANGE)) {
          const key = villageKey(v.cx, v.cz);
          if (key !== site.key) ctx.others.push({ key, name: villageName(key), dist: Math.hypot(v.cx - site.cx, v.cz - site.cz) });
        }
        ctx.others.sort((a, b) => a.dist - b.dist || (a.key < b.key ? -1 : 1));
        for (const kind of EXPLORE_KINDS) {
          const s = nearestLandmark(gen, kind, site.cx, site.cz, STRUCT_RANGE);
          if (s) ctx.structs.push({ kind, dist: Math.round(s.dist) });
        }
      } catch (e) { console.warn('quests: context', e); }
    }
    if (this.cache.size > 24) this.cache.clear();
    this.cache.set(ck, ctx);
    return ctx;
  }

  /** The day's bounties at a site. */
  offersFor(site, day = this.day()) {
    const ck = `off|${site.key}|${day}|${this.game.world.dimension}`;
    if (this.cache.has(ck)) return this.cache.get(ck);
    const list = generateBounties(this.game.seed, day, site.key, this.contextFor(site));
    this.cache.set(ck, list);
    return list;
  }

  /** What a board screen shows: the site, the day's bounties with my group's state of each, deliveries due here. */
  boardView(x, z) {
    const site = this.siteAt(x, z), day = this.day(), m = this.mine();
    const rows = this.offersFor(site, day).map((b) => {
      const entry = m.group.active.find((a) => a.id === b.id) || null;
      const state = m.group.turned[b.id] !== undefined ? 'turned' : entry ? (entry.progress >= entry.n ? 'ready' : 'active') : 'open';
      return { b, entry, state };
    });
    const deliveries = m.group.active.filter((a) => a.kind === 'deliver' && a.to === site.key);
    const rep = getRep(this.game.player, site.key);
    return { site, day, rows, deliveries, rep, standing: standing(rep).name, elder: elderName(site.key), full: m.group.active.length >= MAX_ACTIVE };
  }

  // ---- events ---------------------------------------------------------------------------------------------------------
  /** A game system reports something the player (or `actor`) did. */
  emit(type, payload = {}, actor = null) {
    if (this.isClient()) { if (CLIENT_EVENTS.has(type)) this.sendEvent(type, payload); return; }
    this.bus.emit(type, { ...payload, actor: actor || this.game.player });
  }

  /** A mob died: credit whoever struck it last. */
  killed(mob, killer) {
    if (!mob || !mob.type || this.isClient()) return;
    this.emit('kill', { mob: mob.type }, killer && killer.isPlayer ? killer : null);
  }

  sendEvent(type, p) {
    const m = { t: 'q', op: 'ev', e: type };
    if (type === 'craft' || type === 'cook') { m.id = p.id | 0; m.n = Math.max(1, p.n | 0); }
    else if (type === 'trade') m.n = Math.max(1, p.n | 0);
    else if (type === 'explore') m.k = p.landmark;
    else if (type === 'cross') { m.b = p.biome; m.n = Math.max(1, p.n | 0); }
    this.net.send(m);
  }

  /** Apply an event to the actor's group and story chains (host / alone). */
  credit(actor, ev) {
    if (!actor) return;
    const g = this.game, name = this.nameOf(actor), key = this.groupOf(name), local = actor === g.player;
    const res = this.log.apply(key, ev, name);
    for (const r of res) {
      const title = bountyTitle(r.entry);
      if (r.done) this.tellGroup(key, `Bounty ready: ${title}. Turn it in at a Bounty Board.`, 3500);
      else if (r.entry.kind !== 'cross') this.tellGroup(key, `${title}: ${r.entry.progress}/${r.entry.n}`, 1800);
    }
    for (const s of this.log.storyApply(name, ev)) {
      if (s.ready) this.tell(name, `${s.chain.title}: all done. Report to a Village Elder at a Bounty Board.`, 4000);
      else if (s.advanced) this.tell(name, `${s.chain.title}: step done. Next: ${s.chain.steps[this.log.chainState(name, s.chain.id).step].text}`, 4500);
    }
    if (res.length && local) this.refreshUI();
  }

  // ---- telling people ----------------------------------------------------------------------------------------------------
  tell(name, msg, ms = 2500, ev = null) {
    const g = this.game;
    if (nameKey(name) === nameKey(this.myName())) { if (g.hud) g.hud.toast(msg, ms); if (ev && g.milestones) g.milestones.event(ev); return; }
    const c = this.clientByName(name);
    if (c) c.ch.send({ t: 'q', op: 'toast', m: msg, ms, ev });
  }
  tellGroup(key, msg, ms = 2500, ev = null) { for (const m of this.members(key)) this.tell(m.name, msg, ms, ev); }
  clientByName(name) {
    const n = this.net;
    if (!n || !n.clients) return null;
    for (const c of n.clients.values()) if (c.joined && nameKey(c.name) === nameKey(name)) return c;
    return null;
  }
  refreshUI() { const ui = this.game.ui; if (ui && ui.refreshQuests) ui.refreshQuests(); }

  // ---- doing things at a board (UI entry points) -----------------------------------------------------------------------------
  /** op: 'acc' | 'turn' | 'hand' | 'ab' | 'st' | 'claim'. Alone and on a host it is done at once; a guest asks the host. */
  act(op, pos, arg = {}) {
    const g = this.game;
    if (this.isClient()) {
      const m = { t: 'q', op, id: arg.id };
      if (pos) { m.x = pos.x; m.y = pos.y; m.z = pos.z; }
      if (op === 'hand') {
        const e = this.mine().group.active.find((a) => a.id === arg.id && a.kind === 'deliver');
        const have = e ? g.player.inventory.count(e.target) : 0, n = e ? Math.min(have, e.n - e.progress) : 0;
        if (n <= 0) { g.hud.toast(e ? `You carry no ${nameOfId(e.target)} for this.` : 'That delivery is not yours to make.'); return; }
        if (!g.player.creative) takeItems(g.player.inventory, e.target, n);
        m.n = n; m.iid = e.target;
      }
      this.net.send(m);
      return;
    }
    const r = this.handle(g.player, this.myName(), op, pos, arg, true);
    if (r && r.msg) g.hud.toast(r.msg, r.ms || 3000);
    this.refreshUI();
  }

  /** Do a board action for `actor` (host / alone). `offered` = items a guest already took for a delivery. */
  handle(actor, name, op, pos, arg, local = false) {
    const g = this.game, key = this.groupOf(name), day = this.day();
    const site = pos ? this.siteAt(pos.x + 0.5, pos.z + 0.5) : null;
    const group = this.log.group(key);
    const out = (msg, ok = false, ms = 3000) => ({ ok, msg, ms });
    switch (op) {
      case 'acc': {
        if (!site) return out('');
        const b = this.offersFor(site, day).find((o) => o.id === arg.id);
        if (!b) return out('That notice has been taken down.');
        const r = this.log.accept(key, b, day);
        if (!r.ok) return out(r.why);
        for (const m of this.members(key)) if (nameKey(m.name) !== nameKey(name)) this.tell(m.name, `${name} accepted: ${bountyTitle(b)}`, 2500);
        return out(`Accepted: ${bountyTitle(b)}`, true);
      }
      case 'ab': {
        const e = group.active.find((a) => a.id === arg.id);
        if (!e) return out('');
        this.log.abandon(key, arg.id);
        return out(`Dropped: ${bountyTitle(e)}`, true);
      }
      case 'turn': {
        if (!site) return out('');
        const e = group.active.find((a) => a.id === arg.id);
        if (!e) return out('That bounty is not on your list.');
        if (e.progress < e.n) return out('It is not finished yet.');
        if (e.kind !== 'deliver' && e.vk !== site.key) return out(`Turn this one in at the board of ${villageName(e.vk)}.`);
        if (e.kind === 'deliver' && e.to !== site.key) return out(`Turn this one in at the board of ${e.toName}.`);
        this.finish(key, e, name, site);
        return out('', true);
      }
      case 'hand': {
        if (!site) return out('');
        const e = group.active.find((a) => a.id === arg.id && a.kind === 'deliver');
        const actorInv = actor.inventory;
        let offered = arg.n | 0;
        if (local) offered = e ? Math.min(actorInv.count(e.target), e.n - e.progress) : 0;
        if (!e || e.to !== site.key) { this.giveBack(actor, arg.iid, offered, local); return out(e ? `This delivery is for ${e.toName}.` : 'That delivery is not on your list.'); }
        const took = this.log.handIn(key, e.id, offered, name);
        if (local && took > 0 && !actor.creative) takeItems(actorInv, e.target, took);
        if (!local && offered > took) this.giveBack(actor, e.target, offered - took, false);
        if (took <= 0) return out(local ? 'You carry nothing for this delivery.' : '');
        const done = e.progress >= e.n;
        if (done) this.finish(key, e, name, site);
        else this.tellGroup(key, `${bountyTitle(e)}: ${e.progress}/${e.n}`, 2000);
        return out(done ? '' : `Handed over ${took}.`, true);
      }
      case 'st': {
        const r = this.log.startChain(name, arg.id);
        return out(r.ok ? `A new tale: ${CHAIN_BY_ID[arg.id].title}` : r.why, r.ok);
      }
      case 'claim': {
        if (!site) return out('');
        const chain = this.log.claimChain(name, arg.id);
        if (!chain) return out('That tale is not finished yet.');
        this.payChain(actor, name, chain, site);
        return out('', true);
      }
      default: return out('');
    }
  }

  giveBack(actor, id, n, local) {
    if (local || !(n > 0) || !Number.isInteger(id) || !ITEMS[id]) return;
    this.giveStack(actor, { id, count: Math.min(n, 64), damage: 0 });
  }

  /** A bounty is done: pay everybody in the group who took part (and whoever turned it in). */
  finish(key, entry, turner, site) {
    const day = this.day();
    this.log.turnIn(key, entry.id, day);
    const title = bountyTitle(entry);
    const recipients = this.members(key).filter((m) => (entry.contrib[m.name] | 0) > 0 || nameKey(m.name) === nameKey(turner));
    const who = Object.entries(entry.contrib).map(([n, c]) => `${n} ${c}`).join(', ');
    for (const m of recipients) {
      this.pay(m.actor, m.name, entry.reward, site.key);
      const p = this.log.player(m.name); p.bounties++;
      this.log.touch(null, m.name);
      const isMe = m.actor === this.game.player;
      this.tell(m.name, `Bounty complete: ${title}. Reward: ${rewardText(entry.reward)}${who && this.members(key).length > 1 ? ` (${who})` : ''}`, 5000, 'bounty');
      this.bus.emit('bountyDone', { local: isMe, name: m.name });
    }
  }

  /** A finished tale's reward. */
  payChain(actor, name, chain, site) {
    const r = chain.reward;
    this.pay(actor, name, { beryl: r.beryl, rep: r.rep, items: [] }, site.key);
    this.giveStack(actor, rewardStack(r.item));
    this.tell(name, `${chain.title} is told. ${chain.done}`, 6000, 'tale');
    this.bus.emit('tale', { local: actor === this.game.player, name });
  }

  /** Beryl, items, reputation and a little experience to one player. */
  pay(actor, name, reward, villageKeyStr) {
    const g = this.game;
    if (reward.beryl > 0) this.giveStack(actor, { id: I.BERYL, count: reward.beryl, damage: 0 });
    for (const it of reward.items || []) this.giveStack(actor, rewardStack(it));
    if (reward.rep > 0 && villageKeyStr) repEvent(g, actor, villageKeyStr, reward.rep);
    const xp = 5 + (reward.beryl | 0);
    if (actor === g.player) g.entities.spawnXp(g.player.x, g.player.y + 1, g.player.z, xp);
    else { const c = this.clientByName(name); if (c) c.ch.send({ t: 'gotxp', v: xp }); }
    g.audio.play('levelup');
  }

  /** Put a stack in a player's bag (whatever does not fit lands at their feet); a guest's goes by the host's 'got' message. */
  giveStack(actor, st) {
    const g = this.game;
    if (actor === g.player) {
      const left = g.player.inventory.add({ ...st });
      if (left) g.entities.spawnItem(g.player.x, g.player.y + 1, g.player.z, { ...st, count: left });
      return;
    }
    const c = actor && actor.remote ? this.net.clients.get(actor.remote.id) : null;
    if (c) c.ch.send({ t: 'got', st: { ...st } });
  }

  // ---- ticks -------------------------------------------------------------------------------------------------------------
  tick() {
    const g = this.game, n = g.ticks | 0;
    if (n % 20 === 9) this.scan();
    if (!this.isClient()) {
      if (n % 10 === 4) this.syncGuests();
      if (n % 400 === 3) { const d = this.day(); if (d !== this.lastDay) { this.lastDay = d; this.log.prune(d); } }
    }
  }

  /** My open objectives of the kinds that need watching: [{ kind, target }]. */
  watching() {
    const m = this.mine(), out = [];
    for (const e of m.group.active) if (e.progress < e.n && (e.kind === 'explore' || e.kind === 'cross')) out.push(e);
    for (const def of CHAINS) {
      const s = m.player.chains[def.id];
      if (s && !s.ready && (def.steps[s.step].kind === 'explore' || def.steps[s.step].kind === 'cross')) out.push(def.steps[s.step]);
    }
    return out;
  }

  /** Once a second: structures within sight, and ground covered inside a biome. */
  scan() {
    const g = this.game, p = g.player, w = g.world;
    if (!p || p.dead || g.ui.open === 'death') return;
    const watch = this.watching();
    if (!watch.length) { this.lastPos = null; this.crossAcc = 0; return; }
    const kinds = new Set(watch.filter((o) => o.kind === 'explore').map((o) => o.target));
    if (kinds.size && w.dimension === 'overworld' && w.gen && (g.ticks % 40) < 20) {
      try {
        for (const l of landmarksInBox(w.gen, p.x - SIGHT, p.z - SIGHT, p.x + SIGHT, p.z + SIGHT)) if (kinds.has(l.kind)) this.emit('explore', { landmark: l.kind });
      } catch (e) { /* a lookup that fails is skipped */ }
    }
    const biomes = new Set(watch.filter((o) => o.kind === 'cross').map((o) => o.target));
    if (biomes.size && w.dimension === 'overworld') {
      const here = BIOMES[w.biomeAt(Math.floor(p.x), Math.floor(p.z))];
      const prev = this.lastPos;
      this.lastPos = { x: p.x, z: p.z };
      if (here && biomes.has(here.key) && prev) {
        const d = Math.hypot(p.x - prev.x, p.z - prev.z);
        if (d > 0 && d < 40 && !p.riding) {
          this.crossAcc += d;
          const whole = Math.floor(this.crossAcc);
          if (whole >= 1) { this.crossAcc -= whole; this.emit('cross', { biome: here.key, n: whole }); }
        }
      }
    } else this.lastPos = null;
  }

  // ---- multiplayer ------------------------------------------------------------------------------------------------------------
  /** The host tells each guest its group's list when something changed. */
  syncGuests() {
    const n = this.net;
    if (!n || !n.isHost || !n.clients) return;
    for (const c of n.clients.values()) {
      if (!c.joined || !c.rp) continue;
      const key = this.groupOf(c.name), sig = `${key}|${this.log.group(key).rev}|${this.log.player(c.name).rev | 0}`;
      if (c.qSig === sig) continue;
      c.qSig = sig;
      c.ch.send({ t: 'q', op: 'sync', ...this.log.viewFor(c.name, key) });
    }
    if (this.syncedUI !== this.log.rev) { this.syncedUI = this.log.rev; this.refreshUI(); }
  }

  /** A guest's message to the host. */
  onGuestMessage(c, m) {
    const n = this.net, g = this.game;
    if (!m || typeof m.op !== 'string' || !c.rp || !c.rp.state) return;
    if (!c.qBucket) c.qBucket = new TokenBucket(6, 24, performance.now());
    if (!c.qBucket.take(1, performance.now())) return;
    const actor = c.rp.target, name = c.name;
    if (m.op === 'ev') {
      const ev = { actor };
      switch (m.e) {
        case 'craft': case 'cook':
          if (!Number.isInteger(m.id) || m.id < 1 || m.id > 4095) return;
          ev.id = m.id; ev.n = Math.max(1, Math.min(m.e === 'craft' ? 64 : 16, m.n | 0)); break;
        case 'trade': ev.n = Math.max(1, Math.min(16, m.n | 0)); break;
        case 'explore': if (typeof m.k !== 'string' || !LANDMARK_BY_KEY[m.k]) return; ev.landmark = m.k; break;
        case 'cross': if (typeof m.b !== 'string' || m.b.length > 32) return; ev.biome = m.b; ev.n = Math.max(1, Math.min(60, m.n | 0)); break;
        default: return;
      }
      this.bus.emit(m.e, ev);
      return;
    }
    if (!['acc', 'turn', 'hand', 'ab', 'st', 'claim'].includes(m.op)) return;
    let pos = null;
    if (m.op !== 'ab' && m.op !== 'st') {
      if (!finite(m.x, m.y, m.z)) return;
      pos = { x: m.x | 0, y: m.y | 0, z: m.z | 0 };
      if (!n.near(c, pos.x + 0.5, pos.y + 0.5, pos.z + 0.5, BOARD_REACH) || g.world.getBlock(pos.x, pos.y, pos.z) !== B.BOUNTY_BOARD) {
        if (m.op === 'hand') this.giveBack(actor, m.iid, m.n | 0, false); // not at a board: the items go back
        return;
      }
    }
    const r = this.handle(actor, name, m.op, pos, { id: String(m.id || '').slice(0, 60), n: m.n | 0, iid: m.iid }, false);
    if (r && r.msg) c.ch.send({ t: 'q', op: 'toast', m: r.msg, ms: r.ms || 3000 });
    this.syncGuests();
  }

  /** The host's message to a guest. */
  onHostMessage(m) {
    const g = this.game;
    if (!m || typeof m.op !== 'string') return;
    if (m.op === 'sync') { if (this.log.applyView(m, this.myName())) this.refreshUI(); }
    else if (m.op === 'toast') {
      if (g.hud && typeof m.m === 'string') g.hud.toast(m.m.slice(0, 200), Math.max(1000, Math.min(8000, m.ms | 0 || 3000)));
      if (typeof m.ev === 'string' && g.milestones && (m.ev === 'bounty' || m.ev === 'tale')) g.milestones.event(m.ev);
    }
  }

  /** Part of the welcome a guest gets. */
  welcomeView(name) { return this.log.viewFor(name, this.groupOf(name)); }

  // ---- saving ---------------------------------------------------------------------------------------------------------------
  save() { return this.log.save(); }
  load(d) { this.log.load(d); this.cache.clear(); }

  // ---- journal data ------------------------------------------------------------------------------------------------------------
  /** Where a structure of a kind lies, as a lead for the journal: 'about 400 blocks north-east' or null. */
  leadTo(kind) {
    const g = this.game, w = g.world;
    if (w.dimension !== 'overworld' || !w.gen || !LANDMARK_BY_KEY[kind]) return null;
    try {
      const s = nearestLandmark(w.gen, kind, g.player.x, g.player.z, 3200);
      return s ? { x: s.x, z: s.z, dist: s.dist } : null;
    } catch (e) { return null; }
  }
}

export { gain };

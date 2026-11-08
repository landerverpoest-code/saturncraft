// The Bounty Board screen (use a board) and the Quest Journal (K): both draw from the game's Quests object
// (player/questSystem.js); every button is a call to quests.act(), which a guest sends to the host and
// the host answers with a fresh list, so the screens just redraw whenever `ui.refreshQuests()` is called.
import { iconURL } from './icons.js';
import { CHAINS, bountyTitle, bountyIcon, rewardText, directionHint, villageName } from '../player/quests.js';

function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
const txt = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e; };
const button = (label, fn, disabled = false, cls = '') => {
  const b = document.createElement('button');
  b.className = 'btn small ' + cls; b.type = 'button'; b.textContent = label; b.disabled = !!disabled;
  b.onclick = fn;
  return b;
};

function card(icon, title, lines, buttons, state = '') {
  const c = document.createElement('div');
  c.className = 'quest-card' + (state ? ' ' + state : '');
  const img = document.createElement('img'); img.alt = ''; img.width = img.height = 40;
  try { img.src = iconURL(icon); } catch (e) { /* no icon */ }
  const info = document.createElement('div'); info.className = 'quest-info';
  info.appendChild(txt('b', '', title));
  for (const l of lines) if (l) info.appendChild(txt('div', 'd', l));
  const acts = document.createElement('div'); acts.className = 'quest-acts';
  for (const b of buttons) acts.appendChild(b);
  c.append(img, info, acts);
  return c;
}

function bar(entry) {
  const w = document.createElement('div'); w.className = 'quest-bar';
  const f = document.createElement('div'); f.style.width = Math.round(100 * Math.min(1, entry.progress / Math.max(1, entry.n))) + '%';
  w.appendChild(f);
  return w;
}

/** "Ana 3, Bo 2" - who did what, shown when more than one person took part. */
const contribLine = (e) => {
  const rows = Object.entries(e.contrib || {});
  return rows.length ? 'Done so far by ' + rows.map(([n, c]) => `${n} ${c}`).join(', ') : '';
};

const progressLine = (e) => (e.kind === 'explore' ? (e.progress >= e.n ? 'Found' : 'Not found yet') : `${e.progress} / ${e.n}${e.kind === 'cross' ? ' blocks' : ''}`);

/** The step lines of a tale in progress. */
function taleLines(q, def, s) {
  const lines = [];
  const st = def.steps[s.step];
  lines.push(`Step ${s.step + 1} of ${def.steps.length}: ${st.text}`);
  if (st.n > 1) lines.push(`Progress ${s.p} / ${st.n}`);
  if (st.kind === 'explore') {
    const lead = q.leadTo(st.target);
    lines.push(lead ? `The elder remembers: ${directionHint(q.game.player.x, q.game.player.z, lead.x, lead.z)}.` : 'The elder knows no road to it from here.');
  }
  return lines;
}

/** One tale as a card (state: new, going, ready, told). onAct(op, id) sends the action. */
function taleCard(q, def, m, onAct, canClaim) {
  const s = m.player.chains[def.id], told = m.player.claimed[def.id];
  const reward = def.reward;
  const rl = `Reward: ${reward.beryl} Beryl, +${reward.rep} reputation and ${reward.item.label}`;
  const icon = reward.item.id;
  if (told) return card(icon, def.title, ['Told. ' + def.done], [], 'done');
  if (!s) return card(icon, def.title, [def.intro, rl], [button('Begin this tale', () => onAct('st', def.id))], '');
  if (s.ready) return card(icon, def.title, [def.done, rl], [button('Claim reward', () => onAct('claim', def.id), !canClaim)], 'ready');
  return card(icon, def.title, [...taleLines(q, def, s), rl], [], 'going');
}

/** The Bounty Board screen for the board at (x, y, z). */
export function openBoard(ui, x, y, z) {
  const g = ui.game, q = g.quests;
  g.input.unlock();
  ui.clear();
  ui.open = 'pause';
  const pos = { x, y, z };
  const s = el(`<div class="screen pause-screen quest-screen"><h2 class="qt"></h2><div class="quest-sub"></div>
    <div class="guide-tabs" role="tablist" aria-label="Board tabs"></div>
    <div class="quest-body" tabindex="0"></div><button class="btn" data-a="back">Back</button></div>`);
  const body = s.querySelector('.quest-body'), tabs = s.querySelector('.guide-tabs');
  let tab = 'bounties';
  const leave = () => { ui.open = null; ui.clear(); g.onUIClosed(); };
  const act = (op, id) => { q.act(op, pos, { id }); };
  const tabBtns = {};
  for (const [k, label] of [['bounties', "Today's bounties"], ['tales', "The Elder's tales"]]) {
    const b = document.createElement('button');
    b.className = 'btn guide-tab'; b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = label;
    b.onclick = () => { tab = k; render(); };
    tabBtns[k] = b; tabs.appendChild(b);
  }
  let marked = false;
  const render = () => {
    const v = q.boardView(x + 0.5, z + 0.5), m = q.mine();
    if (!marked) { marked = true; if (g.setWaymark) g.setWaymark({ x: x + 0.5, z: z + 0.5, kind: 'board', label: `${v.site.name} Bounty Board` }); } // the Waymark Compass points here from now on (player/waymark.js)
    s.querySelector('.qt').textContent = `${v.site.name} Bounty Board`;
    s.querySelector('.quest-sub').textContent = `Day ${v.day + 1} · ${v.site.wild ? 'A wayside board' : 'Elder ' + v.elder} · Standing: ${v.standing}${m.key !== '*' ? ' · Team: ' + m.key : ''}`;
    for (const [k, b] of Object.entries(tabBtns)) { b.classList.toggle('on', k === tab); b.setAttribute('aria-selected', String(k === tab)); }
    const scroll = body.scrollTop;
    body.replaceChildren();
    if (tab === 'bounties') {
      if (v.deliveries.length) {
        body.appendChild(txt('h3', '', 'Deliveries for this village'));
        for (const e of v.deliveries) {
          const have = g.player.inventory.count(e.target);
          body.appendChild(card(bountyIcon(e), bountyTitle(e), [`${e.progress} / ${e.n} handed over · you carry ${have}`, contribLine(e), 'Reward: ' + rewardText(e.reward)], [button('Hand over', () => act('hand', e.id), have <= 0)], 'going'));
        }
      }
      body.appendChild(txt('h3', '', 'Notices'));
      for (const r of v.rows) {
        const b = r.b, e = r.entry;
        const lines = [];
        const btns = [];
        if (r.state === 'open') { lines.push('Reward: ' + rewardText(b.reward)); btns.push(button('Accept', () => act('acc', b.id), v.full)); if (v.full) lines.push('Your list is full: finish or drop a bounty first.'); }
        else if (r.state === 'active') { lines.push(progressLine(e), contribLine(e), 'Reward: ' + rewardText(b.reward)); btns.push(button('Drop', () => act('ab', b.id))); }
        else if (r.state === 'ready') { lines.push('Finished! ' + contribLine(e), 'Reward: ' + rewardText(b.reward)); btns.push(button('Turn in', () => act('turn', b.id))); }
        else lines.push('Done for today.');
        const c = card(bountyIcon(b), bountyTitle(b), lines, btns, r.state === 'turned' ? 'done' : r.state === 'ready' ? 'ready' : r.state === 'active' ? 'going' : '');
        if (e && r.state === 'active') c.querySelector('.quest-info').appendChild(bar(e));
        body.appendChild(c);
      }
      // bounties of other boards that end here, or wait to be turned in here
      const here = m.group.active.filter((a) => a.vk === v.site.key && a.kind !== 'deliver' && a.progress >= a.n && !v.rows.some((r) => r.b.id === a.id));
      for (const e of here) body.appendChild(card(bountyIcon(e), bountyTitle(e), ['Finished! Reward: ' + rewardText(e.reward)], [button('Turn in', () => act('turn', e.id))], 'ready'));
      body.appendChild(txt('div', 'd quest-note', 'The notices change every day. Bounties are shared with your team (or everybody, without one).'));
    } else {
      body.appendChild(txt('div', 'd quest-note', v.site.wild ? 'Nobody keeps the tales here, but any board will do to begin or finish one.' : `Elder ${v.elder} of ${v.site.name} tells three tales. Each leads you somewhere far and brings a keepsake.`));
      for (const def of CHAINS) body.appendChild(taleCard(q, def, m, act, true));
    }
    body.scrollTop = scroll;
  };
  s.querySelector('[data-a=back]').onclick = leave;
  s.addEventListener('keydown', (e) => { if (e.key === 'Backspace') { e.preventDefault(); leave(); } });
  ui.padBack = leave;
  ui.padScroll = (dy) => { body.scrollTop += dy; };
  ui.padTab = (d) => { tab = tab === 'bounties' ? 'tales' : 'bounties'; render(); };
  ui.questRefresh = render;
  render();
  ui.layer.appendChild(s);
  g.audio.play('click');
}

/** The Quest Journal: accepted bounties with progress, and the tales under way. */
export function showJournal(ui, fromKey = false) {
  const g = ui.game, q = g.quests;
  ui.clear();
  ui.open = 'pause';
  ui.inJournal = true;
  const s = el(`<div class="screen pause-screen quest-screen"><h2>Quest Journal</h2><div class="quest-sub"></div>
    <div class="guide-tabs" role="tablist" aria-label="Journal tabs"></div>
    <div class="quest-body" tabindex="0"></div><button class="btn" data-a="back">Back</button></div>`);
  const body = s.querySelector('.quest-body'), tabs = s.querySelector('.guide-tabs');
  let tab = 'bounties';
  const leave = () => { if (fromKey) { ui.open = null; ui.clear(); g.onUIClosed(); } else ui.showPause(); };
  const tabBtns = {};
  for (const [k, label] of [['bounties', 'Bounties'], ['tales', 'Tales']]) {
    const b = document.createElement('button');
    b.className = 'btn guide-tab'; b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = label;
    b.onclick = () => { tab = k; render(); };
    tabBtns[k] = b; tabs.appendChild(b);
  }
  const render = () => {
    const m = q.mine();
    s.querySelector('.quest-sub').textContent = `Bounties finished: ${m.player.bounties} · ${m.key === '*' ? 'Shared with everybody' : 'Shared with team ' + m.key} · Day ${q.day() + 1}`;
    for (const [k, b] of Object.entries(tabBtns)) { b.classList.toggle('on', k === tab); b.setAttribute('aria-selected', String(k === tab)); }
    body.replaceChildren();
    if (tab === 'bounties') {
      if (!m.group.active.length) body.appendChild(txt('div', 'd quest-note', 'No bounties accepted. Use a Bounty Board (beside every village well, or craft one) to take some on.'));
      for (const e of m.group.active) {
        const lines = [progressLine(e), contribLine(e)];
        if (e.kind === 'deliver') lines.push(`Hand over at the board of ${e.toName}.`);
        else if (e.progress >= e.n) lines.push(`Turn in at the board of ${villageName(e.vk)}.`);
        else if (e.kind === 'explore') { const lead = q.leadTo(e.target); if (lead) lines.push('Lead: ' + directionHint(g.player.x, g.player.z, lead.x, lead.z)); }
        lines.push('Reward: ' + rewardText(e.reward));
        const c = card(bountyIcon(e), bountyTitle(e), lines, [button('Drop', () => { q.act('ab', null, { id: e.id }); })], e.progress >= e.n ? 'ready' : 'going');
        c.querySelector('.quest-info').appendChild(bar(e));
        body.appendChild(c);
      }
    } else {
      let any = false;
      for (const def of CHAINS) if (m.player.chains[def.id] || m.player.claimed[def.id]) { any = true; body.appendChild(taleCard(q, def, m, () => {}, false)); }
      if (!any) body.appendChild(txt('div', 'd quest-note', "No tales begun. Each village elder tells them at the Bounty Board: look for the tab \"The Elder's tales\"."));
      for (const def of CHAINS) if (m.player.chains[def.id] && m.player.chains[def.id].ready) body.appendChild(txt('div', 'd quest-note', `${def.title} is finished: claim its reward at any Bounty Board.`));
    }
  };
  s.querySelector('[data-a=back]').onclick = leave;
  s.addEventListener('keydown', (e) => { if (e.key === 'Backspace') { e.preventDefault(); leave(); } });
  ui.padBack = leave;
  ui.padScroll = (dy) => { body.scrollTop += dy; };
  ui.padTab = () => { tab = tab === 'bounties' ? 'tales' : 'bounties'; render(); };
  ui.questRefresh = render;
  render();
  ui.layer.appendChild(s);
  ui.inJournal = true;
}

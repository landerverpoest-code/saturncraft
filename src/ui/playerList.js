// The Tab player list: everyone in the shared world with their team colour, game mode and ping.
// Rows come from net/social.js playerRows (the host's roster); this only draws them.
import { gamemodeLabel, pingClass } from '../net/social.js';

export class PlayerList {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.id = 'tablist';
    this.el.className = 'hidden';
    root.appendChild(this.el);
    this.key = '';
    this.frame = 0;
  }

  /** Called every frame from the HUD: held key and a running session show it. */
  update(game) {
    const show = !!(game.net && game.input.is('players') && !game.ui.blocking);
    this.el.classList.toggle('hidden', !show);
    if (!show) { this.key = ''; return; }
    if (this.frame++ % 6 !== 0 && this.key) return;
    const rows = game.net.playerRows();
    const key = JSON.stringify(rows);
    if (key === this.key) return;
    this.key = key;
    this.render(rows, game.net.hostName());
  }

  render(rows, hostName) {
    this.el.textContent = '';
    const h = document.createElement('div');
    h.className = 'tl-head';
    h.textContent = `${hostName ? hostName + "'s world" : 'Players'} - ${rows.length} online`;
    this.el.appendChild(h);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'tl-row' + (r.you ? ' you' : '');
      const name = document.createElement('span');
      name.className = 'tl-name';
      name.textContent = r.name + (r.host ? ' (host)' : r.op ? ' (op)' : '');
      if (r.color) name.style.color = r.color;
      const team = document.createElement('span');
      team.className = 'tl-team';
      team.textContent = r.team ? `[${r.team}]` : '';
      if (r.color) team.style.color = r.color;
      const mode = document.createElement('span');
      mode.className = 'tl-mode';
      mode.textContent = gamemodeLabel(r.gamemode);
      const ping = document.createElement('span');
      ping.className = 'tl-ping ' + pingClass(r.ping);
      ping.textContent = r.ping >= 0 ? `${r.ping} ms` : r.host ? 'host' : '-';
      row.append(name, team, mode, ping);
      this.el.appendChild(row);
    }
  }
}

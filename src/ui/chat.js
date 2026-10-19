// Chat line: T or / opens it, Enter runs the text as a command (a leading
// slash is optional), Esc closes, Up/Down walk the history. Messages fade
// out after ten seconds and reappear while the chat is open.
import { runCommand } from './commands.js';

export class Chat {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.id = 'chat';
    this.log = document.createElement('div');
    this.log.className = 'chat-log';
    this.input = document.createElement('input');
    this.input.className = 'chat-input hidden';
    this.input.maxLength = 256;
    this.input.spellcheck = false;
    this.root.append(this.log, this.input);
    document.body.appendChild(this.root);
    this.history = [];
    this.hIndex = 0;
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep typing away from the game controls
      if (e.key === 'Enter') { this.submit(); e.preventDefault(); }
      else if (e.key === 'Escape') { this.game.ui.close(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && this.history.length) { this.hIndex = Math.max(0, this.hIndex - 1); this.input.value = this.history[this.hIndex]; e.preventDefault(); }
      else if (e.key === 'ArrowDown' && this.history.length) { this.hIndex = Math.min(this.history.length, this.hIndex + 1); this.input.value = this.history[this.hIndex] || ''; e.preventDefault(); }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
  }

  get isOpen() { return !this.input.classList.contains('hidden'); }

  open(prefix = '') {
    this.input.classList.remove('hidden');
    this.root.classList.add('open');
    this.input.value = prefix;
    this.hIndex = this.history.length;
    this.input.focus();
    this.input.setSelectionRange(prefix.length, prefix.length);
  }

  close() {
    this.input.classList.add('hidden');
    this.root.classList.remove('open');
    this.input.blur();
  }

  submit() {
    const text = this.input.value.trim();
    if (text) {
      this.history.push(text);
      if (text.startsWith('/') || this.game.player) {
        const out = text.startsWith('/') ? runCommand(this.game, text) : null;
        if (!text.startsWith('/')) this.add(`<Player> ${text}`);
        else for (const line of [].concat(out || [])) this.add(line);
      }
    }
    this.game.ui.close();
  }

  add(text) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.textContent = text;
    this.log.appendChild(line);
    while (this.log.children.length > 50) this.log.firstChild.remove();
    setTimeout(() => line.classList.add('faded'), 10000);
  }
}

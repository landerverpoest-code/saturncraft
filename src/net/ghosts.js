// Ghost records: what the host keeps of a guest whose link dropped (a timeout, a closed tab, a reload), for 60 s.
// Pure (no network, no DOM), unit-tested in tests/multiplayer_round6.test.js.
//
// While the ghost is there its seat is kept (a stranger cannot fill the world in the meantime), and a guest who comes back
// with the same name AND the same browser token within the window gets exactly the place, health and belongings it had.
// A guest who left on purpose (the Quit button says goodbye) leaves no ghost. After the window the seat is free again; the
// guest's saved record (the host's save keeps one per name) still brings the belongings back on a later join.

export const GHOST_TTL_MS = 60000;
const key = (n) => String(n || '').trim().toLowerCase();

export class GhostBook {
  constructor(ttl = GHOST_TTL_MS) { this.ttl = ttl; this.map = new Map(); }

  /** A guest dropped: remember `rec` (its player record: position, health, inventory...) for the window. */
  add(name, tok, rec, now) {
    if (!name) return null;
    const g = { name, tok: tok || null, rec: rec || null, at: now };
    this.map.set(key(name), g);
    return g;
  }

  prune(now) { for (const [k, g] of this.map) if (now - g.at >= this.ttl) this.map.delete(k); }

  /** The ghost of `name`, if it is still within the window. */
  get(name, now) {
    this.prune(now);
    return this.map.get(key(name)) || null;
  }

  /**
   * A guest joins as `name` with `tok`: gives back its record and forgets the ghost. A ghost made for a browser token
   * only answers to that token (a stranger using the same name gets nothing of it); an untokened ghost answers to the name.
   */
  claim(name, tok, now) {
    const g = this.get(name, now);
    if (!g) return null;
    if (g.tok && g.tok !== tok) return null;
    this.map.delete(key(name));
    return g;
  }

  /** Seats held by ghosts (names), not counting those in `except` (names that are online again). */
  seats(now, except = []) {
    this.prune(now);
    const skip = new Set(except.map(key));
    return [...this.map.values()].filter((g) => !skip.has(key(g.name)));
  }

  /** Has a ghost's seat room for this joiner? A joiner may always take the ghost seat that is their own. */
  canJoin(name, tok, online, maxPlayers, now) {
    const ghosts = this.seats(now, []).filter((g) => key(g.name) !== key(name) || (g.tok && g.tok !== tok));
    return online + ghosts.length < maxPlayers;
  }

  /** Seconds left of a ghost's window (for the host's chat line and the tests). */
  left(name, now) { const g = this.get(name, now); return g ? Math.max(0, Math.ceil((this.ttl - (now - g.at)) / 1000)) : 0; }

  clear() { this.map.clear(); }
}

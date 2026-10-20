// Pluggable transports carrying strings between the host and its clients.
//
//   PeerJS (default): WebRTC data channels; the free public PeerJS signalling
//     server introduces the browsers, after which traffic is peer-to-peer.
//     ?peerhost=..&peerport=..&peerpath=..&peersecure=0|1 selects another
//     signalling server (e.g. a self-hosted `peerjs` server).
//   Loopback (?net=local): BroadcastChannel between tabs of the same browser,
//     for testing without any network.
//
// Host:   const h = await transport.host(code); h.onConnection = (conn) => ...; h.close()
// Client: const conn = await transport.join(code)
// conn:   conn.send(string); conn.onData = fn; conn.onClose = fn; conn.close(); conn.peer
import { peerIdFor } from './protocol.js';

function urlParams() {
  try { return new URLSearchParams(globalThis.location ? globalThis.location.search : ''); } catch { return new URLSearchParams(''); }
}

export function createTransport(params = urlParams()) {
  if (params.get('net') === 'local') return new LoopbackTransport();
  const opts = {};
  if (params.get('peerhost')) {
    opts.host = params.get('peerhost');
    if (params.get('peerport')) opts.port = +params.get('peerport');
    if (params.get('peerpath')) opts.path = params.get('peerpath');
    opts.secure = params.get('peersecure') !== '0';
  }
  return new PeerTransport(opts);
}

// ---- PeerJS ---------------------------------------------------------------------
function wrapDataConnection(dc) {
  const conn = { peer: dc.peer, onData: null, onClose: null, closed: false };
  conn.send = (s) => { if (!conn.closed && dc.open) dc.send(s); };
  conn.close = () => { if (conn.closed) return; conn.closed = true; try { dc.close(); } catch { /* already gone */ } };
  const closed = () => { if (conn._closedFired) return; conn._closedFired = true; conn.closed = true; if (conn.onClose) conn.onClose(); };
  dc.on('data', (d) => { if (conn.onData) conn.onData(d); });
  dc.on('close', closed);
  dc.on('error', closed);
  return conn;
}

export class PeerTransport {
  constructor(opts = {}) { this.opts = opts; this.peer = null; }

  async _peer(id) {
    const { Peer } = await import('peerjs');
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, { debug: 1, ...this.opts }) : new Peer({ debug: 1, ...this.opts });
      const fail = (e) => { peer.destroy(); reject(new Error(e && e.type === 'unavailable-id' ? 'That room code is taken' : `Could not reach the signalling server (${e && (e.type || e.message)})`)); };
      peer.once('open', () => { peer.off('error', fail); resolve(peer); });
      peer.once('error', fail);
    });
  }

  async host(code) {
    const peer = this.peer = await this._peer(peerIdFor(code));
    const h = { onConnection: null, close: () => peer.destroy() };
    peer.on('connection', (dc) => {
      dc.on('open', () => { const c = wrapDataConnection(dc); if (h.onConnection) h.onConnection(c); else c.close(); });
    });
    // keep the room reachable if the signalling socket drops (open data channels are unaffected)
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch { /* destroyed */ } }, 2000); });
    peer.on('error', (e) => console.warn('peer error', e && e.type));
    return h;
  }

  async join(code, timeoutMs = 15000) {
    const peer = this.peer = await this._peer(null);
    return new Promise((resolve, reject) => {
      const dc = peer.connect(peerIdFor(code), { reliable: true, serialization: 'raw' });
      const timer = setTimeout(() => { peer.destroy(); reject(new Error('Timed out connecting to the host')); }, timeoutMs);
      peer.once('error', (e) => {
        clearTimeout(timer); peer.destroy();
        reject(new Error(e && e.type === 'peer-unavailable' ? 'No world is open with that code' : `Connection failed (${e && (e.type || e.message)})`));
      });
      dc.on('open', () => {
        clearTimeout(timer);
        const c = wrapDataConnection(dc);
        const close = c.close;
        c.close = () => { close(); setTimeout(() => peer.destroy(), 200); };
        resolve(c);
      });
    });
  }
}

// ---- BroadcastChannel loopback ---------------------------------------------------
export class LoopbackTransport {
  constructor() { this.id = 'tab-' + Math.random().toString(36).slice(2, 10); }

  _conn(bc, self, other) {
    const conn = { peer: other, onData: null, onClose: null, closed: false };
    conn.send = (s) => { if (!conn.closed) bc.postMessage({ kind: 'data', from: self, to: other, data: s }); };
    conn.close = () => { if (conn.closed) return; bc.postMessage({ kind: 'close', from: self, to: other }); conn._fireClose(); };
    conn._fireClose = () => { if (conn.closed) return; conn.closed = true; if (conn.onClose) conn.onClose(); };
    return conn;
  }

  async host(code) {
    const bc = new BroadcastChannel('saturncraft-net-' + code), conns = new Map();
    const h = { onConnection: null, close: () => { for (const c of conns.values()) c.close(); bc.close(); } };
    bc.onmessage = ({ data: m }) => {
      if (m.kind === 'hello') {
        const c = this._conn(bc, 'host', m.from);
        conns.set(m.from, c);
        bc.postMessage({ kind: 'accept', to: m.from });
        if (h.onConnection) h.onConnection(c);
      } else if (m.to === 'host' && conns.has(m.from)) {
        const c = conns.get(m.from);
        if (m.kind === 'data' && c.onData) c.onData(m.data);
        else if (m.kind === 'close') { conns.delete(m.from); c._fireClose(); }
      }
    };
    globalThis.addEventListener?.('pagehide', () => h.close());
    return h;
  }

  async join(code, timeoutMs = 5000) {
    const bc = new BroadcastChannel('saturncraft-net-' + code);
    return new Promise((resolve, reject) => {
      let conn = null;
      const timer = setTimeout(() => { bc.close(); reject(new Error('No world is open with that code')); }, timeoutMs);
      bc.onmessage = ({ data: m }) => {
        if (m.to !== this.id) return;
        if (m.kind === 'accept' && !conn) {
          clearTimeout(timer);
          conn = this._conn(bc, this.id, 'host');
          globalThis.addEventListener?.('pagehide', () => conn.close());
          resolve(conn);
        } else if (conn && m.kind === 'data' && conn.onData) conn.onData(m.data);
        else if (conn && m.kind === 'close') conn._fireClose();
      };
      bc.postMessage({ kind: 'hello', from: this.id });
    });
  }
}

/** In-memory pair of connected conns (unit tests). */
export function memoryPair() {
  const mk = (peer) => ({ peer, onData: null, onClose: null, closed: false });
  const a = mk('b'), b = mk('a');
  const wire = (x, y) => {
    x.send = (s) => { if (!x.closed) queueMicrotask(() => { if (!y.closed && y.onData) y.onData(s); }); };
    x.close = () => { if (x.closed) return; x.closed = true; if (x.onClose) x.onClose(); if (!y.closed) { y.closed = true; if (y.onClose) y.onClose(); } };
  };
  wire(a, b); wire(b, a);
  return [a, b];
}

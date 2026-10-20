// Block edit synchronisation, independent of the network.
//
// Host: every block change in its world (player edits, fluids, fire, crops,
// explosions, edits applied for clients) is collected and broadcast; edits from
// clients are validated and applied with neighbour updates, so the host decides
// the consequences. Edits in chunks the host has not loaded are written straight
// into the saved chunk data (generating the chunk first when needed).
//
// Client: only its own player edits are sent (World.urgentEdits is set by
// setBlockUrgent, which the interaction code uses); edits from the host are
// applied without neighbour updates (the host already sent their results) and
// never echoed back. Edits for chunks the client has not loaded wait until the
// chunk loads.
import { chunkKey } from '../world/world.js';
import { BLOCKS } from '../world/blocks.js';
import { computeChunkLight } from '../world/lighting.js';
import { cidx, MIN_Y, MAX_Y, CHUNK_VOLUME } from '../world/constants.js';
import { EditBuffer, iterEdits } from './protocol.js';

export function validEdit(x, y, z, id, meta) {
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) && Number.isInteger(id) && Number.isInteger(meta) &&
    y >= MIN_Y && y <= MAX_Y && Math.abs(x) < 3e7 && Math.abs(z) < 3e7 && id >= 0 && !!BLOCKS[id] && meta >= 0 && meta < 256;
}

export class EditSync {
  constructor(world, { host }) {
    this.world = world;
    this.host = host;
    this.applying = false;          // true while applying edits from the network
    this.out = new EditBuffer();
    this.pending = new Map();       // client: chunkKey -> Map(posKey -> edit) for chunks not loaded yet
    this._onChanged = (x, y, z) => this.onChanged(x, y, z);
    world.on('blockChanged', this._onChanged);
  }

  detach() {
    const l = this.world.listeners.blockChanged, i = l.indexOf(this._onChanged);
    if (i >= 0) l.splice(i, 1);
  }

  onChanged(x, y, z) {
    const w = this.world;
    if (this.host || (!this.applying && w.urgentEdits)) this.out.add(x, y, z, w.getBlock(x, y, z), w.getMeta(x, y, z));
  }

  /** Edits to send since the last call (flat array, possibly empty). */
  take() { return this.out.take(); }

  /**
   * Apply edits received from the network. `accept(x, y, z, id, meta)` may veto
   * an edit (host validation); vetoed edits are returned so the sender can be corrected.
   */
  apply(flat, accept = null) {
    const w = this.world, rejected = [], relight = new Set();
    this.applying = true;
    try {
      for (const [x, y, z, id, meta] of iterEdits(flat)) {
        if (!validEdit(x, y, z, id, meta) || (accept && !accept(x, y, z, id, meta))) { rejected.push([x, y, z]); continue; }
        if (w.isLoaded(x, z)) w.setBlockUrgent(x, y, z, id, meta, this.host);
        else if (this.host) { this.writeUnloaded(x, y, z, id, meta); relight.add(chunkKey(x >> 4, z >> 4)); this.out.add(x, y, z, id, meta); }
        else this.addPending(x, y, z, id, meta);
      }
    } finally { this.applying = false; }
    for (const k of relight) { const d = w.saved.get(k); if (d) computeChunkLight(d.blocks, d.light); }
    return rejected;
  }

  addPending(x, y, z, id, meta) {
    const k = chunkKey(x >> 4, z >> 4);
    let m = this.pending.get(k);
    if (!m) { m = new Map(); this.pending.set(k, m); }
    m.set(`${x},${y},${z}`, [x, y, z, id, meta]);
  }

  /** A chunk finished loading: apply the edits that were waiting for it. */
  onChunkLoaded(cx, cz) {
    const k = chunkKey(cx, cz), m = this.pending.get(k);
    if (!m) return;
    this.pending.delete(k);
    this.applying = true;
    try { for (const [x, y, z, id, meta] of m.values()) this.world.setBlock(x, y, z, id, meta, false); } finally { this.applying = false; }
  }

  /** Host: write an edit into the stored data of a chunk that is not loaded. */
  writeUnloaded(x, y, z, id, meta) {
    const w = this.world, cx = x >> 4, cz = z >> 4, k = chunkKey(cx, cz);
    let d = w.saved.get(k);
    if (!d) {
      const g = w.gen.generate(cx, cz);
      const light = new Uint8Array(CHUNK_VOLUME);
      computeChunkLight(g.blocks, light);
      d = { blocks: g.blocks, meta: g.meta, light, biomes: g.biomes, colors: g.colors, heightmap: g.heightmap, modified: true };
      w.saved.set(k, d);
    }
    const lx = x & 15, lz = z & 15, i = cidx(lx, y, lz), hi = lx + lz * 16;
    d.blocks[i] = id; d.meta[i] = meta; d.modified = true;
    if (id && y > d.heightmap[hi]) d.heightmap[hi] = y;
    else if (!id && y === d.heightmap[hi]) {
      let yy = y - 1;
      while (yy > MIN_Y && !d.blocks[cidx(lx, yy, lz)]) yy--;
      d.heightmap[hi] = yy;
    }
  }
}

// Streams chunks around the player: generation jobs in a worker pool, light
// stitching, section meshing (workers for bulk, main thread for edits) and
// per-chunk merged geometry (2 draw calls per chunk).
import * as THREE from 'three';
import { meshSection, pidx, PAD_VOL } from '../world/mesher.js';
import { MIN_Y, SECTION_COUNT, cidx } from '../world/constants.js';
import { chunkKey } from '../world/world.js';
import { createTerrainMaterials, createTerrainDepthMaterial } from './terrainMaterial.js';

export class ChunkRenderer {
  constructor(world, scene, seed, opts = {}) {
    this.world = world;
    this.scene = scene;
    this.renderDistance = opts.renderDistance ?? 8;
    this.materials = createTerrainMaterials();
    this.depthMaterial = createTerrainDepthMaterial();
    this.workers = [];
    const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('../world/worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onWorkerMessage(e.data);
      w.postMessage({ type: 'init', seed });
      w.busy = 0;
      this.workers.push(w);
    }
    this.pendingGen = new Set();
    this.pendingMesh = new Map(); // key*32+sy -> version
    this.meshResults = [];
    this.rebuild = new Set();
    this.jobId = 0;
    this.center = [0, 0];
    this.stats = { chunks: 0, meshed: 0, drawn: 0 };
  }

  setRenderDistance(r) { this.renderDistance = r; }

  pickWorker() {
    let best = this.workers[0];
    for (const w of this.workers) if (w.busy < best.busy) best = w;
    return best;
  }

  onWorkerMessage(m) {
    if (m.type === 'gen') {
      const k = chunkKey(m.cx, m.cz);
      this.pendingGen.delete(k);
      this.workers.forEach((w) => { if (w._jobs && w._jobs.has(m.jobId)) { w._jobs.delete(m.jobId); w.busy--; } });
      const [pcx, pcz] = this.center;
      if (Math.max(Math.abs(m.cx - pcx), Math.abs(m.cz - pcz)) > this.renderDistance + 2) return;
      if (this.world.isChunkLoaded(m.cx, m.cz)) return;
      this.world.addChunk(m.cx, m.cz, m);
      if (this.onChunkLoaded) this.onChunkLoaded(m.cx, m.cz);
    } else if (m.type === 'mesh') {
      this.workers.forEach((w) => { if (w._jobs && w._jobs.has(m.jobId)) { w._jobs.delete(m.jobId); w.busy--; } });
      this.meshResults.push(m);
    }
  }

  post(w, msg, transfer) {
    msg.jobId = ++this.jobId;
    if (!w._jobs) w._jobs = new Set();
    w._jobs.add(msg.jobId);
    w.busy++;
    w.postMessage(msg, transfer);
  }

  /** Padded 18^3 copy of a section including neighbour borders. */
  extractSection(c, sy) {
    const blocks = new Uint8Array(PAD_VOL), light = new Uint8Array(PAD_VOL), meta = new Uint8Array(PAD_VOL);
    const w = this.world;
    const yBase = MIN_Y + sy * 16;
    for (let dz = -1; dz <= 16; dz++) for (let dx = -1; dx <= 16; dx++) {
      let ch = c, lx = dx, lz = dz;
      if (dx < 0 || dx > 15 || dz < 0 || dz > 15) {
        ch = w.getChunk(c.cx + (dx < 0 ? -1 : dx > 15 ? 1 : 0), c.cz + (dz < 0 ? -1 : dz > 15 ? 1 : 0));
        lx = dx & 15; lz = dz & 15;
      }
      for (let dy = -1; dy <= 16; dy++) {
        const y = yBase + dy;
        const p = pidx(dx, dy, dz);
        if (y < MIN_Y) { light[p] = 0; blocks[p] = 6; continue; }
        if (y >= MIN_Y + 384 || !ch) { light[p] = 0xf0; continue; }
        const i = cidx(lx, y, lz);
        blocks[p] = ch.blocks[i]; light[p] = ch.light[i]; meta[p] = ch.meta[i];
      }
    }
    return { blocks, light, meta, colors: c.colors, yBase };
  }

  neighboursLoaded(c) {
    const w = this.world;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (!w.isChunkLoaded(c.cx + dx, c.cz + dz)) return false;
    return true;
  }

  /** Mesh dirty sections synchronously (used right after player edits). */
  flushUrgent() {
    for (const c of this.world.chunks.values()) {
      if (!c.urgent || !c.urgent.size) continue;
      if (!this.neighboursLoaded(c)) { c.urgent.clear(); continue; }
      for (const sy of c.urgent) {
        c.dirty.delete(sy);
        this.applySection(c, sy, c.sectionNonAir[sy] ? meshSection(this.extractSection(c, sy)) : { opaque: null, trans: null });
        this.pendingMesh.delete(chunkKey(c.cx, c.cz) * 32 + sy);
      }
      c.urgent.clear();
      this.buildChunkGeometry(c);
    }
  }

  applySection(c, sy, r) {
    if (!c.render) c.render = { sections: new Array(SECTION_COUNT).fill(null), opaque: null, trans: null };
    c.render.sections[sy] = (r.opaque || r.trans) ? { opaque: r.opaque, trans: r.trans } : null;
  }

  update(px, pz, frameBudgetMs = 6) {
    const t0 = performance.now();
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    this.center = [pcx, pcz];
    const R = this.renderDistance;
    const w = this.world;

    // Unload far chunks
    for (const c of [...w.chunks.values()]) {
      if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > R + 2) {
        this.disposeChunk(c);
        w.removeChunk(c.cx, c.cz);
        if (this.onChunkUnloaded) this.onChunkUnloaded(c.cx, c.cz);
      }
    }

    // Request generation, nearest first
    const maxInflight = this.workers.length * 2;
    if (this.pendingGen.size < maxInflight) {
      const want = [];
      for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const k = chunkKey(cx, cz);
        if (w.chunks.has(k) || this.pendingGen.has(k)) continue;
        want.push([dx * dx + dz * dz, cx, cz, k]);
      }
      want.sort((a, b) => a[0] - b[0]);
      for (const [, cx, cz, k] of want) {
        if (this.pendingGen.size >= maxInflight) break;
        this.pendingGen.add(k);
        this.post(this.pickWorker(), { type: 'gen', cx, cz });
      }
    }

    // Urgent (edit) meshing on the main thread
    this.flushUrgent();

    // Apply finished mesh jobs
    while (this.meshResults.length) {
      const m = this.meshResults.shift();
      const c = w.getChunk(m.cx, m.cz);
      const key = chunkKey(m.cx, m.cz) * 32 + m.sy;
      if (this.pendingMesh.get(key) !== m.version) continue;
      this.pendingMesh.delete(key);
      if (!c) continue;
      this.applySection(c, m.sy, m);
      this.rebuild.add(c);
    }

    // Dispatch mesh jobs for dirty sections of chunks with all neighbours
    let inflight = 0;
    for (const wk of this.workers) inflight += wk.busy;
    if (inflight < this.workers.length * 3) {
      const cands = [];
      for (const c of w.chunks.values()) {
        if (!c.dirty.size) continue;
        const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
        if (d > R || !this.neighboursLoaded(c)) continue;
        cands.push([(c.cx - pcx) ** 2 + (c.cz - pcz) ** 2, c]);
      }
      cands.sort((a, b) => a[0] - b[0]);
      outer: for (const [, c] of cands) {
        for (const sy of [...c.dirty]) {
          if (inflight >= this.workers.length * 3 || performance.now() - t0 > frameBudgetMs) break outer;
          c.dirty.delete(sy);
          const key = chunkKey(c.cx, c.cz) * 32 + sy;
          if (!c.sectionNonAir[sy]) {
            this.applySection(c, sy, { opaque: null, trans: null });
            this.pendingMesh.delete(key);
            this.rebuild.add(c);
            continue;
          }
          const version = (this.pendingMesh.get(key) || 0) + 1;
          this.pendingMesh.set(key, version);
          const sec = this.extractSection(c, sy);
          this.post(this.pickWorker(), { type: 'mesh', cx: c.cx, cz: c.cz, sy, version, ...sec },
            [sec.blocks.buffer, sec.light.buffer, sec.meta.buffer]);
          inflight++;
        }
      }
    }

    // Rebuild merged geometry for chunks that have received sections
    for (const c of this.rebuild) {
      if (performance.now() - t0 > frameBudgetMs + 4) break;
      this.rebuild.delete(c);
      if (w.getChunk(c.cx, c.cz) !== c) continue;
      // wait until no section of this chunk is pending to avoid partial chunks flickering
      this.buildChunkGeometry(c);
    }
    this.stats.chunks = w.chunks.size;
  }

  buildChunkGeometry(c) {
    if (!c.render) return;
    for (const layer of ['opaque', 'trans']) {
      let nv = 0, ni = 0, minY = Infinity, maxY = -Infinity;
      for (let s = 0; s < SECTION_COUNT; s++) {
        const p = c.render.sections[s] && c.render.sections[s][layer];
        if (!p) continue;
        nv += p.pos.length / 3; ni += p.idx.length;
        minY = Math.min(minY, MIN_Y + s * 16); maxY = Math.max(maxY, MIN_Y + s * 16 + 16);
      }
      let mesh = c.render[layer];
      if (!nv) {
        if (mesh) { this.scene.remove(mesh); mesh.geometry.dispose(); c.render[layer] = null; }
        continue;
      }
      const pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 3), uv = new Float32Array(nv * 2);
      const col = new Uint8Array(nv * 3), lit = new Uint8Array(nv * 4), idx = new Uint32Array(ni);
      let vo = 0, io = 0;
      for (let s = 0; s < SECTION_COUNT; s++) {
        const p = c.render.sections[s] && c.render.sections[s][layer];
        if (!p) continue;
        const n = p.pos.length / 3;
        pos.set(p.pos, vo * 3); nrm.set(p.nrm, vo * 3); uv.set(p.uv, vo * 2); col.set(p.col, vo * 3); lit.set(p.lit, vo * 4);
        for (let k = 0; k < p.idx.length; k++) idx[io + k] = p.idx[k] + vo;
        vo += n; io += p.idx.length;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
      g.setAttribute('tuv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
      g.setAttribute('lit', new THREE.BufferAttribute(lit, 4, false));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      const cy = (minY + maxY) / 2, hy = (maxY - minY) / 2;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, cy, 8), Math.sqrt(8 * 8 * 2 + hy * hy));
      g.boundingBox = new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(16, maxY, 16));
      if (mesh) { mesh.geometry.dispose(); mesh.geometry = g; }
      else {
        mesh = new THREE.Mesh(g, layer === 'opaque' ? this.materials.opaque : this.materials.translucent);
        mesh.position.set(c.cx * 16, 0, c.cz * 16);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.castShadow = layer === 'opaque';
        mesh.receiveShadow = true;
        if (layer === 'opaque') mesh.customDepthMaterial = this.depthMaterial;
        this.scene.add(mesh);
        c.render[layer] = mesh;
      }
    }
    c.meshed = true;
  }

  disposeChunk(c) {
    if (!c.render) return;
    for (const layer of ['opaque', 'trans']) {
      const m = c.render[layer];
      if (m) { this.scene.remove(m); m.geometry.dispose(); }
    }
    c.render = null;
    this.rebuild.delete(c);
  }

  /** Are all chunks around a point generated and meshed? */
  isAreaReady(x, z, r = 1) {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const c = this.world.getChunk(cx + dx, cz + dz);
      if (!c || !c.meshed) return false;
    }
    return true;
  }

  dispose() { for (const w of this.workers) w.terminate(); }
}

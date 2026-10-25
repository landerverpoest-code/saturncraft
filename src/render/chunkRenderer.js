// Streams chunks around the player: generation jobs in a worker pool, light
// stitching, section meshing (workers for bulk, main thread for edits) and
// per-chunk merged geometry (2 draw calls per chunk). Occlusion culling trims
// each chunk's draw range to the sections the camera can see into.
import * as THREE from 'three';
import { meshSection, pidx, PAD_VOL } from '../world/mesher.js';
import { MIN_Y, SECTION_COUNT, cidx } from '../world/constants.js';
import { chunkKey } from '../world/world.js';
import { sectionVisibility, sectionHasSky, floodVisible, ALL_OPEN } from '../world/visibility.js';
import { createTerrainMaterials, createTerrainDepthMaterial } from './terrainMaterial.js';

const LAYER_NAMES = ['opaque', 'cutout', 'trans'];
const _frustum = new THREE.Frustum(), _m4 = new THREE.Matrix4(), _box = new THREE.Box3();
/** Shadow pass: draw only the visible surface-layer sections inside the light's frustum. */
function shadowRange(r, o, c, sc, g) {
  const s = o.userData.shadow;
  if (!s) return;
  _frustum.setFromProjectionMatrix(_m4.multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse));
  const ranges = g.userData.ranges, x = o.position.x, z = o.position.z;
  let start = -1, end = -1;
  for (let sy = s[0]; sy <= s[1]; sy++) {
    if (!ranges[sy * 2 + 1]) continue;
    _box.min.set(x, MIN_Y + sy * 16, z); _box.max.set(x + 16, MIN_Y + sy * 16 + 16, z + 16);
    if (!_frustum.intersectsBox(_box)) continue;
    if (start < 0) start = ranges[sy * 2];
    end = ranges[sy * 2] + ranges[sy * 2 + 1];
  }
  g.setDrawRange(Math.max(start, 0), start < 0 ? 0 : end - start);
}
function viewRange(r, o, c, sc, g) { const v = o.userData.view; if (v) g.setDrawRange(v[0], v[1]); }

export class ChunkRenderer {
  constructor(world, scene, seed, opts = {}) {
    this.world = world;
    this.scene = scene;
    this.renderDistance = opts.renderDistance ?? 8;
    this.materials = createTerrainMaterials();
    this.depthMaterial = createTerrainDepthMaterial();
    this.workers = [];
    this.seed = seed;
    this.epoch = 0; // bumped on a dimension switch; older generation results are dropped
    const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('../world/worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onWorkerMessage(e.data);
      w.postMessage({ type: 'init', seed, dimension: world.dimension });
      w.busy = 0;
      this.workers.push(w);
    }
    this.pendingGen = new Set();
    this.pendingMesh = new Map(); // key*32+sy -> version
    this.meshResults = [];
    this.rebuild = new Set();
    this.jobId = 0;
    this.center = [0, 0];
    this.stats = { chunks: 0, meshed: 0, drawn: 0, visibleSections: 0 };
    this.visDirty = true;
    this.visKey = '';
    this.extraCenters = []; // [cx, cz, radius]: also keep chunks loaded here (a multiplayer host simulating its guests' surroundings)
  }

  /** Is a chunk within `pad` of one of the extra centres? */
  nearExtra(cx, cz, pad = 0) {
    for (const [x, z, r] of this.extraCenters) if (Math.max(Math.abs(cx - x), Math.abs(cz - z)) <= r + pad) return true;
    return false;
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
      if (m.epoch !== this.epoch) return;
      const [pcx, pcz] = this.center;
      if (Math.max(Math.abs(m.cx - pcx), Math.abs(m.cz - pcz)) > this.renderDistance + 2 && !this.nearExtra(m.cx, m.cz, 1)) return;
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
    const blocks = new Uint16Array(PAD_VOL), light = new Uint8Array(PAD_VOL), meta = new Uint8Array(PAD_VOL);
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
    return { blocks, light, meta, colors: c.colors, biomes: c.biomes, yBase };
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
      // chunks only kept for simulation (beyond the view) are meshed when the player comes near
      if (Math.max(Math.abs(c.cx - this.center[0]), Math.abs(c.cz - this.center[1])) > this.renderDistance) { c.urgent.clear(); continue; }
      if (!this.neighboursLoaded(c)) { c.urgent.clear(); continue; }
      for (const sy of c.urgent) {
        c.dirty.delete(sy);
        if (c.sectionNonAir[sy]) {
          const sec = this.extractSection(c, sy);
          this.applySection(c, sy, { ...meshSection(sec), vis: sectionVisibility(sec.blocks), sky: sectionHasSky(sec.light) });
        } else this.applySection(c, sy, { opaque: null, cutout: null, trans: null });
        this.pendingMesh.delete(chunkKey(c.cx, c.cz) * 32 + sy);
      }
      c.urgent.clear();
      this.buildChunkGeometry(c);
      this.edited = true;
    }
  }

  applySection(c, sy, r) {
    if (!c.render) c.render = { sections: new Array(SECTION_COUNT).fill(null), vis: new Array(SECTION_COUNT).fill(ALL_OPEN), sky: new Array(SECTION_COUNT).fill(true), opaque: null, cutout: null, trans: null };
    c.render.sections[sy] = (r.opaque || r.cutout || r.trans) ? { opaque: r.opaque, cutout: r.cutout, trans: r.trans } : null;
    c.render.vis[sy] = r.vis ?? ALL_OPEN;
    c.render.sky[sy] = r.sky ?? true;
    this.visDirty = true;
  }

  update(px, pz, frameBudgetMs = 6) {
    const t0 = performance.now();
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    this.center = [pcx, pcz];
    const R = this.renderDistance;
    const w = this.world;

    // Unload far chunks
    for (const c of [...w.chunks.values()]) {
      if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > R + 2 && !this.nearExtra(c.cx, c.cz, 2)) {
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
      for (const [ex, ez, er] of this.extraCenters) {
        for (let dz = -er; dz <= er; dz++) for (let dx = -er; dx <= er; dx++) {
          const cx = ex + dx, cz = ez + dz, k = chunkKey(cx, cz);
          if (w.chunks.has(k) || this.pendingGen.has(k)) continue;
          want.push([1e6 + dx * dx + dz * dz, cx, cz, k]); // after the player's own surroundings
        }
      }
      want.sort((a, b) => a[0] - b[0]);
      for (const [, cx, cz, k] of want) {
        if (this.pendingGen.size >= maxInflight) break;
        if (this.pendingGen.has(k)) continue;
        this.pendingGen.add(k);
        this.post(this.pickWorker(), { type: 'gen', cx, cz, epoch: this.epoch });
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
            this.applySection(c, sy, { opaque: null, cutout: null, trans: null });
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
    for (const layer of LAYER_NAMES) {
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
      const ranges = new Int32Array(SECTION_COUNT * 2); // per section: first index, index count
      const pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 3), uv = new Float32Array(nv * 2);
      const col = new Uint8Array(nv * 3), lit = new Uint16Array(nv * 4), idx = new Uint32Array(ni);
      let vo = 0, io = 0;
      for (let s = 0; s < SECTION_COUNT; s++) {
        const p = c.render.sections[s] && c.render.sections[s][layer];
        if (!p) continue;
        const n = p.pos.length / 3;
        pos.set(p.pos, vo * 3); nrm.set(p.nrm, vo * 3); uv.set(p.uv, vo * 2); col.set(p.col, vo * 3); lit.set(p.lit, vo * 4);
        for (let k = 0; k < p.idx.length; k++) idx[io + k] = p.idx[k] + vo;
        ranges[s * 2] = io; ranges[s * 2 + 1] = p.idx.length;
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
      g.userData.ranges = ranges;
      if (mesh) { mesh.geometry.dispose(); mesh.geometry = g; mesh.userData.view = mesh.userData.shadow = null; }
      else {
        mesh = new THREE.Mesh(g, this.materials[layer]);
        mesh.position.set(c.cx * 16, 0, c.cz * 16);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.castShadow = layer !== 'trans';
        mesh.receiveShadow = true;
        if (layer === 'cutout') mesh.customDepthMaterial = this.depthMaterial;
        if (mesh.castShadow) {
          mesh.onBeforeShadow = shadowRange;
          mesh.onAfterShadow = viewRange;
        }
        this.scene.add(mesh);
        c.render[layer] = mesh;
      }
    }
    c.meshed = true;
    this.visDirty = true;
  }

  /**
   * Occlusion culling: flood fill from the camera's section and limit each
   * chunk's draw range (and bounding sphere) to the sections it reached.
   * Runs only when the camera changes section or meshes change.
   */
  updateVisibility(cam) {
    const ccx = Math.floor(cam.x / 16), ccz = Math.floor(cam.z / 16);
    const csy = Math.floor((cam.y - MIN_Y) / 16);
    const key = `${ccx},${csy},${ccz}`;
    if (!this.visDirty && key === this.visKey) return;
    this.visDirty = false; this.visKey = key;
    const w = this.world;
    const lo = new Map(), hi = new Map();
    let count = 0;
    floodVisible(ccx, csy, ccz, this.renderDistance + 1, (cx, sy, cz) => {
      const c = w.getChunk(cx, cz);
      if (!c) return -1;
      return c.render ? c.render.vis[sy] : ALL_OPEN;
    }, (cx, sy, cz) => {
      const k = chunkKey(cx, cz);
      const a = lo.get(k);
      if (a === undefined || sy < a) lo.set(k, sy);
      if (!(hi.get(k) >= sy)) hi.set(k, sy);
      count++;
    });
    this.stats.visibleSections = count;
    for (const c of w.chunks.values()) {
      if (!c.render) continue;
      const k = chunkKey(c.cx, c.cz);
      const s0 = lo.get(k), s1 = hi.get(k);
      for (const layer of LAYER_NAMES) {
        const mesh = c.render[layer];
        if (!mesh) continue;
        const g = mesh.geometry, r = g.userData.ranges;
        let first = -1, last = -1;
        if (s0 !== undefined) for (let s = s0; s <= s1; s++) if (r[s * 2 + 1]) { if (first < 0) first = s; last = s; }
        if (first < 0) { mesh.visible = false; continue; }
        mesh.visible = true;
        const start = r[first * 2], end = r[last * 2] + r[last * 2 + 1];
        g.setDrawRange(start, end - start);
        if (layer !== 'trans') {
          // Sunlight is scaled by sky light, so sections without any sky light
          // (rock and caves underground) never need to cast sun shadows. One
          // extra section below covers back faces just under a lit surface.
          let sFirst = first;
          while (sFirst <= last && !c.render.sky[sFirst]) sFirst++;
          if (sFirst > first) sFirst--;
          mesh.userData.view = [start, end - start];
          mesh.userData.shadow = [sFirst, last];
        }
        const y0 = MIN_Y + first * 16, y1 = MIN_Y + last * 16 + 16, hy = (y1 - y0) / 2;
        g.boundingSphere.center.set(8, (y0 + y1) / 2, 8);
        g.boundingSphere.radius = Math.sqrt(128 + hy * hy);
      }
    }
  }

  disposeChunk(c) {
    if (!c.render) return;
    for (const layer of LAYER_NAMES) {
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

  /** Drop every chunk mesh and pending job; the workers now generate `dimension`. */
  resetDimension(dimension) {
    for (const c of this.world.chunks.values()) this.disposeChunk(c);
    this.pendingGen.clear(); this.pendingMesh.clear(); this.meshResults.length = 0; this.rebuild.clear();
    this.epoch++;
    for (const w of this.workers) w.postMessage({ type: 'init', seed: this.seed, dimension });
    this.visDirty = true;
  }

  dispose() { for (const w of this.workers) w.terminate(); }
}

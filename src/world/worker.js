// Web Worker: terrain generation + initial lighting, and section meshing.
import { TerrainGenerator } from './generator.js';
import { computeChunkLight } from './lighting.js';
import { meshSection } from './mesher.js';
import { sectionVisibility, sectionHasSky } from './visibility.js';
import { CHUNK_VOLUME } from './constants.js';

let gen = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    gen = new TerrainGenerator(m.seed);
  } else if (m.type === 'gen') {
    const c = gen.generate(m.cx, m.cz);
    const light = new Uint8Array(CHUNK_VOLUME);
    computeChunkLight(c.blocks, light);
    self.postMessage(
      { type: 'gen', jobId: m.jobId, cx: m.cx, cz: m.cz, blocks: c.blocks, meta: c.meta, light, biomes: c.biomes, colors: c.colors, heightmap: c.heightmap },
      [c.blocks.buffer, c.meta.buffer, light.buffer, c.biomes.buffer, c.colors.buffer, c.heightmap.buffer],
    );
  } else if (m.type === 'mesh') {
    const r = meshSection(m);
    const vis = sectionVisibility(m.blocks), sky = sectionHasSky(m.light);
    const transfer = [];
    for (const part of [r.opaque, r.cutout, r.trans]) if (part) for (const k in part) transfer.push(part[k].buffer);
    self.postMessage({ type: 'mesh', jobId: m.jobId, cx: m.cx, cz: m.cz, sy: m.sy, version: m.version, opaque: r.opaque, cutout: r.cutout, trans: r.trans, vis, sky }, transfer);
  }
};

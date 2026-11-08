// The writings left in the chests of the Hermit's Lighthouse, the Mire Shrine and the Stargazer's Observatory (world/lighthouse.js,
// mireShrine.js, observatory.js): one Written Book each, slipped into the chest marked `lore` when its loot is first rolled
// (Game.getChest). Pure functions of the seed and a position, so the host and a saved world agree.
import { I } from './items.js';
import { lighthousesNear, lighthouseChests } from './lighthouse.js';
import { mireShrinesNear, mireChests } from './mireShrine.js';
import { observatoriesNear, observatoryChests } from './observatory.js';
import { hagHutsNear, hagChests } from './hagHut.js';
import { sandvaultsNear, sandvaultChests } from './sandvault.js';
import { recipePages } from './hagCauldron.js';

/** Titles, authors and pages (256 characters at most each) of the three books. */
export const LORE = {
  lighthouse: {
    title: "The Keeper's Log", author: 'The Hermit',
    pages: [
      'Day 1. The point is mine at last. Nine paces across, a ladder, a lamp. The sea does not ask questions, and neither do I.',
      'Day 40. Lit the lens at dusk and a crab the size of a hat came to look. It clacked its claws at the light. We understand each other.',
      'Day 212. Something small and tallow-headed walks the marsh road at night, burning. I leave it candles. It leaves me alone.',
      'Last page. The strongbox stands in the lamp room, beside the lens. Whoever climbs this far has earned it. Keep the lens lit.',
    ],
  },
  mire: {
    title: 'Notes on a Drowned Shrine', author: 'A Surveyor',
    pages: [
      'The mosaic is older than the bog. Whoever laid the sunburst meant it to be seen from above, and the water has only made it a mirror.',
      'The rope ladder behind the altar goes down into a crypt that is full to the roof. I did not go. The shamblers there do not wait the way the dead should.',
      'The candle-headed ones stand dry on the dais and will not step into the water. Whatever they guard, it is not the court.',
    ],
  },
  observatory: {
    title: 'A Chart of the Three Suns', author: 'The Astronomer',
    pages: [
      'The first sun rises red, the second white, the third late and gold. Between them the day is never the same twice.',
      'I have drawn the ring of the great planet for forty years and it has not moved a finger. Everything else has.',
      'The dome was glass once. The wind took the east side first. I left the chart on the pedestal; the stars will want it back.',
    ],
  },
  // the Sandvault's burial hall: the ledger of the vault's keeper (a plain log)
  sandvault: {
    title: "The Sun-Warden's Ledger", author: 'The Sun-Warden',
    pages: [
      'Entered in the third year of the long noon. The vault is sealed under the sand and the sun is its only door. Let no one dig where the golden disc lies.',
      'Three rows of darts guard the road to the hall. Where the plate sits in the middle, keep to the sides. Where the plates sit at the sides, keep to the middle. Better: cut the red lines and the slits fall quiet.',
      'The two who keep the hall were once my guard. They are tired now, and angry. Their master sleeps below the gold.',
    ],
  },
  // a Hag Hut's chest: the recipe of Bog Essence in riddles; its pages depend on the world's seed (world/hagCauldron.js)
  hag: { title: "The Hag's Receipt", author: 'The Hag', pages: null },
};

/** A fresh Written Book stack for a lore key (null for an unknown one). `seed` is the world's: the Hag's recipe depends on it. */
export function loreBook(key, seed = 0) {
  const l = LORE[key];
  if (!l) return null;
  const pages = l.pages ? l.pages.slice() : recipePages(seed);
  return { id: I.WRITTEN_BOOK, count: 1, damage: 0, title: l.title, author: l.author, pages };
}

/** The lore key of the chest at (x, y, z), or null when it is not one of a site's lore chests. */
export function loreKeyAt(gen, x, y, z) {
  if (!gen || !gen.column) return null;
  for (const [near, chests] of [[lighthousesNear, lighthouseChests], [mireShrinesNear, mireChests], [observatoriesNear, observatoryChests], [hagHutsNear, hagChests], [sandvaultsNear, sandvaultChests]]) {
    for (const s of near(gen, x, z, x, z)) for (const c of chests(s)) if (c.lore && c.x === x && c.y === y && c.z === z) return c.lore;
  }
  return null;
}

/** Put the lore book of the chest at (x, y, z), if it has one, into an empty slot of its freshly rolled loot. Returns the key or null. */
export function addLore(gen, x, y, z, slots) {
  const key = loreKeyAt(gen, x, y, z);
  if (!key) return null;
  const i = slots.findIndex((s) => !s);
  if (i < 0) return null;
  slots[i] = loreBook(key, gen.seed);
  return key;
}

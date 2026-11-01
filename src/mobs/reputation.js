// Reputation: what a village thinks of a player. Every player keeps a number from -100 to +100 for each village
// they have dealt with (key "cx,cz" of the village centre, see world/villages.js), kept in player.reputation and
// saved with the player (world/save.js). Fair trades, gifts and winning a raid raise it; hitting settlers and
// killing them lowers it. It moves the prices of every settler of that village (trades.js: repFactor) and, at the
// very bottom, makes them refuse to trade at all (a gift can still win them back).
// In multiplayer the host keeps each guest's reputation (the guest's stand-in object) and tells the guest of every
// change; the guest's own copy only serves to show and work out prices.

export const REP_MIN = -100, REP_MAX = 100;
/** How much each deed is worth. */
export const REP = {
  trade: 0.25, // per completed trade (only up to TRADE_CAP: honest dealing alone does not make a hero)
  gift: 3, // an item the settler's trade has a use for
  treasure: 5, // beryl, gold, diamonds
  raid: 20, // a raid won while in the village
  festival: 2, // staying for the Lantern Festival (world/events.js)
  hit: -3, // hitting a settler
  kill: -25, // killing one
};
export const TRADE_CAP = 45;
/** Standing names, from the lowest rep each begins at. */
export const STANDINGS = [
  { min: REP_MIN, name: 'Hostile' }, { min: -59, name: 'Distrusted' }, { min: -19, name: 'Neutral' },
  { min: 20, name: 'Friendly' }, { min: 60, name: 'Trusted' }, { min: 90, name: 'Hero' },
];
/** At or below this the settlers will not trade. */
export const REFUSE_BELOW = -60;
/** Most that a good name takes off a price, and the most a bad one adds (at the extremes). */
export const MAX_CUT = 0.3, MAX_SURCHARGE = 0.6;
const MAX_VILLAGES = 200;

const clampRep = (v) => Math.max(REP_MIN, Math.min(REP_MAX, v));
const round2 = (v) => Math.round(v * 100) / 100;

/** The key a village's reputation is kept under. */
export const villageKey = (cx, cz) => `${Math.round(cx)},${Math.round(cz)}`;
const VALID_KEY = /^-?\d{1,8},-?\d{1,8}$/;
export const isVillageKey = (k) => typeof k === 'string' && VALID_KEY.test(k);

/** The standing for a reputation: { name, index }. */
export function standing(rep) {
  let index = 0;
  for (let k = 0; k < STANDINGS.length; k++) if (rep >= STANDINGS[k].min) index = k;
  return { name: STANDINGS[index].name, index };
}

/** Price multiplier for a reputation: 1 at 0, down to 1 - MAX_CUT at +100 and up to 1 + MAX_SURCHARGE at -100. */
export function repFactor(rep) {
  rep = clampRep(+rep || 0);
  return rep >= 0 ? 1 - MAX_CUT * (rep / REP_MAX) : 1 + MAX_SURCHARGE * (-rep / -REP_MIN);
}

/** Does a settler turn its back on a player with this reputation? */
export const refusesTrade = (rep) => rep <= REFUSE_BELOW;

/** A holder's reputation in a village (0 when it has none). */
export function getRep(holder, key) {
  const r = holder && holder.reputation;
  return r && key && Number.isFinite(r[key]) ? r[key] : 0;
}

/** Set it (clamped, to two places); returns the new value. A neutral village is not remembered at all. */
export function setRep(holder, key, value) {
  if (!holder || !isVillageKey(key)) return 0;
  if (!holder.reputation) holder.reputation = {};
  const v = round2(clampRep(+value || 0));
  if (v === 0) delete holder.reputation[key]; else holder.reputation[key] = v;
  return v;
}

/**
 * Change it by `delta`. Trades (`kind` 'trade') stop raising it at TRADE_CAP. Returns the new value.
 */
export function addRep(holder, key, delta, kind = null) {
  const cur = getRep(holder, key);
  if (kind === 'trade' && delta > 0) delta = Math.max(0, Math.min(delta, TRADE_CAP - cur));
  return setRep(holder, key, cur + delta);
}

/** A saved reputation table, checked: { "cx,cz": number } without empty or unreasonable entries. */
export function cleanReputation(r) {
  const out = {};
  if (!r || typeof r !== 'object' || Array.isArray(r)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(r)) {
    if (!isVillageKey(k) || !Number.isFinite(v) || n >= MAX_VILLAGES) continue;
    const c = round2(clampRep(v));
    if (c !== 0) { out[k] = c; n++; }
  }
  return out;
}

/** How a settler greets someone with this reputation (for the trade screen). */
export function repHint(rep) {
  if (refusesTrade(rep)) return 'Will not trade. A gift might help.';
  const f = repFactor(rep);
  if (f < 0.995) return `Prices ${Math.round((1 - f) * 100)} % lower`;
  if (f > 1.005) return `Prices ${Math.round((f - 1) * 100)} % higher`;
  return 'Fair prices';
}

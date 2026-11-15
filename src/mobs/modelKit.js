// Helper for adding detail boxes (ears, snouts, stripes, spikes...) to an existing box model.
//
// decorate(parts, { host: [[name, size, offsetFromHostCentre, colour, opts?], ...] })
// appends each extra box on the SAME pivot (and animation) as its host part, so it moves with it. The offset is relative to
// the host box's own offset. An '@' in a host key or a name stands for the side: it expands to 'L' and 'R' and the x offset
// is mirrored for R (host 'leg@' + name 'boot@' gives legL/bootL and legR/bootR). The key '*' appends whole parts as they are.
import { MODELS } from './models.js';

export function decorate(parts, extras) {
  const out = parts.slice();
  const follow = [];
  const add = (hostName, name, size, off, color, opts, sign) => {
    const h = parts.find((p) => p[0] === hostName);
    if (!h) throw new Error('decorate: no part ' + hostName);
    const ho = h[3], ho5 = h[5] || {};
    const o = { ...opts };
    if (ho5.anim && o.anim === undefined) { o.anim = ho5.anim; if (ho5.idx !== undefined) o.idx = ho5.idx; }
    if (o.anim === null) delete o.anim;
    follow.push([name, hostName]);
    out.push([name, size, h[2], [ho[0] + off[0] * sign, ho[1] + off[1], ho[2] + off[2]], color, o]);
  };
  for (const [host, list] of Object.entries(extras)) {
    if (host === '*') { out.push(...list); continue; }
    for (const [name, size, off, color, opts = {}] of list) {
      if (host.includes('@')) {
        for (const [s, sign] of [['L', 1], ['R', -1]]) add(host.replace(/@/g, s), name.replace(/@/g, s), size, off, color, opts, sign);
      } else if (name.includes('@')) {
        for (const [s, sign] of [['L', 1], ['R', -1]]) add(host, name.replace(/@/g, s), size, off, color, opts, sign);
      } else add(host, name, size, off, color, opts, 1);
    }
  }
  out.follow = follow;
  return out;
}

/**
 * Detail boxes sit on their host's pivot but are separate groups, so they must copy whatever the host does this frame (head pitch,
 * a claw snapping, a hidden antler...). Wrap a mob definition's customRender with this once: followDecor(DEF, 'type').
 */
export function followDecor(def, type) {
  const prev = def.customRender;
  def.customRender = (m, model, alpha, sec) => {
    if (prev) prev(m, model, alpha, sec);
    const pa = model.userData && model.userData.parts, list = MODELS[type] && MODELS[type].parts.follow;
    if (!pa || !list) return;
    for (const [name, host] of list) {
      const o = pa[name], h = pa[host];
      if (!o || !h) continue;
      o.rotation.copy(h.rotation); o.position.copy(h.position); o.scale.copy(h.scale); o.visible = h.visible;
    }
  };
}

// Multiplayer: a marker above every other player in view (name and distance), or pinned
// to the screen edge with an arrow when they are off screen, so friends can find each other.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _p = new THREE.Vector3();
const EDGE = 28;   // px from the screen edge for pinned markers
const BOTTOM = 130; // the hotbar and bars cover the bottom of the screen

/**
 * Where a world point shows on screen: { x, y, inside, arrow } - pinned to the screen edge with an arrow
 * (pointing at it, flipped when it is behind the camera) when it is not in view.
 */
export function screenSpot(v, cam, w, h) {
  const half = w / 2, halfH = h / 2;
  _cam.copy(v).applyMatrix4(cam.matrixWorldInverse);
  const front = _cam.z < 0;
  _v.copy(v).project(cam);
  let x = (_v.x * half) + half, y = halfH - (_v.y * halfH);
  const inside = front && x > EDGE && x < w - EDGE && y > EDGE && y < h - BOTTOM;
  let arrow = '';
  if (!inside) {
    let dx = _v.x, dy = _v.y;
    if (!front) { dx = -dx; dy = -dy; }
    const room = dy >= 0 ? halfH - EDGE : halfH - BOTTOM;
    const k = Math.min(Math.abs(dx) > 1e-6 ? (half - EDGE) / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? room / Math.abs(dy) : Infinity);
    x = half + dx * k; y = halfH - dy * k;
    arrow = `<span class="arrow" style="transform:rotate(${Math.atan2(-dy, dx) * 180 / Math.PI}deg)">\u27a4</span>`;
  }
  return { x, y, inside, arrow };
}

export class PlayerMarkers {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.id = 'markers';
    root.appendChild(this.el);
    this.byId = new Map(); // remote player id -> marker element
  }

  /** Called every frame from the HUD while a multiplayer session is running. */
  update(game) {
    const net = game.net, cam = game.camera, p = game.player;
    const seen = new Set();
    if (net && net.remotes && cam) {
      const w = window.innerWidth, h = window.innerHeight;
      for (const rp of net.remotes.values()) {
        if (!rp.root.visible) continue;
        seen.add(rp.id);
        const m = this.marker(rp.id);
        // the marker sits just above the head
        _p.copy(rp.root.position); _p.y += 2.4;
        const { x, y, inside, arrow } = screenSpot(_p, cam, w, h);
        const dist = Math.round(Math.hypot(rp.root.position.x - p.x, rp.root.position.z - p.z));
        m.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
        m.classList.toggle('pinned', !inside);
        m.innerHTML = `${arrow}<b></b><span class="d">${dist} m</span>`;
        const b = m.querySelector('b');
        b.textContent = rp.name;
        b.style.color = (net.social && net.social.colorOf(rp.name)) || ''; // team colour
      }
      // ping beacons (net/social.js): a diamond over the spot, or at the screen edge with an arrow
      if (net.activePings) {
        for (const pg of net.activePings()) {
          const id = 'ping:' + pg.from;
          seen.add(id);
          const m = this.marker(id);
          _p.set(pg.x, pg.y + 1.6, pg.z);
          const { x, y, inside, arrow } = screenSpot(_p, cam, w, h);
          const dist = Math.round(Math.hypot(pg.x - p.x, pg.y - p.y, pg.z - p.z));
          m.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
          m.classList.toggle('pinned', !inside);
          m.classList.add('ping');
          m.style.opacity = String(Math.min(1, pg.life * 6));
          m.innerHTML = `${arrow}<i>\u25c6</i><b></b><span class="d">${dist} m</span>`;
          m.querySelector('i').style.color = pg.color;
          m.querySelector('b').textContent = pg.from;
        }
      }
    }
    for (const [id, m] of this.byId) if (!seen.has(id)) { m.remove(); this.byId.delete(id); }
  }

  clear() {
    for (const m of this.byId.values()) m.remove();
    this.byId.clear();
  }

  marker(id) {
    let m = this.byId.get(id);
    if (!m) { m = document.createElement('div'); m.className = 'marker'; this.el.appendChild(m); this.byId.set(id, m); }
    return m;
  }
}

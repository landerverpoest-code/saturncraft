// AABB physics body integrated at 20 ticks/s with swept per-axis collision
// and 0.6 block step-up, following the reference game's movement order:
// accelerate -> move/collide -> gravity & drag -> friction.
import { PHYS, groundAccel } from './constants.js';
import { BLOCKS, SOLID, B } from '../world/blocks.js';
import { liquidHeight } from '../world/mesher.js';
import { collisionBoxes, SHAPED_COLLISION } from '../world/shapes.js';

const EPS = 1e-7;

export class Body {
  constructor(width, height) {
    this.x = 0; this.y = 0; this.z = 0;       // feet centre
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.width = width; this.height = height;
    this.onGround = false;
    this.horizontalCollision = false;
    this.verticalCollision = false;
    this.inWater = false; this.inLava = false; this.eyeInWater = false;
    this.fallDistance = 0;
    this.stepHeight = PHYS.STEP_HEIGHT;
    this.noGravity = false;
  }

  setPos(x, y, z) { this.x = x; this.y = y; this.z = z; }

  box() {
    const h = this.width / 2;
    return [this.x - h, this.y, this.z - h, this.x + h, this.y + this.height, this.z + h];
  }

  /** Collect solid block boxes intersecting the region. */
  static solidBoxes(world, minX, minY, minZ, maxX, maxY, maxZ, out) {
    out.length = 0;
    const x0 = Math.floor(minX), x1 = Math.floor(maxX - EPS);
    const y0 = Math.floor(minY) - 1, y1 = Math.floor(maxY - EPS);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - EPS);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) {
      const id = world.getBlock(x, y, z);
      if (!SOLID[id]) continue;
      const shaped = SHAPED_COLLISION[id] ? collisionBoxes(id, world.getMeta(x, y, z), world, x, y, z) : null;
      if (shaped) for (const s of shaped) out.push(x + s[0], y + s[1], z + s[2], x + s[3], y + s[4], z + s[5]);
      else out.push(x, y, z, x + 1, y + 1, z + 1);
    }
    return out;
  }

  /** Collide a movement vector against world boxes. Returns [dx,dy,dz]. */
  static collide(world, box, dx, dy, dz) {
    const boxes = Body._tmp || (Body._tmp = []);
    const minX = Math.min(box[0], box[0] + dx), maxX = Math.max(box[3], box[3] + dx);
    const minY = Math.min(box[1], box[1] + dy), maxY = Math.max(box[4], box[4] + dy);
    const minZ = Math.min(box[2], box[2] + dz), maxZ = Math.max(box[5], box[5] + dz);
    Body.solidBoxes(world, minX, minY, minZ, maxX, maxY, maxZ, boxes);
    let b = box.slice();
    // Y first
    for (let i = 0; i < boxes.length; i += 6) dy = clipY(boxes, i, b, dy);
    b[1] += dy; b[4] += dy;
    const xFirst = Math.abs(dx) >= Math.abs(dz);
    if (xFirst) {
      for (let i = 0; i < boxes.length; i += 6) dx = clipX(boxes, i, b, dx);
      b[0] += dx; b[3] += dx;
      for (let i = 0; i < boxes.length; i += 6) dz = clipZ(boxes, i, b, dz);
    } else {
      for (let i = 0; i < boxes.length; i += 6) dz = clipZ(boxes, i, b, dz);
      b[2] += dz; b[5] += dz;
      for (let i = 0; i < boxes.length; i += 6) dx = clipX(boxes, i, b, dx);
    }
    return [dx, dy, dz];
  }

  /** Move with collisions and step-up. */
  move(world, dx, dy, dz, sneakEdge = false) {
    if (sneakEdge && this.onGround && dy <= 0) [dx, dz] = this.backOffFromEdge(world, dx, dz);
    const box = this.box();
    let [rx, ry, rz] = Body.collide(world, box, dx, dy, dz);
    const collidedH = rx !== dx || rz !== dz;
    const landed = dy !== ry && dy < 0;
    if (this.stepHeight > 0 && (this.onGround || landed) && collidedH) {
      // Try stepping up
      let [sx, sy, sz] = Body.collide(world, box, dx, this.stepHeight, dz);
      const [ux, uy, uz] = Body.collide(world, box, 0, this.stepHeight, 0);
      if (uy < this.stepHeight) {
        const b2 = box.slice(); b2[1] += uy; b2[4] += uy;
        const [hx, , hz] = Body.collide(world, b2, dx, 0, dz);
        if (hx * hx + hz * hz > sx * sx + sz * sz) { sx = hx; sz = hz; sy = uy; }
      }
      const b3 = box.slice();
      b3[0] += sx; b3[3] += sx; b3[1] += sy; b3[4] += sy; b3[2] += sz; b3[5] += sz;
      const [, dy2] = Body.collide(world, b3, 0, -sy + (dy < 0 ? dy : 0), 0);
      sy += dy2;
      if (sx * sx + sz * sz > rx * rx + rz * rz + 1e-9) { rx = sx; ry = sy; rz = sz; }
    }
    this.x += rx; this.y += ry; this.z += rz;
    this.horizontalCollision = Math.abs(rx - dx) > 1e-6 || Math.abs(rz - dz) > 1e-6;
    this.verticalCollision = ry !== dy;
    this.onGround = this.verticalCollision && dy < 0;
    if (rx !== dx) this.vx = 0;
    if (rz !== dz) this.vz = 0;
    if (ry !== dy) this.vy = 0;
    // Fall distance accounting
    if (this.onGround) { /* consumed by caller via landing() */ }
    else if (ry < 0) this.fallDistance -= ry;
    return [rx, ry, rz];
  }

  backOffFromEdge(world, dx, dz) {
    const step = 0.05;
    const box = this.box();
    const hasFloor = (ox, oz) => world.boxCollides(box[0] + ox, box[1] - this.stepHeight, box[2] + oz, box[3] + ox, box[1] + 1e-4, box[5] + oz);
    while (dx !== 0 && !hasFloor(dx, 0)) dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
    while (dz !== 0 && !hasFloor(0, dz)) dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
    while (dx !== 0 && dz !== 0 && !hasFloor(dx, dz)) {
      dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
      dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
    }
    return [dx, dz];
  }

  /** Update inWater/inLava flags from overlapping fluid blocks. */
  updateFluidState(world, eyeHeight) {
    const b = this.box();
    this.inWater = false; this.inLava = false; this.eyeInWater = false; this.eyeInLava = false; this.inFire = false;
    const ey = this.y + eyeHeight;
    for (let x = Math.floor(b[0] + 0.001); x <= Math.floor(b[3] - 0.001); x++)
      for (let z = Math.floor(b[2] + 0.001); z <= Math.floor(b[5] - 0.001); z++)
        for (let y = Math.floor(b[1] + 0.001); y <= Math.floor(b[4] - 0.001); y++) {
          const id = world.getBlock(x, y, z);
          if (id === B.FIRE) { this.inFire = true; continue; }
          if (id !== B.WATER && id !== B.LAVA) continue;
          const top = y + (world.getBlock(x, y + 1, z) === id ? 1 : liquidHeight(world.getMeta(x, y, z)));
          if (b[1] < top) {
            if (id === B.WATER) this.inWater = true; else this.inLava = true;
          }
          if (Math.floor(this.x) === x && Math.floor(this.z) === z && ey >= y && ey < top) {
            if (id === B.WATER) this.eyeInWater = true; else this.eyeInLava = true;
          }
        }
  }

  /** Slipperiness of the block under the feet. */
  groundSlipperiness(world) {
    const id = world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5000001), Math.floor(this.z));
    return BLOCKS[id] ? BLOCKS[id].slipperiness : PHYS.DEFAULT_SLIPPERINESS;
  }

  /**
   * One tick of movement.
   * @param {object} input {forward, strafe, yaw, jump, sprint, sneak, speed}
   */
  travel(world, input) {
    const yaw = input.yaw || 0;
    let fwd = (input.forward || 0) * PHYS.INPUT_SCALE, str = (input.strafe || 0) * PHYS.INPUT_SCALE;
    if (input.sneak) { fwd *= PHYS.SNEAK_MULTIPLIER; str *= PHYS.SNEAK_MULTIPLIER; }
    const speed = (input.speed ?? PHYS.WALK_SPEED) * (input.sprint ? PHYS.SPRINT_MULTIPLIER : 1);

    if (this.inWater || this.inLava) {
      if (input.jump) this.vy += PHYS.WATER_JUMP;
      this.accelerate(fwd, str, yaw, PHYS.WATER_ACCEL);
      this.move(world, this.vx, this.vy, this.vz);
      if (this.inWater) {
        const drag = input.sprint ? PHYS.WATER_SPRINT_DRAG : PHYS.WATER_DRAG;
        this.vx *= drag; this.vz *= drag; this.vy *= 0.8;
        if (!this.noGravity) this.vy -= PHYS.WATER_GRAVITY;
      } else {
        this.vx *= PHYS.LAVA_DRAG; this.vz *= PHYS.LAVA_DRAG; this.vy *= PHYS.LAVA_DRAG;
        if (!this.noGravity) this.vy -= PHYS.LAVA_GRAVITY;
      }
      // climb out of fluid onto a ledge
      if (this.horizontalCollision && !world.boxCollides(...offsetBox(this.box(), this.vx, this.vy + 0.6, this.vz))) this.vy = 0.3;
      this.fallDistance = 0;
      return;
    }

    if (input.flying) {
      // creative flight: 0.05 (sprint 0.1) acceleration with air friction, +-0.15 vertical
      // per tick damped by 0.6 (about 10.9 and 4.5 blocks/s at most)
      if (input.jump) this.vy += 0.15;
      if (input.descend) this.vy -= 0.15;
      this.accelerate(fwd, str, yaw, input.sprint ? 0.1 : 0.05);
      this.move(world, this.vx, this.vy, this.vz);
      this.vy *= 0.6; this.vx *= PHYS.AIR_FRICTION; this.vz *= PHYS.AIR_FRICTION;
      this.fallDistance = 0;
      this.jumped = false;
      return;
    }
    if (input.jump && this.onGround && (input.jumpCooldownOk ?? true)) {
      this.vy = PHYS.JUMP_VELOCITY * (input.jumpFactor ?? 1);
      if (input.sprint) {
        const r = yaw;
        this.vx += -Math.sin(r) * PHYS.SPRINT_JUMP_BOOST;
        this.vz += -Math.cos(r) * PHYS.SPRINT_JUMP_BOOST;
      }
      this.jumped = true;
    } else this.jumped = false;

    const slip = this.onGround ? this.groundSlipperiness(world) : 1;
    const accel = this.onGround ? groundAccel(speed, slip) : (input.sprint ? PHYS.AIR_ACCEL_SPRINT : PHYS.AIR_ACCEL);
    this.accelerate(fwd, str, yaw, accel);
    if (input.climbing) { this.vy = Math.max(this.vy, 0.2); this.fallDistance = 0; }
    // Ladders: horizontal speed and descent capped at 0.15, sneaking holds on
    const ladder = this.onLadder(world);
    if (ladder) {
      this.vx = Math.max(-0.15, Math.min(0.15, this.vx));
      this.vz = Math.max(-0.15, Math.min(0.15, this.vz));
      this.vy = Math.max(this.vy, -0.15);
      if (input.sneak && this.vy < 0) this.vy = 0;
      this.fallDistance = 0;
    }
    this.move(world, this.vx, this.vy, this.vz, input.sneak);
    if (this.onGround) {
      // slow ground (Mournsand): horizontal velocity multiplier
      const sf = BLOCKS[world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5000001), Math.floor(this.z))];
      if (sf && sf.speedFactor !== 1) { this.vx *= sf.speedFactor; this.vz *= sf.speedFactor; }
    }
    if (ladder && (this.horizontalCollision || input.jump)) this.vy = 0.2; // climb
    if (!this.noGravity) this.vy -= PHYS.GRAVITY;
    this.vy *= PHYS.DRAG_Y;
    const fr = this.onGround ? slip * PHYS.GROUND_FRICTION_MUL : PHYS.AIR_FRICTION;
    this.vx *= fr; this.vz *= fr;
  }

  /** Is the body inside a ladder block (feet or anywhere along its height)? */
  onLadder(world) {
    const x = Math.floor(this.x), z = Math.floor(this.z);
    for (let y = Math.floor(this.y); y <= Math.floor(this.y + this.height - 0.01); y++) { const id = world.getBlock(x, y, z); if (id === B.LADDER || id === B.VINES) return true; }
    return false;
  }

  /** Add input-relative acceleration (moveRelative). yaw 0 faces -Z. */
  accelerate(fwd, str, yaw, accel) {
    let len = fwd * fwd + str * str;
    if (len < 1e-7) return;
    len = Math.sqrt(len);
    if (len < 1) len = 1;
    const f = fwd / len * accel, s = str / len * accel;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    this.vx += -sin * f + cos * s;
    this.vz += -cos * f - sin * s;
  }
}

function offsetBox(b, dx, dy, dz) { return [b[0] + dx, b[1] + dy, b[2] + dz, b[3] + dx, b[4] + dy, b[5] + dz]; }

function clipY(boxes, i, b, dy) {
  if (b[3] <= boxes[i] + EPS || b[0] >= boxes[i + 3] - EPS || b[5] <= boxes[i + 2] + EPS || b[2] >= boxes[i + 5] - EPS) return dy;
  if (dy > 0 && b[4] <= boxes[i + 1] + EPS) { const d = boxes[i + 1] - b[4]; if (d < dy) dy = d; }
  else if (dy < 0 && b[1] >= boxes[i + 4] - EPS) { const d = boxes[i + 4] - b[1]; if (d > dy) dy = d; }
  return dy;
}
function clipX(boxes, i, b, dx) {
  if (b[4] <= boxes[i + 1] + EPS || b[1] >= boxes[i + 4] - EPS || b[5] <= boxes[i + 2] + EPS || b[2] >= boxes[i + 5] - EPS) return dx;
  if (dx > 0 && b[3] <= boxes[i] + EPS) { const d = boxes[i] - b[3]; if (d < dx) dx = d; }
  else if (dx < 0 && b[0] >= boxes[i + 3] - EPS) { const d = boxes[i + 3] - b[0]; if (d > dx) dx = d; }
  return dx;
}
function clipZ(boxes, i, b, dz) {
  if (b[4] <= boxes[i + 1] + EPS || b[1] >= boxes[i + 4] - EPS || b[3] <= boxes[i] + EPS || b[0] >= boxes[i + 3] - EPS) return dz;
  if (dz > 0 && b[5] <= boxes[i + 2] + EPS) { const d = boxes[i + 2] - b[5]; if (d < dz) dz = d; }
  else if (dz < 0 && b[2] >= boxes[i + 5] - EPS) { const d = boxes[i + 5] - b[2]; if (d > dz) dz = d; }
  return dz;
}

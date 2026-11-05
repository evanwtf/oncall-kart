import type { Box } from './floor';
import { SHOOTER_TUNING } from './tuning';

/** The player on the floor. yaw 0 looks toward -z; forward moves along (-sin yaw, -cos yaw). */
export interface Player {
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  pitch: number;
}

/** Each axis -1..1. strafe +1 is to the player's right. */
export interface MoveInput {
  forward: number;
  strafe: number;
}

export const NO_MOVE: MoveInput = { forward: 0, strafe: 0 };

/** Small gap kept from a face, so a player at rest on a face is never counted inside it. */
const SKIN = 1e-6;

/**
 * Move a circle of `radius` by (dx, dz) through axis-aligned boxes. Each axis
 * moves on its own and stops at the first face it meets (a swept test, so a
 * long move cannot tunnel through a thin wall). A diagonal move into a wall
 * keeps its component along the wall. The circle is treated as its square,
 * which is enough for walls and racks. With `out`, the result goes there and
 * no object is allocated.
 */
export function moveWithCollision(
  p: { x: number; z: number },
  dx: number,
  dz: number,
  radius: number,
  boxes: readonly Box[],
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  let x = p.x;
  let z = p.z;
  if (dx !== 0) {
    let nx = x + dx;
    for (const b of boxes) {
      if (z <= b.minZ - radius || z >= b.maxZ + radius) continue;
      if (dx > 0) {
        const face = b.minX - radius;
        if (x <= face + SKIN && nx > face) nx = Math.min(nx, face);
      } else {
        const face = b.maxX + radius;
        if (x >= face - SKIN && nx < face) nx = Math.max(nx, face);
      }
    }
    x = nx;
  }
  if (dz !== 0) {
    let nz = z + dz;
    for (const b of boxes) {
      if (x <= b.minX - radius || x >= b.maxX + radius) continue;
      if (dz > 0) {
        const face = b.minZ - radius;
        if (z <= face + SKIN && nz > face) nz = Math.min(nz, face);
      } else {
        const face = b.maxZ + radius;
        if (z >= face - SKIN && nz < face) nz = Math.max(nz, face);
      }
    }
    z = nz;
  }
  out.x = x;
  out.z = z;
  return out;
}

/**
 * One fixed step of walking: accelerate toward the input velocity, then move
 * with collision. speedScale scales the top speed (the vendor slowdown).
 */
export function stepPlayer(
  p: Player,
  input: MoveInput,
  dt: number,
  boxes: readonly Box[],
  speedScale = 1,
): void {
  const t = SHOOTER_TUNING;
  let f = Math.max(-1, Math.min(1, input.forward));
  let s = Math.max(-1, Math.min(1, input.strafe));
  const len = Math.hypot(f, s);
  if (len > 1) {
    f /= len;
    s /= len;
  }
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  // Forward is (-sin, -cos); right is (cos, -sin).
  const top = t.runSpeed * speedScale;
  const tx = (-sin * f + cos * s) * top;
  const tz = (-cos * f - sin * s) * top;
  const ex = tx - p.vx;
  const ez = tz - p.vz;
  const gap = Math.hypot(ex, ez);
  const maxDv = t.accel * dt;
  if (gap <= maxDv) {
    p.vx = tx;
    p.vz = tz;
  } else {
    p.vx += (ex / gap) * maxDv;
    p.vz += (ez / gap) * maxDv;
  }
  const want = { x: p.vx * dt, z: p.vz * dt };
  const moved = moveWithCollision(p, want.x, want.z, t.playerRadius, boxes);
  // A blocked axis loses its velocity, so the player slides rather than sticks.
  if (Math.abs(moved.x - p.x - want.x) > 1e-9) p.vx = 0;
  if (Math.abs(moved.z - p.z - want.z) > 1e-9) p.vz = 0;
  p.x = moved.x;
  p.z = moved.z;
}

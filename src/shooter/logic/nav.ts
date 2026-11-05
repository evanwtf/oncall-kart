/**
 * How vendors find their way: a grid over the floor and flow fields on it.
 *
 * A flow field is a BFS distance map from one goal cell. Every vendor that
 * heads for that goal walks downhill on the same map, so one build serves
 * them all.
 */
import { solidBoxes, type FloorDef } from './floor';

export interface NavGrid {
  /** Cell size (m). */
  cell: number;
  cols: number;
  rows: number;
  /** Row-major (index = row * cols + col). 1 = walkable for a vendor of the grid's radius. */
  open: Uint8Array;
}

export interface FlowField {
  goal: { x: number; z: number };
  /** Steps (4-neighbour) from each cell to the goal cell. -1 = unreachable. */
  dist: Int32Array;
  /** BFS queue, kept for the next build. */
  queue: Int32Array;
}

/** Extra clearance (m) past the radius, so a vendor a little off a cell center still clears corners. */
const MARGIN = 0.05;

/**
 * The grid for vendors of `radius`. A cell is open when its center lies on
 * the floor and outside every solid box grown by radius + MARGIN. The boxes
 * grow as squares, as moveWithCollision treats a circle.
 */
export function buildNavGrid(floor: FloorDef, cell: number, radius: number): NavGrid {
  const cols = Math.ceil(floor.width / cell);
  const rows = Math.ceil(floor.depth / cell);
  const open = new Uint8Array(cols * rows).fill(1);
  const r = radius + MARGIN;
  for (const b of solidBoxes(floor)) {
    // Close every cell whose center falls inside the grown box.
    const c0 = Math.max(0, Math.ceil((b.minX - r) / cell - 0.5));
    const c1 = Math.min(cols - 1, Math.floor((b.maxX + r) / cell - 0.5));
    const r0 = Math.max(0, Math.ceil((b.minZ - r) / cell - 0.5));
    const r1 = Math.min(rows - 1, Math.floor((b.maxZ + r) / cell - 0.5));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) open[row * cols + col] = 0;
    }
  }
  return { cell, cols, rows, open };
}

/** The index of the cell that holds (x, z), clamped to the grid. */
export function cellAt(g: NavGrid, x: number, z: number): number {
  const col = Math.min(g.cols - 1, Math.max(0, Math.floor(x / g.cell)));
  const row = Math.min(g.rows - 1, Math.max(0, Math.floor(z / g.cell)));
  return row * g.cols + col;
}

/** The open cell nearest (x, z), searching rings out to `maxRing` cells; -1 if none. */
export function nearestOpen(g: NavGrid, x: number, z: number, maxRing = 6): number {
  const start = cellAt(g, x, z);
  if (g.open[start] === 1) return start;
  const col0 = start % g.cols;
  const row0 = (start - col0) / g.cols;
  for (let ring = 1; ring <= maxRing; ring++) {
    let best = -1;
    let bestD = Infinity;
    for (let row = row0 - ring; row <= row0 + ring; row++) {
      if (row < 0 || row >= g.rows) continue;
      for (let col = col0 - ring; col <= col0 + ring; col++) {
        if (col < 0 || col >= g.cols) continue;
        if (Math.max(Math.abs(row - row0), Math.abs(col - col0)) !== ring) continue;
        const i = row * g.cols + col;
        if (g.open[i] !== 1) continue;
        const d = Math.hypot((col + 0.5) * g.cell - x, (row + 0.5) * g.cell - z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * The flow field toward (gx, gz). With `into`, its buffers are reused and
 * it is returned: no allocation. A goal on a closed cell starts from the
 * nearest open cell.
 */
export function flowField(g: NavGrid, gx: number, gz: number, into?: FlowField): FlowField {
  const n = g.cols * g.rows;
  const f: FlowField =
    into && into.dist.length === n
      ? into
      : { goal: { x: gx, z: gz }, dist: new Int32Array(n), queue: new Int32Array(n) };
  f.goal.x = gx;
  f.goal.z = gz;
  const { dist, queue } = f;
  dist.fill(-1);
  const start = nearestOpen(g, gx, gz);
  if (start < 0) return f;
  dist[start] = 0;
  queue[0] = start;
  let head = 0;
  let tail = 1;
  const { cols, rows, open } = g;
  while (head < tail) {
    const i = queue[head++] as number;
    const d = (dist[i] as number) + 1;
    const col = i % cols;
    // West, east, north, south.
    if (col > 0 && open[i - 1] === 1 && dist[i - 1] === -1) {
      dist[i - 1] = d;
      queue[tail++] = i - 1;
    }
    if (col < cols - 1 && open[i + 1] === 1 && dist[i + 1] === -1) {
      dist[i + 1] = d;
      queue[tail++] = i + 1;
    }
    if (i >= cols && open[i - cols] === 1 && dist[i - cols] === -1) {
      dist[i - cols] = d;
      queue[tail++] = i - cols;
    }
    if (i < (rows - 1) * cols && open[i + cols] === 1 && dist[i + cols] === -1) {
      dist[i + cols] = d;
      queue[tail++] = i + cols;
    }
  }
  return f;
}

/** Neighbour offsets: the 4 straight ones first, then the diagonals. */
const DCOL = [-1, 1, 0, 0, -1, 1, -1, 1] as const;
const DROW = [0, 0, -1, 1, -1, -1, 1, 1] as const;

/**
 * A unit vector downhill on the field from (x, z), toward the center of the
 * best of the 8 neighbours. A diagonal needs both side cells open, so the
 * path never cuts a corner. {0, 0} on the goal cell. From a closed or
 * unreachable cell (a vendor pushed off the grid), it heads for the nearest
 * reachable neighbour. `out` is filled and returned, to avoid an allocation.
 */
export function flowDir(
  g: NavGrid,
  f: FlowField,
  x: number,
  z: number,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  out.x = 0;
  out.z = 0;
  const i = cellAt(g, x, z);
  const here = f.dist[i] as number;
  if (here === 0) return out;
  const col = i % g.cols;
  const row = (i - col) / g.cols;
  let best = -1;
  let bestD = here < 0 ? Infinity : here;
  for (let ring = 1; ring <= 3 && best < 0; ring++) {
    for (let k = 0; k < 8; k++) {
      const nc = col + (DCOL[k] as number) * ring;
      const nr = row + (DROW[k] as number) * ring;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const j = nr * g.cols + nc;
      const d = f.dist[j] as number;
      if (d < 0 || d >= bestD) continue;
      if (ring === 1 && k >= 4) {
        // No corner cutting: both side cells must be open.
        if (g.open[row * g.cols + nc] !== 1 || g.open[nr * g.cols + col] !== 1) continue;
      }
      best = j;
      bestD = d;
    }
    // Only a vendor off the grid looks past the first ring.
    if (here >= 0) break;
  }
  if (best < 0) return out;
  const bc = best % g.cols;
  const tx = (bc + 0.5) * g.cell - x;
  const tz = ((best - bc) / g.cols + 0.5) * g.cell - z;
  const len = Math.hypot(tx, tz);
  if (len < 1e-9) return out;
  out.x = tx / len;
  out.z = tz / len;
  return out;
}

/**
 * True when the segment (x0, z0) → (x1, z1) passes through no box grown by
 * `grow` on each side. Touching a face does not count. A slab test, with a
 * quick reject on the segment's bounds first.
 */
export function segmentClear(
  boxes: readonly { minX: number; maxX: number; minZ: number; maxZ: number }[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  grow: number,
): boolean {
  const eps = 1e-6;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const loX = Math.min(x0, x1);
  const hiX = Math.max(x0, x1);
  const loZ = Math.min(z0, z1);
  const hiZ = Math.max(z0, z1);
  for (const b of boxes) {
    const minX = b.minX - grow + eps;
    const maxX = b.maxX + grow - eps;
    const minZ = b.minZ - grow + eps;
    const maxZ = b.maxZ + grow - eps;
    if (hiX <= minX || loX >= maxX || hiZ <= minZ || loZ >= maxZ) continue;
    let t0 = 0;
    let t1 = 1;
    if (dx === 0) {
      if (x0 <= minX || x0 >= maxX) continue;
    } else {
      let a = (minX - x0) / dx;
      let c = (maxX - x0) / dx;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
    }
    if (dz === 0) {
      if (z0 <= minZ || z0 >= maxZ) continue;
    } else {
      let a = (minZ - z0) / dz;
      let c = (maxZ - z0) / dz;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
    }
    if (t0 < t1) return false;
  }
  return true;
}

import type { Box, FloorDef } from '../../src/shooter/logic/floor';

/** Grid cell size (m) for the reachability check. */
export const CELL = 0.25;

export interface Reach {
  /** Path length (m) from the start to the cell holding (x, z), or Infinity. */
  distanceTo(x: number, z: number): number;
}

/**
 * Shortest walking distances from a start point on a CELL grid. Every box is
 * inflated by the player radius; a cell is free when its center is outside
 * every inflated box. Moves go to the 8 neighbours; a diagonal needs both
 * side cells free, so it never cuts a corner.
 */
export function reachFrom(floor: FloorDef, x0: number, z0: number, radius: number): Reach {
  const nx = Math.ceil(floor.width / CELL);
  const nz = Math.ceil(floor.depth / CELL);
  const boxes: Box[] = [
    ...floor.walls,
    ...floor.racks.map((r) => r.box),
    ...floor.devices.map((d) => d.box),
  ];
  const free = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = (i + 0.5) * CELL;
      const z = (j + 0.5) * CELL;
      const blocked = boxes.some(
        (b) =>
          x > b.minX - radius && x < b.maxX + radius && z > b.minZ - radius && z < b.maxZ + radius,
      );
      free[i * nz + j] = blocked ? 0 : 1;
    }
  }
  const dist = new Float64Array(nx * nz).fill(Infinity);
  const cellOf = (x: number, z: number) => [Math.floor(x / CELL), Math.floor(z / CELL)] as const;
  const [si, sj] = cellOf(x0, z0);
  // Dijkstra with a binary heap: diagonal steps cost more than straight ones.
  const heap: [number, number][] = [];
  const push = (d: number, k: number) => {
    heap.push([d, k]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if ((heap[p] as [number, number])[0] <= d) break;
      [heap[p], heap[c]] = [heap[c] as [number, number], heap[p] as [number, number]];
      c = p;
    }
  };
  const pop = (): [number, number] | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && (heap[l] as [number, number])[0] < (heap[m] as [number, number])[0])
          m = l;
        if (r < heap.length && (heap[r] as [number, number])[0] < (heap[m] as [number, number])[0])
          m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c] as [number, number], heap[m] as [number, number]];
        c = m;
      }
    }
    return top;
  };
  const start = si * nz + sj;
  if (free[start]) {
    dist[start] = 0;
    push(0, start);
  }
  const ok = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx && j < nz && free[i * nz + j] === 1;
  for (let top = pop(); top; top = pop()) {
    const [d, k] = top;
    if (d > (dist[k] ?? Infinity)) continue;
    const i = Math.floor(k / nz);
    const j = k % nz;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (di === 0 && dj === 0) continue;
        const ni = i + di;
        const nj = j + dj;
        if (!ok(ni, nj)) continue;
        if (di !== 0 && dj !== 0 && !(ok(i + di, j) && ok(i, j + dj))) continue;
        const nd = d + CELL * (di !== 0 && dj !== 0 ? Math.SQRT2 : 1);
        const nk = ni * nz + nj;
        if (nd < (dist[nk] ?? Infinity)) {
          dist[nk] = nd;
          push(nd, nk);
        }
      }
    }
  }
  return {
    distanceTo(x, z) {
      const [i, j] = cellOf(x, z);
      if (i < 0 || j < 0 || i >= nx || j >= nz) return Infinity;
      return dist[i * nz + j] ?? Infinity;
    },
  };
}

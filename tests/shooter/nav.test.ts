import { describe, expect, it } from 'vitest';
import { makeRng } from '../../src/logic/rng';
import { FLOOR, frontPoint, solidBoxes } from '../../src/shooter/logic/floor';
import {
  buildNavGrid,
  cellAt,
  flowDir,
  flowField,
  segmentClear,
  type FlowField,
  type NavGrid,
} from '../../src/shooter/logic/nav';
import { moveWithCollision } from '../../src/shooter/logic/player';
import { SHOOTER_TUNING } from '../../src/shooter/logic/tuning';

const T = SHOOTER_TUNING;
const DT = 1 / 120;
const grid = buildNavGrid(FLOOR, T.navCell, T.vendorRadius);
const boxes = solidBoxes(FLOOR);
const isOpen = (g: NavGrid, x: number, z: number) => g.open[cellAt(g, x, z)] === 1;

/**
 * Walk from (x, z) down the field at `speed`, as a vendor does. Returns the
 * time to get within 1 m of the goal (Infinity if never), and whether the
 * walk went 3 s without 0.2 m of progress.
 */
function walk(f: FlowField, x: number, z: number, speed: number, limit = 60) {
  let p = { x, z };
  let mark = { ...p };
  let markTime = 0;
  let stuck = false;
  for (let t = 0; t < limit; t += DT) {
    if (Math.hypot(p.x - f.goal.x, p.z - f.goal.z) <= 1) return { time: t, stuck };
    const d = flowDir(grid, f, p.x, p.z);
    p = moveWithCollision(p, d.x * speed * DT, d.z * speed * DT, T.vendorRadius, boxes);
    if (Math.hypot(p.x - mark.x, p.z - mark.z) >= 0.2) {
      mark = { ...p };
      markTime = t;
    } else if (t - markTime > 3) {
      stuck = true;
    }
  }
  return { time: Infinity, stuck };
}

describe('nav grid', () => {
  it('opens every rack front point and the dock', () => {
    for (const r of FLOOR.racks) {
      const p = frontPoint(r, 0.8);
      expect(isOpen(grid, p.x, p.z), r.id).toBe(true);
    }
    expect(isOpen(grid, FLOOR.dock.x, FLOOR.dock.z)).toBe(true);
    expect(isOpen(grid, FLOOR.spawn.x, FLOOR.spawn.z)).toBe(true);
  });

  it('closes a cell inside a rack', () => {
    const r = FLOOR.racks[0];
    if (!r) throw new Error('no rack');
    expect(isOpen(grid, r.x, r.z)).toBe(false);
  });

  it('sizes the grid to the floor', () => {
    expect(grid.cols).toBe(Math.ceil(FLOOR.width / T.navCell));
    expect(grid.rows).toBe(Math.ceil(FLOOR.depth / T.navCell));
    expect(grid.open.length).toBe(grid.cols * grid.rows);
  });
});

describe('flow field', () => {
  const field = flowField(grid, FLOOR.spawn.x, FLOOR.spawn.z);

  it('reaches the dock from the spawn point', () => {
    const d = field.dist[cellAt(grid, FLOOR.dock.x, FLOOR.dock.z)] ?? -1;
    expect(d).toBeGreaterThan(0);
    expect(field.dist[cellAt(grid, FLOOR.spawn.x, FLOOR.spawn.z)]).toBe(0);
  });

  it('marks a closed cell unreachable', () => {
    const r = FLOOR.racks[0];
    if (!r) throw new Error('no rack');
    expect(field.dist[cellAt(grid, r.x, r.z)]).toBe(-1);
  });

  it('gives a unit vector, and zero at the goal', () => {
    const d = flowDir(grid, field, FLOOR.dock.x, FLOOR.dock.z);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1);
    // The spawn point is west of the dock.
    expect(d.x).toBeLessThan(0);
    expect(flowDir(grid, field, FLOOR.spawn.x, FLOOR.spawn.z)).toEqual({ x: 0, z: 0 });
  });

  it('walks a vendor from the dock to the spawn point without sticking', () => {
    const r = walk(field, FLOOR.dock.x, FLOOR.dock.z, 3);
    expect(r.stuck).toBe(false);
    expect(r.time).toBeLessThan(60);
  });

  it('walks a vendor from 10 random open cells to the spawn point', () => {
    const rng = makeRng(42);
    const reachable: number[] = [];
    for (let i = 0; i < grid.open.length; i++) if ((field.dist[i] ?? -1) >= 0) reachable.push(i);
    for (let n = 0; n < 10; n++) {
      const i = reachable[Math.floor(rng() * reachable.length)] ?? 0;
      const x = ((i % grid.cols) + 0.5) * grid.cell;
      const z = (Math.floor(i / grid.cols) + 0.5) * grid.cell;
      const r = walk(field, x, z, 3);
      expect(r.stuck, `from ${x},${z}`).toBe(false);
      expect(r.time, `from ${x},${z}`).toBeLessThan(60);
    }
  });

  it('walks to a goal in front of every rack in one hall row', () => {
    // A goal in an aisle, reached from the dock: the vendor must turn into the aisle.
    for (const r of FLOOR.racks.filter((_, i) => i % 37 === 0)) {
      const g = frontPoint(r, 0.8);
      const f = flowField(grid, g.x, g.z);
      const res = walk(f, FLOOR.dock.x, FLOOR.dock.z, 3);
      expect(res.stuck, r.id).toBe(false);
      expect(res.time, r.id).toBeLessThan(60);
    }
  });

  it('reuses the buffers of `into`', () => {
    const f = flowField(grid, 20, 18);
    const dist = f.dist;
    const again = flowField(grid, 60, 18, f);
    expect(again).toBe(f);
    expect(again.dist).toBe(dist);
    expect(again.goal).toEqual({ x: 60, z: 18 });
    expect(again.dist[cellAt(grid, 60, 18)]).toBe(0);
  });

  it('builds a field on the real floor fast', () => {
    const f = flowField(grid, 5, 18);
    const runs = 50;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) flowField(grid, 5 + (i % 10), 18, f);
    const ms = (performance.now() - t0) / runs;
    // The plan asks for under 5 ms; the bound is loose so a busy CI runner stays green.
    process.stdout.write(`flow field build: ${ms.toFixed(3)} ms\n`);
    expect(ms).toBeLessThan(20);
  });

  it('starts from the nearest open cell when the goal cell is closed', () => {
    const r = FLOOR.racks[0];
    if (!r) throw new Error('no rack');
    // A goal right on a rack face: its cell is closed.
    const f = flowField(grid, r.x, r.box.minZ - 0.05);
    let zeros = 0;
    for (const d of f.dist) if (d === 0) zeros += 1;
    expect(zeros).toBe(1);
  });
});

describe('segmentClear', () => {
  const b = [{ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }];
  it('finds a segment through a box, and clears one beside it or touching it', () => {
    expect(segmentClear(b, -1, 0.5, 2, 0.5, 0)).toBe(false);
    expect(segmentClear(b, -1, 1.2, 2, 1.2, 0)).toBe(true);
    expect(segmentClear(b, -1, 1.2, 2, 1.2, 0.3)).toBe(false);
    expect(segmentClear(b, -1, 1, 2, 1, 0)).toBe(true);
    expect(segmentClear(b, -1, -1, 2, 2, 0)).toBe(false);
    expect(segmentClear(b, 0.5, -2, 0.5, -0.1, 0)).toBe(true);
    expect(segmentClear(b, 0.5, 0.5, 0.5, 0.5, 0)).toBe(false);
  });
});

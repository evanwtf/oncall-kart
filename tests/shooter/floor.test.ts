import { describe, expect, it } from 'vitest';
import { FLOOR, frontPoint, type Box } from '../../src/shooter/logic/floor';
import { SHOOTER_TUNING } from '../../src/shooter/logic/tuning';
import { reachFrom } from './grid';

/** Boxes that only touch do not overlap; EPS absorbs rounding in the layout sums. */
const EPS = 1e-9;
const overlap = (a: Box, b: Box) =>
  a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;

const targets = [...FLOOR.racks, ...FLOOR.devices];
const boxes = [...FLOOR.walls, ...targets.map((t) => t.box)];
const r = SHOOTER_TUNING.playerRadius;
const reach = reachFrom(FLOOR, FLOOR.spawn.x, FLOOR.spawn.z, r);

describe('floor', () => {
  it('has unique rack ids r1, r2, ...', () => {
    const ids = FLOOR.racks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^r\d+$/);
  });

  it('has at least 60 racks, 2 switches and 2 firewalls', () => {
    expect(FLOOR.racks.length).toBeGreaterThanOrEqual(60);
    expect(FLOOR.racks.every((t) => t.kind === 'rack')).toBe(true);
    expect(FLOOR.devices.filter((d) => d.kind === 'switch').length).toBeGreaterThanOrEqual(2);
    expect(FLOOR.devices.filter((d) => d.kind === 'firewall').length).toBeGreaterThanOrEqual(2);
    const ids = targets.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('racks are standard 0.6 x 1.2 m boxes, centered on x and z, with a unit front', () => {
    for (const t of FLOOR.racks) {
      const w = t.box.maxX - t.box.minX;
      const d = t.box.maxZ - t.box.minZ;
      const dims = [w, d].map((v) => Math.round(v * 100) / 100).sort();
      expect(dims).toEqual([0.6, 1.2]);
      // The 1.2 m side runs along the front direction.
      const along = t.fx !== 0 ? w : d;
      expect(along).toBeCloseTo(1.2);
    }
    for (const t of targets) {
      expect(Math.hypot(t.fx, t.fz)).toBeCloseTo(1);
      expect((t.box.minX + t.box.maxX) / 2).toBeCloseTo(t.x);
      expect((t.box.minZ + t.box.maxZ) / 2).toBeCloseTo(t.z);
    }
  });

  it('has the five areas, and every target lies on the floor', () => {
    expect(FLOOR.areas.map((a) => a.name).sort()).toEqual(
      ['Break room', 'Data hall A', 'Data hall B', 'Loading dock', 'Network room'].sort(),
    );
    for (const b of boxes) {
      expect(b.minX).toBeGreaterThanOrEqual(0);
      expect(b.minZ).toBeGreaterThanOrEqual(0);
      expect(b.maxX).toBeLessThanOrEqual(FLOOR.width);
      expect(b.maxZ).toBeLessThanOrEqual(FLOOR.depth);
    }
    const inArea = (name: string, x: number, z: number) => {
      const a = FLOOR.areas.find((x2) => x2.name === name)?.box;
      return !!a && x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ;
    };
    expect(inArea('Break room', FLOOR.spawn.x, FLOOR.spawn.z)).toBe(true);
    expect(inArea('Loading dock', FLOOR.dock.x, FLOOR.dock.z)).toBe(true);
    for (const d of FLOOR.devices) expect(inArea('Network room', d.x, d.z)).toBe(true);
  });

  it('has no overlapping boxes', () => {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i] as Box;
        const b = boxes[j] as Box;
        if (overlap(a, b)) throw new Error(`boxes ${i} and ${j} overlap`);
      }
    }
  });

  it('spawns the player clear of every box', () => {
    const { x, z } = FLOOR.spawn;
    for (const b of boxes) {
      const inflated = { minX: b.minX - r, maxX: b.maxX + r, minZ: b.minZ - r, maxZ: b.maxZ + r };
      expect(x > inflated.minX && x < inflated.maxX && z > inflated.minZ && z < inflated.maxZ).toBe(
        false,
      );
    }
  });

  it('every front faces an aisle at least 1.6 m wide', () => {
    for (const t of targets) {
      // A 1.6 m deep strip in front of the face, as wide as the face, is clear.
      const half = t.fx !== 0 ? (t.box.maxX - t.box.minX) / 2 : (t.box.maxZ - t.box.minZ) / 2;
      const side = t.fx !== 0 ? (t.box.maxZ - t.box.minZ) / 2 : (t.box.maxX - t.box.minX) / 2;
      const cx = t.x + t.fx * (half + 0.8);
      const cz = t.z + t.fz * (half + 0.8);
      const hx = t.fx !== 0 ? 0.8 - 0.01 : side - 0.01;
      const hz = t.fx !== 0 ? side - 0.01 : 0.8 - 0.01;
      const strip = { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
      for (const b of boxes) expect(overlap(strip, b)).toBe(false);
    }
  });

  it('can reach the front of every rack and device from the spawn point', () => {
    for (const t of targets) {
      const p = frontPoint(t, 0.8);
      expect(reach.distanceTo(p.x, p.z), t.id).toBeLessThan(Infinity);
    }
  });

  it('takes 15 to 27 s at full speed to reach the farthest target', () => {
    let far = 0;
    for (const t of targets) {
      const p = frontPoint(t, 0.8);
      far = Math.max(far, reach.distanceTo(p.x, p.z));
    }
    const seconds = far / SHOOTER_TUNING.runSpeed;
    expect(seconds).toBeGreaterThanOrEqual(15);
    expect(seconds).toBeLessThanOrEqual(27);
  });

  it('frontPoint is the given distance out from the front face', () => {
    const t = FLOOR.racks[0];
    if (!t) throw new Error('no rack');
    const p = frontPoint(t, 0.8);
    // Inside the box along the front, the face is 0.6 m from the center.
    expect(Math.hypot(p.x - t.x, p.z - t.z)).toBeCloseTo(0.6 + 0.8);
    expect((p.x - t.x) * t.fx + (p.z - t.z) * t.fz).toBeCloseTo(1.4);
  });
});

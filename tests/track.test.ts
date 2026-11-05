import { describe, expect, it } from 'vitest';
import { buildTrack, crossedForward, forwardDelta, wrapS } from '../src/logic/track';
import { HALL } from '../src/logic/tracks/hall';
import { circleTrack } from './helpers';

describe('track geometry', () => {
  const track = circleTrack(50);

  it('measures a circle within 1%', () => {
    expect(Math.abs(track.length - 2 * Math.PI * 50) / (2 * Math.PI * 50)).toBeLessThan(0.01);
  });

  it('projects a centerline point back to its s', () => {
    for (let s = 0; s < track.length; s += 7.3) {
      const p = track.project(track.pointAt(s));
      expect(Math.abs(forwardDelta(s, p.s, track.length))).toBeLessThan(0.5);
      expect(Math.abs(p.lateral)).toBeLessThan(0.05);
    }
  });

  it('gives +lateral left of the travel direction', () => {
    const s = 40;
    const c = track.pointAt(s);
    const t = track.tangentAt(s);
    const left = { x: t.z, z: -t.x };
    const p = track.project({ x: c.x + 3 * left.x, z: c.z + 3 * left.z }, s);
    expect(p.lateral).toBeCloseTo(3, 1);
  });

  it('projects with a hint across the seam', () => {
    const p = track.project(track.pointAt(1), track.length - 1);
    expect(p.s).toBeCloseTo(1, 0);
  });

  it('has a unit tangent', () => {
    const t = track.tangentAt(10);
    expect(Math.hypot(t.x, t.z)).toBeCloseTo(1, 5);
  });
});

describe('distance helpers', () => {
  it('wraps s', () => {
    expect(wrapS(-1, 100)).toBe(99);
    expect(wrapS(100, 100)).toBe(0);
    expect(wrapS(250, 100)).toBe(50);
  });

  it('measures the signed shortest delta', () => {
    expect(forwardDelta(99, 1, 100)).toBe(2);
    expect(forwardDelta(1, 99, 100)).toBe(-2);
    expect(forwardDelta(10, 20, 100)).toBe(10);
  });

  it('detects forward crossings only', () => {
    expect(crossedForward(0, 99, 1, 100)).toBe(true);
    expect(crossedForward(0, 1, 99, 100)).toBe(false);
    expect(crossedForward(50, 40, 60, 100)).toBe(true);
    expect(crossedForward(50, 60, 40, 100)).toBe(false);
    expect(crossedForward(50, 10, 20, 100)).toBe(false);
  });

  it('counts a mark once when a move ends exactly on it', () => {
    expect(crossedForward(50, 45, 50, 100)).toBe(true);
    expect(crossedForward(50, 50, 55, 100)).toBe(false);
  });
});

describe('HALL', () => {
  const hall = buildTrack(HALL);
  const L = hall.length;

  it('is a 600-800 m loop', () => {
    expect(L).toBeGreaterThan(600);
    expect(L).toBeLessThan(800);
  });

  it('has 6 gate rows at least 60 m apart', () => {
    const rows = HALL.gateRowFractions.map((f) => f * L);
    expect(rows).toHaveLength(6);
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i] as number;
      const b = rows[(i + 1) % rows.length] as number;
      expect(wrapS(b - a, L)).toBeGreaterThanOrEqual(60);
    }
  });

  it('keeps every gate row out of the pit span', () => {
    for (const f of HALL.gateRowFractions) {
      const s = f * L;
      expect(s < HALL.pit.startS - 10 || s > HALL.pit.endS + 10, `row at ${s}`).toBe(true);
    }
  });

  it('puts the grid 5-30 m after the line and before the pit', () => {
    expect(HALL.gridS).toBeGreaterThanOrEqual(5);
    expect(HALL.gridS).toBeLessThanOrEqual(30);
    expect(HALL.gridS).toBeLessThan(HALL.pit.startS);
  });

  it('never runs close to itself', () => {
    const step = 2;
    const gap = 2 * HALL.halfWidth + 6;
    for (let a = 0; a < L; a += step) {
      for (let b = a + step; b < L; b += step) {
        const along = Math.min(b - a, L - (b - a));
        if (along < 60) continue;
        const pa = hall.pointAt(a);
        const pb = hall.pointAt(b);
        expect(Math.hypot(pa.x - pb.x, pa.z - pb.z), `s=${a} vs s=${b}`).toBeGreaterThan(gap);
      }
    }
  });

  it('keeps the pit lane clear of the rest of the track', () => {
    const p = HALL.pit;
    const reach = p.centerOffset + p.halfWidth + HALL.halfWidth + 2;
    for (let s = p.startS; s <= p.endS; s += 2) {
      const c = hall.pointAt(s);
      const t = hall.tangentAt(s);
      const pit = {
        x: c.x + p.side * p.centerOffset * t.z,
        z: c.z - p.side * p.centerOffset * t.x,
      };
      for (let o = 0; o < L; o += 2) {
        const along = Math.min(Math.abs(o - s), L - Math.abs(o - s));
        if (along < 80) continue;
        const q = hall.pointAt(o);
        expect(Math.hypot(pit.x - q.x, pit.z - q.z)).toBeGreaterThan(reach - p.centerOffset);
      }
    }
  });
});

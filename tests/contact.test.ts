import { describe, expect, it } from 'vitest';
import { resolveContacts } from '../src/logic/contact';
import { spawnKart, type KartState } from '../src/logic/kart';
import { TUNING } from '../src/logic/tuning';
import { dist } from '../src/logic/vec';
import { lineTrack } from './helpers';

const track = lineTrack(1000);
const at = (s: number, lateral: number, speed = 0): { kart: KartState } => ({
  kart: { ...spawnKart(track, s, lateral), speed },
});

describe('resolveContacts', () => {
  it('separates two overlapping karts to twice the kart radius', () => {
    const a = at(100, 0);
    const b = at(100.5, 0.3);
    resolveContacts([a, b]);
    expect(dist(a.kart.pos, b.kart.pos)).toBeGreaterThanOrEqual(2 * TUNING.kartRadius - 1e-9);
  });

  it('pushes both karts the same distance, along the line between them', () => {
    const a = at(100, 0);
    const b = at(101, 0);
    resolveContacts([a, b]);
    expect(a.kart.pos.z).toBeCloseTo(100 - (2 * TUNING.kartRadius - 1) / 2, 9);
    expect(b.kart.pos.z).toBeCloseTo(101 + (2 * TUNING.kartRadius - 1) / 2, 9);
    expect(a.kart.pos.x).toBeCloseTo(0, 9);
  });

  it('leaves karts that do not touch alone', () => {
    const a = at(100, 0, 10);
    const b = at(100 + 2 * TUNING.kartRadius + 0.01, 0, 5);
    const before = [structuredClone(a), structuredClone(b)];
    resolveContacts([a, b]);
    expect([a, b]).toEqual(before);
  });

  it('passes some speed from the kart behind to the kart ahead in a rear-end hit', () => {
    const a = at(100, 0, 20);
    const b = at(101.5, 0, 0);
    resolveContacts([a, b]);
    expect(a.kart.speed).toBeLessThan(20);
    expect(a.kart.speed).toBeGreaterThan(0);
    expect(b.kart.speed).toBeGreaterThan(0);
    // Momentum along the road is kept.
    expect(a.kart.speed + b.kart.speed).toBeCloseTo(20, 9);
  });

  it('does not change the speed of karts that move apart', () => {
    const a = at(100, 0, 0);
    const b = at(101.5, 0, 10);
    resolveContacts([a, b]);
    expect(a.kart.speed).toBe(0);
    expect(b.kart.speed).toBe(10);
  });
});

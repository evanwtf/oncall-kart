import { describe, expect, it } from 'vitest';
import { makeRng } from '../../src/logic/rng';
import { TICKET_TYPES } from '../../src/logic/runbooks';
import { breakTimes, shooterSla } from '../../src/shooter/logic/breaks';
import { FLOOR } from '../../src/shooter/logic/floor';
import { PATCH_NAMES, rollPatches } from '../../src/shooter/logic/patches';
import { SHOOTER_TUNING } from '../../src/shooter/logic/tuning';

const T = SHOOTER_TUNING;

describe('breakTimes', () => {
  it('gives 6 ascending times: the first at 10, gaps of 8 or more, none after 165', () => {
    for (const seed of [1, 2, 3, 42, 9999]) {
      const times = breakTimes(makeRng(seed));
      expect(times).toHaveLength(T.breaks);
      expect(times[0]).toBe(T.firstBreak);
      for (let i = 1; i < times.length; i++) {
        expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(
          T.minBreakGap - 1e-9,
        );
      }
      expect(times[times.length - 1]).toBeLessThanOrEqual(T.shiftSeconds - T.quietEnd);
    }
  });

  it('gives the same list for the same seed, and a different one for another', () => {
    expect(breakTimes(makeRng(1))).toEqual(breakTimes(makeRng(1)));
    expect(breakTimes(makeRng(1))).not.toEqual(breakTimes(makeRng(2)));
  });
});

describe('shooterSla', () => {
  it('is slaBase + slaPerStep per step', () => {
    const cpu = TICKET_TYPES.find((t) => t.id === 'bad-cpu');
    if (!cpu) throw new Error('no bad-cpu');
    expect(shooterSla(cpu)).toBe(77);
  });
});

describe('rollPatches', () => {
  it('rolls one switch, one firewall and one rack, with fictional ids and names', () => {
    for (const seed of [1, 2, 3]) {
      const patches = rollPatches(makeRng(seed), FLOOR);
      expect(patches).toHaveLength(T.patches);
      const kinds = patches.map(
        (p) => [...FLOOR.racks, ...FLOOR.devices].find((t) => t.id === p.targetId)?.kind,
      );
      expect(kinds).toEqual(['switch', 'firewall', 'rack']);
      for (const p of patches) {
        expect(p.id).toMatch(/^ZD-\d{4}-\d{4}$/);
        expect(p.applied).toBe(false);
        expect(PATCH_NAMES).toContain(p.name);
      }
      expect(new Set(patches.map((p) => p.name)).size).toBe(patches.length);
      expect(new Set(patches.map((p) => p.id)).size).toBe(patches.length);
    }
  });

  it('never uses a real advisory prefix', () => {
    for (const p of rollPatches(makeRng(7), FLOOR)) expect(p.id).not.toMatch(/^CVE/i);
  });
});

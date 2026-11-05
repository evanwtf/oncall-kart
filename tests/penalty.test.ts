import { describe, expect, it } from 'vitest';
import { NO_INPUT } from '../src/logic/kart';
import { applyHit, type HitKind } from '../src/logic/penalty';
import { createRace, stepRace, type KartRuntime, type Race } from '../src/logic/race';
import { buildTrack } from '../src/logic/track';
import { HALL } from '../src/logic/tracks/hall';
import { TUNING } from '../src/logic/tuning';

const track = buildTrack(HALL);

function kart(): KartRuntime {
  const r = createRace({ laps: 1, seed: 1, driverColor: 0, bots: 0 }, track);
  const k = r.karts[0];
  if (!k) throw new Error('kart');
  return k;
}

const HAZARD_HITS: HitKind[] = ['page', 'spill', 'cable', 'cron'];

describe('applyHit', () => {
  it('spins a kart with no protection, for the time of that kind', () => {
    for (const kind of [...HAZARD_HITS, 'wrong-gate'] as HitKind[]) {
      const k = kart();
      k.kart = { ...k.kart, driftDir: 1, driftTime: 1 };
      expect(applyHit(k, kind)).toBe('spun');
      expect(k.kart.spinTime).toBe(TUNING.hitSpin[kind]);
      expect(k.kart.driftDir).toBe(0);
    }
    expect(TUNING.hitSpin['wrong-gate']).toBe(TUNING.wrongGateSpin);
  });

  it('lets the Firewall block page, spill, cable and cron hits, and drops it', () => {
    for (const kind of HAZARD_HITS) {
      const k = kart();
      k.shieldTime = 3;
      k.rollbackArmed = true;
      expect(applyHit(k, kind)).toBe('blocked');
      expect(k.shieldTime).toBe(0);
      // A blocked hit consumes the Firewall only.
      expect(k.rollbackArmed).toBe(true);
      expect(k.kart.spinTime).toBe(0);
    }
  });

  it('does not let the Firewall block a wrong gate; a Rollback cancels it', () => {
    const k = kart();
    k.shieldTime = 3;
    k.rollbackArmed = true;
    expect(applyHit(k, 'wrong-gate')).toBe('rolled-back');
    expect(k.shieldTime).toBe(3);
    expect(k.rollbackArmed).toBe(false);
    expect(k.kart.spinTime).toBe(0);
  });

  it('meets Firewall first, then Rollback, then a spin (Review Focus 1)', () => {
    const k = kart();
    k.shieldTime = 3;
    k.rollbackArmed = true;
    expect(applyHit(k, 'page')).toBe('blocked');
    expect(applyHit(k, 'spill')).toBe('rolled-back');
    expect(applyHit(k, 'cron')).toBe('spun');
  });

  it('does not hit a kart that is already spinning: no stun-lock', () => {
    const k = kart();
    expect(applyHit(k, 'page')).toBe('spun');
    k.shieldTime = 3;
    k.rollbackArmed = true;
    const spin = k.kart.spinTime;
    expect(applyHit(k, 'spill')).toBe('ignored');
    expect(applyHit(k, 'wrong-gate')).toBe('ignored');
    expect(k.kart.spinTime).toBe(spin);
    expect(k.shieldTime).toBe(3);
    expect(k.rollbackArmed).toBe(true);
  });
});

describe('penalties in the race', () => {
  function racing(): Race {
    const r = createRace({ laps: 1, seed: 1, driverColor: 0, bots: 1 }, track);
    while (r.phase === 'countdown') stepRace(r, [NO_INPUT], 1 / 60);
    return r;
  }

  it('routes a wrong gate through applyHit: a Rollback cancels the spin', () => {
    const r = racing();
    const p = r.karts[0];
    const row = r.board[0];
    const slot = row?.slots[0];
    if (!p || !row || !slot) throw new Error('setup');
    for (const other of r.karts) if (other !== p) other.finishedAt = 0;
    p.ticket = { ...p.ticket, stepIndex: p.ticket.type.steps.length - 1, deadline: 999 };
    slot.op = p.ticket.type.steps[0] === 'REIMAGE' ? 'POWERON' : 'REIMAGE';
    for (const sl of row.slots) sl.op = slot.op;
    const ok = p.ticket.type.steps[p.ticket.stepIndex];
    if (ok === slot.op) throw new Error('setup: slot op is needed');
    p.rollbackArmed = true;
    p.kart = { ...p.kart, pos: track.pointAt(row.s - 2), heading: 0, speed: 0 };
    const t = track.tangentAt(row.s - 2);
    const c = track.pointAt(row.s - 2);
    p.kart = {
      ...p.kart,
      pos: { x: c.x + slot.lateral * t.z, z: c.z - slot.lateral * t.x },
      heading: Math.atan2(t.x, t.z),
      speed: 15,
    };
    p.proj = { s: row.s - 2, lateral: slot.lateral };
    const events = [];
    for (let i = 0; i < 60; i++)
      events.push(...stepRace(r, [{ ...NO_INPUT, throttle: 1 }], 1 / 120));
    expect(events).toContainEqual({ type: 'wrong-gate', kartId: 0, op: slot.op });
    expect(events).toContainEqual({
      type: 'hit',
      kartId: 0,
      kind: 'wrong-gate',
      outcome: 'rolled-back',
      byId: null,
    });
    expect(p.stats.wrongGates).toBe(1);
    expect(p.kart.spinTime).toBe(0);
    expect(p.rollbackArmed).toBe(false);
  });
});

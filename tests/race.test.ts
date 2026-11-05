import { describe, expect, it } from 'vitest';
import { NO_INPUT, spawnKart, surfaceAt, type KartInput } from '../src/logic/kart';
import type { Op } from '../src/logic/ops';
import {
  createRace,
  gridSlot,
  pitBoxS,
  respawn,
  standings,
  stepRace,
  type Race,
  type RaceEvent,
} from '../src/logic/race';
import { TICKET_TYPES } from '../src/logic/runbooks';
import { buildTrack, forwardDelta } from '../src/logic/track';
import { HALL } from '../src/logic/tracks/hall';
import { TUNING } from '../src/logic/tuning';
import { dist } from '../src/logic/vec';
import { scriptedInput } from './driver';

const track = buildTrack(HALL);
const DT = 1 / 60;
const GAS: KartInput = { ...NO_INPUT, throttle: 1 };

function newRace(laps: 1 | 3 | 10 = 1, seed = 1, bots = 0): Race {
  return createRace({ laps, seed, driverColor: 0, bots }, track);
}

/** Step through the countdown. */
function toGo(race: Race): RaceEvent[] {
  const events: RaceEvent[] = [];
  while (race.phase === 'countdown') events.push(...stepRace(race, [NO_INPUT], DT));
  return events;
}

function player(race: Race) {
  const k = race.karts[0];
  if (!k) throw new Error('no player');
  return k;
}

/** Put the player just before gate row `row`, in its slot `slot`, with a ticket that wants `want`. */
function setUpAtRow(race: Race, row: number, slot: number, want: Op | 'other', speed = 15) {
  const r = race.board[row];
  const sl = r?.slots[slot];
  if (!r || !sl) throw new Error('no slot');
  const type = TICKET_TYPES.find((t) => t.id === 'flapping-nic');
  if (!type) throw new Error('no type');
  const p = player(race);
  // flapping-nic starts with MAINT. Make the slot MAINT, or not MAINT.
  sl.op = want === 'other' ? 'REIMAGE' : 'MAINT';
  for (const other of r.slots) if (other !== sl) other.op = 'REIMAGE';
  p.ticket = { ...p.ticket, type, stepIndex: 0, deadline: race.time + 999 };
  p.kart = { ...spawnKart(track, r.s - 3, sl.lateral), speed };
  p.proj = { s: r.s - 3, lateral: sl.lateral };
}

function driveFor(race: Race, seconds: number, input: KartInput = GAS): RaceEvent[] {
  const events: RaceEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) events.push(...stepRace(race, [input], DT));
  return events;
}

const types = (events: RaceEvent[]) => events.map((e) => e.type);

describe('createRace', () => {
  it('gives equal state for equal config (fresh state per race)', () => {
    const a = newRace(3, 7);
    const b = newRace(3, 7);
    expect({ ...a, rng: null }).toEqual({ ...b, rng: null });
  });

  it('starts with a 3 s countdown and one kart holding a ticket', () => {
    const r = newRace();
    expect(r.phase).toBe('countdown');
    expect(r.countdown).toBe(3);
    expect(r.karts).toHaveLength(1);
    expect(player(r).ticket.number).toBe(1);
  });

  it('ignores input until go', () => {
    const r = newRace();
    const start = { ...player(r).kart.pos };
    const events = driveFor(r, 2.9);
    expect(player(r).kart.pos).toEqual(start);
    expect(types(events)).not.toContain('go');
    const more = driveFor(r, 0.2);
    expect(types(more)).toContain('go');
    expect(r.phase).toBe('racing');
  });
});

describe('gates', () => {
  it('advances the ticket through the needed gate', () => {
    const r = newRace();
    toGo(r);
    setUpAtRow(r, 0, 0, 'MAINT');
    const ev = driveFor(r, 0.5);
    expect(ev).toContainEqual({ type: 'step-ok', kartId: 0, step: 'MAINT' });
    expect(player(r).ticket.stepIndex).toBe(1);
  });

  it('spins the kart through a wrong gate', () => {
    const r = newRace();
    toGo(r);
    setUpAtRow(r, 1, 0, 'other');
    const ev = driveFor(r, 3 / 120);
    // Not crossed yet: no event.
    expect(types(ev)).not.toContain('wrong-gate');
    let all: RaceEvent[] = [];
    let spinAtEvent = -1;
    for (let i = 0; i < 60 && spinAtEvent < 0; i++) {
      const e = stepRace(r, [GAS], 1 / 120);
      all = all.concat(e);
      if (e.some((x) => x.type === 'wrong-gate')) spinAtEvent = player(r).kart.spinTime;
    }
    expect(all).toContainEqual({ type: 'wrong-gate', kartId: 0, op: 'REIMAGE' });
    expect(spinAtEvent).toBeCloseTo(TUNING.wrongGateSpin, 5);
    expect(player(r).ticket.stepIndex).toBe(0);
    expect(player(r).stats.wrongGates).toBe(1);
  });

  it('does nothing in an open lane', () => {
    const r = newRace();
    toGo(r);
    setUpAtRow(r, 0, 0, 'MAINT');
    const row = r.board[0];
    if (!row) throw new Error('row');
    const sorted = [...row.slots].sort((a, b) => a.lateral - b.lateral);
    const [a, b] = sorted;
    if (!a || !b) throw new Error('slots');
    const lane = (a.lateral + a.halfWidth + b.lateral - b.halfWidth) / 2;
    const p = player(r);
    p.kart = { ...spawnKart(track, row.s - 3, lane), speed: 15 };
    p.proj = { s: row.s - 3, lateral: lane };
    const ev = driveFor(r, 0.5);
    expect(types(ev).filter((t) => t === 'step-ok' || t === 'wrong-gate')).toEqual([]);
  });

  it('closes the ticket on its last step, boosts, and issues the next ticket', () => {
    const r = newRace();
    toGo(r);
    setUpAtRow(r, 0, 0, 'MAINT');
    const p = player(r);
    const one = TICKET_TYPES.find((t) => t.id === 'wrong-hostname');
    if (!one) throw new Error('type');
    p.ticket = { ...p.ticket, type: one, stepIndex: 0 };
    const row = r.board[0];
    if (!row?.slots[0]) throw new Error('slot');
    row.slots[0].op = 'META-SYNC';
    const before = p.ticket.number;
    let ev: RaceEvent[] = [];
    let boost = 0;
    for (let i = 0; i < 120; i++) {
      const e = stepRace(r, [GAS], 1 / 120);
      ev = ev.concat(e);
      if (e.some((x) => x.type === 'ticket-closed')) boost = player(r).kart.boostTime;
    }
    const t = types(ev);
    expect(t).toContain('ticket-closed');
    expect(t.indexOf('ticket-issued')).toBeGreaterThan(t.indexOf('ticket-closed'));
    expect(boost).toBeCloseTo(TUNING.ticketCloseBoost, 5);
    expect(player(r).ticket.number).toBe(before + 1);
    expect(player(r).stats.ticketsClosed).toBe(1);
  });

  it('reshuffles the row the player passed', () => {
    const r = newRace();
    toGo(r);
    setUpAtRow(r, 2, 0, 'MAINT');
    const before = JSON.stringify(r.board);
    const ev = driveFor(r, 0.5);
    const shuffle = ev.find((e) => e.type === 'board-reshuffled');
    if (shuffle?.type !== 'board-reshuffled') throw new Error('no board-reshuffled event');
    expect(shuffle.rows).toContain(2);
    // Rows not named in the event did not change.
    const old = JSON.parse(before) as typeof r.board;
    r.board.forEach((row, i) => {
      if (!shuffle.rows.includes(i)) expect(row).toEqual(old[i]);
    });
  });

  it('triggers a gate once when the kart wiggles back and forth over the row', () => {
    const r = newRace();
    toGo(r);
    setUpAtRow(r, 1, 0, 'other', 6);
    let ev = driveFor(r, 0.8);
    expect(types(ev).filter((t) => t === 'wrong-gate')).toHaveLength(1);
    // Back over the row, then forward again.
    const p = player(r);
    const row = r.board[1];
    const sl = row?.slots[0];
    if (!row || !sl) throw new Error('row');
    sl.op = 'REIMAGE';
    p.kart = { ...spawnKart(track, row.s - 2, sl.lateral), speed: 6 };
    p.proj = { s: row.s - 2, lateral: sl.lateral };
    ev = driveFor(r, 1.5);
    expect(types(ev).filter((t) => t === 'wrong-gate')).toHaveLength(0);
  });
});

describe('pit', () => {
  const pitS = HALL.pit.startS + 2;
  const enterPit = (r: Race) => {
    const p = player(r);
    p.kart = { ...spawnKart(track, pitS, HALL.pit.side * (HALL.halfWidth - 1)), speed: 10 };
    p.proj = { s: pitS, lateral: HALL.pit.side * (HALL.halfWidth - 1) };
    // Steer toward the pit side for a moment, then straight.
    const toward: KartInput = { ...GAS, steer: HALL.pit.side * 0.6 };
    const ev = driveFor(r, 0.6, toward);
    return ev.concat(driveFor(r, 0.5, GAS));
  };

  const pit = HALL.pit;
  const lane = pit.side * pit.centerOffset;
  const boxS = pitBoxS(track);
  const diskTicket = (r: Race, stepIndex: number) => {
    const disk = TICKET_TYPES.find((t) => t.id === 'failed-disk');
    if (!disk) throw new Error('type');
    const p = player(r);
    p.ticket = { ...p.ticket, type: disk, stepIndex, deadline: 999 };
    return p;
  };
  const placeInLane = (r: Race, s: number, lateral = lane, speed = 10) => {
    const p = player(r);
    p.kart = { ...spawnKart(track, s, lateral), speed };
    p.proj = { s, lateral };
  };

  it('puts the pit box in the walled section of the lane', () => {
    expect(boxS).toBeGreaterThan(pit.startS + pit.entryLen);
    expect(boxS).toBeLessThan(pit.endS - pit.exitLen);
  });

  it('serves a PIT step at the pit box: hold, event and one advance per ticket', () => {
    const r = newRace();
    toGo(r);
    const p = diskTicket(r, 1);
    placeInLane(r, boxS - 6);
    let held = 0;
    const ev: RaceEvent[] = [];
    for (let i = 0; i < 120 * 2 && held === 0; i++) {
      const e = stepRace(r, [GAS], 1 / 120);
      ev.push(...e);
      if (e.some((x) => x.type === 'pit-service')) held = player(r).kart.holdTime;
    }
    expect(ev).toContainEqual({ type: 'pit-service', kartId: 0, work: 'swap the disk' });
    expect(held).toBeCloseTo(TUNING.pitHold, 5);
    expect(player(r).ticket.stepIndex).toBe(2);
    expect(player(r).pitServedTicket).toBe(p.ticket.number);
  });

  it('does not serve PIT on the first touch of the pit surface at the entry', () => {
    const r = newRace();
    toGo(r);
    diskTicket(r, 1);
    placeInLane(r, pit.startS + 2, pit.side * (pit.centerOffset - pit.halfWidth + 0.5));
    const ev = driveFor(r, 0.4);
    expect(types(ev)).not.toContain('pit-service');
    expect(player(r).ticket.stepIndex).toBe(1);
  });

  it('does not serve PIT on a dip into the exit opening', () => {
    const r = newRace();
    toGo(r);
    diskTicket(r, 1);
    // From the road, steer into the exit opening and back out.
    const s0 = pit.endS - pit.exitLen + 2;
    placeInLane(r, s0, pit.side * (HALL.halfWidth - 1), 12);
    const ev: RaceEvent[] = [];
    let touchedPit = false;
    for (let i = 0; i < 180; i++) {
      const steer = (i < 60 ? 1 : -1) * pit.side * 0.7;
      ev.push(...stepRace(r, [{ ...GAS, steer }], 1 / 120));
      if (surfaceAt(player(r).proj, track) === 'pit') touchedPit = true;
    }
    expect(touchedPit).toBe(true);
    expect(types(ev)).not.toContain('pit-service');
    expect(player(r).ticket.stepIndex).toBe(1);
  });

  it('ignores a respawn while the kart is held in the pit', () => {
    const r = newRace();
    toGo(r);
    diskTicket(r, 1);
    placeInLane(r, boxS - 3);
    driveFor(r, 0.5);
    expect(player(r).kart.holdTime).toBeGreaterThan(0);
    const before = { ...player(r).kart.pos };
    expect(respawn(r, 0)).toEqual([]);
    expect(player(r).kart.pos).toEqual(before);
  });

  it('changes nothing when the next step is not PIT', () => {
    const r = newRace();
    toGo(r);
    const p = player(r);
    const disk = TICKET_TYPES.find((t) => t.id === 'failed-disk');
    if (!disk) throw new Error('type');
    p.ticket = { ...p.ticket, type: disk, stepIndex: 0, deadline: 999 };
    const ev = enterPit(r);
    expect(types(ev)).not.toContain('pit-service');
    expect(player(r).ticket.stepIndex).toBe(0);
    expect(player(r).kart.holdTime).toBe(0);
  });
});

describe('SLA', () => {
  it('pages the kart on breach and issues a new ticket', () => {
    const r = newRace();
    toGo(r);
    const p = player(r);
    p.ticket = { ...p.ticket, deadline: r.time + 0.05 };
    const before = p.ticket.number;
    let slow = 0;
    const ev: RaceEvent[] = [];
    for (let i = 0; i < 30; i++) {
      const e = stepRace(r, [NO_INPUT], 1 / 120);
      ev.push(...e);
      if (e.some((x) => x.type === 'sla-breach')) slow = player(r).kart.slowTime;
    }
    expect(types(ev)).toContain('sla-breach');
    expect(slow).toBeCloseTo(TUNING.slaSlow, 5);
    expect(player(r).ticket.number).toBe(before + 1);
    expect(player(r).stats.slaBreaches).toBe(1);
  });
});

describe('laps', () => {
  function race(laps: 1 | 3, maxSeconds: number) {
    const r = newRace(laps, 3);
    toGo(r);
    const ev: RaceEvent[] = [];
    for (let i = 0; i < maxSeconds / DT && r.phase !== 'finished'; i++) {
      ev.push(...stepRace(r, [scriptedInput(r)], DT));
    }
    return { r, ev };
  }

  it('finishes a 1-lap race with the scripted driver', () => {
    const { r, ev } = race(1, 180);
    expect(types(ev)).toContain('finished');
    expect(r.phase).toBe('finished');
    expect(player(r).finishedAt).not.toBeNull();
  });

  it('emits 3 lap events in a 3-lap race', () => {
    const { ev } = race(3, 500);
    expect(types(ev).filter((t) => t === 'lap')).toHaveLength(3);
  });
});

describe('frame spikes', () => {
  it('clamps a 2 s frame to 0.1 s', () => {
    const r = newRace();
    toGo(r);
    const t0 = r.time;
    stepRace(r, [GAS], 2.0);
    expect(r.time - t0).toBeCloseTo(0.1, 6);
  });

  it('still triggers a gate crossed inside one big step', () => {
    const r = newRace();
    toGo(r);
    setUpAtRow(r, 0, 0, 'MAINT', 24);
    const p = player(r);
    const row = r.board[0];
    const sl = row?.slots[0];
    if (!row || !sl) throw new Error('row');
    p.kart = { ...spawnKart(track, row.s - 1, sl.lateral), speed: 24 };
    p.proj = { s: row.s - 1, lateral: sl.lateral };
    const ev = stepRace(r, [GAS], 2.0);
    expect(ev).toContainEqual({ type: 'step-ok', kartId: 0, step: 'MAINT' });
  });
});

describe('respawn', () => {
  it('puts the kart on the centerline at its s, at rest, held', () => {
    const r = newRace();
    toGo(r);
    const p = player(r);
    p.kart = { ...spawnKart(track, 300, 11), speed: 12 };
    p.proj = track.project(p.kart.pos, 300);
    const s = p.proj.s;
    const ev = respawn(r, 0);
    expect(ev).toEqual([{ type: 'respawn', kartId: 0 }]);
    const q = track.project(player(r).kart.pos, s);
    expect(q.s).toBeCloseTo(s, 1);
    expect(q.lateral).toBeCloseTo(0, 3);
    expect(player(r).kart.speed).toBe(0);
    expect(player(r).kart.holdTime).toBe(TUNING.respawnHold);
  });

  it('respawns after too long off-road', () => {
    const r = newRace();
    toGo(r);
    const p = player(r);
    const lat = -(HALL.halfWidth + 2);
    p.kart = spawnKart(track, 300, lat);
    p.proj = track.project(p.kart.pos, 300);
    const ev = driveFor(r, TUNING.offroadRespawn + 0.2, NO_INPUT);
    expect(types(ev)).toContain('respawn');
  });

  it('respawns when stuck under throttle', () => {
    const r = newRace();
    toGo(r);
    const p = player(r);
    p.kart = spawnKart(track, 300, 0);
    p.proj = track.project(p.kart.pos, 300);
    // Something holds the kart at rest (walls deflect, so pin it by hand).
    const ev: RaceEvent[] = [];
    for (let i = 0; i < (TUNING.stuckRespawn + 0.3) * 120; i++) {
      player(r).kart.speed = 0;
      ev.push(...stepRace(r, [GAS], 1 / 120));
    }
    expect(types(ev)).toContain('respawn');
    expect(player(r).offroadTime).toBe(0);
  });
});

describe('grid', () => {
  const slots = Array.from({ length: 8 }, (_, i) => gridSlot(i, track));

  it('puts all 8 slots after the line, inside gridS..gridS+40', () => {
    for (const sl of slots) {
      expect(sl.s).toBeGreaterThan(HALL.gridS);
      expect(sl.s).toBeLessThanOrEqual(HALL.gridS + 40);
      expect(Math.abs(sl.lateral)).toBeLessThan(HALL.halfWidth - TUNING.kartRadius);
    }
  });

  it('puts the slots 2 abreast, with no two karts overlapping', () => {
    expect(new Set(slots.map((sl) => sl.lateral)).size).toBe(2);
    const pos = slots.map((sl) => spawnKart(track, sl.s, sl.lateral).pos);
    pos.forEach((a, i) =>
      pos.slice(i + 1).forEach((b) => expect(dist(a, b)).toBeGreaterThan(2 * TUNING.kartRadius)),
    );
  });

  it('starts 8 karts on the grid with 7 bots', () => {
    const r = newRace(1, 1, 7);
    expect(r.karts).toHaveLength(8);
    expect(r.karts.map((k) => k.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const k of r.karts) expect(k.proj.s).toBeGreaterThan(HALL.gridS);
  });
});

describe('standings', () => {
  it('ranks a kart that backs over the line behind one that did not (issue #1)', () => {
    const r = newRace(3, 1, 1);
    toGo(r);
    const [a, b] = r.karts;
    if (!a || !b) throw new Error('karts');
    // Both start just after the line. a reverses over it; b drives forward.
    a.kart = spawnKart(track, 3, 3);
    a.proj = { s: 3, lateral: 3 };
    b.kart = spawnKart(track, 2, -3);
    b.proj = { s: 2, lateral: -3 };
    for (let i = 0; i < 300; i++) {
      stepRace(r, [{ ...NO_INPUT, brake: 1 }, GAS], 1 / 120);
    }
    expect(a.lap.sector).toBeLessThan(0);
    expect(standings(r)).toEqual([1, 0]);
  });

  it('orders unfinished karts by progress', () => {
    const r = newRace(3, 1, 2);
    const [a, b, c] = r.karts;
    if (!a || !b || !c) throw new Error('karts');
    a.lap = { ...a.lap, completed: 1 };
    b.lap = { ...b.lap, completed: 2 };
    c.lap = { ...c.lap, completed: 1 };
    a.proj = { s: 100, lateral: 0 };
    c.proj = { s: 200, lateral: 0 };
    expect(standings(r)).toEqual([1, 2, 0]);
  });

  it('puts finished karts first, by finishedAt', () => {
    const r = newRace(3, 1, 3);
    const [a, b, c, d] = r.karts;
    if (!a || !b || !c || !d) throw new Error('karts');
    c.finishedAt = 90;
    a.finishedAt = 95;
    // b has more progress, but it has not finished.
    b.lap = { ...b.lap, completed: 3 };
    b.proj = { s: 300, lateral: 0 };
    expect(standings(r)).toEqual([2, 0, 1, 3]);
  });
});

describe('kart contact', () => {
  it('stops a kart closing at 40 m/s from passing through the kart ahead', () => {
    const r = newRace(1, 1, 1);
    toGo(r);
    const [a, b] = r.karts;
    if (!a || !b) throw new Error('karts');
    // The loading-dock straight, after the grid.
    a.kart = { ...spawnKart(track, 60, 0), speed: 40 };
    a.proj = { s: 60, lateral: 0 };
    b.kart = spawnKart(track, 66, 0.2);
    b.proj = { s: 66, lateral: 0.2 };
    let minGap = Infinity;
    for (let i = 0; i < 120; i++) {
      stepRace(r, [GAS, NO_INPUT], 1 / 120);
      minGap = Math.min(minGap, dist(a.kart.pos, b.kart.pos));
      expect(forwardDelta(a.proj.s, b.proj.s, track.length)).toBeGreaterThan(0);
    }
    expect(minGap).toBeGreaterThan(2 * TUNING.kartRadius - 0.5);
    expect(b.kart.speed).toBeGreaterThan(0);
  });

  it('separates two karts placed on top of each other within one step', () => {
    const r = newRace(1, 1, 1);
    toGo(r);
    const [a, b] = r.karts;
    if (!a || !b) throw new Error('karts');
    a.kart = spawnKart(track, 80, 0);
    a.proj = { s: 80, lateral: 0 };
    b.kart = spawnKart(track, 80.3, 0.1);
    b.proj = { s: 80.3, lateral: 0.1 };
    stepRace(r, [NO_INPUT, NO_INPUT], 1 / 120);
    expect(dist(a.kart.pos, b.kart.pos)).toBeGreaterThanOrEqual(2 * TUNING.kartRadius - 1e-6);
  });
});

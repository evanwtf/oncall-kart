import { describe, expect, it } from 'vitest';
import { ITEM_KINDS, rollItem, useItem, type ItemKind } from '../src/logic/items';
import { NO_INPUT, spawnKart, type KartInput } from '../src/logic/kart';
import {
  createRace,
  stepRace,
  type KartRuntime,
  type Race,
  type RaceEvent,
} from '../src/logic/race';
import { makeRng } from '../src/logic/rng';
import { TICKET_TYPES } from '../src/logic/runbooks';
import { buildTrack, forwardDelta } from '../src/logic/track';
import { HALL } from '../src/logic/tracks/hall';
import { TUNING } from '../src/logic/tuning';

const track = buildTrack(HALL);
const STEP = 1 / 120;

/** A race at 'go' with `bots` bots that do not move unless a test moves them. */
function racing(bots = 0): Race {
  const r = createRace({ laps: 3, seed: 1, driverColor: 0, bots }, track);
  while (r.phase === 'countdown') stepRace(r, [NO_INPUT], 1 / 60);
  return r;
}

function kartOf(r: Race, id: number): KartRuntime {
  const k = r.karts[id];
  if (!k) throw new Error(`no kart ${id}`);
  return k;
}

function place(k: KartRuntime, s: number, lateral: number, speed = 0) {
  k.kart = { ...spawnKart(track, s, lateral), speed };
  k.proj = { s, lateral };
}

function run(r: Race, seconds: number, inputs: KartInput[] = [NO_INPUT]): RaceEvent[] {
  const out: RaceEvent[] = [];
  for (let i = 0; i < Math.round(seconds / STEP); i++) out.push(...stepRace(r, inputs, STEP));
  return out;
}

describe('item boxes', () => {
  it('starts with 4 boxes per item-box row', () => {
    const r = racing();
    expect(r.boxes).toHaveLength(4 * (HALL.itemBoxRows ?? []).length);
  });

  it('gives an item inside the pickup radius, and the box respawns after boxRespawn', () => {
    const r = racing();
    const p = kartOf(r, 0);
    const box = r.boxes[0];
    if (!box) throw new Error('box');
    place(p, box.s - 0.5, box.lateral);
    const ev = run(r, STEP);
    expect(p.item).not.toBeNull();
    expect(ev).toContainEqual({ type: 'item-picked', kartId: 0, item: p.item });
    expect(box.respawnAt).toBeCloseTo(r.time + TUNING.boxRespawn, 6);
    // The box is gone until it respawns.
    p.item = null;
    run(r, TUNING.boxRespawn - 0.1);
    expect(p.item).toBeNull();
    run(r, 0.2);
    expect(p.item).not.toBeNull();
  });

  it('gives nothing outside the radius', () => {
    const r = racing();
    const p = kartOf(r, 0);
    const box = r.boxes[0];
    if (!box) throw new Error('box');
    place(p, box.s, box.lateral + TUNING.boxRadius + 0.2);
    run(r, STEP);
    expect(p.item).toBeNull();
  });

  it('gives nothing to a kart that holds an item, and the box stays', () => {
    const r = racing();
    const p = kartOf(r, 0);
    const box = r.boxes[0];
    if (!box) throw new Error('box');
    p.item = 'coffee';
    place(p, box.s, box.lateral);
    run(r, STEP);
    expect(p.item).toBe('coffee');
    expect(box.respawnAt).toBe(0);
  });

  it('gives an item for a closed ticket when the kart holds none', () => {
    const r = racing();
    const p = kartOf(r, 0);
    const row = r.board[0];
    const slot = row?.slots[0];
    const one = TICKET_TYPES.find((t) => t.id === 'wrong-hostname');
    if (!row || !slot || !one) throw new Error('setup');
    slot.op = 'META-SYNC';
    p.ticket = { ...p.ticket, type: one, stepIndex: 0, deadline: 999 };
    place(p, row.s - 1, slot.lateral, 15);
    const ev = run(r, 0.2, [{ ...NO_INPUT, throttle: 1 }]);
    expect(ev.map((e) => e.type)).toContain('ticket-closed');
    expect(p.item).not.toBeNull();
  });
});

describe('rollItem', () => {
  const counts = (place: number) => {
    const rng = makeRng(99);
    const c: Record<ItemKind, number> = { coffee: 0, rollback: 0, firewall: 0, page: 0, spill: 0 };
    for (let i = 0; i < 1000; i++) c[rollItem(rng, place, 8)]++;
    return c;
  };

  it('gives every kind', () => {
    for (const kind of ITEM_KINDS) expect(counts(4)[kind]).toBeGreaterThan(0);
  });

  it('gives trailing karts more coffee and page, leaders more firewall and spill', () => {
    const first = counts(1);
    const last = counts(8);
    expect(last.coffee).toBeGreaterThan(first.coffee + 50);
    expect(last.page).toBeGreaterThan(first.page + 50);
    expect(first.firewall).toBeGreaterThan(last.firewall + 50);
    expect(first.spill).toBeGreaterThan(last.spill + 50);
  });
});

describe('item effects', () => {
  it('Coffee adds boost time', () => {
    const r = racing();
    const p = kartOf(r, 0);
    p.item = 'coffee';
    p.kart = { ...p.kart, boostTime: 0.5 };
    expect(useItem(r, 0)).toEqual([{ type: 'item-used', kartId: 0, item: 'coffee' }]);
    expect(p.kart.boostTime).toBeCloseTo(0.5 + TUNING.coffeeBoost, 9);
    expect(p.item).toBeNull();
  });

  it('Rollback arms; Firewall raises the shield', () => {
    const r = racing();
    const p = kartOf(r, 0);
    p.item = 'rollback';
    useItem(r, 0);
    expect(p.rollbackArmed).toBe(true);
    p.item = 'firewall';
    useItem(r, 0);
    expect(p.shieldTime).toBe(TUNING.shieldTime);
  });

  it('does nothing without an item', () => {
    const r = racing();
    expect(useItem(r, 0)).toEqual([]);
  });

  it('the shield wears off after shieldTime', () => {
    const r = racing();
    const p = kartOf(r, 0);
    p.item = 'firewall';
    useItem(r, 0);
    run(r, TUNING.shieldTime + 0.05);
    expect(p.shieldTime).toBe(0);
  });

  it('Spill drops a puddle spillOffset m behind the thrower', () => {
    const r = racing();
    const p = kartOf(r, 0);
    place(p, 300, 2);
    p.item = 'spill';
    useItem(r, 0);
    expect(r.puddles).toHaveLength(1);
    const pd = r.puddles[0];
    expect(pd?.s).toBeCloseTo(300 - TUNING.spillOffset, 6);
    expect(pd?.lateral).toBe(2);
    expect(pd?.ownerId).toBe(0);
  });

  it('uses the item on the press of the item input, once per press', () => {
    const r = racing();
    const p = kartOf(r, 0);
    place(p, 300, 0);
    p.item = 'coffee';
    const press: KartInput = { ...NO_INPUT, item: true };
    let ev = run(r, STEP, [press]);
    expect(ev).toContainEqual({ type: 'item-used', kartId: 0, item: 'coffee' });
    p.item = 'rollback';
    run(r, 0.2, [press]); // still held: no new use
    expect(p.item).toBe('rollback');
    run(r, STEP, [NO_INPUT]);
    ev = run(r, STEP, [press]);
    expect(ev).toContainEqual({ type: 'item-used', kartId: 0, item: 'rollback' });
  });
});

describe('Page', () => {
  it('homes on the next kart ahead and hits only that kart', () => {
    const r = racing(3);
    const [p, a, b, c] = [0, 1, 2, 3].map((id) => kartOf(r, id)) as [
      KartRuntime,
      KartRuntime,
      KartRuntime,
      KartRuntime,
    ];
    // Bots stay where they are.
    const hold = () => {
      for (const k of [a, b, c]) k.kart = { ...k.kart, holdTime: 1 };
    };
    for (const k of [p, a, c]) k.lap = { ...k.lap, completed: 1 };
    place(p, 300, 0);
    place(b, 320, 0); // a lap down: on the road ahead of the player, but behind in the race
    place(a, 340, 0); // the next kart ahead in the race: the target
    place(c, 400, 0);
    hold();
    p.item = 'page';
    const used = useItem(r, 0);
    expect(used).toContainEqual({ type: 'item-used', kartId: 0, item: 'page' });
    expect(r.projectiles).toHaveLength(1);
    expect(r.projectiles[0]?.targetId).toBe(1);
    const ev: RaceEvent[] = [];
    for (let i = 0; i < 4 * 120 && r.projectiles.length > 0; i++) {
      hold();
      ev.push(...stepRace(r, [NO_INPUT], STEP));
    }
    const hits = ev.filter((e) => e.type === 'hit');
    expect(hits).toEqual([{ type: 'hit', kartId: 1, kind: 'page', outcome: 'spun', byId: 0 }]);
    expect(r.projectiles).toHaveLength(0);
  });

  it('with no target (the thrower leads), flies forward and expires after pageLife (Review Focus 2)', () => {
    const r = racing(1);
    const p = kartOf(r, 0);
    const bot = kartOf(r, 1);
    place(p, 300, 0);
    place(bot, 250, 0);
    bot.kart = { ...bot.kart, holdTime: 99 };
    p.kart = { ...p.kart, holdTime: 99 };
    p.item = 'page';
    useItem(r, 0);
    const pg = r.projectiles[0];
    expect(pg?.targetId).toBeNull();
    const ev = run(r, 1);
    expect(r.projectiles[0]?.s ?? 0).toBeGreaterThan(300 + TUNING.pageSpeed * 0.9);
    ev.push(...run(r, TUNING.pageLife));
    expect(r.projectiles).toHaveLength(0);
    expect(ev.filter((e) => e.type === 'hit')).toEqual([]);
    // A long-lived Page with no target laps the hall: it passes its thrower
    // and the bot, and hits neither.
    p.item = 'page';
    useItem(r, 0);
    const long = r.projectiles[0];
    if (!long) throw new Error('page');
    long.life = (1.5 * track.length) / TUNING.pageSpeed;
    const lap = run(r, long.life + 0.1);
    expect(lap.filter((e) => e.type === 'hit')).toEqual([]);
    expect(r.projectiles).toHaveLength(0);
  });

  it('has no target when the kart ahead finished', () => {
    const r = racing(1);
    const p = kartOf(r, 0);
    const bot = kartOf(r, 1);
    bot.finishedAt = 10;
    place(p, 300, 0);
    p.item = 'page';
    useItem(r, 0);
    expect(r.projectiles[0]?.targetId).toBeNull();
  });
});

describe('Page lateral gap', () => {
  it('misses a target more than pageHitGap across, and hits one inside it', () => {
    for (const [gap, hits] of [
      [TUNING.pageHitGap + 0.5, 0],
      [TUNING.pageHitGap - 0.5, 1],
    ] as const) {
      const r = racing(1);
      const p = kartOf(r, 0);
      const bot = kartOf(r, 1);
      // The thrower sits well aside, so no kart contact moves the target.
      place(p, 290, -6);
      place(bot, 300.5, 2);
      bot.kart = { ...bot.kart, holdTime: 99 };
      bot.lap = { ...bot.lap, completed: 1 };
      p.kart = { ...p.kart, holdTime: 99 };
      r.projectiles.push({
        id: 50,
        ownerId: 0,
        targetId: 1,
        s: 299.9,
        lateral: bot.proj.lateral + gap,
        speed: TUNING.pageSpeed,
        life: 2,
      });
      // One substep: no time to home in.
      const ev = run(r, STEP).filter((e) => e.type === 'hit');
      expect(ev).toHaveLength(hits);
    }
  });
});

describe('puddles', () => {
  it('spins a kart that drives into one, then disappears', () => {
    const r = racing();
    const p = kartOf(r, 0);
    r.puddles.push({ id: 99, ownerId: 1, s: 305, lateral: 0, life: 20 });
    place(p, 300, 0, 15);
    const ev = run(r, 1, [{ ...NO_INPUT, throttle: 1 }]);
    expect(ev).toContainEqual({ type: 'hit', kartId: 0, kind: 'spill', outcome: 'spun', byId: 1 });
    expect(r.puddles).toHaveLength(0);
  });

  it('dries up after spillLife', () => {
    const r = racing();
    r.puddles.push({ id: 99, ownerId: 0, s: 500, lateral: 0, life: 1 });
    run(r, 1.05);
    expect(r.puddles).toHaveLength(0);
  });

  it('meets the Firewall first, and a second hit in the same substep then spins (Review Focus 1)', () => {
    const r = racing();
    const p = kartOf(r, 0);
    place(p, 300, 0);
    p.kart = { ...p.kart, holdTime: 1 };
    p.shieldTime = 3;
    // Two puddles under the kart: both reach it in one substep.
    r.puddles.push({ id: 98, ownerId: 1, s: 300, lateral: 0.2, life: 20 });
    r.puddles.push({ id: 99, ownerId: 1, s: 300.3, lateral: -0.2, life: 20 });
    const ev = run(r, STEP).filter((e) => e.type === 'hit');
    expect(ev.map((e) => (e.type === 'hit' ? e.outcome : ''))).toEqual(['blocked', 'spun']);
    expect(r.puddles).toHaveLength(0);
    expect(p.shieldTime).toBe(0);
  });
});

describe('bots and items', () => {
  it('a bot uses its item after its itemDelay', () => {
    const r = racing(1);
    const bot = kartOf(r, 1);
    place(bot, 300, 0, 15);
    bot.item = 'coffee';
    bot.itemAt = r.time;
    const ev = run(r, 5);
    expect(ev).toContainEqual({ type: 'item-used', kartId: 1, item: 'coffee' });
    expect(forwardDelta(300, bot.proj.s, track.length)).toBeGreaterThan(0);
  });
});

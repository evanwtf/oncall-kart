import { describe, expect, it } from 'vitest';
import { BOT_PROFILES, botInput } from '../src/logic/bot';
import { NO_INPUT, spawnKart, surfaceAt } from '../src/logic/kart';
import {
  createRace,
  pitBoxS,
  standings,
  stepRace,
  type Race,
  type RaceEvent,
} from '../src/logic/race';
import { TICKET_TYPES } from '../src/logic/runbooks';
import { buildTrack } from '../src/logic/track';
import { HALL } from '../src/logic/tracks/hall';
import { TUNING } from '../src/logic/tuning';

const track = buildTrack(HALL);

function botRace(laps: 1 | 3 | 10, seed: number, driverColor = 0): Race {
  return createRace({ laps, seed, driverColor, bots: 7 }, track);
}

const allBotsDone = (r: Race) => r.karts.every((k) => k.id === r.playerId || k.finishedAt !== null);

/** Run a race with an idle player until every bot finishes or the time runs out. */
function runBots(r: Race, maxSeconds: number, dt = 1 / 120): RaceEvent[] {
  const events: RaceEvent[] = [];
  const frames = Math.ceil((maxSeconds + TUNING.countdown) / dt);
  for (let i = 0; i < frames && !allBotsDone(r); i++) {
    events.push(...stepRace(r, [NO_INPUT], dt));
  }
  return events;
}

const botOrder = (r: Race) => standings(r).filter((id) => id !== r.playerId);

describe('bot profiles', () => {
  it('has 7 profiles from strong to weak', () => {
    expect(BOT_PROFILES).toHaveLength(7);
    for (let i = 1; i < BOT_PROFILES.length; i++) {
      const a = BOT_PROFILES[i - 1];
      const b = BOT_PROFILES[i];
      if (!a || !b) throw new Error('profile');
      expect(b.topSpeedScale).toBeLessThanOrEqual(a.topSpeedScale);
      expect(b.wrongLaneChance).toBeGreaterThanOrEqual(a.wrongLaneChance);
      expect(b.lineNoise).toBeGreaterThanOrEqual(a.lineNoise);
    }
  });
});

describe('bot drivers', () => {
  it('gives each bot a distinct driver, never the player one', () => {
    for (let color = 0; color < 8; color++) {
      const r = botRace(1, 1, color);
      const drivers = r.karts.map((k) => k.driverIndex);
      expect(new Set(drivers).size).toBe(8);
      expect(r.karts[0]?.driverIndex).toBe(color);
      expect(r.karts[0]?.isBot).toBe(false);
      expect(r.karts.slice(1).every((k) => k.isBot)).toBe(true);
    }
  });

  it('starts with no bots when bots is 0', () => {
    expect(createRace({ laps: 1, seed: 1, driverColor: 0, bots: 0 }, track).karts).toHaveLength(1);
  });
});

describe('botInput', () => {
  it('is a pure function of the race state', () => {
    const r = botRace(3, 5);
    runBots(r, 8);
    const before = JSON.stringify(r);
    const a = botInput(r, 3);
    const b = botInput(r, 3);
    expect(a).toEqual(b);
    expect(JSON.stringify(r)).toBe(before);
  });
});

describe('a race of 7 bots', () => {
  const r = botRace(3, 11);
  const events = runBots(r, 3 * 70);
  const bots = r.karts.filter((k) => k.isBot);

  it('finishes: every bot completes 3 laps within 3 x 70 s', () => {
    for (const k of bots) {
      expect(k.lap.completed).toBe(3);
      expect(k.finishedAt).not.toBeNull();
      expect(k.finishedAt as number).toBeLessThan(3 * 70);
    }
    expect(events.filter((e) => e.type === 'finished')).toHaveLength(7);
  });

  // A kart makes at most one step per gate row, and a row carries the needed
  // op only about 2 times in 5. So about 2 steps a lap is the ceiling on this
  // board, and a ticket has about 3.7 steps: 1 ticket per lap is out of reach.
  it('makes steady progress: at least 1.5 steps and 0.3 tickets per lap', () => {
    const steps = events.filter((e) => e.type === 'step-ok' && e.kartId !== 0).length;
    const closed = bots.reduce((n, k) => n + k.stats.ticketsClosed, 0);
    expect(steps / (bots.length * 3)).toBeGreaterThanOrEqual(1.5);
    expect(closed / (bots.length * 3)).toBeGreaterThanOrEqual(0.3);
  });

  it('keeps the rubber band inside its bounds', () => {
    for (const k of bots) {
      expect(k.speedScale).toBeGreaterThanOrEqual(TUNING.rubberBand.min);
      expect(k.speedScale).toBeLessThanOrEqual(TUNING.rubberBand.max);
    }
  });

  it('gives the same finishing order for the same seed', () => {
    const again = botRace(3, 11);
    runBots(again, 3 * 70);
    expect(botOrder(again)).toEqual(botOrder(r));
  });
});

describe('bot mistakes', () => {
  it('makes some wrong gates, and the strongest bot fewer than the weakest', () => {
    const wrong = new Array<number>(8).fill(0);
    for (const seed of [21, 22]) {
      const r = botRace(10, seed);
      runBots(r, 10 * 70);
      for (const k of r.karts) wrong[k.id] = (wrong[k.id] ?? 0) + k.stats.wrongGates;
    }
    const total = wrong.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    // Bot 1 holds the strongest profile, bot 7 the weakest.
    expect(wrong[1] as number).toBeLessThan(wrong[7] as number);
    // Two 10-lap races: about 4 s here, slower on the shared CI runner.
  }, 60_000);
});

describe('bots and the pit (Review Focus 4)', () => {
  it('takes the pit lane, is served at the pit box, and leaves the pit', () => {
    const r = botRace(3, 4);
    runBots(r, 0.1);
    const bot = r.karts[2];
    const disk = TICKET_TYPES.find((t) => t.id === 'failed-disk');
    if (!bot || !disk) throw new Error('setup');
    // Only this bot races: park the others off the line.
    for (const k of r.karts) if (k !== bot) k.finishedAt = 0;
    bot.ticket = { ...bot.ticket, type: disk, stepIndex: 1, deadline: 999 };
    bot.kart = { ...spawnKart(track, 690, 0), speed: 15 };
    bot.proj = { s: 690, lateral: 0 };
    bot.lap = { ...bot.lap, sector: 3 };
    const events: RaceEvent[] = [];
    let inPitLane = 0;
    let servedAt: number | null = null;
    let exitAt: number | null = null;
    const exitOpening = HALL.pit.endS - HALL.pit.exitLen;
    const surfacesAfterBox = new Set<string>();
    for (let i = 0; i < 20 * 120; i++) {
      const ev = stepRace(r, [NO_INPUT], 1 / 120);
      events.push(...ev);
      if (ev.some((e) => e.type === 'pit-service' && e.kartId === 2)) servedAt = r.time;
      const surface = surfaceAt(bot.proj, track);
      if (surface === 'pit') inPitLane += 1 / 120;
      if (servedAt !== null && exitAt === null) {
        if (bot.proj.s >= exitOpening) exitAt = r.time;
        else surfacesAfterBox.add(surface);
      }
      if (bot.proj.s > HALL.pit.endS + 40 && bot.proj.s < 300) break;
    }
    // From the box to the exit opening: in the lane all the way (the hold
    // included), never on the divider or off the road.
    expect(servedAt).not.toBeNull();
    expect(exitAt).not.toBeNull();
    expect((exitAt as number) - (servedAt as number)).toBeLessThan(4);
    expect([...surfacesAfterBox]).toEqual(['pit']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'pit-service', kartId: 2 }));
    expect(bot.ticket.stepIndex).toBe(2);
    // It left the pit lane and drives on, with no respawn.
    expect(surfaceAt(bot.proj, track)).toBe('road');
    expect(bot.proj.s).toBeGreaterThan(HALL.pit.endS + 40);
    expect(events.filter((e) => e.type === 'respawn' && e.kartId === 2)).toHaveLength(0);
    // One pass through the lane: about its length at the pit speed limit, plus the hold.
    expect(inPitLane).toBeLessThan(15);
    expect(pitBoxS(track)).toBeGreaterThan(HALL.pit.startS);
  });

  it('respawns a bot that is stuck for TUNING.stuckRespawn s', () => {
    const r = botRace(3, 4);
    runBots(r, 0.1);
    const bot = r.karts[3];
    if (!bot) throw new Error('bot');
    bot.kart = spawnKart(track, 300, 0);
    bot.proj = track.project(bot.kart.pos, 300);
    const events: RaceEvent[] = [];
    for (let i = 0; i < (TUNING.stuckRespawn + 0.3) * 120; i++) {
      bot.kart.speed = 0;
      events.push(...stepRace(r, [NO_INPUT], 1 / 120));
    }
    expect(events).toContainEqual({ type: 'respawn', kartId: 3 });
  });
});

describe('bots and hazards', () => {
  it('a bot steers round a cable patch in its home lane', () => {
    const r = botRace(3, 4);
    runBots(r, 0.1);
    // Bot 3's home lane is 0.3 road half-widths right: inside the first patch.
    const bot = r.karts[3];
    const cable = (HALL.hazards ?? []).find((h) => h.kind === 'cable');
    if (!bot || !cable) throw new Error('setup');
    for (const k of r.karts) if (k !== bot) k.finishedAt = 0;
    bot.ticket = { ...bot.ticket, deadline: 999 };
    bot.kart = { ...spawnKart(track, cable.s - 45, cable.lateral), speed: 18 };
    bot.proj = { s: cable.s - 45, lateral: cable.lateral };
    expect(Math.abs(-0.3 * HALL.halfWidth - cable.lateral)).toBeLessThan(cable.width / 2);
    const events = runBots(r, 4);
    expect(bot.proj.s).toBeGreaterThan(cable.s + cable.length);
    expect(events.filter((e) => e.type === 'hit' && e.kind === 'cable')).toEqual([]);
  });
});

describe('determinism across frame rates (Review Focus 5)', () => {
  it('gives the same finishing order at 30 fps and at 144 fps', () => {
    const a = botRace(1, 31);
    runBots(a, 80, 1 / 30);
    const b = botRace(1, 31);
    runBots(b, 80, 1 / 144);
    expect(allBotsDone(a)).toBe(true);
    expect(botOrder(b)).toEqual(botOrder(a));
    expect(b.karts.map((k) => k.finishedAt)).toEqual(a.karts.map((k) => k.finishedAt));
  });
});

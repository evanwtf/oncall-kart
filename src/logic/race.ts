import { createBoard, reshuffleAfterPass, slotAt, type Board } from './board';
import {
  constrainToTrack,
  NO_INPUT,
  spawnKart,
  stepKart,
  surfaceAt,
  type KartInput,
  type KartState,
} from './kart';
import { lapStart, lapUpdate, type LapState } from './lap';
import type { Op, Step } from './ops';
import { makeRng, type Rng } from './rng';
import { applyStep, issueTicket, nextStep, type Ticket } from './ticket';
import { crossedForward, type Projection, type Track } from './track';
import { TUNING } from './tuning';

export type LapCount = 1 | 3 | 10;

export interface RaceConfig {
  laps: LapCount;
  seed: number;
  driverColor: number;
}

export interface KartStats {
  ticketsClosed: number;
  wrongGates: number;
  slaBreaches: number;
}

export interface KartRuntime {
  id: number;
  kart: KartState;
  proj: Projection;
  lap: LapState;
  ticket: Ticket;
  stats: KartStats;
  finishedAt: number | null;
  /** Number of the ticket whose PIT step this kart had served. */
  pitServedTicket: number | null;
  offroadTime: number;
  stuckTime: number;
  /** Last gate row this kart triggered: a row triggers once per pass. */
  lastGateRow: number | null;
}

export type RaceEvent =
  | { type: 'step-ok'; kartId: number; step: Step }
  | { type: 'ticket-closed'; kartId: number; ticket: Ticket }
  | { type: 'ticket-issued'; kartId: number; ticket: Ticket }
  | { type: 'wrong-gate'; kartId: number; op: Op }
  | { type: 'sla-breach'; kartId: number; ticket: Ticket }
  | { type: 'pit-service'; kartId: number; work: string }
  | { type: 'lap'; kartId: number; completed: number; lapTime: number }
  | { type: 'board-reshuffled'; rows: number[] }
  | { type: 'respawn'; kartId: number }
  | { type: 'go' }
  | { type: 'finished'; kartId: number; time: number };

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface Race {
  config: RaceConfig;
  track: Track;
  board: Board;
  rng: Rng;
  /** Race clock in seconds. It starts at 0 on 'go'. */
  time: number;
  countdown: number;
  phase: RacePhase;
  karts: KartRuntime[];
  playerId: 0;
  nextTicketNumber: number;
}

/** Grid slot i: two columns, rows 6 m apart, behind the grid line. */
function gridSlot(track: Track, i: number): Projection {
  const row = Math.floor(i / 2);
  const s = track.def.gridS - row * 6;
  const lateral = track.def.halfWidth * 0.35 * (i % 2 === 0 ? 1 : -1);
  return { s: ((s % track.length) + track.length) % track.length, lateral: i === 0 ? 0 : lateral };
}

export function createRace(config: RaceConfig, track: Track): Race {
  const rng = makeRng(config.seed);
  const board = createBoard(rng, track);
  const kartCount = 1; // phase 2 adds bots
  let nextTicketNumber = 1;
  const karts: KartRuntime[] = [];
  for (let id = 0; id < kartCount; id++) {
    const slot = gridSlot(track, id);
    karts.push({
      id,
      kart: spawnKart(track, slot.s, slot.lateral),
      proj: slot,
      lap: lapStart(0),
      ticket: issueTicket(rng, nextTicketNumber++, 0),
      stats: { ticketsClosed: 0, wrongGates: 0, slaBreaches: 0 },
      finishedAt: null,
      pitServedTicket: null,
      offroadTime: 0,
      stuckTime: 0,
      lastGateRow: null,
    });
  }
  return {
    config,
    track,
    board,
    rng,
    time: 0,
    countdown: TUNING.countdown,
    phase: 'countdown',
    karts,
    playerId: 0,
    nextTicketNumber,
  };
}

function newTicket(race: Race, k: KartRuntime, events: RaceEvent[]): void {
  k.ticket = issueTicket(race.rng, race.nextTicketNumber++, race.time);
  events.push({ type: 'ticket-issued', kartId: k.id, ticket: k.ticket });
}

/** Apply a step to the kart's ticket and emit what happened. */
function doStep(race: Race, k: KartRuntime, step: Step, events: RaceEvent[]): void {
  const { ticket, result } = applyStep(k.ticket, step);
  if (result === 'wrong') return;
  k.ticket = ticket;
  events.push({ type: 'step-ok', kartId: k.id, step });
  if (result === 'closed') {
    k.stats.ticketsClosed++;
    k.kart = { ...k.kart, boostTime: Math.max(k.kart.boostTime, TUNING.ticketCloseBoost) };
    events.push({ type: 'ticket-closed', kartId: k.id, ticket });
    newTicket(race, k, events);
  }
}

/** s of the pit box: the middle of the walled section of the pit lane. */
export function pitBoxS(track: Track): number {
  const { pit } = track.def;
  return (pit.startS + pit.entryLen + pit.endS - pit.exitLen) / 2;
}

export function respawn(race: Race, kartId: number): RaceEvent[] {
  const k = race.karts[kartId];
  // A held kart (pit work, a respawn in progress) cannot respawn: no skipping the pit.
  if (!k || k.kart.holdTime > 0) return [];
  k.kart = { ...spawnKart(race.track, k.proj.s, 0), holdTime: TUNING.respawnHold };
  k.proj = { s: k.proj.s, lateral: 0 };
  k.offroadTime = 0;
  k.stuckTime = 0;
  return [{ type: 'respawn', kartId }];
}

function substep(race: Race, inputs: readonly KartInput[], h: number, events: RaceEvent[]): void {
  race.time += h;
  const { track } = race;
  for (const k of race.karts) {
    const input = (k.finishedAt === null ? inputs[k.id] : undefined) ?? NO_INPUT;
    const prev = k.proj;
    const prevSurface = surfaceAt(prev, track);

    let kart = stepKart(k.kart, input, h, prevSurface);
    let proj = track.project(kart.pos, prev.s);
    const constrained = constrainToTrack(kart, proj, track);
    if (constrained !== kart) {
      kart = constrained;
      proj = track.project(kart.pos, prev.s);
    }
    k.kart = kart;
    k.proj = proj;
    const surface = surfaceAt(proj, track);

    // Laps.
    const lap = lapUpdate(k.lap, prev.s, proj.s, track, race.time);
    if (lap.completedLap) {
      const lapTime = race.time - k.lap.lapStartTime;
      events.push({ type: 'lap', kartId: k.id, completed: lap.state.completed, lapTime });
      if (lap.state.completed >= race.config.laps && k.finishedAt === null) {
        k.finishedAt = race.time;
        events.push({ type: 'finished', kartId: k.id, time: race.time });
        if (k.id === race.playerId) race.phase = 'finished';
      }
    }
    k.lap = lap.state;
    if (k.finishedAt !== null) continue;

    // Gate rows.
    race.board.forEach((row, i) => {
      if (i === k.lastGateRow || !crossedForward(row.s, prev.s, proj.s, track.length)) return;
      k.lastGateRow = i;
      const slot = slotAt(row, proj.lateral);
      if (slot) {
        if (slot.op === nextStep(k.ticket)) {
          doStep(race, k, slot.op, events);
        } else {
          k.stats.wrongGates++;
          k.kart = { ...k.kart, spinTime: TUNING.wrongGateSpin, driftDir: 0, driftTime: 0 };
          events.push({ type: 'wrong-gate', kartId: k.id, op: slot.op });
        }
      }
      if (k.id === race.playerId) {
        const { board, rows } = reshuffleAfterPass(race.board, i, race.rng);
        race.board = board;
        if (rows.length > 0) events.push({ type: 'board-reshuffled', rows });
      }
    });

    // Pit: the pit box serves a PIT step, once per ticket.
    if (surface === 'pit' && crossedForward(pitBoxS(track), prev.s, proj.s, track.length)) {
      const work = k.ticket.type.pitWork;
      if (nextStep(k.ticket) === 'PIT' && k.pitServedTicket !== k.ticket.number) {
        k.pitServedTicket = k.ticket.number;
        k.kart = { ...k.kart, holdTime: TUNING.pitHold, speed: 0 };
        events.push({ type: 'pit-service', kartId: k.id, work: work ?? 'hands-on work' });
        doStep(race, k, 'PIT', events);
      }
    }

    // SLA.
    if (race.time > k.ticket.deadline) {
      k.stats.slaBreaches++;
      k.kart = { ...k.kart, slowTime: TUNING.slaSlow };
      events.push({ type: 'sla-breach', kartId: k.id, ticket: k.ticket });
      newTicket(race, k, events);
    }

    // Automatic respawn.
    k.offroadTime = surface === 'offroad' ? k.offroadTime + h : 0;
    const stuck =
      input.throttle > 0 &&
      Math.abs(k.kart.speed) < TUNING.stuckSpeed &&
      k.kart.holdTime === 0 &&
      k.kart.spinTime === 0;
    k.stuckTime = stuck ? k.stuckTime + h : 0;
    if (k.offroadTime > TUNING.offroadRespawn || k.stuckTime > TUNING.stuckRespawn) {
      events.push(...respawn(race, k.id));
    }
  }
}

/**
 * Advance the race by dt seconds of wall time. A long frame is cut to
 * TUNING.maxFrame; the logic runs in fixed substeps of about TUNING.step,
 * so a fast kart never skips a gate row, the line or a wall. Mutates race.
 */
export function stepRace(race: Race, inputs: readonly KartInput[], dt: number): RaceEvent[] {
  const events: RaceEvent[] = [];
  const frame = Math.min(Math.max(dt, 0), TUNING.maxFrame);
  if (frame === 0) return events;
  if (race.phase === 'countdown') {
    race.countdown = Math.max(0, race.countdown - frame);
    if (race.countdown === 0) {
      race.phase = 'racing';
      events.push({ type: 'go' });
    }
    return events;
  }
  const n = Math.max(1, Math.round(frame / TUNING.step));
  const h = frame / n;
  for (let i = 0; i < n; i++) substep(race, inputs, h, events);
  return events;
}

import { botInput, profileOf, updateRubberBand } from './bot';
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
import { resolveContacts } from './contact';
import { lapStart, lapUpdate, type LapState } from './lap';
import type { Op, Step } from './ops';
import { DRIVERS } from './drivers';
import { touches, type Hazard } from './hazards';
import {
  collectBoxes,
  giveItem,
  hitKart,
  hitPuddles,
  stepProjectiles,
  useItem,
  type ItemBox,
  type ItemKind,
  type Projectile,
  type Puddle,
} from './items';
import { makeRng, type Rng } from './rng';
import { applyStep, issueTicket, nextStep, type Ticket } from './ticket';
import { crossedForward, type Projection, type Track } from './track';
import { TUNING } from './tuning';
import type { HitKind, HitOutcome } from './penalty';

export { standings } from './standings';

export type LapCount = 1 | 3 | 10;

export interface RaceConfig {
  laps: LapCount;
  seed: number;
  driverColor: number;
  /** Bot rivals, 0 to 7. The setup screen uses 7. */
  bots: number;
}

export interface KartStats {
  ticketsClosed: number;
  wrongGates: number;
  slaBreaches: number;
}

export interface KartRuntime {
  id: number;
  /** Index into DRIVERS. */
  driverIndex: number;
  isBot: boolean;
  /** Index into BOT_PROFILES, or null for the player. */
  botProfile: number | null;
  /** Rubber-band scale on the top speed (bots only; 1 for the player). */
  speedScale: number;
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
  item: ItemKind | null;
  /** Race time the kart got its item. */
  itemAt: number;
  /** The item input in the last substep: an item is used on the press. */
  itemButton: boolean;
  rollbackArmed: boolean;
  /** Firewall time left. */
  shieldTime: number;
  /** Per hazard: the kart touched it in the last substep. A hazard hits on contact. */
  hazardContact: boolean[];
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
  | { type: 'item-picked'; kartId: number; item: ItemKind }
  | { type: 'item-used'; kartId: number; item: ItemKind }
  | { type: 'hit'; kartId: number; kind: HitKind; outcome: HitOutcome; byId: number | null }
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
  /** Frame time not yet run as a fixed substep. */
  stepAcc: number;
  boxes: ItemBox[];
  projectiles: Projectile[];
  puddles: Puddle[];
  hazards: readonly Hazard[];
  /** Next id for a projectile or a puddle. */
  nextEntityId: number;
}

/**
 * Grid slot i of 8: two columns, 4 m apart in s, all after the finish line
 * (inside gridS..gridS+40). Slot 0 is the front of the grid.
 */
export function gridSlot(index: number, track: Track): Projection {
  const s = track.def.gridS + 30 - 4 * index;
  const lateral = track.def.halfWidth * 0.35 * (index % 2 === 0 ? 1 : -1);
  return { s, lateral };
}

export function createRace(config: RaceConfig, track: Track): Race {
  const rng = makeRng(config.seed);
  const board = createBoard(rng, track);
  const bots = Math.max(0, Math.min(7, Math.floor(config.bots)));
  let nextTicketNumber = 1;
  const karts: KartRuntime[] = [];
  for (let id = 0; id <= bots; id++) {
    // The bots fill the grid from the front; the player starts behind them.
    const slot = gridSlot(id === 0 ? bots : id - 1, track);
    karts.push({
      id,
      driverIndex: (config.driverColor + id) % DRIVERS.length,
      isBot: id !== 0,
      botProfile: id === 0 ? null : id - 1,
      speedScale: 1,
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
      item: null,
      itemAt: 0,
      itemButton: false,
      rollbackArmed: false,
      shieldTime: 0,
      hazardContact: (track.def.hazards ?? []).map(() => false),
    });
  }
  const hw = track.def.halfWidth;
  const boxes = (track.def.itemBoxRows ?? []).flatMap((s) =>
    [-0.75, -0.25, 0.25, 0.75].map((f) => ({ s, lateral: f * hw, respawnAt: 0 })),
  );
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
    stepAcc: 0,
    boxes,
    projectiles: [],
    puddles: [],
    hazards: track.def.hazards ?? [],
    nextEntityId: 1,
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
    giveItem(race, k, events);
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

  // 1. Move every kart.
  const prevProj = race.karts.map((k) => k.proj);
  // Bots decide from the state before anyone moves, so kart order does not matter.
  // A bot that finished drives on; a player who finished coasts.
  const kartInputs = race.karts.map((k) =>
    k.isBot
      ? botInput(race, k.id)
      : ((k.finishedAt === null ? inputs[k.id] : undefined) ?? NO_INPUT),
  );
  race.karts.forEach((k, i) => {
    const prev = prevProj[i] as Projection;
    const input = kartInputs[i] as KartInput;
    const capScale = k.isBot ? profileOf(k).topSpeedScale * k.speedScale : 1;
    let kart = stepKart(k.kart, input, h, surfaceAt(prev, track), capScale);
    let proj = track.project(kart.pos, prev.s);
    const constrained = constrainToTrack(kart, proj, track);
    if (constrained !== kart) {
      kart = constrained;
      proj = track.project(kart.pos, prev.s);
    }
    k.kart = kart;
    k.proj = proj;
  });

  // 2. Kart-to-kart contact, among the karts still racing. A push can move a
  // kart into a wall, so constrain the pushed karts again.
  const racing = race.karts.filter((k) => k.finishedAt === null);
  const before = racing.map((k) => k.kart);
  resolveContacts(racing);
  racing.forEach((k, i) => {
    if (k.kart === before[i]) return;
    const prev = prevProj[k.id] as Projection;
    let proj = track.project(k.kart.pos, prev.s);
    const constrained = constrainToTrack(k.kart, proj, track);
    if (constrained !== k.kart) {
      k.kart = constrained;
      proj = track.project(k.kart.pos, prev.s);
    }
    k.proj = proj;
  });

  // 3. Rules: laps, gates, pit, SLA, respawn. A reshuffle waits for the end of
  // the substep, so every kart in this substep sees the same board.
  const passedRows: number[] = [];
  race.karts.forEach((k, i) => {
    const prev = prevProj[i] as Projection;
    const input = kartInputs[i] as KartInput;
    const proj = k.proj;
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
    if (k.finishedAt !== null) return;

    // Gate rows.
    race.board.forEach((row, ri) => {
      if (ri === k.lastGateRow || !crossedForward(row.s, prev.s, proj.s, track.length)) return;
      k.lastGateRow = ri;
      const slot = slotAt(row, proj.lateral);
      if (slot) {
        if (slot.op === nextStep(k.ticket)) {
          doStep(race, k, slot.op, events);
        } else {
          k.stats.wrongGates++;
          events.push({ type: 'wrong-gate', kartId: k.id, op: slot.op });
          hitKart(k, 'wrong-gate', null, events);
        }
      }
      if (k.id === race.playerId) passedRows.push(ri);
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

    // Items: pick up, then use on the press of the item input.
    k.shieldTime = Math.max(0, k.shieldTime - h);
    collectBoxes(race, k, events);
    const press = input.item === true && !k.itemButton;
    k.itemButton = input.item === true;
    if (press && k.kart.spinTime === 0) events.push(...useItem(race, k.id));

    // Hazards hit on contact; puddles on touch.
    race.hazards.forEach((hz, hi) => {
      const now = touches(hz, proj, race.time, track);
      if (now && !k.hazardContact[hi] && (hz.kind === 'cable' || hz.kind === 'cron')) {
        hitKart(k, hz.kind, null, events);
      }
      k.hazardContact[hi] = now;
    });
    hitPuddles(race, k, events);

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
    updateRubberBand(race, k, h);
  });

  // 4. Pages fly; puddles dry up.
  stepProjectiles(race, h, events);

  // 5. The change board moves behind the player.
  for (const ri of passedRows) {
    const { board, rows } = reshuffleAfterPass(race.board, ri, race.rng);
    race.board = board;
    if (rows.length > 0) events.push({ type: 'board-reshuffled', rows });
  }
}

/**
 * Advance the race by dt seconds of wall time. A long frame is cut to
 * TUNING.maxFrame. The logic runs in fixed substeps of TUNING.step; time
 * left over carries to the next call. So the same inputs give the same race
 * at any frame rate, and a fast kart never skips a gate row, the line or a
 * wall. Mutates race.
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
  race.stepAcc += frame;
  // The tolerance absorbs rounding, so a frame of exactly one step runs one substep.
  while (race.stepAcc >= TUNING.step * (1 - 1e-6)) {
    race.stepAcc -= TUNING.step;
    substep(race, inputs, TUNING.step, events);
  }
  return events;
}

import type { ItemKind } from '../logic/items';
import { driftStage } from '../logic/kart';
import { standings, type Race, type RaceEvent } from '../logic/race';
import { dist } from '../logic/vec';

/** A sound to play now. The synth maps each kind to one sound. */
export type Cue =
  | { kind: 'countdown'; n: 3 | 2 | 1 }
  | { kind: 'go' }
  | { kind: 'gate-ok' }
  | { kind: 'gate-wrong' }
  | { kind: 'ticket-closed' }
  | { kind: 'sla-breach' }
  | { kind: 'pit' }
  | { kind: 'lap' }
  | { kind: 'final-lap' }
  | { kind: 'finish'; place: number }
  | { kind: 'drift-stage'; stage: 1 | 2 | 3 }
  | { kind: 'boost' }
  | { kind: 'item-pick' }
  | { kind: 'item-use'; item: ItemKind }
  | { kind: 'hit'; outcome: 'blocked' | 'rolled-back' | 'spun'; gain: number };

export type CueKind = Cue['kind'];

/** What cuesFor remembers between frames. One per race. */
export interface CueState {
  /** The countdown number last cued, or null before the first. */
  lastCountdown: number | null;
  /** The player's drift stage last cued; 0 when not drifting. */
  lastDriftStage: number;
  /** The player's boost time in the last frame: a rise is a new boost. */
  lastBoost: number;
  /** Per cue kind: the times (s) of the cues in the current window. */
  recent: Map<string, number[]>;
}

/** Metres. A hit on another kart fades to silence at this range. */
export const HEAR_RANGE = 40;
/** Each cue kind plays at most this many times per RATE_WINDOW. */
export const MAX_PER_KIND = 3;
/** Seconds. */
export const RATE_WINDOW = 0.1;

export function createCueState(): CueState {
  return { lastCountdown: null, lastDriftStage: 0, lastBoost: 0, recent: new Map() };
}

/** Take one slot in the kind's rate window. false: the window is full. */
function allow(state: CueState, kind: CueKind, now: number): boolean {
  const times = (state.recent.get(kind) ?? []).filter((t) => now - t < RATE_WINDOW);
  if (times.length >= MAX_PER_KIND) {
    state.recent.set(kind, times);
    return false;
  }
  times.push(now);
  state.recent.set(kind, times);
  return true;
}

/**
 * The cues for one frame: the race events of the frame, plus the countdown,
 * drift and boost read from the race state. Only the player's events make a
 * sound, except hits, which fade with distance from the player. now is a
 * clock in seconds, for the rate limit. Mutates state.
 */
export function cuesFor(
  race: Race,
  events: readonly RaceEvent[],
  state: CueState,
  now: number,
): Cue[] {
  const out: Cue[] = [];
  const push = (c: Cue) => {
    if (allow(state, c.kind, now)) out.push(c);
  };
  const me = race.karts[race.playerId];

  if (race.phase === 'countdown') {
    const n = Math.ceil(race.countdown);
    if (n !== state.lastCountdown && (n === 3 || n === 2 || n === 1)) {
      push({ kind: 'countdown', n });
    }
    state.lastCountdown = n;
  }

  const closed = events.some((e) => e.type === 'ticket-closed' && e.kartId === race.playerId);
  for (const e of events) {
    if (e.type === 'go') {
      push({ kind: 'go' });
      continue;
    }
    if (e.type === 'hit') {
      if (e.outcome === 'ignored') continue;
      let gain = 1;
      if (e.kartId !== race.playerId) {
        const k = race.karts[e.kartId];
        if (!k || !me) continue;
        gain = 1 - dist(k.kart.pos, me.kart.pos) / HEAR_RANGE;
        if (gain <= 0) continue;
      }
      push({ kind: 'hit', outcome: e.outcome, gain });
      continue;
    }
    if (!('kartId' in e) || e.kartId !== race.playerId) continue;
    switch (e.type) {
      case 'step-ok':
        // The pit and a closed ticket have their own sounds.
        if (e.step !== 'PIT' && !closed) push({ kind: 'gate-ok' });
        break;
      case 'ticket-closed':
        push({ kind: 'ticket-closed' });
        break;
      case 'wrong-gate':
        push({ kind: 'gate-wrong' });
        break;
      case 'sla-breach':
        push({ kind: 'sla-breach' });
        break;
      case 'pit-service':
        push({ kind: 'pit' });
        break;
      case 'item-picked':
        push({ kind: 'item-pick' });
        break;
      case 'item-used':
        push({ kind: 'item-use', item: e.item });
        break;
      case 'lap': {
        const laps = race.config.laps;
        // The finish line has its own sound.
        if (e.completed >= laps) break;
        push({ kind: e.completed === laps - 1 ? 'final-lap' : 'lap' });
        break;
      }
      case 'finished': {
        const order = race.finalOrder ?? standings(race);
        push({ kind: 'finish', place: order.indexOf(race.playerId) + 1 });
        break;
      }
      default:
        break;
    }
  }

  if (me) {
    const stage = me.kart.driftDir === 0 ? 0 : driftStage(me.kart.driftTime);
    for (let s = state.lastDriftStage + 1; s <= stage; s++) {
      push({ kind: 'drift-stage', stage: s as 1 | 2 | 3 });
    }
    state.lastDriftStage = stage;
    if (me.kart.boostTime > state.lastBoost + 1e-9) push({ kind: 'boost' });
    state.lastBoost = me.kart.boostTime;
  }
  return out;
}

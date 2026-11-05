import { crossedBackward, crossedForward, forwardDelta, type Track } from './track';

/**
 * Lap progress. The lap is cut into sectorCount equal spans; boundary 0 is
 * the finish line. `sector` counts the boundaries passed in order since the
 * lap started. It goes negative when the kart backs over the line.
 */
export interface LapState {
  completed: number;
  sector: number;
  lapStartTime: number;
  bestLap: number | null;
}

export function lapStart(now: number): LapState {
  return { completed: 0, sector: 0, lapStartTime: now, bestLap: null };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export function lapUpdate(
  state: LapState,
  prevS: number,
  curS: number,
  track: Track,
  now: number,
): { state: LapState; completedLap: boolean } {
  const L = track.length;
  const n = track.def.sectorCount;
  const delta = forwardDelta(prevS, curS, L);
  // A jump this large is a teleport or a cut, not driving: ignore it.
  if (delta === 0 || Math.abs(delta) > L / 4) return { state, completedLap: false };

  let st = state;
  let completedLap = false;
  // Check the boundaries in travel order, so one move can pass more than one.
  for (let step = 0; step < n; step++) {
    if (delta > 0) {
      const k = mod(st.sector + 1, n);
      if (!crossedForward((k * L) / n, prevS, curS, L)) break;
      st = { ...st, sector: st.sector + 1 };
      if (st.sector === n) {
        const lapTime = now - st.lapStartTime;
        st = {
          completed: st.completed + 1,
          sector: 0,
          lapStartTime: now,
          bestLap: st.bestLap === null ? lapTime : Math.min(st.bestLap, lapTime),
        };
        completedLap = true;
      }
    } else {
      const k = mod(st.sector, n);
      if (!crossedBackward((k * L) / n, prevS, curS, L)) break;
      st = { ...st, sector: st.sector - 1 };
    }
  }
  return { state: st, completedLap };
}

/** Laps done plus the fraction of the current lap: for ranking karts. */
export function raceProgress(state: LapState, s: number, length: number): number {
  return state.completed + s / length;
}

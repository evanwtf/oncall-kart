import { raceProgress } from './lap';
import type { KartRuntime, Race } from './race';

/** Kart ids, best first: finished karts by finishedAt, then the rest by progress. */
export function standings(race: Race): number[] {
  const { length, def } = race.track;
  const progress = (k: KartRuntime) => raceProgress(k.lap, k.proj.s, length, def.sectorCount);
  return [...race.karts]
    .sort((a, b) => {
      if (a.finishedAt !== null && b.finishedAt !== null) {
        return a.finishedAt - b.finishedAt || a.id - b.id;
      }
      if (a.finishedAt !== null) return -1;
      if (b.finishedAt !== null) return 1;
      return progress(b) - progress(a) || a.id - b.id;
    })
    .map((k) => k.id);
}

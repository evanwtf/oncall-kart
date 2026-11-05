import { buildTrack, type Track, type TrackDef } from '../src/logic/track';
import type { Vec2 } from '../src/logic/vec';

/** A circle of the given radius as control points, counter to the direction of travel. */
export function circlePoints(radius: number, count: number): Vec2[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return { x: radius * Math.sin(a), z: radius * Math.cos(a) };
  });
}

export function circleDef(radius: number, overrides: Partial<TrackDef> = {}): TrackDef {
  return {
    name: 'circle',
    controlPoints: circlePoints(radius, 16),
    halfWidth: 9,
    gateRowFractions: [0.2, 0.35, 0.5, 0.65, 0.8, 0.95],
    sectorCount: 4,
    pit: {
      startS: 0.02,
      endS: 0.12,
      side: 1,
      centerOffset: 13,
      halfWidth: 3,
      entryLen: 8,
      exitLen: 8,
    },
    gridS: 2,
    ...overrides,
  };
}

/** Build a circle track; pit fractions in the def are scaled to metres. */
export function circleTrack(radius: number, overrides: Partial<TrackDef> = {}): Track {
  const def = circleDef(radius, overrides);
  const L = 2 * Math.PI * radius;
  const scaled = {
    ...def,
    pit: overrides.pit ?? { ...def.pit, startS: def.pit.startS * L, endS: def.pit.endS * L },
  };
  return buildTrack(scaled);
}

/** A fake Track of a given length for logic that only needs `length`. */
export function lineTrack(length: number, sectorCount = 4): Track {
  return {
    def: { ...circleDef(10), sectorCount, gridS: 2 },
    length,
    pointAt: (s) => ({ x: 0, z: s }),
    tangentAt: () => ({ x: 0, z: 1 }),
    project: (p) => ({ s: p.z, lateral: p.x }),
  };
}

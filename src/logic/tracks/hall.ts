import type { TrackDef } from '../track';
import type { Vec2 } from '../vec';

/** The sketch below is drawn large; K scales it to the final size. */
const K = 0.66;

const sketch: readonly Vec2[] = [
  { x: 0, z: -110 },
  { x: 0, z: -40 },
  { x: 0, z: 30 },
  { x: 0, z: 100 },
  { x: -8, z: 145 },
  { x: -40, z: 172 },
  { x: -85, z: 172 },
  { x: -125, z: 150 },
  { x: -155, z: 112 },
  { x: -168, z: 62 },
  { x: -160, z: 22 },
  { x: -138, z: -2 },
  { x: -112, z: 4 },
  { x: -100, z: 30 },
  { x: -100, z: 62 },
  { x: -92, z: 94 },
  { x: -72, z: 112 },
  { x: -48, z: 104 },
  { x: -40, z: 74 },
  // The back aisle: a straight run home with two gate rows.
  { x: -46, z: 30 },
  { x: -52, z: -20 },
  { x: -58, z: -70 },
  { x: -64, z: -112 },
  { x: -62, z: -148 },
  { x: -50, z: -174 },
  { x: -28, z: -186 },
  { x: -8, z: -176 },
  { x: 0, z: -146 },
];

/**
 * The data-centre hall. Travel starts north (+z) up the loading-dock straight,
 * which holds the finish line (s = 0), the grid and the pit lane on the left.
 * Then a wide right turn, a fast sweeper, two hairpins, the back aisle and a
 * last hairpin onto the straight.
 */
export const HALL: TrackDef = {
  name: 'Data-centre hall',
  controlPoints: sketch.map((p) => ({ x: p.x * K, z: p.z * K })),
  halfWidth: 9,
  // s = 150 (after the pit exit), 239 and 324 (the sweeper), 565 and 640
  // (the back aisle). The hairpins and the final corner hold no rows.
  gateRowFractions: [0.199, 0.3171, 0.4298, 0.7495, 0.849],
  sectorCount: 4,
  pit: {
    startS: 28,
    endS: 128,
    side: 1,
    centerOffset: 13,
    halfWidth: 3,
    entryLen: 20,
    exitLen: 20,
  },
  gridS: 12,
};

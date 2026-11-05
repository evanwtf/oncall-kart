/**
 * The data-centre floor: walls, racks and network devices as boxes on the
 * ground plane (x east, z south, metres). Built in code; pure data.
 *
 * West to east: the break room (the spawn point), data hall A, the network
 * room, data hall B, and the loading dock. A corridor runs the full length
 * through the middle. Each hall has rack rows in back-to-back pairs, with
 * the fronts on the aisles.
 */

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type TargetKind = 'rack' | 'switch' | 'firewall';

export interface Target {
  id: string;
  kind: TargetKind;
  /** Center of the box. */
  x: number;
  z: number;
  /** Unit vector out of the front. */
  fx: number;
  fz: number;
  box: Box;
}

export type AreaName =
  'Data hall A' | 'Data hall B' | 'Network room' | 'Break room' | 'Loading dock';

export interface FloorDef {
  width: number;
  depth: number;
  walls: Box[];
  racks: Target[];
  devices: Target[];
  areas: { name: AreaName; box: Box }[];
  /** yaw 0 looks toward -z. */
  spawn: { x: number; z: number; yaw: number };
  /** Where vendors come in (phase 2). */
  dock: { x: number; z: number };
}

/** Rack size: 0.6 m wide along the row, 1.2 m deep front to back. */
export const RACK_WIDTH = 0.6;
export const RACK_DEPTH = 1.2;
/** Wall thickness. */
const WALL = 0.3;

const box = (minX: number, maxX: number, minZ: number, maxZ: number): Box => ({
  minX,
  maxX,
  minZ,
  maxZ,
});

/** A target whose 1.2 m side runs along its front direction (fx, fz), which is axis-aligned. */
function target(
  id: string,
  kind: TargetKind,
  x: number,
  z: number,
  fx: number,
  fz: number,
  width: number,
  depth: number,
): Target {
  const hx = (fx !== 0 ? depth : width) / 2;
  const hz = (fx !== 0 ? width : depth) / 2;
  return { id, kind, x, z, fx, fz, box: box(x - hx, x + hx, z - hz, z + hz) };
}

/** The point `distance` metres out from the middle of the front face. */
export function frontPoint(t: Target, distance: number): { x: number; z: number } {
  const half = t.fx !== 0 ? (t.box.maxX - t.box.minX) / 2 : (t.box.maxZ - t.box.minZ) / 2;
  return { x: t.x + t.fx * (half + distance), z: t.z + t.fz * (half + distance) };
}

// Layout numbers.
const DEPTH = 36;
/** The corridor down the middle, z from CORRIDOR[0] to CORRIDOR[1]. */
const CORRIDOR = [15, 21] as const;
/** West and east edges of each area. */
const BREAK = [0, 14] as const;
const HALL_A = [14, 52] as const;
const NET = [52, 66] as const;
const HALL_B = [66, 104] as const;
const DOCK = [104, 118] as const;
const WIDTH = DOCK[1];
/** Each hall: 5 row segments of 8 racks, with cross aisles between them. */
const SEGMENTS = 5;
const RACKS_PER_SEGMENT = 8;
const CROSS_AISLE = 2.4;
/** z of the north edge of each back-to-back pair of rows. */
const PAIR_Z = [3.2, 8.6, 25, 30.4] as const;

function buildFloor(): FloorDef {
  const walls: Box[] = [];
  // Outer walls.
  walls.push(box(0, WIDTH, 0, WALL), box(0, WIDTH, DEPTH - WALL, DEPTH));
  walls.push(box(0, WALL, WALL, DEPTH - WALL), box(WIDTH - WALL, WIDTH, WALL, DEPTH - WALL));
  // Partitions between the areas, open where the corridor passes.
  for (const x of [BREAK[1], NET[0], NET[1], DOCK[0]]) {
    walls.push(box(x - WALL / 2, x + WALL / 2, WALL, CORRIDOR[0]));
    walls.push(box(x - WALL / 2, x + WALL / 2, CORRIDOR[1], DEPTH - WALL));
  }
  // The break room: a table and a counter.
  walls.push(box(4, 7, 7, 9), box(1.2, 2.2, 26, 33));
  // The loading dock: pallets of boxed hardware.
  walls.push(box(109, 111.4, 4, 6.4), box(113, 115.4, 8, 10.4), box(110, 112.4, 28, 30.4));

  const racks: Target[] = [];
  const segLen = RACKS_PER_SEGMENT * RACK_WIDTH;
  for (const [x0, x1] of [HALL_A, HALL_B]) {
    const used = SEGMENTS * segLen + (SEGMENTS - 1) * CROSS_AISLE;
    const start = x0 + (x1 - x0 - used) / 2;
    for (const pz of PAIR_Z) {
      // North row faces north (-z), south row faces south (+z): back to back.
      for (const [zc, fz] of [
        [pz + RACK_DEPTH / 2, -1],
        [pz + RACK_DEPTH * 1.5, 1],
      ] as const) {
        for (let s = 0; s < SEGMENTS; s++) {
          const sx = start + s * (segLen + CROSS_AISLE);
          for (let i = 0; i < RACKS_PER_SEGMENT; i++) {
            const x = sx + (i + 0.5) * RACK_WIDTH;
            racks.push(
              target(`r${racks.length + 1}`, 'rack', x, zc, 0, fz, RACK_WIDTH, RACK_DEPTH),
            );
          }
        }
      }
    }
  }

  // The network room: switches along the north, firewalls along the south.
  const devices: Target[] = [];
  const netMid = (NET[0] + NET[1]) / 2;
  [-4.5, -1.5, 1.5, 4.5].forEach((dx, i) => {
    devices.push(target(`sw${i + 1}`, 'switch', netMid + dx, 7, 0, 1, 0.8, 1.2));
  });
  [-3, 0, 3].forEach((dx, i) => {
    devices.push(target(`fw${i + 1}`, 'firewall', netMid + dx, 29, 0, -1, 1.0, 1.2));
  });

  const area = (name: AreaName, [x0, x1]: readonly [number, number]) => ({
    name,
    box: box(x0, x1, 0, DEPTH),
  });
  return {
    width: WIDTH,
    depth: DEPTH,
    walls,
    racks,
    devices,
    areas: [
      area('Break room', BREAK),
      area('Data hall A', HALL_A),
      area('Network room', NET),
      area('Data hall B', HALL_B),
      area('Loading dock', DOCK),
    ],
    spawn: { x: 5.5, z: 18, yaw: -Math.PI / 2 },
    dock: { x: 112, z: 18 },
  };
}

export const FLOOR: FloorDef = buildFloor();

/** Every box a player collides with on this floor. */
export function solidBoxes(floor: FloorDef): Box[] {
  return [...floor.walls, ...floor.racks.map((t) => t.box), ...floor.devices.map((t) => t.box)];
}

/** The area that holds (x, z), or null. */
export function areaAt(floor: FloorDef, x: number, z: number): AreaName | null {
  for (const a of floor.areas) {
    if (x >= a.box.minX && x <= a.box.maxX && z >= a.box.minZ && z <= a.box.maxZ) return a.name;
  }
  return null;
}

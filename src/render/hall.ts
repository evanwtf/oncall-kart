import * as THREE from 'three';
import type { Track } from '../logic/track';
import { TUNING } from '../logic/tuning';
import { canvasTexture, floorTexture, hazardTexture } from './textures';

export interface HallHandle {
  group: THREE.Group;
  /** Blink a few rack LEDs. Call once per frame. */
  update(time: number): void;
}

const RACK = { w: 0.7, h: 2.2, d: 1.1 };
const LED_COLORS = [0x3ddc97, 0x3ddc97, 0x3ddc97, 0x4d9de0, 0xf2a03d, 0x10161d];

/** The front of a block of racks: dark doors, vents and small LEDs. */
function rackFrontTexture(racks: number): THREE.CanvasTexture {
  return canvasTexture(64 * racks, 256, (ctx, w, h) => {
    ctx.fillStyle = '#0c1015';
    ctx.fillRect(0, 0, w, h);
    const leds = ['#3ddc97', '#3ddc97', '#4d9de0', '#f2a03d'];
    for (let r = 0; r < racks; r++) {
      const x = r * 64;
      ctx.fillStyle = '#161d25';
      ctx.fillRect(x + 3, 4, 58, h - 8);
      for (let u = 0; u < 22; u++) {
        const y = 10 + u * 10.8;
        ctx.fillStyle = u % 3 ? '#1d2630' : '#232e3a';
        ctx.fillRect(x + 7, y, 50, 8);
        if ((u * 7 + r * 3) % 4 !== 0) {
          ctx.fillStyle = leds[(u + r) % leds.length] ?? '#3ddc97';
          ctx.fillRect(x + 48, y + 3, 4, 2);
        }
      }
    }
  });
}

/** The data-centre hall: raised floor, rack rows with LEDs, cable trays, the loading dock. */
export function buildHall(track: Track): HallHandle {
  const group = new THREE.Group();
  const L = track.length;
  const { halfWidth, pit } = track.def;

  // Bounds of the track, plus a margin.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const samples: { x: number; z: number }[] = [];
  for (let s = 0; s < L; s += 3) {
    const p = track.pointAt(s);
    samples.push(p);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const margin = 45;
  minX -= margin;
  maxX += margin;
  minZ -= margin;
  maxZ += margin;

  // Floor.
  const tex = floorTexture();
  const fw = maxX - minX + 200;
  const fd = maxZ - minZ + 200;
  tex.repeat.set(fw / 2.4, fd / 2.4); // 0.6 m tiles, 4 per texture
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(fw, fd),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  group.add(floor);

  // Keep-out distance: racks stay clear of the walls and the pit lane.
  const clear = halfWidth + TUNING.offroadWidth + 3;
  const pitClear = pit.centerOffset + pit.halfWidth + 3;
  const minDist = (x: number, z: number) => {
    let best = Infinity;
    for (const p of samples) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
    return Math.sqrt(best);
  };
  // The dock sits beside the pit: keep that strip free.
  const dockA = track.pointAt(pit.startS - 20);
  const dockB = track.pointAt(pit.endS + 10);
  const inDock = (x: number, z: number) =>
    x > Math.min(dockA.x, dockB.x) - 2 &&
    x < Math.max(dockA.x, dockB.x) + pitClear + 14 &&
    z > Math.min(dockA.z, dockB.z) &&
    z < Math.max(dockA.z, dockB.z);

  // Rack rows run along x; pairs face each other across a cold aisle. One
  // instanced box is a block of 8 racks; a texture draws the rack fronts.
  const blocks: THREE.Matrix4[] = [];
  const trays: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  const block = 8; // racks per block
  const blockLen = block * RACK.w;
  for (let z = minZ; z < maxZ; z += 3.6) {
    for (let x = minX; x < maxX; x += blockLen + 1.2) {
      const cx = x + blockLen / 2;
      const ends = [minDist(x, z), minDist(cx, z), minDist(x + blockLen, z)];
      if (Math.min(...ends) < Math.max(clear, pitClear) || inDock(cx, z)) continue;
      if (Math.min(...ends) > 70) continue; // lost in the fog anyway
      blocks.push(m.clone().makeTranslation(cx, RACK.h / 2, z));
      trays.push(m.clone().makeTranslation(cx, 3.4, z + 0.9));
    }
  }

  const front = rackFrontTexture(block);
  const side = new THREE.MeshStandardMaterial({ color: 0x151b22, roughness: 0.6, metalness: 0.4 });
  const face = new THREE.MeshStandardMaterial({
    map: front,
    emissiveMap: front,
    emissive: 0xffffff,
    emissiveIntensity: 0.35,
    roughness: 0.6,
    metalness: 0.3,
  });
  // Box faces: +x, -x, +y, -y, +z, -z. Fronts on ±z.
  const rackMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(blockLen - 0.05, RACK.h, RACK.d),
    [side, side, side, side, face, face],
    blocks.length,
  );
  blocks.forEach((mat, i) => rackMesh.setMatrixAt(i, mat));
  group.add(rackMesh);

  // A few hundred bright LEDs that blink, on the blocks nearest the track.
  const ledCount = Math.min(600, blocks.length * 2);
  const leds = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.07, 0.05, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    ledCount,
  );
  const v = new THREE.Vector3();
  const color = new THREE.Color();
  for (let li = 0; li < ledCount; li++) {
    const b = blocks[Math.floor((li * 7919) % blocks.length)];
    if (!b) continue;
    v.setFromMatrixPosition(b);
    const face = li % 2 ? 1 : -1;
    m.makeTranslation(
      v.x - blockLen / 2 + ((li * 37) % block) * RACK.w + 0.2,
      0.5 + ((li * 13) % 15) * 0.1,
      v.z + face * (RACK.d / 2 + 0.012),
    );
    leds.setMatrixAt(li, m);
    leds.setColorAt(li, color.setHex(LED_COLORS[li % LED_COLORS.length] ?? 0x3ddc97));
  }
  group.add(leds);

  const trayMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(blockLen, 0.12, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x5b6878, metalness: 0.6, roughness: 0.4 }),
    trays.length,
  );
  trays.forEach((mat, i) => trayMesh.setMatrixAt(i, mat));
  group.add(trayMesh);

  // Loading dock beside the pit lane: a raised platform with a hazard edge and doors.
  const t = track.tangentAt((pit.startS + pit.endS) / 2);
  const dockLen = pit.endS - pit.startS + 30;
  const mid = track.pointAt((pit.startS + pit.endS) / 2);
  const off = pit.side * (pitClear + 4);
  const dock = new THREE.Group();
  dock.position.set(mid.x + off * t.z, 0, mid.z - off * t.x);
  dock.rotation.y = Math.atan2(t.x, t.z);
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(8, 1.2, dockLen),
    new THREE.MeshStandardMaterial({ color: 0x3b444f, roughness: 0.9 }),
  );
  platform.position.set(pit.side * 4, 0.6, 0);
  dock.add(platform);
  const stripeTex = hazardTexture();
  stripeTex.repeat.set(dockLen / 1.5, 1);
  const edge = new THREE.Mesh(
    new THREE.PlaneGeometry(dockLen, 1.2),
    new THREE.MeshStandardMaterial({ map: stripeTex }),
  );
  edge.rotation.y = -pit.side * (Math.PI / 2);
  edge.position.set(0.01 * -pit.side, 0.6, 0);
  dock.add(edge);
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x6a7686,
    roughness: 0.7,
    metalness: 0.3,
  });
  for (let i = 0; i < 6; i++) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 7), doorMat);
    door.position.set(pit.side * 8.2, 1.2 + 2.5, -dockLen / 2 + 12 + i * ((dockLen - 24) / 5));
    dock.add(door);
  }
  group.add(dock);

  return {
    group,
    update(time: number) {
      // Re-colour a few LEDs per frame: a calm, constant flicker.
      const n = Math.min(24, ledCount);
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(Math.random() * ledCount);
        const on = Math.sin(time * 3 + idx) > -0.6;
        leds.setColorAt(idx, color.setHex(on ? (LED_COLORS[idx % 5] ?? 0x3ddc97) : 0x10161d));
      }
      if (leds.instanceColor) leds.instanceColor.needsUpdate = true;
    },
  };
}

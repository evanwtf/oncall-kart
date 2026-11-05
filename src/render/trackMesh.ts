import * as THREE from 'three';
import type { Track } from '../logic/track';
import { TUNING } from '../logic/tuning';
import { canvasTexture, hazardTexture } from './textures';

const STEP = 2; // metres between ribbon samples

/** A flat or vertical ribbon along the track between two lateral offsets (functions of s). */
function ribbon(
  track: Track,
  from: number,
  to: number,
  inner: (s: number) => number,
  outer: (s: number) => number,
  y0: number,
  y1: number,
  vertical: boolean,
  uPerMetre: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = Math.max(1, Math.ceil((to - from) / STEP));
  for (let i = 0; i <= n; i++) {
    const s = from + ((to - from) * i) / n;
    const c = track.pointAt(s);
    const t = track.tangentAt(s);
    const li = inner(s);
    const lo = outer(s);
    // Left of travel is (t.z, -t.x).
    pos.push(c.x + li * t.z, y0, c.z - li * t.x);
    pos.push(c.x + lo * t.z, vertical ? y1 : y0, c.z - lo * t.x);
    uv.push(s * uPerMetre, 0, s * uPerMetre, 1);
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildTrackMesh(track: Track): THREE.Group {
  const group = new THREE.Group();
  const L = track.length;
  const { halfWidth: hw, pit } = track.def;
  const outer = hw + TUNING.offroadWidth;
  const pitInner = pit.centerOffset - pit.halfWidth;
  const pitOuter = pit.centerOffset + pit.halfWidth;
  const inPit = (s: number) => s >= pit.startS && s <= pit.endS;
  const const_ = (v: number) => () => v;
  const doubleSide = { side: THREE.DoubleSide };

  // Road: dark epoxy with a faint centre line.
  const roadTex = canvasTexture(64, 256, (ctx, w, h) => {
    ctx.fillStyle = '#323b47';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3d4754';
    for (let i = 0; i < 40; i++) ctx.fillRect((i * 37) % w, (i * 91) % h, 2, 2);
    ctx.fillStyle = '#8fa3b8';
    ctx.fillRect(0, h / 2 - 2, w / 2, 4);
  });
  roadTex.wrapS = THREE.RepeatWrapping;
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.8, ...doubleSide });
  group.add(
    new THREE.Mesh(ribbon(track, 0, L, const_(-hw), const_(hw), 0.02, 0.02, false, 1 / 8), roadMat),
  );

  // Hazard-stripe kerbs on both edges.
  const kerbTex = hazardTexture();
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.7, ...doubleSide });
  group.add(
    new THREE.Mesh(
      ribbon(track, 0, L, const_(hw - 0.6), const_(hw + 0.4), 0.04, 0.04, false, 1 / 1.5),
      kerbMat,
    ),
  );
  group.add(
    new THREE.Mesh(
      ribbon(track, 0, L, const_(-hw - 0.4), const_(-hw + 0.6), 0.04, 0.04, false, 1 / 1.5),
      kerbMat,
    ),
  );

  // Pit lane surface.
  const pitMat = new THREE.MeshStandardMaterial({ color: 0x2c3d4f, roughness: 0.9, ...doubleSide });
  const ps = pit.side;
  group.add(
    new THREE.Mesh(
      ribbon(
        track,
        pit.startS,
        pit.endS,
        const_(ps * pitInner),
        const_(ps * pitOuter),
        0.03,
        0.03,
        false,
        1,
      ),
      pitMat,
    ),
  );
  // Pit entry and exit ramps between road and lane.
  for (const [a, b] of [
    [pit.startS, pit.startS + pit.entryLen],
    [pit.endS - pit.exitLen, pit.endS],
  ] as const) {
    group.add(
      new THREE.Mesh(
        ribbon(track, a, b, const_(ps * hw), const_(ps * pitInner), 0.03, 0.03, false, 1),
        pitMat,
      ),
    );
  }

  // Soft walls: low padded barriers. On the pit side they follow the pit lane.
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x5d7088,
    roughness: 0.6,
    ...doubleSide,
  });
  const wallH = 1.2;
  const sideWall = (sign: 1 | -1) => (s: number) =>
    sign * (sign === ps && inPit(s) ? pitOuter : outer);
  for (const sign of [1, -1] as const) {
    const lat = sideWall(sign);
    group.add(new THREE.Mesh(ribbon(track, 0, L, lat, lat, 0, wallH, true, 1), wallMat));
  }
  // The divider between road and pit lane, closed between the openings.
  const divMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.5, ...doubleSide });
  const divLat = (ps * (hw + pitInner)) / 2;
  group.add(
    new THREE.Mesh(
      ribbon(
        track,
        pit.startS + pit.entryLen,
        pit.endS - pit.exitLen,
        const_(divLat),
        const_(divLat),
        0,
        1.0,
        true,
        1,
      ),
      divMat,
    ),
  );

  // Finish line: a check in on-call amber and slate.
  const lineTex = canvasTexture(128, 32, (ctx, w, h) => {
    const n = 16;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#f2a03d' : '#2b3440';
        ctx.fillRect((i * w) / n, (j * h) / 4, w / n, h / 4);
      }
    }
  });
  const lineGeo = ribbon(track, 0, 2.5, const_(-hw), const_(hw), 0.05, 0.05, false, 1 / 2.5);
  // Re-map the UVs so the check runs across the road.
  const uv = lineGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, i % 2, uv.getX(i));
  group.add(
    new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ map: lineTex, ...doubleSide })),
  );

  // Grid boxes.
  const gridMat = new THREE.MeshBasicMaterial({
    color: 0xdfe7ef,
    transparent: true,
    opacity: 0.5,
    ...doubleSide,
  });
  const gs = track.def.gridS;
  group.add(
    new THREE.Mesh(
      ribbon(track, gs - 0.2, gs + 0.2, const_(-2), const_(2), 0.05, 0.05, false, 1),
      gridMat,
    ),
  );
  return group;
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cronPosition, type Hazard } from '../logic/hazards';
import type { Race } from '../logic/race';
import { hash01 } from '../logic/rng';
import type { Track } from '../logic/track';
import { TUNING } from '../logic/tuning';
import { canvasTexture } from './textures';
import { ribbon } from './trackMesh';

/** The pages and puddles drawn at most. More in flight than this are not drawn. */
const MAX_PAGES = 16;
const MAX_PUDDLES = 24;
const TRAIL = 4;

/** Item boxes, Pages, puddles and the hazards: all instanced or merged, so a few draw calls. */
export interface PropsHandle {
  group: THREE.Group;
  /** Draw the live props of the race. time: wall seconds, for animation. */
  update(race: Race, time: number): void;
  dispose(): void;
}

const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

/** World position of (s, lateral) at height y. */
function at(track: Track, s: number, lateral: number, y: number): THREE.Vector3 {
  const c = track.pointAt(s);
  const t = track.tangentAt(s);
  return new THREE.Vector3(c.x + lateral * t.z, y, c.z - lateral * t.x);
}

const headingAt = (track: Track, s: number) => {
  const t = track.tangentAt(s);
  return Math.atan2(t.x, t.z);
};

/** A hazard-striped change-request crate: yellow and black with "CR" on each face. */
function crateTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b1f24';
    for (let i = -4; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 24, 0);
      ctx.lineTo(i * 24 + 12, 0);
      ctx.lineTo(i * 24 + 12 + h, h);
      ctx.lineTo(i * 24 + h, h);
      ctx.fill();
    }
    ctx.fillStyle = '#f5f7fa';
    ctx.fillRect(24, 38, 80, 52);
    ctx.fillStyle = '#1b1f24';
    ctx.font = '900 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CR', 64, 66);
    ctx.strokeStyle = '#1b1f24';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  });
}

/** Frost with a snowflake decal in the middle. */
function iceTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(190, 225, 255, 0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
      const x = hash01(1, i) * w;
      const y = hash01(2, i) * h;
      const a = hash01(3, i) * Math.PI;
      const l = 10 + hash01(4, i) * 30;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    // The snowflake: six arms with two barbs each.
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -80);
      ctx.moveTo(0, -48);
      ctx.lineTo(-18, -66);
      ctx.moveTo(0, -48);
      ctx.lineTo(18, -66);
      ctx.stroke();
    }
    ctx.restore();
  });
  return tex;
}

/** A clock face for the cron barrel's ends. */
function clockTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#c8432f';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f5f7fa';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 54, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1f24';
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ctx.fillRect(w / 2 + Math.cos(a) * 44 - 3, h / 2 + Math.sin(a) * 44 - 3, 6, 6);
    }
    ctx.strokeStyle = '#1b1f24';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2, h / 2 - 36);
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + 26, h / 2 + 8);
    ctx.stroke();
  });
}

/** Cable spaghetti: a tangle of thin coloured tubes over each patch, merged into one mesh. */
function cableGeometry(track: Track, patches: readonly Hazard[]): THREE.BufferGeometry | null {
  const colors = [0x4d9de0, 0xf2c14e, 0xe15554, 0x3ddc97, 0xf78fb3, 0xe8eef5];
  const geos: THREE.BufferGeometry[] = [];
  patches.forEach((h, hi) => {
    for (let i = 0; i < 16; i++) {
      const r = (k: number) => hash01(hi, i, k);
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < 6; k++) {
        const s = h.s + h.length * ((k + r(k + 10) * 0.8) / 6);
        const lat = h.lateral + (r(k) - 0.5) * h.width;
        pts.push(at(track, s, lat, 0.06 + r(k + 20) * 0.12));
      }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.05, 4, false);
      const c = new THREE.Color(colors[i % colors.length]);
      const n = tube.attributes.position?.count ?? 0;
      const col = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) col.set([c.r, c.g, c.b], v * 3);
      tube.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geos.push(tube);
    }
  });
  if (geos.length === 0) return null;
  const merged = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  return merged;
}

export function buildProps(track: Track, race: Race): PropsHandle {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
    const m = new THREE.InstancedMesh(keep(geo), keep(mat), n);
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    group.add(m);
    return m;
  };

  // Item boxes.
  const crateTex = keep(crateTexture());
  const boxes = instanced(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.6 }),
    Math.max(1, race.boxes.length),
  );
  const boxPos = race.boxes.map((b) => at(track, b.s, b.lateral, 1.0));

  // Pages: a small pager, a blinking red light and a short trail.
  const pagers = instanced(
    new THREE.BoxGeometry(0.5, 0.22, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x20252c, roughness: 0.4 }),
    MAX_PAGES,
  );
  const lights = instanced(
    new THREE.BoxGeometry(0.16, 0.12, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
    MAX_PAGES,
  );
  const trail = instanced(
    new THREE.BoxGeometry(0.2, 0.2, 0.2),
    new THREE.MeshBasicMaterial({ color: 0xff8a6a, transparent: true, opacity: 0.5 }),
    MAX_PAGES * TRAIL,
  );

  // Puddles: a brown disc and a paper cup on its side.
  const discGeo = new THREE.CircleGeometry(TUNING.puddleRadius, 14);
  discGeo.rotateX(-Math.PI / 2);
  const discs = instanced(
    discGeo,
    new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.15, metalness: 0.1 }),
    MAX_PUDDLES,
  );
  const cupGeo = new THREE.CylinderGeometry(0.13, 0.1, 0.3, 8);
  cupGeo.rotateZ(Math.PI / 2);
  const cups = instanced(
    cupGeo,
    new THREE.MeshStandardMaterial({ color: 0xf5f1e8, roughness: 0.7 }),
    MAX_PUDDLES,
  );

  // Cron barrels: the axis along the road, so they roll across it.
  const crons = race.hazards.filter((h) => h.kind === 'cron');
  const barrelGeo = new THREE.CylinderGeometry(0.8, 0.8, 1.1, 12);
  barrelGeo.rotateX(Math.PI / 2);
  const clockTex = keep(clockTexture());
  const sideMat = keep(new THREE.MeshStandardMaterial({ color: 0xc8432f, roughness: 0.5 }));
  const faceMat = keep(new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.5 }));
  const barrels = new THREE.InstancedMesh(
    keep(barrelGeo),
    [sideMat, faceMat, faceMat],
    Math.max(1, crons.length),
  );
  barrels.frustumCulled = false;
  barrels.count = crons.length;
  barrels.castShadow = true;
  group.add(barrels);

  // Cables and ice: static, merged.
  const cableGeo = cableGeometry(
    track,
    race.hazards.filter((h) => h.kind === 'cable'),
  );
  if (cableGeo) {
    const mesh = new THREE.Mesh(
      keep(cableGeo),
      keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 })),
    );
    group.add(mesh);
  }
  const ice = race.hazards.filter((h) => h.kind === 'ice');
  if (ice.length > 0) {
    const geos = ice.map((h) =>
      ribbon(
        track,
        h.s,
        h.s + h.length,
        () => h.lateral - h.width / 2,
        () => h.lateral + h.width / 2,
        0.035,
        0.035,
        false,
        1 / h.length,
      ),
    );
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    if (merged) {
      const iceTex = keep(iceTexture());
      const mesh = new THREE.Mesh(
        keep(merged),
        keep(
          new THREE.MeshStandardMaterial({
            map: iceTex,
            transparent: true,
            roughness: 0.1,
            metalness: 0.2,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            side: THREE.DoubleSide,
          }),
        ),
      );
      group.add(mesh);
    }
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();

  return {
    group,
    update(r: Race, time: number) {
      // Boxes bob and spin; a picked box is gone until it respawns.
      boxes.count = r.boxes.length;
      r.boxes.forEach((b, i) => {
        const p = boxPos[i];
        if (!p || r.time < b.respawnAt) {
          boxes.setMatrixAt(i, hidden);
          return;
        }
        e.set(0.35, time * 1.6 + i, 0);
        pos.set(p.x, p.y + Math.sin(time * 3 + i) * 0.15, p.z);
        boxes.setMatrixAt(i, m4.compose(pos, q.setFromEuler(e), one));
      });
      boxes.instanceMatrix.needsUpdate = true;

      const pages = r.projectiles.slice(0, MAX_PAGES);
      pagers.count = pages.length;
      lights.count = pages.length;
      trail.count = pages.length * TRAIL;
      const blink = Math.floor(time * 6) % 2 === 0;
      pages.forEach((pg, i) => {
        const h = headingAt(track, pg.s);
        q.setFromEuler(e.set(0, h, 0));
        const p = at(track, pg.s, pg.lateral, 0.9 + Math.sin(time * 10 + i) * 0.08);
        pagers.setMatrixAt(i, m4.compose(p, q, one));
        pos.set(p.x, p.y + 0.16, p.z);
        lights.setMatrixAt(i, blink ? m4.compose(pos, q, one) : hidden);
        for (let k = 0; k < TRAIL; k++) {
          const back = (k + 1) * 0.6;
          const sc = 1 - k * 0.22;
          const tp = at(track, pg.s - back, pg.lateral, p.y);
          trail.setMatrixAt(i * TRAIL + k, m4.compose(tp, q, new THREE.Vector3(sc, sc, sc)));
        }
      });
      pagers.instanceMatrix.needsUpdate = true;
      lights.instanceMatrix.needsUpdate = true;
      trail.instanceMatrix.needsUpdate = true;

      const puddles = r.puddles.slice(0, MAX_PUDDLES);
      discs.count = puddles.length;
      cups.count = puddles.length;
      puddles.forEach((pd, i) => {
        const h = headingAt(track, pd.s);
        const p = at(track, pd.s, pd.lateral, 0.045);
        discs.setMatrixAt(i, m4.compose(p, q.setFromEuler(e.set(0, 0, 0)), one));
        const cp = at(track, pd.s + 0.3, pd.lateral + 0.4, 0.13);
        cups.setMatrixAt(i, m4.compose(cp, q.setFromEuler(e.set(0, h + pd.id, 0)), one));
      });
      discs.instanceMatrix.needsUpdate = true;
      cups.instanceMatrix.needsUpdate = true;

      crons.forEach((h, i) => {
        const c = cronPosition(h, r.time, track);
        const p = at(track, c.s, c.lateral, 0.8);
        // Roll: the angle is the distance travelled over the radius.
        e.set(0, headingAt(track, c.s), 0);
        q.setFromEuler(e);
        const roll = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          -c.lateral / 0.8,
        );
        barrels.setMatrixAt(i, m4.compose(p, q.multiply(roll), one));
      });
      barrels.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      barrels.dispose();
      group.clear();
    },
  };
}

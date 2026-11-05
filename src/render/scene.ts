import * as THREE from 'three';
import { DRIVERS } from '../logic/drivers';
import { driftStage } from '../logic/kart';
import type { Race, RaceEvent } from '../logic/race';
import { createChaseCamera } from './camera';
import { buildGates, type GatesHandle } from './gates';
import { buildHall } from './hall';
import { buildKart, type KartMesh } from './kartMesh';
import { createSparks } from './sparks';
import { buildTrackMesh } from './trackMesh';

export interface SceneHandle {
  /** Draw the race. alpha in [0, 1] blends the last captured state toward the current one. */
  render(race: Race, alpha: number): void;
  /** Store the kart poses before a logic step, for interpolation. */
  capture(race: Race): void;
  onEvents(events: RaceEvent[]): void;
  /** Point the scene at a new race on the same track: new gates, kart colors, camera snap. */
  reset(race: Race): void;
  resize(): void;
  dispose(): void;
  readonly renderer: THREE.WebGLRenderer;
}

const FOG = 0x0a1422;

interface Pose {
  x: number;
  z: number;
  heading: number;
}

export function createScene(canvas: HTMLCanvasElement, initial: Race): SceneHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.Fog(FOG, 40, 170);

  // Cold-aisle light: blue from above, dark floor bounce, one cool key light.
  scene.add(new THREE.HemisphereLight(0x7fb2ff, 0x1a2230, 1.6));
  const key = new THREE.DirectionalLight(0xdfeaff, 1.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -20;
  key.shadow.camera.right = 20;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 80;
  scene.add(key);
  scene.add(key.target);

  let race = initial;
  const hall = buildHall(race.track);
  scene.add(hall.group);
  const trackMesh = buildTrackMesh(race.track);
  scene.add(trackMesh);

  let gates: GatesHandle = buildGates(race.track, race.board);
  scene.add(gates.group);

  const karts: KartMesh[] = [];
  const sparks = createSparks();
  scene.add(sparks.points);

  const chase = createChaseCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight));
  let prev: Pose[] = [];
  let lastTime = performance.now();
  let shake = 0;
  let snap = true;

  const color = (i: number) => {
    if (i === race.playerId) return DRIVERS[race.config.driverColor]?.color ?? 0xff6b35;
    return DRIVERS[(race.config.driverColor + i) % DRIVERS.length]?.color ?? 0xffffff;
  };

  const syncKarts = () => {
    while (karts.length < race.karts.length) {
      const k = buildKart(0xffffff);
      karts.push(k);
      scene.add(k.group);
    }
    while (karts.length > race.karts.length) {
      const k = karts.pop();
      if (k) {
        scene.remove(k.group);
        k.dispose();
      }
    }
    karts.forEach((k, i) => k.setColor(color(i)));
  };
  syncKarts();

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    chase.resize(w / Math.max(1, h));
  };
  resize();
  window.addEventListener('resize', resize);

  const capture = (r: Race) => {
    prev = r.karts.map((k) => ({ x: k.kart.pos.x, z: k.kart.pos.z, heading: k.kart.heading }));
  };
  capture(race);

  const lerpAngle = (a: number, b: number, t: number) =>
    a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

  return {
    renderer,
    capture,
    render(r: Race, alpha: number) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      race = r;
      if (karts.length !== r.karts.length) syncKarts();

      let player: Pose | null = null;
      r.karts.forEach((k, i) => {
        const mesh = karts[i];
        if (!mesh) return;
        const p = prev[i] ?? { x: k.kart.pos.x, z: k.kart.pos.z, heading: k.kart.heading };
        const pose = {
          x: p.x + (k.kart.pos.x - p.x) * alpha,
          z: p.z + (k.kart.pos.z - p.z) * alpha,
          heading: lerpAngle(p.heading, k.kart.heading, alpha),
        };
        mesh.group.position.set(pose.x, 0, pose.z);
        mesh.group.rotation.y = pose.heading;
        // Effects: spin-out turns the body; a drift yaws it into the turn.
        const spin = k.kart.spinTime > 0 ? k.kart.spinTime * 14 : 0;
        const driftYaw = k.kart.driftDir * 0.35;
        mesh.body.rotation.y += (spin + driftYaw - mesh.body.rotation.y) * (spin ? 1 : 0.2);
        mesh.body.position.y = k.kart.holdTime > 0 ? 0 : Math.abs(Math.sin(now / 90)) * 0.02;
        for (const w of mesh.wheels) w.rotation.x += (k.kart.speed * dt) / 0.28;
        if (i === r.playerId) player = pose;
      });

      const pk = r.karts[r.playerId];
      if (pk && player) {
        const pose: Pose = player;
        chase.update(pose.x, pose.z, pose.heading, pk.kart.boostTime > 0, dt, snap);
        snap = false;
        const drifting = pk.kart.driftDir !== 0;
        sparks.update(
          dt,
          drifting
            ? { x: pose.x, z: pose.z, heading: pose.heading, stage: driftStage(pk.kart.driftTime) }
            : null,
        );
        key.position.set(pose.x + 10, 30, pose.z + 6);
        key.target.position.set(pose.x, 0, pose.z);
      }
      if (shake > 0) {
        shake = Math.max(0, shake - dt);
        chase.camera.position.x += (Math.random() - 0.5) * shake * 0.8;
        chase.camera.position.y += (Math.random() - 0.5) * shake * 0.8;
      }
      hall.update(now / 1000);
      renderer.render(scene, chase.camera);
    },
    onEvents(events: RaceEvent[]) {
      let reshuffled = false;
      for (const e of events) {
        if (e.type === 'board-reshuffled') {
          for (const row of e.rows) gates.redrawRow(race.board, row);
          reshuffled = true;
        }
        if (e.type === 'sla-breach' && e.kartId === race.playerId) shake = 0.6;
        if (e.type === 'wrong-gate' && e.kartId === race.playerId) shake = Math.max(shake, 0.25);
      }
      if (reshuffled) gates.sync(race.board);
    },
    reset(r: Race) {
      race = r;
      scene.remove(gates.group);
      gates.dispose();
      gates = buildGates(r.track, r.board);
      scene.add(gates.group);
      syncKarts();
      sparks.clear();
      capture(r);
      shake = 0;
      snap = true;
    },
    resize,
    dispose() {
      window.removeEventListener('resize', resize);
      gates.dispose();
      for (const k of karts) k.dispose();
      sparks.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            const map = (m as THREE.MeshStandardMaterial).map;
            map?.dispose();
            m.dispose();
          }
        }
      });
      renderer.dispose();
    },
  };
}

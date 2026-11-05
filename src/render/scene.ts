import * as THREE from 'three';
import { DRIVERS } from '../logic/drivers';
import { driftStage } from '../logic/kart';
import type { Race, RaceEvent } from '../logic/race';
import { createChaseCamera } from './camera';
import { buildGates, type GatesHandle } from './gates';
import { buildHall } from './hall';
import { buildFleet } from './kartMesh';
import { buildProps, type PropsHandle } from './props';
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
  /**
   * Screen position (CSS px) of each kart's name tag in the last frame, and
   * its distance from the camera; null when the kart is behind the camera.
   */
  tags(): ReadonlyArray<{ x: number; y: number; dist: number } | null>;
}

/** Karts the fleet can draw: the player and 7 bots. */
const MAX_KARTS = 8;

const FOG = 0x22385a;

interface Pose {
  x: number;
  z: number;
  heading: number;
}

export interface SceneOptions {
  /** Phones and tablets: pixel ratio capped at 1.5 and no shadows. */
  lowPower?: boolean;
}

export function createScene(
  canvas: HTMLCanvasElement,
  initial: Race,
  options: SceneOptions = {},
): SceneHandle {
  const lowPower = options.lowPower ?? false;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.Fog(FOG, 60, 190);

  // Cold-aisle light: blue from above, dark floor bounce, one cool key light.
  scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x3a4658, 3.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.castShadow = !lowPower;
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

  const fleet = buildFleet(MAX_KARTS);
  scene.add(fleet.group);
  let props: PropsHandle = buildProps(race.track, race);
  scene.add(props.group);
  let wheelSpin: number[] = [];
  let bodyYaw: number[] = [];
  let tagPos: Array<{ x: number; y: number; dist: number } | null> = [];
  const v3 = new THREE.Vector3();
  const sparks = createSparks();
  scene.add(sparks.points);

  const chase = createChaseCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight));
  let prev: Pose[] = [];
  let lastTime = performance.now();
  let shake = 0;
  let snap = true;

  const syncKarts = () => {
    fleet.setCount(race.karts.length);
    race.karts.forEach((k, i) => fleet.setColor(i, DRIVERS[k.driverIndex]?.color ?? 0xffffff));
    wheelSpin = race.karts.map(() => 0);
    bodyYaw = race.karts.map(() => 0);
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
      if (wheelSpin.length !== r.karts.length) syncKarts();

      let player: Pose | null = null;
      const poses: Pose[] = [];
      r.karts.forEach((k, i) => {
        const p = prev[i] ?? { x: k.kart.pos.x, z: k.kart.pos.z, heading: k.kart.heading };
        const pose = {
          x: p.x + (k.kart.pos.x - p.x) * alpha,
          z: p.z + (k.kart.pos.z - p.z) * alpha,
          heading: lerpAngle(p.heading, k.kart.heading, alpha),
        };
        // Effects: spin-out turns the body; a drift yaws it into the turn.
        const spin = k.kart.spinTime > 0 ? k.kart.spinTime * 14 : 0;
        const driftYaw = k.kart.driftDir * 0.35;
        const yaw = bodyYaw[i] ?? 0;
        bodyYaw[i] = yaw + (spin + driftYaw - yaw) * (spin ? 1 : 0.2);
        wheelSpin[i] = (wheelSpin[i] ?? 0) + (k.kart.speed * dt) / 0.28;
        fleet.setPose(i, {
          ...pose,
          bodyYaw: bodyYaw[i] ?? 0,
          bodyY: k.kart.holdTime > 0 ? 0 : Math.abs(Math.sin(now / 90 + i)) * 0.02,
          wheelSpin: wheelSpin[i] ?? 0,
          shield: k.shieldTime > 0,
        });
        poses[i] = pose;
        if (i === r.playerId) player = pose;
      });
      fleet.commit();
      props.update(r, now / 1000);

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

      // Name tags: project a point above each kart to the canvas.
      const w = canvas.clientWidth;
      const hgt = canvas.clientHeight;
      // The interpolated pose, as drawn: the raw logic position jitters.
      tagPos = r.karts.map((k, i) => {
        const pose = poses[i] ?? { x: k.kart.pos.x, z: k.kart.pos.z };
        v3.set(pose.x, 2.1, pose.z);
        const dist = v3.distanceTo(chase.camera.position);
        v3.project(chase.camera);
        if (v3.z > 1 || v3.z < -1) return null;
        return { x: ((v3.x + 1) / 2) * w, y: ((1 - v3.y) / 2) * hgt, dist };
      });
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
        if (e.type === 'hit' && e.kartId === race.playerId && e.outcome === 'spun') {
          shake = Math.max(shake, 0.3);
        }
      }
      if (reshuffled) gates.sync(race.board);
    },
    reset(r: Race) {
      race = r;
      scene.remove(gates.group);
      gates.dispose();
      gates = buildGates(r.track, r.board);
      scene.add(gates.group);
      scene.remove(props.group);
      props.dispose();
      props = buildProps(r.track, r);
      scene.add(props.group);
      syncKarts();
      sparks.clear();
      capture(r);
      shake = 0;
      snap = true;
    },
    resize,
    tags: () => tagPos,
    dispose() {
      window.removeEventListener('resize', resize);
      gates.dispose();
      fleet.dispose();
      props.dispose();
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

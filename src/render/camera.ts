import * as THREE from 'three';

const BACK = 7.5;
const UP = 3.4;
const LOOK_AHEAD = 5;
const BASE_FOV = 68;
const BOOST_FOV = 78;

/** Horizontal field of view, degrees, that a tall (portrait) screen keeps at least. */
const MIN_HFOV = 56;
/** Upper bound on the vertical field of view, degrees, so a tall screen does not fish-eye. */
const MAX_VFOV = 96;

const RAD = Math.PI / 180;

/**
 * Vertical field of view for an aspect ratio (width / height). Landscape keeps
 * the base value. Portrait widens it, so the road ahead stays in view.
 */
export function fovForAspect(aspect: number, baseFov: number): number {
  if (aspect >= 1) return baseFov;
  const v = (2 * Math.atan(Math.tan((MIN_HFOV * RAD) / 2) / Math.max(0.1, aspect))) / RAD;
  return Math.min(MAX_VFOV, Math.max(baseFov, v));
}

export interface ChaseCamera {
  camera: THREE.PerspectiveCamera;
  /** Follow the kart. dt in seconds; boosting widens the view. */
  update(
    x: number,
    z: number,
    heading: number,
    boosting: boolean,
    dt: number,
    snap?: boolean,
  ): void;
  resize(aspect: number): void;
}

export function createChaseCamera(aspect: number): ChaseCamera {
  const camera = new THREE.PerspectiveCamera(fovForAspect(aspect, BASE_FOV), aspect, 0.1, 600);
  const target = new THREE.Vector3();
  const look = new THREE.Vector3();
  let camHeading = 0;
  return {
    camera,
    update(x, z, heading, boosting, dt, snap = false) {
      // Lag the heading a little, so turns read as turns.
      const d = Math.atan2(Math.sin(heading - camHeading), Math.cos(heading - camHeading));
      const kHead = snap ? 1 : 1 - Math.exp(-dt * 5);
      camHeading += d * kHead;
      const fx = Math.sin(camHeading);
      const fz = Math.cos(camHeading);
      target.set(x - fx * BACK, UP, z - fz * BACK);
      const kPos = snap ? 1 : 1 - Math.exp(-dt * 10);
      camera.position.lerp(target, kPos);
      look.set(x + fx * LOOK_AHEAD, 1, z + fz * LOOK_AHEAD);
      camera.lookAt(look);
      const fov = fovForAspect(camera.aspect, BASE_FOV) + (boosting ? BOOST_FOV - BASE_FOV : 0);
      const next = camera.fov + (fov - camera.fov) * (1 - Math.exp(-dt * 4));
      if (Math.abs(next - camera.fov) > 0.01) {
        camera.fov = next;
        camera.updateProjectionMatrix();
      }
    },
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
  };
}

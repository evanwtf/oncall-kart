import { describe, expect, it } from 'vitest';
import { fovForAspect } from '../src/render/camera';

describe('fovForAspect', () => {
  it('keeps the base field of view in landscape and at square', () => {
    expect(fovForAspect(16 / 9, 68)).toBe(68);
    expect(fovForAspect(1, 68)).toBe(68);
  });

  it('widens for a portrait phone (375 x 667)', () => {
    const v = fovForAspect(375 / 667, 68);
    // tan(28 deg) / 0.562 gives about 87 degrees vertical.
    expect(v).toBeGreaterThan(84);
    expect(v).toBeLessThan(90);
  });

  it('widens more as the screen gets taller, up to a cap', () => {
    expect(fovForAspect(0.5, 68)).toBeGreaterThan(fovForAspect(0.7, 68));
    expect(fovForAspect(0.2, 68)).toBe(96);
  });

  it('never narrows below the base value', () => {
    expect(fovForAspect(0.95, 68)).toBe(68);
  });
});

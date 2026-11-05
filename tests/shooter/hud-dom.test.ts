// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TICKET_TYPES } from '../../src/logic/runbooks';
import { frontPoint } from '../../src/shooter/logic/floor';
import {
  breakRack,
  createShift,
  facingTarget,
  stepShift,
  yawToward,
  type Shift,
} from '../../src/shooter/logic/shift';
import { createShooterHud } from '../../src/shooter/ui/hud';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** A shift with a broken rack in view and a step picked. */
function scene(): Shift {
  const s = createShift(1);
  const rack = s.floor.racks.find((r) => !s.patches.some((p) => p.targetId === r.id));
  const type = TICKET_TYPES[0];
  if (!rack || !type) throw new Error('setup');
  breakRack(s, rack.id, type);
  const p = frontPoint(rack, 0.8);
  s.player.x = p.x;
  s.player.z = p.z;
  s.player.yaw = yawToward(p.x, p.z, rack.x, rack.z);
  stepShift(
    s,
    { move: { forward: 0, strafe: 0 }, yaw: s.player.yaw, pitch: 0, work: false, pick: 'MAINT' },
    1 / 120,
  );
  return s;
}

describe('shooter hud in the DOM', () => {
  it('draws the floor map base once at a fractional pixel ratio', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.7999999 });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const hud = createShooterHud(root);
    const s = scene();
    const create = vi.spyOn(document, 'createElement');
    hud.update(s, facingTarget(s));
    hud.update(s, facingTarget(s));
    hud.update(s, facingTarget(s));
    const canvases = create.mock.calls.filter(([tag]) => tag === 'canvas').length;
    expect(canvases).toBe(1);
  });

  it('changes nothing in the DOM when nothing changed', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const hud = createShooterHud(root);
    hud.el.hidden = false;
    const s = scene();
    const mutationsOfRepeat = (facing: boolean) => {
      hud.update(s, facing ? facingTarget(s) : null);
      const obs = new MutationObserver(() => undefined);
      obs.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
      hud.update(s, facing ? facingTarget(s) : null);
      const records = obs.takeRecords();
      obs.disconnect();
      return records.map(
        (r) => `${r.type}:${(r.target as Element).className ?? ''}:${r.attributeName ?? ''}`,
      );
    };
    expect(facingTarget(s)).not.toBeNull();
    expect(mutationsOfRepeat(true)).toEqual([]);
    expect(mutationsOfRepeat(false)).toEqual([]);
  });
});

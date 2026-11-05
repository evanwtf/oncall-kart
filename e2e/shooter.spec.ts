import { expect, test, type Page } from '@playwright/test';
import type { ShooterHooks } from '../src/shooter/game';
import { PANEL_STEPS } from '../src/shooter/logic/shift';

const URL = '/oncall-kart/?game=shooter&seed=1&debug=1';

/** Collect console errors and page errors. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

const screen = (page: Page) => page.evaluate(() => window.__oncallShooter?.screen() ?? null);

async function open(page: Page) {
  await page.goto(URL);
  await expect.poll(() => screen(page), { timeout: 15_000 }).toBe('briefing');
}

async function start(page: Page) {
  await page.evaluate(() => window.__oncallShooter?.start?.());
  await expect.poll(() => screen(page)).toBe('playing');
}

async function face(page: Page, id: string) {
  await page.evaluate((target) => window.__oncallShooter?.faceTarget?.(target), id);
}

/** Where one rack's ticket stands: its next step, 'closed', plus the wrong-step count. */
const rackState = (page: Page, rackId: string) =>
  page.evaluate((id) => {
    const h = window.__oncallShooter as ShooterHooks;
    const t = h.openTickets().find((x) => x.rackId === id);
    return `${t ? t.next : 'closed'}/${h.stats().wrongSteps}`;
  }, rackId);

/**
 * Hold E until `done` holds, then let go. Game time can run slower than the
 * wall clock on a slow software-GL frame, so a fixed hold is not enough.
 */
async function holdUntil(page: Page, done: () => Promise<boolean>, timeout = 30_000) {
  await page.keyboard.down('KeyE');
  try {
    await expect.poll(done, { timeout, intervals: [50, 100, 200] }).toBe(true);
  } finally {
    await page.keyboard.up('KeyE');
  }
}

/** Pick a step with its number key, then hold E until the rack's ticket moves. */
async function doStep(page: Page, rackId: string, step: string) {
  const key = PANEL_STEPS.indexOf(step as (typeof PANEL_STEPS)[number]) + 1;
  expect(key).toBeGreaterThan(0);
  const before = await rackState(page, rackId);
  await page.keyboard.press(`Digit${key}`);
  await holdUntil(page, async () => (await rackState(page, rackId)) !== before);
}

/** Two animation frames: every queued input is handled by then. */
const twoFrames = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );

/**
 * Keep the browser from taking a real lock: a headless Chromium on Linux
 * grants one, and a real lock under a faked pointerLockElement sends the
 * mouse to the canvas, so menu clicks miss.
 */
const noRealLock = (page: Page) =>
  page.addInitScript(() => {
    Element.prototype.requestPointerLock = function () {
      return Promise.resolve();
    } as Element['requestPointerLock'];
  });

/** Pretend the browser took (canvas) or ended (null) the mouse lock. */
const fakeLock = (page: Page, locked: boolean) =>
  page.evaluate((on) => {
    const canvas = document.getElementById('game');
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => (on ? canvas : null),
    });
    document.dispatchEvent(new Event('pointerlockchange'));
  }, locked);

const stats = (page: Page) => page.evaluate(() => window.__oncallShooter?.stats());

test('a shift: walk, fix a rack, a wrong step, pause, and fired at 0:00', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await open(page);
  await expect(page.locator('.zd-brief-patch')).toHaveCount(3);
  await expect(page.locator('.zd-briefing')).toContainText('Click to start');

  await start(page);
  const before = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).player());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).player());
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1);

  // Break r1 and fix it: FW-ISO (key 5), then REINSTATE (key 4).
  await page.evaluate(() =>
    (window.__oncallShooter as ShooterHooks).breakNow?.('r1', 'outdated-firmware'),
  );
  await face(page, 'r1');
  await expect(page.locator('.zd-panel')).toBeVisible();
  await expect(page.locator('.zd-panel-head')).toContainText('r1-u');
  await doStep(page, 'r1', 'FW-ISO');
  expect(await rackState(page, 'r1')).toBe('REINSTATE/0');
  await doStep(page, 'r1', 'REINSTATE');
  expect(await rackState(page, 'r1')).toBe('closed/0');
  expect((await stats(page))?.ticketsClosed).toBe(1);

  // A wrong step: MAINT (key 1) on a firmware ticket.
  await page.evaluate(() =>
    (window.__oncallShooter as ShooterHooks).breakNow?.('r2', 'outdated-firmware'),
  );
  await face(page, 'r2');
  await doStep(page, 'r2', 'MAINT');
  expect(await rackState(page, 'r2')).toBe('FW-ISO/1');
  expect((await stats(page))?.wrongSteps).toBe(1);

  const info = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).renderInfo());
  test.info().annotations.push({ type: 'renderInfo', description: JSON.stringify(info) });
  console.log(`renderInfo mid-shift (${test.info().project.name}): ${JSON.stringify(info)}`);
  expect(info.calls).toBeGreaterThan(0);
  expect(info.calls).toBeLessThan(150);

  // P pauses; Resume returns to the shift.
  await page.keyboard.press('KeyP');
  await expect.poll(() => screen(page)).toBe('paused');
  await page.locator('.zd-pause .menu-item', { hasText: 'Resume' }).click();
  await expect.poll(() => screen(page)).toBe('playing');

  // The clock runs out with no patch applied: fired.
  await page.evaluate(() => (window.__oncallShooter as ShooterHooks).setClockLeft?.(1));
  await expect
    .poll(() => page.evaluate(() => (window.__oncallShooter as ShooterHooks).ending()), {
      timeout: 10_000,
    })
    .toBe('fired');
  await expect.poll(() => screen(page)).toBe('ended');
  await expect(page.locator('.zd-ended')).toBeVisible();
  await expect(page.locator('.zd-end-title')).toHaveText('Fired');
  expect(errors).toEqual([]);
});

test('every patch applied and nothing broken: a clean shift', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await open(page);
  await start(page);
  const patches = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).patches());
  expect(patches).toHaveLength(3);
  for (const p of patches) {
    await face(page, p.targetId);
    await holdUntil(page, () =>
      page.evaluate(
        (id) =>
          !!(window.__oncallShooter as ShooterHooks).patches().find((x) => x.id === id)?.applied,
        p.id,
      ),
    );
  }
  await expect(page.locator('.zd-patch.applied')).toHaveCount(3);

  // Fix whatever broke meanwhile, by its runbook. The check for no open
  // ticket and the jump of the clock run in one evaluate, so no break can
  // land between them.
  let done = false;
  for (let guard = 0; guard < 60 && !done; guard++) {
    const next = await page.evaluate(() => {
      const h = window.__oncallShooter as ShooterHooks;
      const t = h.openTickets()[0];
      if (t) return t;
      h.setClockLeft?.(1);
      return null;
    });
    if (next === null) {
      done = true;
      break;
    }
    if (next.next === null) continue;
    await face(page, next.rackId);
    await doStep(page, next.rackId, next.next);
  }
  expect(done).toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window.__oncallShooter as ShooterHooks).ending()), {
      timeout: 10_000,
    })
    .toBe('clean');
  await expect(page.locator('.zd-end-title')).toHaveText('Clean shift');
  expect(errors).toEqual([]);
});

test('a lost mouse lock pauses, and a blur or a hidden tab after it does not resume', async ({
  page,
}) => {
  await noRealLock(page);
  const errors = trackErrors(page);
  await open(page);
  await start(page);
  // The lock ends (Esc in the browser), then the window loses focus.
  await fakeLock(page, true);
  await twoFrames(page);
  // In one task, so no frame runs between the lost lock and the blur.
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
    document.dispatchEvent(new Event('pointerlockchange'));
    window.dispatchEvent(new Event('blur'));
  });
  await twoFrames(page);
  await twoFrames(page);
  expect(await screen(page)).toBe('paused');

  // Again, with a hidden tab instead of a blur.
  await page.locator('.zd-pause .menu-item', { hasText: 'Resume' }).click();
  await expect.poll(() => screen(page)).toBe('playing');
  await fakeLock(page, true);
  await twoFrames(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
    document.dispatchEvent(new Event('pointerlockchange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await twoFrames(page);
  await twoFrames(page);
  expect(await screen(page)).toBe('paused');
  expect(errors).toEqual([]);
});

test('a lock granted after the shift paused is given back', async ({ page }) => {
  await noRealLock(page);
  const errors = trackErrors(page);
  await open(page);
  await start(page);
  await page.keyboard.press('KeyP');
  await expect.poll(() => screen(page)).toBe('paused');
  await page.evaluate(() => {
    const w = window as unknown as { exits: number };
    w.exits = 0;
    document.exitPointerLock = () => {
      w.exits += 1;
    };
  });
  // A lock asked for before the pause lands late.
  await fakeLock(page, true);
  await twoFrames(page);
  expect(await page.evaluate(() => (window as unknown as { exits: number }).exits)).toBeGreaterThan(
    0,
  );
  expect(await screen(page)).toBe('paused');
  expect(errors).toEqual([]);
});

test('the start screen opens the shooter, and the briefing goes back to it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/oncall-kart/?seed=1&debug=1');
  await page.locator('button[data-game="shooter"]').click();
  await page.waitForURL(/game=shooter/);
  await expect.poll(() => screen(page), { timeout: 15_000 }).toBe('briefing');
  await page.locator('.zd-briefing .action', { hasText: 'Start screen' }).click();
  await page.waitForURL((u) => !u.searchParams.has('game'));
  await expect(page.locator('button[data-game]')).toHaveCount(2);
  expect(errors).toEqual([]);
});

const speedFactor = (page: Page) =>
  page.evaluate(() => (window.__oncallShooter as ShooterHooks).speedFactor());
const budget = (page: Page) =>
  page.evaluate(() => (window.__oncallShooter as ShooterHooks).budget());

test('vendors arrive from the dock', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await start(page);
  // Jump to 9 s: the first vendor comes at 12-18 s.
  await page.evaluate(() => (window.__oncallShooter as ShooterHooks).setClockLeft?.(180 - 9));
  await expect
    .poll(() => page.evaluate(() => (window.__oncallShooter as ShooterHooks).vendors().length), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  const left = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).clockLeft());
  // By 30 s into the shift.
  expect(180 - left).toBeLessThanOrEqual(30);
  const v = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).vendors()[0]);
  expect(v?.x ?? 0).toBeGreaterThan(90);
  expect(errors).toEqual([]);
});

test('three close vendors slow you to 40%; the money gun frees you', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = trackErrors(page);
  await open(page);
  await start(page);
  // Three vendors 1.5 m in front of the player, in the break room.
  await page.evaluate(() => {
    const h = window.__oncallShooter as ShooterHooks;
    const p = h.player();
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    for (const side of [-0.6, 0, 0.6]) {
      h.spawnVendor?.('renewal-rep', p.x + fx * 1.5 - fz * side, p.z + fz * 1.5 + fx * side);
    }
  });
  await expect.poll(() => speedFactor(page)).toBeCloseTo(0.4, 9);
  await expect(page.locator('.zd-speed')).toHaveText('Speed 40% · 3 vendors close');

  // Aim at each vendor that is not distracted, and hold fire.
  const startLeft = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).clockLeft());
  await page.evaluate(() => (window.__oncallShooter as ShooterHooks).fire?.(true));
  try {
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const h = window.__oncallShooter as ShooterHooks;
            const v = h.vendors().find((x) => !x.distracted);
            if (v) h.lookAt?.(v.x, v.z);
            return h.speedFactor();
          }),
        { timeout: 20_000, intervals: [16, 33, 50] },
      )
      .toBe(1);
  } finally {
    await page.evaluate(() => (window.__oncallShooter as ShooterHooks).fire?.(false));
  }
  const endLeft = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).clockLeft());
  // Within 2 s of shift time.
  expect(startLeft - endLeft).toBeLessThanOrEqual(2);
  expect(await budget(page)).toBeLessThan(20000);
  const vendors = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).vendors());
  expect(vendors.every((v) => v.distracted)).toBe(true);
  expect((await stats(page))?.vendorsDistracted).toBeGreaterThanOrEqual(3);
  await expect(page.locator('.zd-speed')).toBeHidden();
  expect(errors).toEqual([]);
});

test('with no budget the gun only clicks', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await start(page);
  await page.evaluate(() => (window.__oncallShooter as ShooterHooks).setBudget?.(0));
  await page.evaluate(() => (window.__oncallShooter as ShooterHooks).fire?.(true));
  await page.waitForTimeout(500);
  await page.evaluate(() => (window.__oncallShooter as ShooterHooks).fire?.(false));
  expect(await budget(page)).toBe(0);
  expect((await stats(page))?.moneySpent).toBe(0);
  await expect(page.locator('.zd-budget')).toHaveText('$0');
  await expect(page.locator('.zd-budget')).toHaveClass(/empty/);
  expect(errors).toEqual([]);
});

test('20 vendors and the gun stay within the draw-call budget', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await start(page);
  await page.evaluate(() => {
    const h = window.__oncallShooter as ShooterHooks;
    const roles = [
      'account-exec',
      'renewal-rep',
      'license-auditor',
      'support-agent',
      'solutions-architect',
    ] as const;
    for (let i = 0; i < 20; i++)
      h.spawnVendor?.(roles[i % 5] ?? 'renewal-rep', 9 + (i % 5), 15 + Math.floor(i / 5) * 1.5);
    h.lookAt?.(11, 17);
    h.fire?.(true);
  });
  await page.waitForTimeout(500);
  await twoFrames(page);
  const info = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).renderInfo());
  await page.evaluate(() => (window.__oncallShooter as ShooterHooks).fire?.(false));
  const n = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).vendors().length);
  expect(n).toBe(20);
  test
    .info()
    .annotations.push({ type: 'renderInfo-20-vendors', description: JSON.stringify(info) });
  console.log(`renderInfo with 20 vendors (${test.info().project.name}): ${JSON.stringify(info)}`);
  expect(info.calls).toBeGreaterThan(0);
  expect(info.calls).toBeLessThan(150);
  expect(errors).toEqual([]);
});

test('a pause freezes the vendors', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await start(page);
  await page.evaluate(() =>
    (window.__oncallShooter as ShooterHooks).spawnVendor?.('account-exec', 20, 18),
  );
  await page.keyboard.press('KeyP');
  await expect.poll(() => screen(page)).toBe('paused');
  const before = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).vendors());
  await page.waitForTimeout(500);
  await twoFrames(page);
  const after = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).vendors());
  expect(after).toEqual(before);
  // Resumed, it walks again.
  await page.keyboard.press('KeyP');
  await expect.poll(() => screen(page)).toBe('playing');
  await expect
    .poll(() => page.evaluate(() => (window.__oncallShooter as ShooterHooks).vendors()[0]?.x))
    .toBeLessThan(before[0]?.x ?? 0);
  expect(errors).toEqual([]);
});

test('the debug spawn takes only real roles, and no more than 20 vendors', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await start(page);
  const n = await page.evaluate(() => {
    const h = window.__oncallShooter as ShooterHooks;
    h.spawnVendor?.('toString' as never, 20, 18);
    h.spawnVendor?.('constructor' as never, 20, 18);
    for (let i = 0; i < 25; i++)
      h.spawnVendor?.('renewal-rep', 10 + (i % 5), 15 + Math.floor(i / 5));
    return h.vendors();
  });
  expect(n).toHaveLength(20);
  expect(n.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z))).toBe(true);
  expect(n.every((v) => v.role === 'renewal-rep')).toBe(true);
  expect(errors).toEqual([]);
});

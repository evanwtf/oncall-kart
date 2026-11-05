import { expect, test, type Page } from '@playwright/test';
import type { ShooterHooks } from '../src/shooter/game';
import { PANEL_STEPS } from '../src/shooter/logic/shift';
import { SHOOTER_TUNING } from '../src/shooter/logic/tuning';

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

/** Pick a step with its number key, then hold E long enough for it to finish. */
async function doStep(page: Page, step: string) {
  const key = PANEL_STEPS.indexOf(step as (typeof PANEL_STEPS)[number]) + 1;
  expect(key).toBeGreaterThan(0);
  await page.keyboard.press(`Digit${key}`);
  const seconds = step === 'PIT' ? SHOOTER_TUNING.handsOnSeconds : SHOOTER_TUNING.opSeconds;
  await holdE(page, (seconds + 0.5) * 1000);
}

async function holdE(page: Page, ms: number) {
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(ms);
  await page.keyboard.up('KeyE');
}

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
  await page.keyboard.press('Digit5');
  await holdE(page, 2500);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__oncallShooter as ShooterHooks).openTickets().find((t) => t.rackId === 'r1')
            ?.next,
      ),
    )
    .toBe('REINSTATE');
  await page.keyboard.press('Digit4');
  await holdE(page, 2500);
  const open1 = await page.evaluate(() =>
    (window.__oncallShooter as ShooterHooks).openTickets().map((t) => t.rackId),
  );
  expect(open1).not.toContain('r1');
  expect((await stats(page))?.ticketsClosed).toBe(1);

  // A wrong step: MAINT (key 1) on a firmware ticket.
  await page.evaluate(() =>
    (window.__oncallShooter as ShooterHooks).breakNow?.('r2', 'outdated-firmware'),
  );
  await face(page, 'r2');
  await page.keyboard.press('Digit1');
  await holdE(page, 2500);
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
    await holdE(page, (SHOOTER_TUNING.patchSeconds + 0.5) * 1000);
  }
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.__oncallShooter as ShooterHooks).patches().every((p) => p.applied),
      ),
    )
    .toBe(true);
  await expect(page.locator('.zd-patch.applied')).toHaveCount(3);

  // Fix whatever broke meanwhile, by its runbook.
  for (let guard = 0; guard < 40; guard++) {
    const open = await page.evaluate(() => (window.__oncallShooter as ShooterHooks).openTickets());
    const t = open[0];
    if (!t) break;
    if (t.next === null) continue;
    await face(page, t.rackId);
    await doStep(page, t.next);
  }
  expect(await page.evaluate(() => (window.__oncallShooter as ShooterHooks).openTickets())).toEqual(
    [],
  );

  await page.evaluate(() => (window.__oncallShooter as ShooterHooks).setClockLeft?.(1));
  await expect
    .poll(() => page.evaluate(() => (window.__oncallShooter as ShooterHooks).ending()), {
      timeout: 10_000,
    })
    .toBe('clean');
  await expect(page.locator('.zd-end-title')).toHaveText('Clean shift');
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

import { expect, test, type Page } from '@playwright/test';
import pkg from '../package.json' with { type: 'json' };
import { TUNING } from '../src/logic/tuning';

const hooks = (page: Page) =>
  page.evaluate(() => {
    const k = window.__oncallKart;
    if (!k) throw new Error('no debug hooks');
    return { screen: k.screen(), speed: k.playerSpeed(), phase: k.phase() };
  });

const screen = async (page: Page) => (await hooks(page)).screen;
const speed = async (page: Page) => (await hooks(page)).speed;

async function holdUp(page: Page, ms: number) {
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(ms);
  await page.keyboard.up('ArrowUp');
}

// The plan asks for 6 s. Software WebGL in the CI container starts slowly, so allow 12 s.
async function waitRacing(page: Page, timeout = 12_000) {
  await expect.poll(() => screen(page), { timeout }).toBe('racing');
}

test('a race starts, drives, pauses, restarts and resizes without errors', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/oncall-kart/?seed=1');
  await expect(page.locator('#ui')).toContainText(`v${pkg.version}`);
  await expect.poll(() => screen(page)).toBe('title');

  // The canvas holds a WebGL 2 context.
  const webgl2 = await page.evaluate(() => {
    const c = document.getElementById('game');
    return c instanceof HTMLCanvasElement && c.getContext('webgl2') !== null;
  });
  expect(webgl2).toBe(true);

  await page.keyboard.press('Enter');
  await expect.poll(() => screen(page)).toBe('setup');
  await page.keyboard.press('Enter');
  await expect.poll(() => screen(page)).toBe('countdown');
  await waitRacing(page);

  await holdUp(page, 2000);
  expect(await speed(page)).toBeGreaterThan(5);
  await expect(page.locator('.ticket-head')).toContainText('#0001');

  // A fine pointer: no touch controls, no touch-only pause items.
  await expect(page.locator('.touch')).toBeHidden();
  expect(await page.evaluate(() => window.__oncallKart?.touchControls())).toBe(false);
  if (process.env.SCREENSHOTS) {
    await page.screenshot({ path: `screenshots/${test.info().project.name}-race.png` });
  }

  // A touchscreen laptop: one touch shows the controls and starts auto-gas. A
  // driving key hands control back to the keyboard, so the brake works.
  await page.evaluate(() =>
    document.body.dispatchEvent(
      new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 9, bubbles: true }),
    ),
  );
  await expect.poll(() => page.evaluate(() => window.__oncallKart?.touchControls())).toBe(true);
  await page.waitForTimeout(500);
  const before = await speed(page);
  expect(before).toBeGreaterThan(5);
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(800);
  const braked = await speed(page);
  await page.keyboard.up('ArrowDown');
  expect(braked).toBeLessThan(before - 3);
  expect(await page.evaluate(() => window.__oncallKart?.touchControls())).toBe(false);

  await page.keyboard.press('KeyP');
  await expect.poll(() => screen(page)).toBe('paused');
  await expect(page.locator('.menu-item', { hasText: 'Respawn' })).toBeHidden();
  await expect(page.locator('.menu-item', { hasText: 'Auto-gas' })).toBeHidden();
  await page.keyboard.press('KeyP');
  await expect.poll(() => screen(page)).toBe('racing');

  // Restart twice from the pause menu (Escape, Down to Restart, Enter).
  const memory: { geometries: number; textures: number }[] = [];
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Escape');
    await expect.poll(() => screen(page)).toBe('paused');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(() => screen(page)).toBe('countdown');
    await waitRacing(page);
    memory.push(
      await page.evaluate(() => {
        const info = window.__oncallKart?.renderInfo();
        return { geometries: info?.geometries ?? -1, textures: info?.textures ?? -2 };
      }),
    );
  }
  // A restart frees what it replaces: no meshes or textures pile up.
  expect(memory[1]).toEqual(memory[0]);

  // A fresh race: the clock runs at about wall time (no doubled loop) and
  // the kart is no faster than top speed (no stacked state).
  const t0 = await page.evaluate(() => window.__oncallKart?.raceTime() ?? 0);
  const w0 = Date.now();
  await page.keyboard.down('ArrowUp');
  let max = 0;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(200);
    max = Math.max(max, await speed(page));
  }
  await page.keyboard.up('ArrowUp');
  const raceSeconds = (await page.evaluate(() => window.__oncallKart?.raceTime() ?? 0)) - t0;
  const wallSeconds = (Date.now() - w0) / 1000;
  expect(raceSeconds).toBeGreaterThan(wallSeconds * 0.6);
  expect(raceSeconds).toBeLessThan(wallSeconds * 1.15);
  expect(max).toBeGreaterThan(5);
  expect(max).toBeLessThanOrEqual(TUNING.topSpeed + 1e-6);

  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  expect(errors).toEqual([]);
});

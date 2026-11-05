import { expect, test, type Page } from '@playwright/test';
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
  await expect(page.locator('#ui')).toContainText('v0.1.0');
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

  await page.keyboard.press('KeyP');
  await expect.poll(() => screen(page)).toBe('paused');
  await page.keyboard.press('KeyP');
  await expect.poll(() => screen(page)).toBe('racing');

  // Restart twice from the pause menu (Escape, Down to Restart, Enter).
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Escape');
    await expect.poll(() => screen(page)).toBe('paused');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(() => screen(page)).toBe('countdown');
    await waitRacing(page);
  }
  // A fresh race: no doubled speed from stacked state.
  await page.keyboard.down('ArrowUp');
  let max = 0;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(200);
    max = Math.max(max, await speed(page));
  }
  await page.keyboard.up('ArrowUp');
  expect(max).toBeGreaterThan(5);
  expect(max).toBeLessThanOrEqual(TUNING.topSpeed + 1e-6);

  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  expect(errors).toEqual([]);
});

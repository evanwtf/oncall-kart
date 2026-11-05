import { expect, test, type Locator, type Page } from '@playwright/test';

/** Set SCREENSHOTS=1 to save screenshots to screenshots/ (git-ignored). */
const SHOTS = !!process.env.SCREENSHOTS;

const hooks = (page: Page) =>
  page.evaluate(() => {
    const k = window.__oncallKart;
    if (!k) throw new Error('no debug hooks');
    return {
      screen: k.screen(),
      speed: k.playerSpeed(),
      heading: k.playerHeading(),
      touch: k.touchControls(),
    };
  });

const screen = async (page: Page) => (await hooks(page)).screen;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `screenshots/${test.info().project.name}-${name}.png` });
}

/**
 * A touch pointer event. Playwright's touchscreen only taps, so drags are
 * dispatched. Use an id no real pointer has: Chromium gives the mouse id 1.
 */
async function pointer(target: Locator, type: string, id: number, x: number, y: number) {
  await target.dispatchEvent(type, {
    pointerId: id,
    pointerType: 'touch',
    isPrimary: true,
    clientX: x,
    clientY: y,
  });
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function box(page: Page, sel: string): Promise<Box> {
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`${sel} has no box`);
  return b;
}

/** The HUD panels and the controls do not overlap, and all sit inside the viewport. */
async function expectLayout(page: Page, sels: string[]) {
  const vp = page.viewportSize();
  if (!vp) throw new Error('no viewport');
  const boxes = await Promise.all(sels.map((s) => box(page, s)));
  boxes.forEach((b, i) => {
    expect(b.x, `${sels[i]} left`).toBeGreaterThanOrEqual(0);
    expect(b.y, `${sels[i]} top`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${sels[i]} right`).toBeLessThanOrEqual(vp.width);
    expect(b.y + b.height, `${sels[i]} bottom`).toBeLessThanOrEqual(vp.height);
    for (let j = i + 1; j < boxes.length; j++) {
      const other = boxes[j];
      if (other) expect(overlaps(b, other), `${sels[i]} overlaps ${sels[j]}`).toBe(false);
    }
  });
}

const PAD_ID = 41;
const HUD_AND_CONTROLS = ['.hud-left', '.ticket', '.hud-speed', '.touch-buttons', '.touch-pause'];

test('touch: tap through the menus, race with auto-gas, steer, pause, rotate', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/oncall-kart/?seed=1');
  await expect.poll(() => screen(page)).toBe('title');
  await expect(page.locator('.title .prompt.only-touch')).toBeVisible();

  await page.locator('.title').tap();
  await expect.poll(() => screen(page)).toBe('setup');
  await page.locator('.chip', { hasText: '3' }).tap();
  await page.locator('.chip', { hasText: /^1$/ }).tap();
  await expect(page.locator('.chip.selected')).toHaveText('1');
  await shot(page, 'setup');
  await page.locator('.action', { hasText: 'Start' }).tap();
  await expect.poll(() => screen(page)).toBe('countdown');
  await expect.poll(() => screen(page), { timeout: 12_000 }).toBe('racing');

  // The touch controls show on the track.
  await expect(page.locator('.touch')).toBeVisible();
  expect((await hooks(page)).touch).toBe(true);
  await expectLayout(page, HUD_AND_CONTROLS);

  // Auto-gas drives with no button held.
  await page.waitForTimeout(2000);
  expect((await hooks(page)).speed).toBeGreaterThan(5);

  // A drag right on the pad turns the kart.
  const pad = page.locator('.touch-pad');
  const padBox = await box(page, '.touch-pad');
  const x0 = padBox.x + padBox.width * 0.4;
  const y0 = padBox.y + padBox.height * 0.75;
  const h0 = (await hooks(page)).heading;
  await pointer(pad, 'pointerdown', PAD_ID, x0, y0);
  for (let i = 1; i <= 8; i++) await pointer(pad, 'pointermove', PAD_ID, x0 + i * 10, y0);
  await expect(page.locator('.touch-pad.active')).toBeVisible();
  await shot(page, 'race-landscape');
  // Sample the turn: at full lock the kart soon meets the wall, which turns it back.
  let turned = 0;
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(100);
    turned = Math.max(turned, Math.abs((await hooks(page)).heading - h0));
  }
  await pointer(pad, 'pointerup', PAD_ID, x0 + 80, y0);
  await expect(page.locator('.touch-pad.active')).toHaveCount(0);
  expect(turned).toBeGreaterThan(0.1);

  // The pause button pauses; Resume resumes.
  await page.locator('.touch-pause').tap();
  await expect.poll(() => screen(page)).toBe('paused');
  await expect(page.locator('.touch')).toBeHidden();
  await page.locator('.menu-item', { hasText: 'Resume' }).tap();
  await expect.poll(() => screen(page)).toBe('racing');

  // Touch-only pause items: the auto-gas switch (select, then confirm) and Respawn.
  await page.locator('.touch-pause').tap();
  await expect.poll(() => screen(page)).toBe('paused');
  const autoGas = page.locator('.menu-item', { hasText: 'Auto-gas' });
  await expect(autoGas).toHaveText('Auto-gas: On');
  await autoGas.tap();
  await autoGas.tap();
  await expect(autoGas).toHaveText('Auto-gas: Off');
  await expect(page.locator('.menu-item', { hasText: 'Respawn' })).toBeVisible();
  await shot(page, 'pause');
  await autoGas.tap();
  await expect(autoGas).toHaveText('Auto-gas: On');
  const respawn = page.locator('.menu-item', { hasText: 'Respawn' });
  await respawn.tap();
  await respawn.tap();
  await expect.poll(() => screen(page)).toBe('racing');
  await expect(page.locator('.toast', { hasText: 'RESPAWN' })).toBeVisible();

  // Portrait and back: the hint shows, the controls stay inside the viewport.
  const landscape = page.viewportSize();
  if (!landscape) throw new Error('no viewport');
  await page.setViewportSize({ width: landscape.height, height: landscape.width });
  await page.waitForTimeout(500);
  await expect(page.locator('.rotate-hint')).toBeVisible();
  await shot(page, 'race-portrait');
  await expectLayout(page, [...HUD_AND_CONTROLS, '.rotate-hint']);
  await page.locator('.rotate-close').tap();
  await expect(page.locator('.rotate-hint')).toBeHidden();
  await page.setViewportSize(landscape);
  await page.waitForTimeout(500);
  await expectLayout(page, HUD_AND_CONTROLS);
  expect(await screen(page)).toBe('racing');

  expect(errors).toEqual([]);
});

import { expect, test, type Locator, type Page } from '@playwright/test';
import { TICKET_TYPES, type TicketType } from '../src/logic/runbooks';

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
  // The DOM follows the game state on the next frame.
  for (const s of sels) await expect(page.locator(s)).toBeVisible();
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
const HUD_AND_CONTROLS = [
  '.hud-left',
  '.hud-place',
  '.hud-item',
  '.ticket',
  '.hud-speed',
  '.touch-buttons',
  '.touch-pause',
];

/**
 * The place, the item slot and the minimap keep clear of the gate signs: the
 * middle 40% of the width in the top half of a landscape screen. The minimap
 * may be hidden on a short screen; when it shows, it must not cover the card.
 */
async function expectClearOfSigns(page: Page) {
  const vp = page.viewportSize();
  if (!vp || vp.height > vp.width) return;
  const signs: Box = { x: vp.width * 0.3, y: 0, width: vp.width * 0.4, height: vp.height / 2 };
  for (const sel of ['.hud-place', '.hud-item']) {
    expect(overlaps(await box(page, sel), signs), `${sel} covers the gate signs`).toBe(false);
  }
  if (await page.locator('.minimap').isVisible()) {
    const map = await box(page, '.minimap');
    expect(overlaps(map, signs), 'the minimap covers the gate signs').toBe(false);
    expect(overlaps(map, await box(page, '.ticket')), 'the minimap covers the card').toBe(false);
  }
}

/** The tallest ticket card: the longest title, at the longest pit step. */
function worstTicket(): { type: TicketType; stepIndex: number } {
  const byLength = <T>(xs: readonly T[], len: (x: T) => number) =>
    xs.reduce((a, b) => (len(b) > len(a) ? b : a));
  const title = byLength(TICKET_TYPES, (t) => t.title.length).title;
  const pit = byLength(TICKET_TYPES, (t) => t.pitWork?.length ?? 0);
  return { type: { ...pit, title }, stepIndex: pit.steps.indexOf('PIT') };
}

/** Give the player the worst ticket (needs ?debug=1) and wait for the card to show it. */
async function setWorstTicket(page: Page) {
  const w = worstTicket();
  expect(w.type.title).toBe('Wrong hostname in inventory');
  expect(w.type.pitWork).toBe('recable the top-of-rack switch');
  await page.evaluate((x) => window.__oncallKart?.setTicket?.(x.type, x.stepIndex), w);
  await expect(page.locator('.ticket-head')).toContainText(w.type.title);
  await expect(page.locator('.step.next .work')).toHaveText('recable the top-of-rack switch');
}

/** On a landscape phone the card stays in the top 30%, so the gate signs ahead stay in view. */
async function expectShortTicket(page: Page) {
  const vp = page.viewportSize();
  if (!vp) throw new Error('no viewport');
  const b = await box(page, '.ticket');
  expect(b.y + b.height, 'ticket bottom').toBeLessThanOrEqual(vp.height * 0.3);
}

/** Tap from the title to the race. */
async function tapToRace(page: Page) {
  await expect.poll(() => screen(page)).toBe('title');
  await page.locator('.title').tap();
  await expect.poll(() => screen(page)).toBe('setup');
  await page.locator('.action', { hasText: 'Start' }).tap();
  await expect.poll(() => screen(page), { timeout: 12_000 }).toBe('racing');
}

/** The pause menu clears the HUD that stays on screen; the card and the speed hide. */
async function expectPauseLayout(page: Page) {
  await expect(page.locator('.ticket')).toBeHidden();
  await expect(page.locator('.hud-speed')).toBeHidden();
  await expectLayout(page, ['.hud-left', '.pause .menu']);
}

test('touch: tap through the menus, race with auto-gas, steer, pause, rotate', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/oncall-kart/?game=kart&seed=1&debug=1');
  await expect.poll(() => screen(page)).toBe('title');
  await expect(page.locator('.title .prompt.only-touch')).toBeVisible();

  // The page blocks zoom, scroll, selection and the callout.
  const page_ = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return {
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
      touchAction: body.touchAction,
      userSelect: body.userSelect || body.webkitUserSelect,
    };
  });
  expect(page_.viewport).toContain('viewport-fit=cover');
  expect(page_.touchAction).toBe('none');
  expect(page_.userSelect).toBe('none');

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
  expect(await page.locator('.touch-pad').evaluate((e) => getComputedStyle(e).touchAction)).toBe(
    'none',
  );
  await expectLayout(page, HUD_AND_CONTROLS);
  await setWorstTicket(page);
  await expectLayout(page, HUD_AND_CONTROLS);
  await expectShortTicket(page);
  await expectClearOfSigns(page);
  await expect(page.locator('.touch-item')).toBeVisible();

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
  await expectPauseLayout(page);
  await shot(page, 'pause');
  await autoGas.tap();
  await expect(autoGas).toHaveText('Auto-gas: On');
  const respawn = page.locator('.menu-item', { hasText: 'Respawn' });
  await respawn.tap();
  await respawn.tap();
  await expect.poll(() => screen(page)).toBe('racing');
  await expect(page.locator('.toast', { hasText: 'RESPAWN' }).last()).toBeVisible();

  // Portrait and back: the hint shows, the controls stay inside the viewport.
  const landscape = page.viewportSize();
  if (!landscape) throw new Error('no viewport');
  await page.setViewportSize({ width: landscape.height, height: landscape.width });
  await page.waitForTimeout(500);
  await expect(page.locator('.rotate-hint')).toBeVisible();
  await shot(page, 'race-portrait');
  await expectLayout(page, [...HUD_AND_CONTROLS, '.rotate-hint']);
  // A toast in portrait shows below the ticket card.
  await page.locator('.touch-pause').tap();
  await expect.poll(() => screen(page)).toBe('paused');
  await expectPauseLayout(page);
  await respawn.tap();
  await respawn.tap();
  await expect.poll(() => screen(page)).toBe('racing');
  await expect(page.locator('.toast', { hasText: 'RESPAWN' }).last()).toBeVisible();
  await expectLayout(page, [...HUD_AND_CONTROLS, '.rotate-hint', '.toast:last-child']);
  await shot(page, 'race-portrait-toast');
  await page.locator('.rotate-close').tap();
  await expect(page.locator('.rotate-hint')).toBeHidden();
  await page.setViewportSize(landscape);
  await page.waitForTimeout(500);
  await expectLayout(page, HUD_AND_CONTROLS);
  expect(await screen(page)).toBe('racing');

  expect(errors).toEqual([]);
});

// Landscape Safari on a 667 x 375 phone leaves about 331 px under its toolbars.
test('touch: a short landscape screen, auto-gas off, the tallest ticket', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.addInitScript(() => localStorage.setItem('oncall-kart.autoGas', 'off'));
  await page.setViewportSize({ width: 667, height: 331 });
  await page.goto('/oncall-kart/?game=kart&seed=1&debug=1');
  await tapToRace(page);

  await expect(page.locator('.touch-gas')).toBeVisible();
  await expect(page.locator('.touch-item')).toBeVisible();
  await setWorstTicket(page);
  // An item in the slot: its longest name.
  await page.evaluate(() => window.__oncallKart?.giveItem?.('rollback'));
  await expect(page.locator('.hud-item')).toContainText('ROLLBACK');
  await expectLayout(page, HUD_AND_CONTROLS);
  await expectShortTicket(page);
  await expectClearOfSigns(page);
  await shot(page, '667x331-race');

  // The ITEM button uses the item.
  await page.locator('.touch-item').tap();
  await expect(page.locator('.hud-item')).toContainText('NO ITEM');

  // Parked short of a gate row: the signs stay clear of the card.
  const rows = await page.evaluate(() => window.__oncallKart?.rowS() ?? []);
  const row = rows[1];
  if (row === undefined) throw new Error('no gate rows');
  for (const d of [20, 12]) {
    await page.evaluate((s) => window.__oncallKart?.placePlayer?.(s), row - d);
    await page.waitForTimeout(600);
    await shot(page, `667x331-gate-${d}m`);
  }

  await page.locator('.touch-pause').tap();
  await expect.poll(() => screen(page)).toBe('paused');
  await expectPauseLayout(page);
  await shot(page, '667x331-pause');
  expect(errors).toEqual([]);
});

test('touch: the first tap starts sound; Sound in the pause menu mutes across a reload', async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  const audio = () =>
    page.evaluate(() => ({
      state: window.__oncallKart?.audioState(),
      muted: window.__oncallKart?.muted(),
    }));

  await page.goto('/oncall-kart/?game=kart&seed=1');
  await expect.poll(() => screen(page)).toBe('title');
  expect(await audio()).toEqual({ state: 'locked', muted: false });
  await tapToRace(page);
  const allowed = browserName === 'webkit' ? ['running', 'suspended'] : ['running'];
  await expect.poll(async () => allowed.includes((await audio()).state ?? '')).toBe(true);

  await page.locator('.touch-pause').tap();
  await expect.poll(() => screen(page)).toBe('paused');
  const sound = page.locator('.menu-item', { hasText: 'Sound' });
  await expect(sound).toHaveText('Sound: On');
  // Tap to select, tap again to confirm.
  await sound.tap();
  await sound.tap();
  await expect(sound).toHaveText('Sound: Off');
  expect((await audio()).muted).toBe(true);
  await expectPauseLayout(page);

  await page.reload();
  await expect.poll(() => screen(page)).toBe('title');
  expect((await audio()).muted).toBe(true);
  await expect(page.locator('.mute-icon')).toBeVisible();
  expect(errors).toEqual([]);
});

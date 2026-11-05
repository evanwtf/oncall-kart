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

  await page.goto('/oncall-kart/?game=kart&seed=1');
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

  // Phase 2: the player and 7 bots.
  const race = await page.evaluate(() => ({
    karts: window.__oncallKart?.kartCount(),
    place: window.__oncallKart?.place(),
  }));
  expect(race.karts).toBe(8);
  expect(race.place).toBeGreaterThanOrEqual(1);
  expect(race.place).toBeLessThanOrEqual(8);
  await expect(page.locator('.hud-place')).toContainText('/ 8');
  if (process.env.SCREENSHOTS) {
    await page.screenshot({ path: `screenshots/${test.info().project.name}-grid.png` });
  }

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

test('items, a Page, and the results of an 8-kart race', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  const shot = async (name: string) => {
    if (process.env.SCREENSHOTS) {
      await page.screenshot({ path: `screenshots/${test.info().project.name}-${name}.png` });
    }
  };

  await page.goto('/oncall-kart/?game=kart&seed=3&debug=1');
  await expect.poll(() => screen(page)).toBe('title');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await waitRacing(page);

  // Coffee: the item key boosts the kart past its top speed.
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__oncallKart?.giveItem?.('coffee'));
  await expect(page.locator('.hud-item')).toContainText('COFFEE');
  await page.keyboard.press('KeyE');
  await expect.poll(() => speed(page), { timeout: 3000 }).toBeGreaterThan(TUNING.topSpeed + 0.5);
  await expect(page.locator('.hud-item')).toContainText('NO ITEM');
  await page.keyboard.up('ArrowUp');

  // The autopilot drives the rest; a Page goes at the kart ahead.
  await page.evaluate(() => window.__oncallKart?.autopilot?.(true));
  await page.evaluate(() => window.__oncallKart?.giveItem?.('page'));
  await expect(page.locator('.hud-item')).toContainText('PAGE');
  await page.keyboard.press('ShiftLeft');
  await expect(page.locator('.hud-item')).toContainText('NO ITEM');
  await page.waitForTimeout(300);
  await shot('page');
  await page.waitForTimeout(5000);
  await shot('mid-race');

  // The 1-lap race ends; the results list all 8 karts, the player among them.
  await expect.poll(() => screen(page), { timeout: 100_000 }).toBe('results');
  await expect(page.locator('.order li')).toHaveCount(8);
  await expect(page.locator('.order li.you')).toHaveCount(1);
  await shot('results');
  expect(errors).toEqual([]);
});

/** Collect console errors and page errors. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function startRace(page: Page) {
  await page.goto('/oncall-kart/?game=kart&seed=1');
  await expect.poll(() => screen(page)).toBe('title');
  await page.keyboard.press('Enter');
  await expect.poll(() => screen(page)).toBe('setup');
  await page.keyboard.press('Enter');
  await waitRacing(page);
}

test('the race keeps rendering after WebGL context loss and restore', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = trackErrors(page);
  await startRace(page);

  const lose = await page.evaluate(() => {
    const c = document.getElementById('game');
    if (!(c instanceof HTMLCanvasElement)) return false;
    const ext = c.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!ext) return false;
    (window as unknown as { __loseCtx: WEBGL_lose_context }).__loseCtx = ext;
    ext.loseContext();
    return true;
  });
  expect(lose).toBe(true);
  await page.waitForTimeout(500);
  await page.evaluate(() =>
    (window as unknown as { __loseCtx: WEBGL_lose_context }).__loseCtx.restoreContext(),
  );

  // After the restore, frames draw again and the race clock runs.
  const sample = () =>
    page.evaluate(() => ({
      calls: window.__oncallKart?.renderInfo().calls ?? 0,
      time: window.__oncallKart?.raceTime() ?? 0,
      lost: (document.getElementById('game') as HTMLCanvasElement)
        .getContext('webgl2')
        ?.isContextLost(),
    }));
  await expect.poll(async () => (await sample()).lost, { timeout: 10_000 }).toBe(false);
  const a = await sample();
  // Software GL recompiles every shader after a restore, so the first frames
  // are slow: wait for the clock rather than for a fixed time.
  await page.keyboard.down('ArrowUp');
  await expect
    .poll(async () => (await sample()).time, { timeout: 15_000 })
    .toBeGreaterThan(a.time + 0.5);
  await expect.poll(() => speed(page), { timeout: 15_000 }).toBeGreaterThan(1);
  await page.keyboard.up('ArrowUp');
  expect((await sample()).calls).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the pause screen is still: no wheels, sparks or lights move', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = trackErrors(page);
  await startRace(page);
  await holdUp(page, 1000);
  await page.keyboard.press('KeyP');
  await expect.poll(() => screen(page)).toBe('paused');
  // Compare the 3D view only: hide the menu and the HUD, whose CSS may animate.
  await page.evaluate(() => {
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
  });
  await page.waitForTimeout(300);
  const canvas = page.locator('#game');
  const first = await canvas.screenshot();
  await page.waitForTimeout(700);
  const second = await canvas.screenshot();
  expect(second.equals(first)).toBe(true);
  expect(errors).toEqual([]);
});

test('a new pixel ratio resizes the renderer', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = trackErrors(page);
  // A headless browser cannot move a window to another display. Record the
  // resolution queries the game makes, then fake the move: a new ratio and a
  // change event on the query, as a real browser sends.
  await page.addInitScript(() => {
    const queries: MediaQueryList[] = [];
    (window as unknown as { __dprQueries: MediaQueryList[] }).__dprQueries = queries;
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => {
      const mql = real(q);
      if (q.includes('dppx')) queries.push(mql);
      return mql;
    };
  });
  await page.goto('/oncall-kart/?game=kart&seed=1');
  await expect.poll(() => screen(page)).toBe('title');
  const sample = () =>
    page.evaluate(() => {
      const c = document.getElementById('game') as HTMLCanvasElement;
      const queries = (window as unknown as { __dprQueries: MediaQueryList[] }).__dprQueries;
      return {
        buffer: c.width,
        css: c.clientWidth,
        dpr: window.devicePixelRatio,
        last: queries.at(-1)?.media ?? '',
      };
    });
  const before = await sample();
  expect(before.buffer).toBe(before.css * before.dpr);
  expect(before.last).toContain(`${before.dpr}dppx`);
  // Desktop Safari starts at 2, Desktop Chrome at 1: move to the other one.
  const next = before.dpr === 1 ? 2 : 1;
  await page.evaluate((ratio) => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => ratio });
    const queries = (window as unknown as { __dprQueries: MediaQueryList[] }).__dprQueries;
    queries.at(-1)?.dispatchEvent(new Event('change'));
  }, next);
  await expect.poll(async () => (await sample()).buffer).toBe(before.css * next);
  // The game now listens for the next change, from the new ratio.
  expect((await sample()).last).toContain(`${next}dppx`);
  expect(errors).toEqual([]);
});

test('sound starts on the first key press, and M mutes across a reload', async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000);
  const errors = trackErrors(page);
  const audio = () =>
    page.evaluate(() => ({
      state: window.__oncallKart?.audioState(),
      muted: window.__oncallKart?.muted(),
    }));
  await page.goto('/oncall-kart/?game=kart&seed=1');
  await expect.poll(() => screen(page)).toBe('title');
  // Nothing before a gesture: Safari would block it.
  expect(await audio()).toEqual({ state: 'locked', muted: false });
  await expect(page.locator('.mute-icon')).toBeHidden();

  await page.keyboard.press('Enter');
  await expect.poll(() => screen(page)).toBe('setup');
  // Headless WebKit may refuse audio output; it must still leave 'locked'.
  const allowed = browserName === 'webkit' ? ['running', 'suspended'] : ['running'];
  await expect.poll(async () => allowed.includes((await audio()).state ?? '')).toBe(true);

  await page.keyboard.press('KeyM');
  await expect.poll(async () => (await audio()).muted).toBe(true);
  await expect(page.locator('.mute-icon')).toBeVisible();
  await page.reload();
  await expect.poll(() => screen(page)).toBe('title');
  expect(await audio()).toEqual({ state: 'locked', muted: true });
  await expect(page.locator('.mute-icon')).toBeVisible();

  // The pause menu has a Sound item too, on the keyboard.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await waitRacing(page);
  await page.keyboard.press('KeyP');
  await expect.poll(() => screen(page)).toBe('paused');
  const sound = page.locator('.menu-item', { hasText: 'Sound' });
  await expect(sound).toHaveText('Sound: Off');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(sound).toHaveText('Sound: On');
  expect((await audio()).muted).toBe(false);
  await expect(page.locator('.mute-icon')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the start screen picks a game, and the kart title switches back', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = trackErrors(page);
  await page.goto('/oncall-kart/?seed=1');
  const cards = page.locator('button[data-game]');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('button[data-game="kart"]')).toBeVisible();
  await expect(page.locator('button[data-game="shooter"]')).toBeVisible();

  await page.locator('button[data-game="kart"]').click();
  // The click loads a new page: wait for it before reading its hooks.
  await page.waitForURL(/game=kart/);
  await page.waitForFunction(() => window.__oncallKart !== undefined);
  await expect.poll(() => screen(page)).toBe('title');
  expect(new URL(page.url()).searchParams.get('game')).toBe('kart');
  expect(new URL(page.url()).searchParams.get('seed')).toBe('1');

  // Switch game goes back to the start screen and keeps the other params.
  await page.locator('.switch-game').click();
  await page.waitForURL((u) => !u.searchParams.has('game'));
  await expect(cards).toHaveCount(2);
  expect(new URL(page.url()).searchParams.has('game')).toBe(false);
  expect(new URL(page.url()).searchParams.get('seed')).toBe('1');
  expect(errors).toEqual([]);
});

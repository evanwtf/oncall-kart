import { expect, test } from '@playwright/test';

test('the page loads and shows the version', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/oncall-kart/');
  await expect(page.locator('#ui')).toContainText('oncall-kart v0.1.0');
  expect(errors).toEqual([]);
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('ci.yml', () => {
  const workflow = read('.github/workflows/ci.yml');

  it('runs the e2e job in the Playwright image that matches @playwright/test', () => {
    const { version } = JSON.parse(read('node_modules/@playwright/test/package.json')) as {
      version: string;
    };
    const tags = [...workflow.matchAll(/mcr\.microsoft\.com\/playwright:(v[^\s'"]+)/g)].map(
      (m) => m[1],
    );
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toBe(`v${version}-noble`);
  });

  it('checks the e2e image Node against .nvmrc before it builds', () => {
    const e2e = workflow.slice(workflow.indexOf('\n  e2e:'), workflow.indexOf('\n  deploy:'));
    const guard = e2e.indexOf('node scripts/check-node.mjs');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(e2e.indexOf('npm ci'));
  });

  it('has no pull_request trigger (fork PRs must not reach the self-hosted runner)', () => {
    expect(workflow).not.toMatch(/pull_request/);
  });

  it('keeps every uploaded artifact for 1 day', () => {
    const uploads = workflow.split(/uses: actions\/upload-/).slice(1);
    expect(uploads.length).toBeGreaterThan(0);
    for (const block of uploads) expect(block).toMatch(/retention-days: 1\b/);
  });
});

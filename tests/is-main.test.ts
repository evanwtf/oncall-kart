import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMain } from '../scripts/is-main.mjs';

const script = fileURLToPath(new URL('../scripts/check-node.mjs', import.meta.url));

describe('isMain', () => {
  it('is true for the script itself and false for another file or none', () => {
    const url = new URL('../scripts/check-node.mjs', import.meta.url).href;
    expect(isMain(url, script)).toBe(true);
    expect(isMain(url, fileURLToPath(import.meta.url))).toBe(false);
    expect(isMain(url, undefined)).toBe(false);
    expect(isMain(url, '/no/such/file.mjs')).toBe(false);
  });

  it('runs main() when node starts the script through a symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'is-main-'));
    try {
      const link = join(dir, 'check-node.mjs');
      symlinkSync(script, link);
      // Without the real-path compare, main() never runs and the output is empty.
      const out = execFileSync(process.execPath, [link], { encoding: 'utf8' });
      expect(out).toMatch(/^check-node: /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

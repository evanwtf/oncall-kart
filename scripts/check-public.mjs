#!/usr/bin/env node
// Public-repo guard. Refuses LAN IPs, private DNS names and home-directory
// paths in tracked files. Prints file:line only, so the leak is not echoed.
// 10.x is allowed (baseline public-repos.md exception).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** @type {ReadonlyArray<readonly [string, RegExp]>} */
const RULES = [
  ['private-ipv4', /\b(?:192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/],
  ['private-dns', /\b[a-z0-9-]+\.(?:internal|lan|home\.arpa|localdomain)\b/i],
  ['home-path', /\/(?:Users|home)\/[A-Za-z0-9._-]+\//],
];

/** Files that name the patterns on purpose, as fake examples. */
const SKIP = new Set([
  'scripts/check-public.mjs',
  'tests/check-public.test.ts',
  'docs/superpowers/plans/2026-11-04-oncall-kart-phase1.md',
]);

/**
 * Find leaks in one text.
 * @param {string} text
 * @returns {string[]} one `<line>:<rule>` entry per match
 */
export function findPublicLeaks(text) {
  /** @type {string[]} */
  const found = [];
  text.split('\n').forEach((line, i) => {
    for (const [rule, re] of RULES) {
      if (re.test(line)) found.push(`${i + 1}:${rule}`);
    }
  });
  return found;
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((f) => f !== '' && !SKIP.has(f));
  let bad = 0;
  for (const file of files) {
    /** @type {string} */
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // deleted in the worktree, or a dangling symlink
    }
    for (const hit of findPublicLeaks(text)) {
      const [line, rule] = hit.split(':');
      console.log(`${file}:${line} (${rule})`);
      bad += 1;
    }
  }
  if (bad > 0) {
    console.log(`check-public: ${bad} match(es). Remove them before you commit.`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

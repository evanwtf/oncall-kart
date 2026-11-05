#!/usr/bin/env node
// Public-repo guard. Refuses LAN IPs, private DNS names, home-directory
// paths and denylisted private names in tracked files. Prints file:line
// only, so the leak is not echoed. 10.x is allowed (baseline public-repos.md
// exception). Private names that look ordinary go in .public-denylist, one
// per line; that file is git-ignored. PUBLIC_DENYLIST overrides its path.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** @type {ReadonlyArray<readonly [string, RegExp]>} */
const RULES = [
  ['private-ipv4', /\b(?:192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g],
  ['private-dns', /\b[a-z0-9-]+\.(?:internal|lan|home\.arpa|localdomain)\b/gi],
  ['home-path', /\/(?:Users|home)\/[A-Za-z0-9._-]+\//g],
];

/**
 * The fake values that the guard's own tests and the phase 1 plan name on
 * purpose. A match equal to one of these is allowed; anything else is not.
 */
const FAKES = new Set([
  '192.168.1.5',
  '172.20.0.1',
  'foo.internal',
  'bar.lan',
  'x.home.arpa',
  '/Users/alice/',
  '/home/bob/',
]);

/** Files that name the patterns on purpose. */
const SKIP = new Set(['scripts/check-public.mjs', 'tests/check-public.test.ts']);

/**
 * Read the denylist: one name per line, # comments, blank lines skipped.
 * A missing file gives an empty list.
 * @param {string} path
 * @returns {string[]} lower-cased names
 */
export function loadDenylist(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

/**
 * Find leaks in one text.
 * @param {string} text
 * @param {readonly string[]} [denylist] lower-cased names, matched as fixed strings
 * @returns {string[]} one `<line>:<rule>` entry per line and rule that match
 */
export function findPublicLeaks(text, denylist = []) {
  /** @type {string[]} */
  const found = [];
  text.split('\n').forEach((line, i) => {
    for (const [rule, re] of RULES) {
      const real = [...line.matchAll(re)].some((m) => !FAKES.has(m[0]));
      if (real) found.push(`${i + 1}:${rule}`);
    }
    const lower = line.toLowerCase();
    if (denylist.some((name) => lower.includes(name))) found.push(`${i + 1}:denylist`);
  });
  return found;
}

function main() {
  const denylist = loadDenylist(process.env.PUBLIC_DENYLIST ?? '.public-denylist');
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
    for (const hit of findPublicLeaks(text, denylist)) {
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

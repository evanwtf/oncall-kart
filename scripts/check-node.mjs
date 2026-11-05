#!/usr/bin/env node
// CI guard. The e2e job runs in the Playwright image, which brings its own
// Node. Refuse to build when that Node's major version differs from .nvmrc.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Compare a Node version with the .nvmrc text.
 * @param {string} nvmrc the .nvmrc file, for example "26\n" or "v26.1.0"
 * @param {string} version process.versions.node, for example "26.13.0"
 * @returns {string | null} the reason to refuse, or null when they agree
 */
export function nodeMismatch(nvmrc, version) {
  const want = /^v?(\d+)/.exec(nvmrc.trim());
  if (!want) return `.nvmrc has no major version: "${nvmrc.trim()}"`;
  const have = /^v?(\d+)\./.exec(version.trim());
  if (!have) return `bad Node version: "${version}"`;
  if (want[1] !== have[1]) return `Node ${version} does not match .nvmrc (${want[1]})`;
  return null;
}

function main() {
  const nvmrc = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8');
  const why = nodeMismatch(nvmrc, process.versions.node);
  if (why) {
    console.log(`check-node: ${why}. Update the Playwright image or .nvmrc.`);
    process.exit(1);
  }
  console.log(`check-node: Node ${process.versions.node} matches .nvmrc.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

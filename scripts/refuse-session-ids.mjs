#!/usr/bin/env node
// commit-msg guard. Refuses agent session links, session IDs and agent
// co-author trailers in a commit message.
import { readFileSync } from 'node:fs';
import { isMain } from './is-main.mjs';

/** @type {ReadonlyArray<readonly [string, RegExp]>} */
const RULES = [
  ['session-url', /claude\.ai\/code\/session/i],
  ['session-trailer', /^\s*Claude-Session:/im],
  // The shape of a real agent session ID, as the baseline model guard has it.
  ['session-id', /\bsession_01[A-Za-z0-9]{20,}/],
  ['co-author', /^\s*Co-Authored-By:\s*Claude\b/im],
];

/**
 * Find session details in a commit message.
 * @param {string} msg
 * @returns {string[]} the names of the rules that match
 */
export function findSessionIds(msg) {
  return RULES.filter(([, re]) => re.test(msg)).map(([rule]) => rule);
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.log('usage: refuse-session-ids.mjs <commit-msg-file>');
    process.exit(2);
  }
  const hits = findSessionIds(readFileSync(file, 'utf8'));
  if (hits.length > 0) {
    console.log(`refuse-session-ids: remove ${hits.join(', ')} from the commit message.`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main();

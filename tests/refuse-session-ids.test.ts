import { describe, expect, it } from 'vitest';
import { findSessionIds } from '../scripts/refuse-session-ids.mjs';

describe('findSessionIds', () => {
  it.each([
    'see https://claude.ai/code/session_abc',
    'feat: x\n\nClaude-Session: x',
    'ref session_01ABCDEFGHJKMNPQRSTVWXYZ',
    'feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
  ])('flags %s', (msg) => {
    expect(findSessionIds(msg)).not.toEqual([]);
  });

  it.each([
    'fix: session timer drift',
    'feat: add a pit session counter',
    'fix: session_timer reset',
    'ref session_01ABC',
  ])('allows %s', (msg) => {
    expect(findSessionIds(msg)).toEqual([]);
  });
});

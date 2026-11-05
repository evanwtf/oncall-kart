import { describe, expect, it } from 'vitest';
import { nodeMismatch } from '../scripts/check-node.mjs';

describe('nodeMismatch', () => {
  it.each([
    ['26\n', '26.13.0'],
    ['v26', '26.0.1'],
    ['26.1.0', '26.13.0'],
  ])('accepts .nvmrc %j with Node %s', (nvmrc, version) => {
    expect(nodeMismatch(nvmrc, version)).toBeNull();
  });

  it.each([
    ['26', '24.11.0'],
    ['26', '2.6.0'],
    ['24', '26.13.0'],
    ['', '26.13.0'],
    ['lts/*', '26.13.0'],
    ['26', 'garbage'],
  ])('refuses .nvmrc %j with Node %s', (nvmrc, version) => {
    expect(nodeMismatch(nvmrc, version)).not.toBeNull();
  });
});

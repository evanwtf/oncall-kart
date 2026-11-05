import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPublicLeaks, loadDenylist } from '../scripts/check-public.mjs';

describe('findPublicLeaks', () => {
  it.each([
    'host at 192.168.1.50 here',
    'docker net 172.20.0.9',
    'see foo2.internal for it',
    'ssh bar2.lan',
    'printer y.home.arpa',
    'cd /Users/carol/git',
    'cd /home/dave/src',
  ])('flags %s', (text) => {
    expect(findPublicLeaks(text)).not.toEqual([]);
  });

  it.each([
    'fabric 10.0.0.1',
    'loopback 127.0.0.1',
    'https://evanwtf.github.io/oncall-kart/',
    'failed disk, r12-u07',
    'version 1.64.1 and 172.15.0.1 and 172.32.0.1',
  ])('allows %s', (text) => {
    expect(findPublicLeaks(text)).toEqual([]);
  });

  it.each([
    '192.168.1.5',
    '172.20.0.1',
    'foo.internal',
    'bar.lan',
    'x.home.arpa',
    '/Users/alice/',
    '/home/bob/',
  ])('allows the documented fake value %s', (fake) => {
    expect(findPublicLeaks(`the guard flags ${fake} in its tests`)).toEqual([]);
  });

  it('still flags a real leak on a line that also holds a fake value', () => {
    expect(findPublicLeaks('fake 192.168.1.5, real 192.168.1.6')).toEqual(['1:private-ipv4']);
  });

  it('reports line and rule, never the matched text', () => {
    expect(findPublicLeaks('ok\nssh 192.168.0.9\nok')).toEqual(['2:private-ipv4']);
  });

  it('passes the phase 1 plan, and catches a new leak added to it', () => {
    const plan = readFileSync(
      new URL('../docs/superpowers/plans/2026-11-04-oncall-kart-phase1.md', import.meta.url),
      'utf8',
    );
    expect(findPublicLeaks(plan)).toEqual([]);
    expect(findPublicLeaks(`${plan}\nssh 192.168.4.4\n`)).not.toEqual([]);
  });
});

describe('denylist', () => {
  it('flags denylisted names case-insensitively, as fixed strings', () => {
    const deny = ['bigbox', 'a.b*c'];
    expect(findPublicLeaks('ssh BigBox now', deny)).toEqual(['1:denylist']);
    expect(findPublicLeaks('a.b*c', deny)).toEqual(['1:denylist']);
    expect(findPublicLeaks('aXbbc', deny)).toEqual([]);
  });

  it('reads one name per line, skips blanks and comments, and allows a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deny-'));
    const file = join(dir, '.public-denylist');
    writeFileSync(file, '# private names\nBigBox\n\n  nas-01  \n');
    expect(loadDenylist(file)).toEqual(['bigbox', 'nas-01']);
    expect(loadDenylist(join(dir, 'absent'))).toEqual([]);
  });
});

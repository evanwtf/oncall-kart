import { describe, expect, it } from 'vitest';
import { findPublicLeaks } from '../scripts/check-public.mjs';

describe('findPublicLeaks', () => {
  it.each([
    'host at 192.168.1.5 here',
    'docker net 172.20.0.1',
    'see foo.internal for it',
    'ssh bar.lan',
    'printer x.home.arpa',
    'cd /Users/alice/git',
    'cd /home/bob/src',
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

  it('reports line and rule, never the matched text', () => {
    expect(findPublicLeaks('ok\nssh 192.168.0.9\nok')).toEqual(['2:private-ipv4']);
  });
});

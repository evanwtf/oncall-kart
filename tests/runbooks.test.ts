import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { OP_INFO, OPS, STEP_COLORS } from '../src/logic/ops';
import { TICKET_TYPES } from '../src/logic/runbooks';

describe('runbooks', () => {
  it('has exactly the 9 ticket types from the design, with their steps', () => {
    const table = Object.fromEntries(TICKET_TYPES.map((t) => [t.id, t.steps.join(',')]));
    expect(table).toEqual({
      'failed-disk': 'TAKEDOWN,PIT,REINSTATE',
      'outdated-firmware': 'FW-ISO,REINSTATE',
      'bad-cpu': 'LOGCOLLECT,TAKEDOWN,PIT,POWERON,META-SYNC,REINSTATE',
      'switch-maintenance': 'MAINT,PIT,META-SYNC,REINSTATE',
      'rebuild-cluster': 'MAINT,REIMAGE,META-SYNC,REINSTATE',
      'overheating-gpu': 'LOGCOLLECT,TAKEDOWN,PIT,REINSTATE',
      'bad-dimm': 'LOGCOLLECT,TAKEDOWN,PIT,REINSTATE',
      'flapping-nic': 'MAINT,FW-ISO,META-SYNC,REINSTATE',
      'wrong-hostname': 'META-SYNC',
    });
  });

  it('gives pit work text to every type with a PIT step', () => {
    for (const t of TICKET_TYPES) {
      if (t.steps.includes('PIT')) expect(t.pitWork, t.id).toMatch(/\S/);
    }
  });

  it('uses only known operations or PIT', () => {
    for (const t of TICKET_TYPES) {
      for (const s of t.steps) expect([...OPS, 'PIT']).toContain(s);
    }
  });

  it('describes every operation', () => {
    expect(Object.keys(OP_INFO).sort()).toEqual([...OPS].sort());
    expect(OP_INFO.TAKEDOWN).toBe('Maintenance plus power off');
  });
});

describe('step colors', () => {
  it('gives every step its own color', () => {
    const keys = Object.keys(STEP_COLORS).sort();
    expect(keys).toEqual([...OPS, 'PIT'].sort());
    const colors = Object.values(STEP_COLORS).map((c) => c.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('keeps the HUD done and pending greys out of the step colors', () => {
    const css = readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');
    const grey = (name: string) =>
      css.match(new RegExp(`--step-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
    const colors = Object.values(STEP_COLORS).map((c) => c.toLowerCase());
    for (const name of ['done', 'pending']) {
      const value = grey(name);
      expect(value, name).toBeDefined();
      expect(colors).not.toContain(value?.toLowerCase());
    }
  });
});

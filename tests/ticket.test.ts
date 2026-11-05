import { describe, expect, it } from 'vitest';
import { makeRng } from '../src/logic/rng';
import { TICKET_TYPES } from '../src/logic/runbooks';
import { applyStep, issueTicket, nextStep, type Ticket } from '../src/logic/ticket';
import { slaSeconds } from '../src/logic/tuning';

const byId = (id: string) => {
  const t = TICKET_TYPES.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};

const ticketOf = (id: string): Ticket => ({
  number: 1,
  type: byId(id),
  location: 'r1-u01',
  stepIndex: 0,
  issuedAt: 0,
  deadline: 100,
});

describe('ticket', () => {
  it('advances on the next step and does not mutate the input', () => {
    const t = ticketOf('failed-disk');
    const { ticket, result } = applyStep(t, 'TAKEDOWN');
    expect(result).toBe('advanced');
    expect(ticket.stepIndex).toBe(1);
    expect(t.stepIndex).toBe(0);
    expect(nextStep(ticket)).toBe('PIT');
  });

  it('closes on the last step', () => {
    let t = ticketOf('failed-disk');
    t = applyStep(t, 'TAKEDOWN').ticket;
    t = applyStep(t, 'PIT').ticket;
    const { ticket, result } = applyStep(t, 'REINSTATE');
    expect(result).toBe('closed');
    expect(nextStep(ticket)).toBeNull();
  });

  it('closes a one-step ticket at once', () => {
    expect(applyStep(ticketOf('wrong-hostname'), 'META-SYNC').result).toBe('closed');
  });

  it('refuses any other step and keeps the index', () => {
    const t = ticketOf('failed-disk');
    const { ticket, result } = applyStep(t, 'REINSTATE');
    expect(result).toBe('wrong');
    expect(ticket.stepIndex).toBe(0);
  });

  it('refuses a step on a closed ticket', () => {
    const t = { ...ticketOf('wrong-hostname'), stepIndex: 1 };
    expect(applyStep(t, 'META-SYNC').result).toBe('wrong');
  });

  it('issues tickets with a valid location and deadline', () => {
    const rng = makeRng(5);
    for (let i = 0; i < 500; i++) {
      const t = issueTicket(rng, i + 1, 10);
      expect(t.number).toBe(i + 1);
      expect(t.stepIndex).toBe(0);
      expect(t.location).toMatch(/^r([1-9]|[1-3]\d|40)-u(0[1-9]|[1-3]\d|4[0-2])$/);
      expect(t.issuedAt).toBe(10);
      expect(t.deadline).toBe(10 + slaSeconds(t.type));
    }
  });

  it('gives more SLA time to longer runbooks', () => {
    expect(slaSeconds(byId('bad-cpu'))).toBeGreaterThan(slaSeconds(byId('failed-disk')));
    expect(slaSeconds(byId('failed-disk'))).toBeGreaterThan(slaSeconds(byId('wrong-hostname')));
  });
});

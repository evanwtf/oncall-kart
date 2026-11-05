import type { Step } from './ops';
import { intBetween, pick, type Rng } from './rng';
import { TICKET_TYPES, type TicketType } from './runbooks';
import { slaSeconds } from './tuning';

export interface Ticket {
  number: number;
  type: TicketType;
  /** Fake rack and unit, for example "r12-u07". */
  location: string;
  /** Index of the next step. Equals steps.length when the ticket is closed. */
  stepIndex: number;
  issuedAt: number;
  deadline: number;
}

export type StepResult = 'advanced' | 'closed' | 'wrong';

export function issueTicket(rng: Rng, number: number, now: number): Ticket {
  const type = pick(rng, TICKET_TYPES);
  const rack = intBetween(rng, 1, 40);
  const unit = intBetween(rng, 1, 42);
  return {
    number,
    type,
    location: `r${rack}-u${String(unit).padStart(2, '0')}`,
    stepIndex: 0,
    issuedAt: now,
    deadline: now + slaSeconds(type),
  };
}

/** The step the ticket needs next, or null when it is closed. */
export function nextStep(t: Ticket): Step | null {
  return t.type.steps[t.stepIndex] ?? null;
}

/** Apply one step. Pure: returns a new ticket and never changes the input. */
export function applyStep(t: Ticket, step: Step): { ticket: Ticket; result: StepResult } {
  const want = nextStep(t);
  if (want === null || want !== step) return { ticket: t, result: 'wrong' };
  const ticket = { ...t, stepIndex: t.stepIndex + 1 };
  return { ticket, result: nextStep(ticket) === null ? 'closed' : 'advanced' };
}

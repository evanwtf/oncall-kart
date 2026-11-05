import type { TicketType } from './runbooks';

/** Every tunable number in the game logic. Units: metres, seconds, radians. */
export const TUNING = {
  /** SLA time for a ticket: slaBase + slaPerStep * number of steps. */
  slaBase: 25,
  slaPerStep: 14,
};

export function slaSeconds(type: TicketType): number {
  return TUNING.slaBase + TUNING.slaPerStep * type.steps.length;
}

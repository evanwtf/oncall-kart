import type { Step } from './ops';

/**
 * A ticket type and its runbook.
 *
 * Edit this file to add or change tickets. Each step is an operation from
 * ops.ts or 'PIT'. A type with a 'PIT' step needs `pitWork`: the pit crew
 * shows it. Run `npm test` after an edit.
 */
export interface TicketType {
  id: string;
  title: string;
  steps: readonly Step[];
  pitWork?: string;
}

export const TICKET_TYPES: readonly TicketType[] = [
  {
    id: 'failed-disk',
    title: 'Failed disk',
    steps: ['TAKEDOWN', 'PIT', 'REINSTATE'],
    pitWork: 'swap the disk',
  },
  {
    id: 'outdated-firmware',
    title: 'Outdated firmware',
    steps: ['FW-ISO', 'REINSTATE'],
  },
  {
    id: 'bad-cpu',
    title: 'Bad CPU',
    steps: ['LOGCOLLECT', 'TAKEDOWN', 'PIT', 'POWERON', 'META-SYNC', 'REINSTATE'],
    pitWork: 'swap the CPU',
  },
  {
    id: 'switch-maintenance',
    title: 'Switch maintenance',
    steps: ['MAINT', 'PIT', 'META-SYNC', 'REINSTATE'],
    pitWork: 'recable the top-of-rack switch',
  },
  {
    id: 'rebuild-cluster',
    title: 'Rebuild tenant cluster',
    steps: ['MAINT', 'REIMAGE', 'META-SYNC', 'REINSTATE'],
  },
  {
    id: 'overheating-gpu',
    title: 'Overheating GPU',
    steps: ['LOGCOLLECT', 'TAKEDOWN', 'PIT', 'REINSTATE'],
    pitWork: 'reseat the GPU and its fans',
  },
  {
    id: 'bad-dimm',
    title: 'Bad DIMM',
    steps: ['LOGCOLLECT', 'TAKEDOWN', 'PIT', 'REINSTATE'],
    pitWork: 'swap the DIMM',
  },
  {
    id: 'flapping-nic',
    title: 'Flapping NIC',
    steps: ['MAINT', 'FW-ISO', 'META-SYNC', 'REINSTATE'],
  },
  {
    id: 'wrong-hostname',
    title: 'Wrong hostname in inventory',
    steps: ['META-SYNC'],
  },
];

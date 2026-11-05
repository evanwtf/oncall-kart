/** The operations that the gates carry. */
export const OPS = [
  'MAINT',
  'TAKEDOWN',
  'POWERON',
  'REINSTATE',
  'FW-ISO',
  'LOGCOLLECT',
  'META-SYNC',
  'REIMAGE',
] as const;

export type Op = (typeof OPS)[number];

/** A runbook step: an operation at a gate, or hands-on work in the pit. */
export type Step = Op | 'PIT';

export const OP_INFO: Record<Op, string> = {
  MAINT: 'Enter maintenance: stop tenant services, make ready for work',
  TAKEDOWN: 'Maintenance plus power off',
  POWERON: 'Power on',
  REINSTATE: 'Inverse of maintenance; powers the machine on if it is off',
  'FW-ISO': 'Maintenance, then boot the firmware-updater ISO',
  LOGCOLLECT: 'Maintenance, then boot the log-collector ISO',
  'META-SYNC': 'Pull the latest server metadata (hostname, serial, MACs) upstream',
  REIMAGE: 'Reinstall the OS',
};

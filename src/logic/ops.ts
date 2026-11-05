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

/**
 * One color per step, so a gate reads at a glance and the HUD matches it.
 * The HUD marks done and pending steps in greys, never in these hues.
 */
export const STEP_COLORS: Record<Step, string> = {
  MAINT: '#4d9de0',
  TAKEDOWN: '#e15554',
  POWERON: '#3ddc97',
  REINSTATE: '#f2c14e',
  'FW-ISO': '#b084f5',
  LOGCOLLECT: '#2ec4b6',
  'META-SYNC': '#f78fb3',
  REIMAGE: '#ff8c42',
  PIT: '#e8eef5',
};

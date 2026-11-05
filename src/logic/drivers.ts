/** The eight on-call engineers. Original characters; the color is the hoodie. */
export interface Driver {
  name: string;
  color: number;
}

export const DRIVERS: readonly Driver[] = [
  { name: 'Rollback Rae', color: 0xff6b35 },
  { name: 'Pager Pat', color: 0x3ddc97 },
  { name: 'Quorum Quinn', color: 0x4d9de0 },
  { name: 'Hotfix Hal', color: 0xe15554 },
  { name: 'Runbook Robin', color: 0xf2c14e },
  { name: 'Failover Fran', color: 0xb084f5 },
  { name: 'Uptime Uma', color: 0x2ec4b6 },
  { name: 'Cronjob Cody', color: 0xf78fb3 },
];

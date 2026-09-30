import type { IconName } from '../components/Icon';

/** One line of the notification bell / "Needs attention" (from the my_notifications RPC). */
export interface Notice { key: string; n: number; label: string; to: string; tone: 'warn' | 'bad' | 'info' }
export const NOTICE_ICON: Record<string, IconName> = {
  approvals: 'checkCircle', backlog: 'box', late: 'clock', not_sent: 'send', gaps: 'search', dups: 'repeat', locations: 'settings', month: 'calendar',
  to_send: 'send', to_receive: 'inbox', explain: 'alert', rejected: 'x', backlog_rejected: 'box',
};

// Every word the user sees for a status or type lives here - plain language, no ERP jargon.
import type { DiscKind, LegStatus } from './types';

export type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'bad' | 'purple';

export const LEG_STATUS: Record<LegStatus, { label: string; tone: Tone }> = {
  awaiting_dispatch: { label: 'Not sent yet', tone: 'neutral' },
  in_transit: { label: 'On the way', tone: 'info' },
  partially_received: { label: 'Partly received', tone: 'warn' },
  discrepancy: { label: 'Needs explanation', tone: 'bad' },
  completed: { label: 'Done', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const DISPATCH_STATUS: Record<string, { label: string; tone: Tone }> = {
  awaiting_dispatch: { label: 'Not sent yet', tone: 'neutral' },
  ok: { label: 'OK', tone: 'good' },
  short: { label: 'Sent less', tone: 'warn' },
  not_sent: { label: 'Not sent', tone: 'bad' },
  over: { label: 'Sent extra', tone: 'purple' },
  unplanned: { label: 'Not in plan', tone: 'purple' },
};

export const DISC_KIND: Record<DiscKind, { label: string; short: string; who: 'sender' | 'receiver'; help: string }> = {
  dispatch_short: { label: 'Sent less than planned', short: 'Sent less', who: 'sender', help: 'The sending store sent less than head office planned, or did not send the item at all.' },
  dispatch_over: { label: 'Sent more than planned', short: 'Sent extra', who: 'sender', help: 'The sending store sent more than head office planned.' },
  unplanned_item: { label: 'Item not in the plan', short: 'Not in plan', who: 'sender', help: 'This item was sent but was not in the plan - often a wrong or substitute item.' },
  unplanned_stv: { label: 'Transfer without a plan', short: 'No plan', who: 'sender', help: 'Stock was sent without any plan from head office.' },
  receipt_short: { label: 'Not received yet', short: 'Not received', who: 'receiver', help: 'Stock was sent to this store but the store has not received it in the ERP yet. Until it does, the stock is invisible in the app.' },
  receipt_over: { label: 'Received but never sent', short: 'Received extra', who: 'receiver', help: 'The store received stock that nobody sent in this system (old stuck stock, or the sender forgot to upload).' },
};

export const DIRECTION: Record<string, { label: string; tone: Tone; help: string }> = {
  dispatch: { label: 'Sent', tone: 'info', help: 'A store sent stock to another store' },
  receipt: { label: 'Received', tone: 'good', help: 'A store received stock - it is now sellable' },
  direct: { label: 'Direct', tone: 'purple', help: 'Sent directly from store to store' },
  other: { label: 'Other', tone: 'neutral', help: 'Not a normal transfer (return, wrong store…) - head office checks it' },
};

export const VS_STATUS: Record<string, { label: string; tone: Tone; help: string }> = {
  not_in_system: { label: 'Unknown stuck stock', tone: 'bad', help: 'The ERP shows this stock stuck in the store, but no transfer here explains it. Old stock or a voucher that was never uploaded.' },
  partly_explained: { label: 'More than expected', tone: 'warn', help: 'The ERP shows more stuck stock than the open transfers explain.' },
  receipt_not_uploaded: { label: 'Received, not uploaded', tone: 'purple', help: 'The store received it in the ERP but did not upload the receiving voucher here.' },
  explained: { label: 'On the way (normal)', tone: 'info', help: 'Matches a transfer that is still waiting to be received.' },
};

export const ROLE_LABEL = { admin: 'Head office (admin)', viewer: 'Head office (view only)', store: 'Store user' } as const;

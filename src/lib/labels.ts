import type { DiscKind, LegStatus } from './types';

export type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'bad' | 'purple';

export const LEG_STATUS: Record<LegStatus, { label: string; tone: Tone }> = {
  awaiting_dispatch: { label: 'Awaiting dispatch', tone: 'neutral' },
  in_transit: { label: 'In transit', tone: 'info' },
  partially_received: { label: 'Partly received', tone: 'warn' },
  discrepancy: { label: 'Discrepancy open', tone: 'bad' },
  completed: { label: 'Completed', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const DISPATCH_STATUS: Record<string, { label: string; tone: Tone }> = {
  awaiting_dispatch: { label: 'Not dispatched yet', tone: 'neutral' },
  ok: { label: 'Matched', tone: 'good' },
  short: { label: 'Short', tone: 'warn' },
  not_sent: { label: 'Not sent', tone: 'bad' },
  over: { label: 'Over', tone: 'purple' },
  unplanned: { label: 'Not in plan', tone: 'purple' },
};

export const DISC_KIND: Record<DiscKind, { label: string; short: string; who: 'sender' | 'receiver'; help: string }> = {
  dispatch_short: { label: 'Sent less than planned', short: 'Short sent', who: 'sender', help: 'The sending store sent less than the allocation (or did not send the item).' },
  dispatch_over: { label: 'Sent more than planned', short: 'Over sent', who: 'sender', help: 'The sending store sent more than the allocation.' },
  unplanned_item: { label: 'Item not in plan', short: 'Unplanned item', who: 'sender', help: 'Item on the STV that was not in the allocation (often a wrong / substitute item).' },
  unplanned_stv: { label: 'Transfer without plan', short: 'Unplanned STV', who: 'sender', help: 'A whole STV that is not linked to any allocation plan.' },
  receipt_short: { label: 'Not received', short: 'Not received', who: 'receiver', help: 'Dispatched into the Allocation store but not (fully) moved into the receiving D.S.' },
  receipt_over: { label: 'Received without dispatch', short: 'Over received', who: 'receiver', help: 'Received from the Allocation store with no matching dispatch in the system (old backlog or missing sender upload).' },
};

export const DIRECTION: Record<string, { label: string; tone: Tone; help: string }> = {
  dispatch: { label: 'Dispatch', tone: 'info', help: 'Sender → receiving store\'s Allocation (virtual) store' },
  receipt: { label: 'Receipt', tone: 'good', help: 'Allocation store → the same store\'s D.S (stock becomes sellable)' },
  direct: { label: 'Direct', tone: 'purple', help: 'Store → store directly, no Allocation store in between' },
  other: { label: 'Other', tone: 'neutral', help: 'Not an allocation movement (e.g. return, wrong store)' },
};

export const VS_STATUS: Record<string, { label: string; tone: Tone; help: string }> = {
  not_in_system: { label: 'Not in system', tone: 'bad', help: 'In the ERP virtual store but no open transfer in IALC - old backlog or an STV that was never uploaded.' },
  partly_explained: { label: 'More than expected', tone: 'warn', help: 'ERP holds more than the open transfers explain.' },
  receipt_not_uploaded: { label: 'Receipt not uploaded', tone: 'purple', help: 'ERP shows less than IALC expects - the receiving STV was probably posted in the ERP but not uploaded here.' },
  explained: { label: 'Matches open transfer', tone: 'info', help: 'Matches transfers still waiting to be received.' },
};

export const ROLE_LABEL = { admin: 'Head office (admin)', viewer: 'Head office (view only)', store: 'Store user' } as const;

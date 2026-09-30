export type Role = 'admin' | 'viewer' | 'store';

export interface Site { id: number; name: string; kind: 'ds' | 'dc'; aliases: string[]; sort_order: number; active: boolean }
export interface ErpLocation { code: string; erp_name: string; site_id: number; kind: 'ds' | 'dc' | 'allocation'; auto_created: boolean }
export interface ReasonCode { code: string; label: string; applies_to: string[]; sort_order: number; active: boolean }
export interface Profile { user_id: string; full_name: string; login: string | null; role: Role; active: boolean }

export interface LegRow {
  leg_id: string; allocation_id: string; ref: string; kind: 'dc' | 'internal'; title: string | null;
  from_site_id: number; to_site_id: number; plan_date: string; allocation_status: 'active' | 'cancelled'; created_at: string;
  planned_skus: number; planned_qty: number; dispatched_skus: number; dispatched_qty: number;
  received_skus: number; received_qty: number; open_qty: number; open_value: number;
  open_issues: number; pending_issues: number; first_dispatch_date: string | null; dispatch_docs: string | null; stv_count: number;
  completed_date: string | null; last_receipt_date: string | null; status: LegStatus; days_waiting_dispatch: number | null;
}
export type LegStatus = 'awaiting_dispatch' | 'in_transit' | 'partially_received' | 'discrepancy' | 'completed' | 'cancelled';

export interface LegItemRow {
  leg_id: string; item_code: string; item_name: string | null; cost: number | null; planned_qty: number | null;
  dispatched_qty: number; received_qty: number; open_qty: number; raw_open_qty: number;
  first_dispatch: string | null; last_receipt_date: string | null; dispatch_docs: string | null; leg_dispatched: boolean;
  dispatch_status: 'awaiting_dispatch' | 'unplanned' | 'not_sent' | 'short' | 'over' | 'ok';
  dispatch_gap: number; resolution_id: string | null; resolution_kind: string | null; resolution_status: ResStatus | null;
  reason_code: string | null; resolution_note: string | null;
}
export type ResStatus = 'pending' | 'approved' | 'rejected';

export interface DispatchItemRow {
  stv_id: string; doc_no: string; stv_date: string; direction: 'dispatch' | 'direct'; from_code: string; to_code: string;
  from_site_id: number; to_site_id: number; leg_id: string | null; item_code: string; item_name: string | null; cost: number | null;
  dispatched_qty: number; received_qty: number; raw_open_qty: number; open_qty: number;
  last_receipt_date: string | null; receipt_docs: string | null; age_days: number;
  resolution_id: string | null; resolution_status: ResStatus | null; reason_code: string | null; resolution_note: string | null;
}

export type DiscKind = 'dispatch_short' | 'dispatch_over' | 'unplanned_item' | 'unplanned_stv' | 'receipt_short' | 'receipt_over';
export interface DiscrepancyRow {
  kind: DiscKind; leg_id: string | null; stv_id: string | null; item_code: string; item_name: string | null; cost: number | null;
  from_site_id: number | null; to_site_id: number; responsible_site_id: number; ref: string | null; allocation_id: string | null;
  doc_no: string | null; docs: string | null; event_date: string | null; planned_qty: number | null; actual_qty: number | null; gap_qty: number | null;
  resolution_id: string | null; resolution_status: ResStatus | null; reason_code: string | null; resolution_note: string | null;
}

export interface StvRow {
  id: string; doc_no: string; stv_date: string; from_code: string; to_code: string; from_site_id: number; to_site_id: number;
  from_kind: string; to_kind: string; direction: 'dispatch' | 'receipt' | 'direct' | 'other'; leg_id: string | null; post_ref: string | null;
  source: string; file_path: string | null; file_name: string | null; line_count: number; total_qty: number; parse_warnings: string[];
  status: 'active' | 'void'; void_reason: string | null; uploaded_by: string | null; uploaded_at: string;
}

export interface VsRow {
  location_code: string; site_id: number; erp_name: string; snapshot_date: string | null; item_code: string; item_name: string | null;
  cost: number | null; erp_qty: number; erp_value: number | null; system_open_qty: number; diff_qty: number;
  since_date: string | null; age_days: number | null; match_status: 'not_in_system' | 'partly_explained' | 'receipt_not_uploaded' | 'explained';
}

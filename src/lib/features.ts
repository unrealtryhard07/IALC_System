// Features that are built but switched off for now. Set one to true to bring it back -
// the database side (tables, approvals, notifications) stays in place either way.
export const FEATURES = {
  /** Old stock clean-up: decide and approve what happens to stock stuck in the Allocation stores. */
  oldStockCleanup: false,
};

/** Where the "stuck stock" cards on the Overview and Dashboard link to. */
export const STUCK_STOCK_LINK = FEATURES.oldStockCleanup
  ? { to: '/virtual-stores?tab=cleanup', label: 'Clean up' }
  : { to: '/virtual-stores', label: 'Open list' };

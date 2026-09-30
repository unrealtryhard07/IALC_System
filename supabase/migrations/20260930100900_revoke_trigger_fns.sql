-- Trigger / helper functions are never called from the app (Supabase grants EXECUTE to authenticated by default).
revoke execute on function public.guard_stvs_lock(), public.guard_allocations_lock(), public.guard_snapshots_lock(),
  public.locked_error(date) from authenticated;

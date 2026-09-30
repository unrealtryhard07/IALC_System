-- Pin search_path on the remaining helper functions (Supabase security advisor).
alter function public.kw_today() set search_path = public;
alter function public.norm_name(text) set search_path = public;
alter function public.classify_direction(public.erp_locations, public.erp_locations) set search_path = public;

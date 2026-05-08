-- 062_support_update_thread_drop_legacy_overload.sql
--
-- Fix: remove legacy 5-arg overload of support_staff_update_thread.
-- It conflicts with the current 6-arg version when RPC is called with
-- named parameters and causes:
-- "Could not choose the best candidate function ...".

set search_path = public, pg_temp;

drop function if exists public.support_staff_update_thread(
  uuid,   -- p_staff_id
  uuid,   -- p_thread_id
  text,   -- p_status
  uuid,   -- p_assigned_staff_id
  boolean -- p_clear_unread
);

-- Removes only a redundant duplicate index; table rows and the remaining index are preserved.
DROP INDEX IF EXISTS public.flamexbot_admin_audit_created_at_idx;

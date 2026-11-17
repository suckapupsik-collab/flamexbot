-- Let authenticated users read only their own completed add-on purchases.
-- Pending and failed invoices remain server-only; RLS blocks access to other users.
GRANT SELECT ON TABLE public.flamexbot_addon_star_payments TO authenticated;

DROP POLICY IF EXISTS "Users can view own completed add-on payments"
  ON public.flamexbot_addon_star_payments;

CREATE POLICY "Users can view own completed add-on payments"
  ON public.flamexbot_addon_star_payments
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND status = 'paid'
    AND paid_at IS NOT NULL
    AND public.is_flamexbot_user_active()
  );

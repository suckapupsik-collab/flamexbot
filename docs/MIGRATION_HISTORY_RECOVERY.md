# Supabase migration history recovery

**Project:** `flamexbot`  
**Supabase project:** `yxmfhnbqzudoiwjlrpui`  
**Checked:** 2026-11-17

## Verified state

- Supabase migration history contains **75 applied entries**.
- `main` contains **28 SQL files** under `supabase/migrations/`.
- The raw count difference is **47**. This is a repository/history gap, not proof that exactly 47 particular SQL files can be recreated from the current schema.
- Comparing tracked filenames with Supabase history:
  - 10 files match both the applied migration name and version.
  - 11 files have a matching migration name but a different version prefix.
  - 7 files do not have an exact applied migration-name match.
- The migration directory first appears in Git history in commit `81e675a8107f851c73daf97b30ba4e4a0cd1b0f1`. Its parent commit `0cd033e48323c729f5d881d9a501ddf56ee8a348` has no `supabase/migrations/` directory. Therefore, the earlier applied migrations were not preserved in this repository's tracked migration history.
- At least one tracked file, `20261116040000_add_business_message_event_history.sql`, has no exact version/name entry in the current Supabase migration list. Its presence in GitHub is not proof that this exact file was applied under that version.

## Safety rules

1. **Do not run `supabase db push` from this repository until every tracked migration is reconciled with the production migration ledger.** Version mismatches can make the CLI treat already-applied SQL as pending.
2. Do not reset the production database, rewrite `supabase_migrations.schema_migrations`, or reapply historical migrations.
3. Do not create empty SQL placeholders for missing history.
4. Do not infer historical migration bodies from today's schema and label them as original migrations. The current schema cannot reliably reproduce the order, intermediate states, data changes, or one-time operations of the original migrations.

## Recovery plan

1. Search for the original SQL files in developer workstations, deployment artifacts, backups, exported SQL Editor history, and other repository clones.
2. For each recovered file, compare its SQL and intended version/name against the live migration ledger before adding it to Git.
3. Keep already-applied production migrations untouched. If an original file cannot be recovered, document that gap rather than inventing its contents.
4. Once historical recovery is complete, create a separate, reviewed baseline/snapshot for provisioning a **new** environment. Do not use that baseline to replace production history.
5. Only resume automated migration pushes after the repository filenames and contents have been reconciled with the live migration ledger.

## Current disposition

**No production migration was reset, replayed, or rewritten during this audit.** The gap remains open pending recovery of original SQL sources.


## Follow-up check — 2026-11-17

A later check after the notification/webhook and Stars-refund work found **77 applied migrations** and **30 tracked SQL files**. The original 75/28 figures above are the earlier audit snapshot, not the current count. Two additional migration sources are now tracked:
- `20261117133242_telegram_update_claim_status.sql`
- `20261117133649_flamexbot_refunded_star_payment_ledger.sql`

The migration history gap is still open. The new files document only the changes applied during this follow-up; they do not reconstruct the missing historical SQL. Continue to avoid production resets, replaying old migrations, and `db push` until all version/name mismatches have been reconciled.


## Follow-up check — 2026-11-17 (Stars grant serialization)

The production migration ledger now contains **78 applied migrations** and GitHub `main` contains **31 SQL migration files**. The raw count difference remains 47; it is not proof that exactly 47 individual source files are missing because historical version/name mismatches remain.

New migration tracked and applied:
- `20261117134151_serialize_stars_grants_with_bans_and_refunds.sql`

This migration updates the Premium/PRO, paid-wheel, and command-protection payment RPCs to lock and validate the user's profile row (including Telegram ID and `is_banned=false`) inside the transaction. It also serializes grant processing with refund preparation using a transaction-scoped advisory lock keyed by Telegram's payment charge ID, and rejects a charge already present in the refund ledger.

The paid-wheel RPC now validates and locks the profile before drawing/awarding the prize. The free-wheel redemption path already decrements spins through an update constrained by `is_banned=false`, which locks the profile row before calling the prize routine.

The migration preserves the existing service-role-only EXECUTE grants on payment/refund RPCs. No production payment, refund, or prize redemption was executed during this audit.


## Follow-up check — 2026-11-17 (weekly wheel grants and index cleanup)

The production ledger now contains **80 applied migrations** and GitHub `main` contains **33 SQL migration files**. The raw difference remains 47 and must not be interpreted as an exact count of missing historical sources.

New migrations:
- `20261117134807_top_up_weekly_wheel_grants_after_pro_upgrade.sql`
- `20261117135026_refund_ledger_fk_index_and_dedupe_notifications_index.sql`

Weekly wheel grants are now idempotent per user/week and can top up an existing Premium grant by one spin after an upgrade to PRO during that same week. The function re-locks and re-reads the profile and subscription before computing the delta; it never removes spins already granted after a downgrade. It preserves the existing service-role-only EXECUTE grant and the existing Monday cron schedule.

The wheel UI now computes displayed probabilities from the same weights and PRO multiplier as the database draw routine. The PRO copy describes a 10% increase to rare-prize weights rather than promising an exact 10% increase to normalized probabilities.

The performance advisor identified two exactly identical pending-notification indexes. The newer duplicate was removed; the original index was retained. An index was also added to the refund ledger's user foreign key. No other unused indexes were dropped because advisor usage counters alone are insufficient evidence that they are safe to remove.


## Follow-up check — 2026-11-17 (weekly grant top-up and index cleanup)

The production migration ledger now contains **80 applied migrations** and GitHub `main` contains **33 SQL migration files**. The raw count difference remains 47; it is not a verified count of individually missing migration files.

New migrations:
- `20261117134807_top_up_weekly_wheel_grants_after_pro_upgrade.sql`
- `20261117135026_refund_ledger_fk_index_and_dedupe_notifications_index.sql`

The weekly grant RPC now tops up an existing one-spin Premium grant to two spins if the same account upgrades to PRO during that UTC week. It locks by user/week, locks and re-reads the profile and subscription, and only adds the positive delta. Downgrades do not remove already granted spins. Existing Monday cron schedule and service-role-only execution are preserved. This logic was verified by inspecting the deployed SQL definition and ACL; the grant job was not manually executed against real accounts.

The wheel interface now derives displayed probabilities from the same weight set and PRO multiplier as the SQL draw routine. PRO wording now describes the 10% weight increase accurately.

The performance advisor's duplicate-index warning was resolved: the exact duplicate `notifications_telegram_delivery_pending_idx` was dropped, retaining `notifications_pending_telegram_idx`. A user_id index was added to the refund ledger; the advisor no longer reports its foreign key as unindexed. Other unused indexes were left intact pending query-level evidence.


## Follow-up check — 2026-11-17 (trial/subscription race)

New migration applied and tracked:
- `20261117135257_serialize_trial_claim_with_subscription_payments.sql`

The trial claim now locks the user's active profile row and then the subscription row before checking eligibility and granting three trial days. This follows the same profile-then-subscription lock order as paid Premium/PRO grants. It prevents a simultaneous trial claim from overwriting a paid subscription or allowing a trial to start after a paid subscription has already become active. The existing one-trial-per-user check and notification remain in the same transaction.


## Follow-up check — 2026-11-17 (referral reward serialization)

New migration applied and tracked:
- `20261117135441_serialize_referral_rewards_with_account_bans.sql`

Referral reward processing now locks the referrer and referred user's profile rows in deterministic UUID order before checking Telegram linkage and ban status. It then locks the referrer's subscription before choosing between a lifetime-plan bonus spin and a one-day Premium/PRO-preserving extension. This closes the race where a ban could occur after the eligibility check but before reward application and reduces deadlock risk for concurrent referral attempts.

The underlying `apply_flamexbot_referral(uuid,uuid)` RPC remains service-role-only; the authenticated entry point uses the current `auth.uid()` as the referred account. No referral was manually applied during verification.

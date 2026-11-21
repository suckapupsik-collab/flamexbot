# FLAMEXBOT archive migration source comparison

- Date: 2026-11-21
- Repository: `suckapupsik-collab/flamexbot`, branch `main`
- Archive: `flamexbot-main/supabase/migrations`
- Archive SQL files inspected: **38**
- Method: compare archive SQL text against the same path on GitHub main; content fingerprints were computed from Unicode code points. This is a source-to-source comparison only, not proof of what SQL was executed in production.

## Result

| Status | Count | Meaning |
|---|---:|---|
| Identical archive and GitHub main | 26 | Safe to regard GitHub main as byte-for-byte equivalent at the text level for these files |
| Same path, content changed | 11 | GitHub main contains a newer/different SQL body; do not overwrite it with archive content |
| Archive-only path | 1 | No file at the same path on GitHub main; not automatically safe to restore |

## 26 identical files

- `20261116000000_add_antimut_enabled_to_business_chat_settings.sql`
- `20261116011000_fix_admin_premium_upsert.sql`
- `20261116012000_guarantee_daily_task_rotation.sql`
- `20261116013000_publish_profiles_for_moderation.sql`
- `20261116014000_admin_directory_telegram_avatar.sql`
- `20261116015000_daily_progress_and_auto_read_notifications.sql`
- `20261116035000_flamexbot_command_protection_addon_and_webhook_reliability.sql`
- `20261116040000_add_business_message_event_history.sql`
- `20261117000000_add_business_chat_spam_consent.sql`
- `20261117001000_business_flood_protection.sql`
- `20261117002000_auto_flood_mute_override.sql`
- `20261117121753_flamexbot_trigger_acl_and_fk_indexes.sql`
- `20261117123211_flamexbot_addon_payment_history_rls.sql`
- `20261117124510_flamexbot_business_outbound_rate_limit.sql`
- `20261117124656_flamexbot_wheel_payment_charge_id_unique.sql`
- `20261117130000_flamexbot_business_message_events_least_privilege.sql`
- `20261117131112_atomic_telegram_notification_delivery_claims.sql`
- `20261117131327_include_business_connection_notifications_in_delivery.sql`
- `20261117131607_claim_admin_notification_before_direct_send.sql`
- `20261117131752_claim_wheel_notification_before_direct_send.sql`
- `20261117133000_index_business_send_limits_chat_fk.sql`
- `20261117133242_telegram_update_claim_status.sql`
- `20261117133649_flamexbot_refunded_star_payment_ledger.sql`
- `20261117134000_index_telegram_init_data_cleanup.sql`
- `20261117135026_refund_ledger_fk_index_and_dedupe_notifications_index.sql`
- `20261117194205_add_flamexbot_support_inbox.sql`

## 11 files whose GitHub main content differs from the archive

The current GitHub file is newer/different; keep it. The archive copy must not overwrite it.

- `20261116010000_flamexbot_admin_badges_daily_tasks_achievements.sql`
- `20261116016000_enforced_bans_and_admin_audit.sql`
- `20261116050000_flamexbot_subscription_tiers_wheel_perks.sql`
- `20261117125944_preserve_verification_when_changing_role_badges.sql`
- `20261117131433_link_admin_notifications_to_audit_event.sql`
- `20261117134151_serialize_stars_grants_with_bans_and_refunds.sql`
- `20261117134807_top_up_weekly_wheel_grants_after_pro_upgrade.sql`
- `20261117135000_block_referrals_for_banned_accounts.sql`
- `20261117135257_serialize_trial_claim_with_subscription_payments.sql`
- `20261117135441_serialize_referral_rewards_with_account_bans.sql`
- `20261117135958_clarify_pro_rare_prize_weight_bonus_copy.sql`

## Archive-only file

- `20261120000000_admin_business_connection_status.sql`

This file defines an older admin status RPC. The current repository instead contains the newer migration `20261120205352_business_status_rpc_and_fk_indexes.sql`, which is recorded in the live production ledger. Do not restore the archive-only file under its old timestamp: doing so could replay/reintroduce an obsolete function definition.

## Production ledger boundary

The live Supabase ledger snapshot contains **116** applied entries, latest `20261120210506 drop_duplicate_admin_audit_index`. The ledger exposes version and name, not the original SQL body. Archive filenames/timestamps are not sufficient to prove a one-to-one match with production entries. Therefore:

1. No SQL was executed against production as part of this comparison.
2. No migration ledger rows were changed.
3. No archive SQL was replayed or renamed to imitate a production migration.
4. Continue recovery by finding original SQL from Git history, backup clones, workstation backups, or deployment records, and reconcile exact version/name before any future migration operation.

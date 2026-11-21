# FLAMEXBOT production migration reconciliation

Date: 2026-11-21  
Repository: `suckapupsik-collab/flamexbot`, branch `main`  
Supabase project: `yxmfhnbqzudoiwjlrpui`

## Verified production state

- Supabase migration ledger: **116** entries.
- Latest applied entry: `20261120210506 drop_duplicate_admin_audit_index`.
- Archive SQL files reviewed: **38**.
- GitHub history query for `supabase/migrations`: **53 commits**.
- The production schema contains `public.flamexbot_business_message_events` (650 rows) and the support inbox tables. These observations confirm objects exist, not which exact migration version created them.

## Reconciliation summary

| Classification | Files | Interpretation |
|---|---:|---|
| Archive version matches a production ledger version | 19 | Version prefix is the same; verify SQL body separately before any replay |
| Version prefix differs, but a clear ledger counterpart exists | 17 | Use the production ledger version/name below; archive filename is not authoritative |
| No production ledger counterpart found; object exists | 1 | Business message event table creation SQL is recoverable in Git history, but the creation migration is not represented by a matching ledger entry |
| Superseded by a newer production migration | 1 | Old archive Business status RPC is obsolete; do not restore it |

## Per-file mapping

| Archive SQL file | Production ledger counterpart | Status |
|---|---|---|
| `20261116000000_add_antimut_enabled_to_business_chat_settings.sql` | `20261116012938 add_antimut_enabled_to_business_chat_settings` | Version differs |
| `20261116010000_flamexbot_admin_badges_daily_tasks_achievements.sql` | `20261116015108 flamexbot_admin_badges_daily_tasks_and_achievements` | Version differs; Git history has later edits |
| `20261116011000_fix_admin_premium_upsert.sql` | `20261116015606 fix_flamexbot_admin_premium_upsert` | Version differs |
| `20261116012000_guarantee_daily_task_rotation.sql` | `20261116020335 guarantee_daily_task_rotation` | Version differs |
| `20261116013000_publish_profiles_for_moderation.sql` | `20261116020421 publish_profiles_for_realtime_moderation` | Version differs |
| `20261116014000_admin_directory_telegram_avatar.sql` | `20261116020714 show_telegram_avatar_in_admin_directory` | Version differs |
| `20261116015000_daily_progress_and_auto_read_notifications.sql` | `20261116021411 flamexbot_daily_progress_rpc_and_auto_read_notifications` | Version differs |
| `20261116016000_enforced_bans_and_admin_audit.sql` | `20261116021800 flamexbot_enforced_bans_and_admin_audit` | Version differs; Git history has later edits |
| `20261116035000_flamexbot_command_protection_addon_and_webhook_reliability.sql` | `20261116035442 flamexbot_command_protection_addon_and_webhook_reliability` | Version differs |
| `20261116040000_add_business_message_event_history.sql` | No matching create-table migration entry found | Unpaired; table exists in production |
| `20261116050000_flamexbot_subscription_tiers_wheel_perks.sql` | `20261116124948 flamexbot_subscription_tiers_wheel_perks` | Version differs |
| `20261117000000_add_business_chat_spam_consent.sql` | `20261117083421 add_business_chat_spam_consent` | Version differs |
| `20261117001000_business_flood_protection.sql` | `20261117091901 business_flood_protection` | Version differs |
| `20261117002000_auto_flood_mute_override.sql` | `20261117092442 auto_flood_mute_override` | Version differs |
| `20261117121753_flamexbot_trigger_acl_and_fk_indexes.sql` | `20261117121753 flamexbot_trigger_acl_and_fk_indexes` | Version matches |
| `20261117123211_flamexbot_addon_payment_history_rls.sql` | `20261117123211 flamexbot_addon_payment_history_rls` | Version matches |
| `20261117124510_flamexbot_business_outbound_rate_limit.sql` | `20261117124510 flamexbot_business_outbound_rate_limit` | Version matches |
| `20261117124656_flamexbot_wheel_payment_charge_id_unique.sql` | `20261117124656 flamexbot_wheel_payment_charge_id_unique` | Version matches |
| `20261117125944_preserve_verification_when_changing_role_badges.sql` | `20261117125944 preserve_verification_when_changing_role_badges` | Version matches |
| `20261117130000_flamexbot_business_message_events_least_privilege.sql` | `20261117123756 flamexbot_business_message_events_least_privilege` | Version differs |
| `20261117131112_atomic_telegram_notification_delivery_claims.sql` | `20261117131112 atomic_telegram_notification_delivery_claims` | Version matches |
| `20261117131327_include_business_connection_notifications_in_delivery.sql` | `20261117131327 include_business_connection_notifications_in_delivery` | Version matches |
| `20261117131433_link_admin_notifications_to_audit_event.sql` | `20261117131433 link_admin_notifications_to_audit_event` | Version matches |
| `20261117131607_claim_admin_notification_before_direct_send.sql` | `20261117131607 claim_admin_notification_before_direct_send` | Version matches |
| `20261117131752_claim_wheel_notification_before_direct_send.sql` | `20261117131752 claim_wheel_notification_before_direct_send` | Version matches |
| `20261117133000_index_business_send_limits_chat_fk.sql` | `20261117130357 index_business_send_limits_chat_fk` | Version differs |
| `20261117133242_telegram_update_claim_status.sql` | `20261117133242 telegram_update_claim_status` | Version matches |
| `20261117133649_flamexbot_refunded_star_payment_ledger.sql` | `20261117133649 flamexbot_refunded_star_payment_ledger` | Version matches |
| `20261117134000_index_telegram_init_data_cleanup.sql` | `20261117130551 index_telegram_init_data_cleanup` | Version differs |
| `20261117134151_serialize_stars_grants_with_bans_and_refunds.sql` | `20261117134151 serialize_stars_grants_with_bans_and_refunds` | Version matches |
| `20261117134807_top_up_weekly_wheel_grants_after_pro_upgrade.sql` | `20261117134807 top_up_weekly_wheel_grants_after_pro_upgrade` | Version matches |
| `20261117135000_block_referrals_for_banned_accounts.sql` | `20261117130824 block_referrals_for_banned_accounts` | Version differs |
| `20261117135026_refund_ledger_fk_index_and_dedupe_notifications_index.sql` | `20261117135026 refund_ledger_fk_index_and_dedupe_notifications_index` | Version matches |
| `20261117135257_serialize_trial_claim_with_subscription_payments.sql` | `20261117135257 serialize_trial_claim_with_subscription_payments` | Version matches |
| `20261117135441_serialize_referral_rewards_with_account_bans.sql` | `20261117135441 serialize_referral_rewards_with_account_bans` | Version matches |
| `20261117135958_clarify_pro_rare_prize_weight_bonus_copy.sql` | `20261117135958 clarify_pro_rare_prize_weight_bonus_copy` | Version matches |
| `20261117194205_add_flamexbot_support_inbox.sql` | `20261117194205 add_flamexbot_support_inbox` | Version matches |
| `20261120000000_admin_business_connection_status.sql` | Superseded by `20261120205352 business_status_rpc_and_fk_indexes` | Obsolete archive source; do not restore |

## Git history evidence

- The business message event table creation SQL is present in commit `97906969da255348fb1e4315ef81b988d48e742c` (2026-11-16). The table currently exists in production with 650 rows. A later, separate migration `20261117123756 flamexbot_business_message_events_least_privilege` only revokes client write privileges and grants SELECT; it is not the table-creation migration. The creation SQL's exact production ledger association remains unproven.
- The support inbox migration's SQL is in Git history and is currently tracked as `20261117194205_add_flamexbot_support_inbox.sql`. A temporary mismatched filename was aligned and then removed in commits `5aae44ba5341047210009955eea07c0b77373051` and `b4cb96297f27f89bd29ba69f56941edac60f72f6`.
- The admin badges/daily-task and enforced-ban migration files have subsequent Git edits (e.g. commits `bca24a3ece716dc12b908e386602bb510f71eba3`, `74405e78058e1461902abd263d3defd9cb535493`, `31b4ff62ccf82ce4c3bac022617182bd199199f7`, `87329d5bb40f25cb1a6f5c5034d3154cc73f2a53`). The current main-branch bodies must not be assumed to be the exact SQL originally executed.
- The old archive status migration has no same-path GitHub file. Production has the newer `20261120205352_business_status_rpc_and_fk_indexes`; its SQL is tracked on main.

## Safe recovery decisions

1. Do not run `supabase db push`, reset, replay, or rename these historical migrations.
2. Do not add the 17 differently timestamped archive files under their archive timestamps; their production ledger versions already exist.
3. Keep the event-history table creation SQL as a recovered historical source, but do not invent a ledger row for it. Find deployment/audit evidence if its exact application mechanism must be established.
4. Keep the newer Business status migration; do not restore the obsolete archive RPC.
5. Preserve both the 116-entry ledger snapshot and this mapping as recovery documentation. No production schema, data, or migration ledger was changed during this reconciliation.

# Production Supabase migration ledger snapshot

- Project: `flamexbot`
- Project ref: `yxmfhnbqzudoiwjlrpui`
- Snapshot date: 2026-11-21
- Source: live Supabase `list_migrations` response
- Applied entries observed: **116**
- Latest applied entry: `20261120210506` — `drop_duplicate_admin_audit_index`

This is a read-only snapshot of the production migration ledger. It is **not** a reconstructed migration directory and does not assert that missing SQL source files have been recovered.

## Applied production ledger

| Version | Name |
|---|---|
| `20261115200435` | `secure_chat_media_and_realtime` |
| `20261115200732` | `telegram_mini_app_auth` |
| `20261115200751` | `telegram_init_data_replay_table_public` |
| `20261115203527` | `telegram_business_connections` |
| `20261115204742` | `business_inbox_and_messages` |
| `20261115205003` | `business_chat_realtime` |
| `20261115205514` | `founder_only_admin_and_business_only_messaging` |
| `20261115212506` | `flamex_business_media_storage_and_replies` |
| `20261115212644` | `expand_flamex_business_document_types` |
| `20261115213552` | `flamexbot_achievement_and_streak_activity` |
| `20261115213931` | `business_unread_counts_rpc` |
| `20261115220041` | `add_flamexbot_telegram_stars_payments` |
| `20261115220145` | `expose_private_stars_payment_rpc_to_service_role` |
| `20261115220211` | `add_premium_automation_preferences` |
| `20261116012938` | `add_antimut_enabled_to_business_chat_settings` |
| `20261116015108` | `flamexbot_admin_badges_daily_tasks_and_achievements` |
| `20261116015606` | `fix_flamexbot_admin_premium_upsert` |
| `20261116020246` | `protect_owner_premium_and_permanent_subscriptions` |
| `20261116020335` | `guarantee_daily_task_rotation` |
| `20261116020421` | `publish_profiles_for_realtime_moderation` |
| `20261116020714` | `show_telegram_avatar_in_admin_directory` |
| `20261116021411` | `flamexbot_daily_progress_rpc_and_auto_read_notifications` |
| `20261116021712` | `flamexbot_admin_audit_and_daily_rotation` |
| `20261116021800` | `flamexbot_enforced_bans_and_admin_audit` |
| `20261116021823` | `tighten_flamexbot_badge_and_audit_table_privileges` |
| `20261116021930` | `protect_all_owner_entitlements_and_preserve_permanent_premium` |
| `20261116022007` | `remove_unused_duplicate_admin_audit_log` |
| `20261116022350` | `secure_flamexbot_leaderboard_and_admin_checks` |
| `20261116022512` | `restrict_flamexbot_unread_counts_to_active_users` |
| `20261116022950` | `add_flamexbot_friends_and_daily_streak_engine` |
| `20261116023303` | `restrict_friend_request_table_writes_to_rpc` |
| `20261116023418` | `exclude_business_commands_from_streak_activity` |
| `20261116023730` | `use_telegram_avatar_for_friend_search` |
| `20261116025010` | `repair_rewards_msk_badge_limit_admin_streak_and_stats` |
| `20261116030130` | `set_default_profile_timezone_to_moscow` |
| `20261116030628` | `enable_admin_badge_privileges_with_owner_hierarchy` |
| `20261116031026` | `tighten_trigger_rpc_permissions_and_add_fk_indexes` |
| `20261116031117` | `protect_developer_and_admin_accounts_from_delegated_moderators` |
| `20261116031305` | `initialize_moscow_timezone_for_existing_profiles` |
| `20261116033700` | `show_founder_blue_verification_without_second_badge` |
| `20261116034316` | `include_unlinked_accounts_in_unverified_filter` |
| `20261116035442` | `flamexbot_command_protection_addon_and_webhook_reliability` |
| `20261116114917` | `per_chat_automations_and_referral_trigger` |
| `20261116115532` | `per_chat_afk_settings` |
| `20261116123845` | `flamexbot_founder_tier_guard` |
| `20261116123902` | `flamexbot_weekly_wheel_grants` |
| `20261116123933` | `flamexbot_wheel_tier_rewards` |
| `20261116123938` | `flamexbot_enable_weekly_scheduler` |
| `20261116123950` | `schedule_flamexbot_weekly_spins` |
| `20261116124020` | `flamexbot_admin_founder_tier_visibility` |
| `20261116124408` | `preserve_active_flamexbot_higher_tiers_on_premium_payment` |
| `20261116124642` | `flamexbot_founder_trial_referral_compatibility` |
| `20261116124948` | `flamexbot_subscription_tiers_wheel_perks` |
| `20261116125810` | `flamexbot_owner_public_pro_tiers` |
| `20261116125826` | `flamexbot_premium_pro_telegram_star_payments` |
| `20261116130420` | `protect_premium_pro_admin_tier_grants` |
| `20261116130512` | `queue_telegram_bot_notifications` |
| `20261116132725` | `flamexbot_public_tiers_owner_pro_notifications` |
| `20261117083421` | `add_business_chat_spam_consent` |
| `20261117091901` | `business_flood_protection` |
| `20261117092442` | `auto_flood_mute_override` |
| `20261117121753` | `flamexbot_trigger_acl_and_fk_indexes` |
| `20261117123211` | `flamexbot_addon_payment_history_rls` |
| `20261117123756` | `flamexbot_business_message_events_least_privilege` |
| `20261117124510` | `flamexbot_business_outbound_rate_limit` |
| `20261117124656` | `flamexbot_wheel_payment_charge_id_unique` |
| `20261117125944` | `preserve_verification_when_changing_role_badges` |
| `20261117130357` | `index_business_send_limits_chat_fk` |
| `20261117130551` | `index_telegram_init_data_cleanup` |
| `20261117130824` | `block_referrals_for_banned_accounts` |
| `20261117131112` | `atomic_telegram_notification_delivery_claims` |
| `20261117131327` | `include_business_connection_notifications_in_delivery` |
| `20261117131433` | `link_admin_notifications_to_audit_event` |
| `20261117131607` | `claim_admin_notification_before_direct_send` |
| `20261117131752` | `claim_wheel_notification_before_direct_send` |
| `20261117133242` | `telegram_update_claim_status` |
| `20261117133649` | `flamexbot_refunded_star_payment_ledger` |
| `20261117134151` | `serialize_stars_grants_with_bans_and_refunds` |
| `20261117134807` | `top_up_weekly_wheel_grants_after_pro_upgrade` |
| `20261117135026` | `refund_ledger_fk_index_and_dedupe_notifications_index` |
| `20261117135257` | `serialize_trial_claim_with_subscription_payments` |
| `20261117135441` | `serialize_referral_rewards_with_account_bans` |
| `20261117135958` | `clarify_pro_rare_prize_weight_bonus_copy` |
| `20261117194205` | `add_flamexbot_support_inbox` |
| `20261118173828` | `season_editor_and_leaderboard` |
| `20261118174022` | `season_editor_founder_guard_and_rank_index` |
| `20261118174355` | `season_events_and_rewards` |
| `20261118174518` | `season_events_founder_guard_and_active_season` |
| `20261118175311` | `season_event_archive_and_founder_policy` |
| `20261118175415` | `season_event_exact_time_progress` |
| `20261118175806` | `season_promo_codes` |
| `20261118175934` | `season_promo_code_privacy` |
| `20261118180154` | `season_event_leaderboard_and_notifications` |
| `20261118180532` | `season_event_reminders_and_auto_rewards` |
| `20261118180619` | `lock_down_season_event_trigger_functions` |
| `20261119134718` | `wheel_coin_balance_prizes` |
| `20261119135522` | `founder_wheel_admin_overview` |
| `20261119135659` | `configurable_wheel_prizes` |
| `20261119135806` | `public_wheel_odds_from_config` |
| `20261119135831` | `harden_wheel_prize_config_updates` |
| `20261119135942` | `wheel_founder_spins_and_revenue_stats` |
| `20261119140151` | `founder_wheel_price_and_weekly_limits` |
| `20261119140229` | `public_wheel_economy_display` |
| `20261119140348` | `wheel_refund_history_and_dynamic_price_validation` |
| `20261119140602` | `founder_unified_payment_journal` |
| `20261119141142` | `premium_entitlement_ledger` |
| `20261119141426` | `premium_refund_eligibility_preview` |
| `20261119141542` | `atomic_premium_refund_completion` |
| `20261119141753` | `premium_refund_reservation_guards` |
| `20261119181709` | `business_profile_copy_restore` |
| `20261119181807` | `business_profile_copy_bio` |
| `20261120154749` | `fix_daily_task_claim_cases` |
| `20261120155124` | `add_business_chat_monitor` |
| `20261120205352` | `business_status_rpc_and_fk_indexes` |
| `20261120210248` | `season_event_avatar_fallback` |
| `20261120210506` | `drop_duplicate_admin_audit_index` |

## Recovery rules

1. Do not run `supabase db push`, reset production, rewrite `supabase_migrations.schema_migrations`, or replay historical migrations while source/version reconciliation is incomplete.
2. A ledger entry proves that a migration version/name was recorded as applied; it does not reveal the original SQL body.
3. Do not recreate missing historical SQL from the current schema and label it as the original migration.
4. Recover original SQL from Git history, other clones, workstation backups, deployment artifacts, or exported SQL Editor history. Compare each recovered body with the live ledger before tracking it.
5. Keep future schema changes as new, reviewed migrations. Do not alter already-applied production history to make repository counts match.

## Interpretation

The ledger currently contains **116** applied entries. The archive inspected for this recovery contains 38 SQL migration files. These counts alone do not establish the exact number of missing source files: migration version prefixes may differ, and some archive files may not correspond one-to-one with recorded production entries. Use exact version/name/body reconciliation before any automated migration push.

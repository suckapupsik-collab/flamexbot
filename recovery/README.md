# Recovered FLAMEXBOT migration sources

Date: 2026-11-21

This folder preserves **11 historical SQL files** whose archive contents were confirmed against exact GitHub historical revisions using SHA-256. Files are intentionally stored under `recovery/migrations/`, **outside** `supabase/migrations/`, so Supabase CLI does not treat them as pending migrations.

These are source-recovery copies only. They are not instructions to replay SQL and do not establish which exact SQL body was executed in production. The live migration ledger remains the authority for applied version identifiers.

| Recovered file | Historical Git commit | SHA-256 of archive and historical source |
|---|---|---|
| `20261116010000_flamexbot_admin_badges_daily_tasks_achievements.sql` | `31b4ff62ccf82ce4c3bac022617182bd199199f7` | `19de40c151a4c5b543c73898469a12884de2173c76fcd853695705a60e650222` |
| `20261116016000_enforced_bans_and_admin_audit.sql` | `87329d5bb40f25cb1a6f5c5034d3154cc73f2a53` | `cb4ebca0de2fd95ed55981b1bd7f7e2a35602bc15d1d198b3fa7d1cb3ed61890` |
| `20261116050000_flamexbot_subscription_tiers_wheel_perks.sql` | `34ccd3e171edb4e053b43f0b91e5a6ad197276fe` | `d040dd445d92fc907cbf2430902069897b162689581d51a95181773e370bf16f` |
| `20261117125944_preserve_verification_when_changing_role_badges.sql` | `6de5398c3785f9cdb3b08afeecfef23028e085b6` | `f232076bce58cedcb94c0c470a815baa79ae39aa6beafee8acf71fdf28064726` |
| `20261117131433_link_admin_notifications_to_audit_event.sql` | `dd3d2eee121310e98d25cc175b3f19ee7d56ca94` | `00350c272fd6d3fd459e05e0379ab37b5dcbfa52e7f10ed1bb4c91c5af708f16` |
| `20261117134151_serialize_stars_grants_with_bans_and_refunds.sql` | `6c2496adff59da9c6f06cbb1357587d6b597b104` | `5ebfa40cebb6c7b357ea1005bbd4fa5570ba97c88542c68a63ca8197f14ec69d` |
| `20261117134807_top_up_weekly_wheel_grants_after_pro_upgrade.sql` | `b9691f2836b08077c641a79e904a8b5070c53069` | `ebeb7aaebb2b3872ccde3c5e217c4319a71da6ffebfde4612b703d58d7bfeb2b` |
| `20261117135000_block_referrals_for_banned_accounts.sql` | `0a07ec9fc032e8ce1222749e53d272fd87fd2d4b` | `45d1e28dd6aa519dcdc253be1b9a97177082f9281bbead26fc4f057ad757f00d` |
| `20261117135257_serialize_trial_claim_with_subscription_payments.sql` | `46ee3651de229cb1fd3ff8de871139f82308238a` | `7c089b1403acd181673d1ec11aec0857ea3bb41ace2ec8afc487daab6480e69b` |
| `20261117135441_serialize_referral_rewards_with_account_bans.sql` | `e51217edcfb0c8430610c065f37acd92449de84e` | `d71ed33aad9a958348793c4595b1429dec1235205e453e80b49730ecb716c78d` |
| `20261117135958_clarify_pro_rare_prize_weight_bonus_copy.sql` | `c0397c65aa267b9926611a8664cf05b88acade18` | `287f14a4d8bf6c23f6078d24b602d9f6246ff79c025e6993866039a41b1905a3` |

## Safety

- Do not move these files into `supabase/migrations/` without a separate, explicit recovery plan.
- Do not replay them against production.
- Do not rewrite the `supabase_migrations.schema_migrations` ledger.
- The historical source match proves source provenance, not production execution provenance.

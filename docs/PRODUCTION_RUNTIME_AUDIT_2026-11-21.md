# FLAMEXBOT production runtime audit — 2026-11-21

## Scope

Read-only review of the production Supabase project and the current FLAMEXBOT GitHub main branch after the PIN recovery patch. No database writes, migration replay, Edge Function deployment, or user-data changes were made during this audit.

## Build and frontend

- GitHub Actions run: `44903993594`
- Commit: `7cdc34ed4d94cb9a57a820b98137d8f1d17eca25`
- Result: success
- `npm install`, `npm test`, and `npm run build`: all successful
- Cloudflare Pages deployment: `8ef76366-f445-4cb1-ab9e-e3de23190e67`
- Deployment URL: https://8ef76366.flamexbot.pages.dev
- Cloudflare stages queued, initialize, clone, build, deploy: all success
- PIN tests cover verification exception recovery and successful verification.

## Supabase runtime

- Project is active and healthy.
- Applied migration ledger: 116 entries. No migrations were applied during this audit.
- All listed Edge Functions were ACTIVE at inspection time. Important versions: `flamexbot-bot` v199, `business-chat-send` v35, `telegram-auth` v13, `flamexbot-support-inbox` v11, `flamexbot-business-status` v1.
- Current public table inventory includes 29 Business chats, 2,143 Business messages, 651 Business message event records, and 72 bot inbox messages. Counts are point-in-time and may change.

## Runtime errors observed

Supabase unified logs for the last 24 hours showed repeated errors from `business-chat-send` v35:

- `Bad Request: user not found` — six occurrences in the sampled error results.
- The log does not identify which Business chat/action triggered each failure. Do not infer that a specific chat is broken from these log lines alone.
- Read-only aggregate on `flamexbot_business_chats`: 29 rows, no missing `telegram_chat_id`, one row missing `telegram_user_id`, and no rows where both IDs are present but differ.
- This aggregate does not establish the cause. The function sends using `telegram_chat_id`; the missing optional `telegram_user_id` row is not, by itself, proof of the error source.

Historical `telegram-auth` v11 errors reported a null `profiles.username` constraint. The deployed function is now v13; no current v13 error appeared in the sampled 24-hour error results. Keep this as historical context, not an asserted current failure.

## Source/deployment drift requiring reconciliation

The active deployed `business-chat-send` v35 source retrieved from Supabase differs materially from the tracked GitHub file at `supabase/functions/business-chat-send/index.ts`:

- Active deployed source: 551 lines / 37,408 characters.
- GitHub main source: 402 lines / 26,115 characters.
- The live source includes additional Business features such as `set_business_time` and newer outgoing-text handling.
- GitHub main includes changes not present in the live source, including additional permission checks and the `unafk` command path.

Do not deploy either copy over the other until these differences are reconciled. A blind deploy could remove live functionality or regress permission checks. The next safe step is a deliberate three-way merge of the active v35 source, tracked GitHub source, and intended current behavior, followed by tests and a controlled deployment.

## Security and performance advisor review

- Security advisor reported 24 RLS-enabled tables without policies. RLS with no policies is default-deny for API roles; these findings are not evidence of public access. Do not add broad policies just to silence the linter.
- Security advisor reported 45 SECURITY DEFINER functions executable by authenticated users. A targeted definition review confirmed founder/admin guards in the inspected administrative functions, including user management, audit listing, payment journal, wheel management, and season-promo management. The linter finding alone is not proof of an authorization bypass. Remaining functions should be reviewed individually before changing grants.
- Leaked-password protection is disabled in Supabase Auth; this is a configuration hardening item, not changed during this audit.
- Performance advisor reported 27 unused indexes. No indexes were dropped; usage counters and workload context should be reviewed before considering removal.
- Health advisor returned no findings.

## Safety decisions

- No Supabase data or schema was changed.
- No Edge Function was redeployed.
- No migration ledger entries were edited.
- Do not blanket-revoke SECURITY DEFINER grants or add broad RLS policies.
- Reconcile `business-chat-send` source drift before attempting a fix for the Telegram `user not found` errors.

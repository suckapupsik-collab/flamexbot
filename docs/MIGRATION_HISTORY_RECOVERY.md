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

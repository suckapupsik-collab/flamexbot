# FLAMEXBOT 3.0.1 — 28 November 2026

## Release scope

- Publish the current, newer `main` application rather than overwrite it with the older 22 November archive.
- Prevent stale Mini App HTML from hiding a newly published version: the root document and `index.html` are revalidated on every load.
- Keep Vite's content-hashed `/assets/*` files immutable and cacheable for one year.
- Revalidate the public UX stylesheet so style corrections are visible after deployment.

## Verified production state at release

- Supabase Edge Functions `flamexbot-bot` v226 and `setup-flamexbot-webhook` v5 are active and their source matches GitHub `main`.
- Telegram Business sender source and its `logic.js` match the active Supabase deployment.
- Telegram webhook secret is Vault-backed; the transitional legacy hash has been retired.
- Founder account remains on permanent Premium.

The supplied archive contains older server/PIN sources and older migrations, so those files were not allowed to overwrite the live versions.

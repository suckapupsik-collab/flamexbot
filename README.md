# FLAMEXBOT

FLAMEXBOT is a friends-first messaging app built around daily shared streaks.

## Stack
- Vite + vanilla JavaScript
- Supabase Auth, Postgres, Row Level Security and Realtime-ready data model
- Cloudflare Pages hosting

## Local development
1. Install Node.js 20.19+ or 22.12+.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Run `npm install`, then `npm run dev`.

## Cloudflare Pages
- Build command: `npm run build`
- Build output directory: `dist`
- Add the two Vite environment variables in Pages project settings.
- Add your deployed site URL to Supabase Auth > URL Configuration (Site URL and Redirect URLs).
- For Google login, configure Google as a Supabase Auth provider and add the Supabase callback URL in Google Cloud.

## Security
Only the Supabase publishable key belongs in browser configuration. Never expose a Supabase secret/service_role key in this repository or frontend.

## Current scope
The first frontend scaffold includes email/password signup and login, Google OAuth initiation, profile editing, friend search and requests, conversations, messages, and streak views. Telegram Mini App validation and Telegram Business integration require server-side endpoints and are not enabled yet.

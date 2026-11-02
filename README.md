# CFA Study Hub

Personal study tracker for the CFA Level I exam (May 2027): guided study sessions, topic plan, progress by module, Anki check-ins, mistake log, scores and notes.

## How it fits together

- `index.html` — the whole app (plain HTML, CSS and JavaScript, no build step)
- `config.js` — Supabase project URL and public (anon/publishable) key
- `setup.sql` — creates the database table with row-level security and loads the starting data
- `vercel.json` — hosting settings for Vercel

Hosting: Vercel deploys automatically on every push to `main`.
Data and sign-in: Supabase. All data lives in one `docs` table; each row belongs to one user and row-level security stops anyone else reading or changing it. Public sign-ups are turned off in Supabase.

## Signing in on a public computer

Leave "Keep me signed in on this device" unticked. The session then ends when the browser closes or after an hour without activity. Use the Sign out button when you're done.

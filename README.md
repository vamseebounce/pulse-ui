# Pulse — Bounce Tasks ops console

Single-file static SPA (no build step), mirroring FleetPro's `vehicle-parts-check` deploy
pattern. Auth = Supabase magic link, gated by the `tasks.members` allowlist via `tasks.is_member()`.
Data = 5 read-only Postgres views in the shared Supabase project's `tasks` schema
(`v_sync_status`, `v_weekly_summary`, `v_new_vs_old_summary`, `v_login_bucket_summary`,
`v_distance_bucket_summary`) — all created `WITH (security_invoker = true)` so the caller's
own RLS (`tasks.is_member()`) applies; non-members get zero rows even if they guess the URL.

## Local preview

Just open `index.html` in a browser (no server needed) — everything talks directly to Supabase.

## Deploy (GitHub Pages) — manual steps

This session couldn't push to GitHub directly (no `gh` CLI / git remote configured in the
sandbox). To finish the deploy Vamsee decided on:

1. **Create a new GitHub repo** (e.g. `pulse-ui`), any visibility.
2. From this folder (currently on branch `master` — this sandbox's filesystem couldn't
   rename it locally, GitHub will let you rename the default branch after push if you want `main`):
   ```
   git remote add origin https://github.com/<you>/pulse-ui.git
   git push -u origin master
   ```
3. **Enable GitHub Pages**: repo Settings → Pages → Deploy from branch `main` / root.
4. **BigRock DNS**: add `CNAME tasks → <you>.github.io` for `bounceops.online` (the `CNAME`
   file in this repo already points Pages at `tasks.bounceops.online`).
5. **Supabase Auth → URL Configuration → Redirect URLs**: add
   `https://tasks.bounceops.online` (additive — don't remove FleetPro's existing entry).
   No MCP tool exposes this setting; it's a Dashboard-only change.
6. **Seed teammates**: `vamsee@scalability.club` is already in `tasks.members` (role
   `admin`). Add anyone else via:
   ```sql
   insert into tasks.members (user_id, email, role)
   values ('<auth.users.id>', '<email>', 'viewer');
   ```
   (they need an existing `auth.users` row first — sign in once via the magic link, then
   look up their `id` in `auth.users` and insert.)

## What's live vs. stale

The "Sync status" panel shows `last_synced_at`/`last_row_count` per source. As of this build,
3 of 5 Metabase source feeds (Daily Rider Pings, Rider Order Pings, Rider Sessions/online-offline)
have been confirmed stalled upstream since 27 Jul — not a bug in this app, the Metabase `temp_*`
views themselves stopped getting new rows. The weekly/login/distance tables will show thinning
data for these dimensions until that's fixed upstream; order-side metrics (from All Orders /
Delivered) stay live.

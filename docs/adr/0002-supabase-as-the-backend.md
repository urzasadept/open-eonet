# Supabase is the backend: Postgres functions over its REST API, no API server

The backend is entirely inside Supabase. pg_cron triggers an Edge Function that syncs EONET into Postgres/PostGIS, and the web app reads through Postgres functions (e.g. `events_near`) called over Supabase's REST API with the public key. Row-level security makes all public access read-only. We chose this over a Hono/Node API (on a VPS or in an Edge Function) to stay on a free tier, avoid cold starts, and avoid writing server code when the web app is the only client.

## Consequences

- The SQL functions *are* the API contract. Abuse limits (max radius 500 km, max 500 results, max Activity Window 365 days, no Tracks in list results) must be enforced inside the functions, not only in the UI.
- Free-tier risks are accepted: the project can be paused for inactivity (which also stops the sync), the database is capped at 500 MB, and Edge Functions have CPU limits. A failing sync is reported by a healthchecks.io ping and a staleness banner in the UI. That signal is the trigger to move to a paid plan or a VPS, which stays cheap because everything is plain Postgres.
- If a public API for third parties is ever wanted, put an HTTP layer such as Hono in front of the same functions. Don't expose the REST API to third parties directly.

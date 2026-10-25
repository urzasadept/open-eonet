# Task: build Eonet v1

Build a light, fast web app that shows natural events (wildfires, storms, volcanoes, …) near a location, backed by our own mirror of NASA's EONET v3 API.

The design is settled. Your job is to implement it. Before you write any code, read:

- `GLOSSARY.md` — the project's vocabulary. Use these exact terms in code, UI copy and commits (`Active Event`, `Activity Window`, `Search Point`, `Latest Position`, `Track`, `Incremental Sync`, `Full Sync`, `Backfill`, …).
- `docs/adr/0001-active-means-recent-not-open.md` — what "Active" means.
- `docs/adr/0002-supabase-as-the-backend.md` — why there is no API server, and the abuse caps.

If implementation forces a design change, stop and ask the user rather than deviating. If a new domain term appears, add it to `GLOSSARY.md`.

## Stack

| Concern | Choice |
| --- | --- |
| Repo | pnpm workspaces: `apps/web`, `packages/shared`, `scripts/backfill`, `supabase/` |
| Database | Supabase Postgres + PostGIS, migrations in `supabase/migrations` via the Supabase CLI |
| Sync | One Supabase Edge Function (Deno), triggered by `pg_cron` through `pg_net`, with its secret held in Supabase Vault |
| Read API | Postgres functions called over Supabase's REST API (`supabase.rpc`), public access read-only through row-level security |
| Frontend | Vite + Preact (`preact/compat` aliased for React libraries), TanStack Query, Zod, plain Leaflet + `leaflet.markercluster` (no `react-leaflet`) |
| Frontend hosting | Cloudflare Pages, building from git |
| Lint and format | Biome |
| Tests | Vitest; SQL functions tested against a local Supabase |
| CI | GitHub Actions |
| Monitoring | healthchecks.io ping from the sync, plus a staleness banner in the UI |

`packages/shared` holds the EONET Zod schemas and the shared types. Keep it runtime-agnostic, with Zod as its only dependency, because both Node and Deno (the Edge Function) import it.

## Environment

- Node 24, pnpm 11 and the Supabase CLI are installed.
- Docker comes from OrbStack. If `docker` isn't found, ask the user to open OrbStack. `supabase start` needs it.
- There is no Supabase project, Cloudflare account or git remote yet. Build and verify everything locally. For deploy, prepare the config and document the secrets it needs, but don't try to deploy.

## EONET v3 facts (verified Oct 2026)

- Base URL: `https://eonet.gsfc.nasa.gov/api/v3/events`. Useful parameters: `status=open|closed|all` (if omitted, only open events are returned), `days`, `start`/`end` (`YYYY-MM-DD`), `category`, `limit`.
- v2.1 is deprecated, so don't use it.
- Shape: `id`, `title`, `description`, `link`, `closed` (ISO date or `null`), `categories[{id,title}]` (the ids are strings such as `wildfires`), `sources[{id,url}]`, and `geometry[]`. Note that the field is called `geometry` and is an array. Each geometry entry has `date`, `type` (`Point`, or in principle `Polygon`), `coordinates` (**in `[lon, lat]` order**), and `magnitudeValue`/`magnitudeUnit`, which may be null.
- The open set is about 7,200 events and about 5 MB of JSON. Roughly 99% are wildfires, and nearly all are in North America; only about 26 are in Europe. The oldest Open event dates from 2002.
- **`status=all` with no date range returns HTTP 500.** Always bound it with `start`/`end`. One year is about 5,000 events and about 4.5 MB.
- The rate limit is 1,000 requests per hour, far above what we use.

## Data model

Three tables:

- **`events`**: one row per EONET id. Columns: title, description, link, `closed_at`, categories as `text[]` (with a GIN index), sources as `jsonb`, and the cached Latest Position (`geography`, GiST index) and its date.
- **`event_geometries`**: one row per Geometry, with `event_id`, `date`, `geom geography`, `magnitude_value` and `magnitude_unit`. Columns are `geography`, not point-only, so polygons work. A polygon's Latest Position is its centroid.
- **`sync_runs`**: one row per run, with kind (`incremental` | `full` | `backfill`), start and finish times, counts and any error.

Rules:

- Don't store raw EONET JSON. The free tier caps the database at 500 MB.
- Never delete events. EONET is the source of truth for closures.
- Upserting an event replaces its geometries in the same transaction, so the stored Track always matches EONET's.

## Read API (Postgres functions)

1. **`events_near(lat, lon, radius_km, categories?, activity_window_days?)`**
   - Returns Active Events (`closed_at is null` and latest date within the window) whose Latest Position is within the Radius, ordered by distance.
   - Each row contains id, title, categories, Latest Position, latest date, latest magnitude and distance in km. It doesn't include the Track.
2. **`event_detail(id)`**: the event with its full Track, sources and `closed_at`.
3. **`categories()`**: the list of categories.
4. **`sync_status()`**: the time of the last successful run for each kind.

Enforce these caps inside the functions: radius of at most 500 km, at most 500 results, and an Activity Window of at most 365 days. The anonymous role can execute these functions and nothing else; there is no write access of any kind.

## Sync

- **Incremental Sync**: every 5 minutes, fetch `days=1` and upsert the results.
- **Full Sync**: every hour, fetch `status=open` and `status=closed&days=7`, then upsert both. This is how `closed_at` gets set.
- Validate every response with the shared Zod schemas. If parsing fails, record it in `sync_runs` and fail the run; never write partial garbage.
- On success, ping the healthchecks.io URL from an Edge Function secret, if one is set.
- **Backfill**: run with `pnpm backfill`. It's a local Node script that writes with the service-role key and fetches one year at a time from the oldest EONET year up to now. It's safe to re-run, because it upserts.

## Web app

- A single page: map plus list.
- The Search Point comes from browser geolocation or a draggable pin on the map. There's no place-name search.
- Radius can be 50, 100, 250 or 500 km (default 250), and the Activity Window defaults to 30 days. Add a category filter.
- The list and the markers come from `events_near`. Selecting an event loads `event_detail` and draws its Track.
- When nothing is found, say **"No EONET events nearby"**, with a short note on Coverage. Never imply the area is safe.
- Show a "data may be stale" banner if the last successful sync was more than an hour ago.
- English only, distances in km, times in the user's local time zone.
- Keep the bundle small. Report the gzipped JS size when you finish.

## Steps

Work through these in order. Each step is done only when its completion criterion holds, and you've actually run the check.

1. **Scaffold**: create the workspace, Biome, TypeScript project references and the root scripts (`dev`, `build`, `typecheck`, `lint`, `test`, `backfill`).
   **Done when** `pnpm install && pnpm lint && pnpm typecheck` pass.
2. **Shared schemas**: write the Zod schemas for v3 events. Save real response samples to `packages/shared/fixtures/`: one open-set excerpt, one closed event, and one storm with a multi-point Track.
   **Done when** Vitest parses every fixture, and a test proves a malformed payload is rejected.
3. **Database**: write the migration with the tables, indexes, RLS and the four read functions, including their caps.
   **Done when** `supabase db reset` applies cleanly, and the Vitest integration tests against local Supabase cover the distance ordering, the Activity Window, the category filter, every cap, and anonymous writes being rejected.
4. **Sync**: write the Edge Function and the `pg_cron`/`pg_net`/Vault wiring for both schedules.
   **Done when**, run locally against the live EONET API, an Incremental Sync and a Full Sync each populate the tables and write a successful `sync_runs` row, and running each a second time changes no row counts.
5. **Backfill**: write the script.
   **Done when** it completes against local Supabase and a second run is a no-op in terms of row counts. Report the final database size.
6. **Web app**: build it as specified above.
   **Done when** it runs against local Supabase with backfilled data, you've checked it in the browser (geolocation or a pin, the radius and category filters, the Track on selection, the empty state and the stale banner), and `pnpm build` succeeds.
7. **CI and deploy prep**: add a GitHub Actions workflow that runs lint, typecheck and tests, then `supabase db push` and the Edge Function deploy on `main`. Add the Cloudflare Pages build settings and a `README.md` with local setup steps and the list of secrets and accounts needed for the first deploy.
   **Done when** the workflow file is valid and the README covers every secret the workflow and the Edge Function read.

Commit after each step with a message naming the step.

# Eonet

A small web app that shows natural events near a location, from a Supabase mirror of
[NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3). Domain terms are defined in
[`GLOSSARY.md`](GLOSSARY.md), and design decisions are recorded in [`docs/adr`](docs/adr).

| Path | What it is |
| --- | --- |
| `apps/web` | Vite + Preact single page: map plus list |
| `packages/shared` | EONET Zod schemas, sync logic and read API types, shared by Node and Deno |
| `supabase/migrations` | Mirror tables, the read API functions and the sync schedule |
| `supabase/functions/sync` | The Edge Function that runs Incremental and Full Syncs |
| `scripts/backfill` | `pnpm backfill`, a one-off Node script that mirrors every year of EONET |

## Local setup

You need Node 24, pnpm 11, the Supabase CLI and a running Docker (for example OrbStack). Then:

```sh
pnpm local                 # http://localhost:5173
```

This one command:

- installs dependencies;
- starts local Supabase;
- stores the Vault secrets;
- runs the Backfill if the mirror is empty;
- serves the `sync` Edge Function, logging to `supabase/.temp/functions-serve.log`;
- starts the web app with the local keys.

It writes no key files and is safe to re-run. Ctrl+C stops the web app and the function server.
`supabase stop` stops the database.

### Manual steps

These are the steps `pnpm local` runs, if you want to run them one at a time.

```sh
pnpm install
supabase start             # applies the migrations; prints the local URL and keys
pnpm db:local-secrets      # stores project_url and secret_key in the local Vault
```

`pnpm db:local-secrets` reads the keys from `supabase status`, so no key is committed.
Re-run it after `supabase db reset` or `supabase stop --no-backup`.

Fill the mirror. Create a `.env` at the repo root (it is gitignored) with the `API_URL` and
`SECRET_KEY` values from `supabase status`:

```sh
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SECRET_KEY=sb_secret_...
```

```sh
pnpm backfill              # about 2 minutes; safe to re-run
```

Serve the Edge Function so that the local `pg_cron` jobs can reach it (an Incremental Sync every
5 minutes and a Full Sync every hour):

```sh
supabase functions serve
```

Run the web app. Create `apps/web/.env.local` with the `API_URL` and `PUBLISHABLE_KEY` values from
`supabase status`:

```sh
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

```sh
pnpm dev                   # http://localhost:5173
```

### Checks

```sh
pnpm lint                  # Biome
pnpm typecheck             # tsc --build, plus deno check for the Edge Function
pnpm test                  # Vitest; the supabase tests need the local stack running
pnpm build                 # typecheck, then the production web build in apps/web/dist
```

The integration tests read the local keys from `supabase status`. To point them elsewhere, set
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.

## Accounts needed for the first deploy

- **GitHub**: hosts the repo and runs `.github/workflows/ci.yml`.
- **Supabase**: one project, which holds the database, the Edge Function and the Vault secrets.
- **Cloudflare**: a Pages project connected to the GitHub repo.
- **healthchecks.io** (optional): a check with a 5-minute period, pinged after every successful sync.

## Secrets and settings

Nothing secret is committed. This is everything the workflow, the Edge Function and the database
read.

### GitHub Actions repository secrets

These are read by the `deploy` job, which runs on pushes to `main` after the checks pass.

| Secret | Where to get it |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase dashboard, Account, Access Tokens |
| `SUPABASE_PROJECT_REF` | The project's reference id, from its URL or Project Settings |
| `SUPABASE_DB_PASSWORD` | The database password chosen when creating the project |

The `check` job needs no secrets: it runs lint, typecheck, and the tests against a local Supabase
started inside the runner.

### Supabase Vault secrets

The `pg_cron` jobs call the Edge Function through `pg_net` and read these from Vault. Until both
exist, every scheduled sync fails, and the web app shows the stale banner. After the first
`supabase db push`, run this once in the dashboard's SQL editor:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<secret key, sb_secret_...>', 'secret_key');
```

| Vault secret | Value |
| --- | --- |
| `project_url` | `https://<project-ref>.supabase.co` |
| `secret_key` | A secret API key (Project Settings, API Keys). It is sent in the `apikey` header, and the function only accepts secret keys. |

### Edge Function secrets

| Secret | Value |
| --- | --- |
| `HEALTHCHECKS_URL` | Optional. The healthchecks.io ping URL. If unset, no ping is sent. |

Set it with `supabase secrets set HEALTHCHECKS_URL=https://hc-ping.com/<uuid> --project-ref <project-ref>`.
`@supabase/server` also reads `SUPABASE_URL` and `SUPABASE_SECRET_KEYS`, but Supabase provides
those to every function, so don't set them.

### Cloudflare Pages build settings

Connect the GitHub repo in the Cloudflare dashboard (Workers & Pages, Create, Pages) and use:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `pnpm --filter @eonet/web build` |
| Build output directory | `apps/web/dist` |
| Root directory | `/` (the repo root) |
| Production branch | `main` |

Pages installs dependencies from `pnpm-lock.yaml` before running the build command. It takes the
Node version from `.node-version`. Set these environment variables for both Production and
Preview:

| Variable | Value |
| --- | --- |
| `PNPM_VERSION` | `11.0.9` (matches `packageManager` in `package.json`) |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | A publishable key (`sb_publishable_...`). It is public by design and can only call the read functions. |

The `VITE_` variables are inlined at build time, so redeploy after changing them.

## First deploy, in order

Follow [`docs/deploy.md`](docs/deploy.md). It walks through the Supabase project, the GitHub
secrets, the Vault secrets, the Backfill and the Cloudflare Pages project, with a check after each
step.

## Notes

- Map tiles come from the public OpenStreetMap tile servers, which allow light use only under their
  [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). Switch to a
  commercial tile provider if traffic grows.
- EONET is not a warning service. Its Coverage is uneven, so an empty result never means an area
  is safe.

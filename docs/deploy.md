# Deploying Eonet to Supabase and Cloudflare Pages

This takes the repo from a local checkout to a running production app. Steps must be done in
order: the sync schedule fails until the Vault secrets exist, and the web app shows nothing useful
until the Backfill has run. Allow about 30 minutes.

The secrets mentioned here are described in more detail in the README's
[Secrets and settings](../README.md#secrets-and-settings) section.

## 0. Before you start

You need:

- Accounts on GitHub, Supabase and Cloudflare, plus healthchecks.io if you want a missed-sync alert.
- Locally: Node 24, pnpm 11, the Supabase CLI and this repo with `pnpm install` done.
- A password manager entry to collect the values below as you go:
  - the database password,
  - the project ref,
  - the publishable key (`sb_publishable_...`),
  - the secret key (`sb_secret_...`),
  - a Supabase access token,
  - the healthchecks.io ping URL (optional).

## 1. Create the Supabase project

1. In the [Supabase dashboard](https://supabase.com/dashboard), create a new project. Pick the
   region closest to most users, and generate a strong database password. Save the password; you
   can't see it again.
2. Note the **project ref**. It's the id in the dashboard URL
   (`https://supabase.com/dashboard/project/<project-ref>`) and in the API URL
   (`https://<project-ref>.supabase.co`).
3. Open **Project Settings → API Keys**. Copy a **publishable key** and a **secret key**. If the
   project only shows legacy `anon` and `service_role` keys, create the new keys there first: the
   web app and the sync function both expect the new key format.
4. Open **Account → Access Tokens** and create a token for GitHub Actions.

## 2. Push the repo to GitHub with deploy secrets

1. Create an empty GitHub repository, and add it as the remote:

   ```sh
   git remote add origin git@github.com:<owner>/<repo>.git
   ```

2. Before pushing, open **Settings → Secrets and variables → Actions** in the repo and add these
   repository secrets:

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_ACCESS_TOKEN` | The access token from step 1.4 |
   | `SUPABASE_PROJECT_REF` | The project ref |
   | `SUPABASE_DB_PASSWORD` | The database password |

3. Push:

   ```sh
   git push -u origin main
   ```

4. Watch the **CI** workflow in the Actions tab. The `check` job runs lint, typecheck and tests.
   Then the `deploy` job links the project, runs `supabase db push`, which creates the tables, the
   read API and the two cron jobs, and deploys the `sync` function.

If you'd rather do the first deploy from your machine, run the same commands locally instead of
waiting for CI:

```sh
supabase login
supabase link --project-ref <project-ref>        # asks for the database password
supabase db push
supabase functions deploy sync --project-ref <project-ref>
```

## 3. Store the Vault secrets

The cron jobs read the function URL and the key they send from Vault. In the dashboard, open the
**SQL Editor** and run, with your own values:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<sb_secret_...>', 'secret_key');
```

To change a value later, delete the old secret and create it again:

```sql
delete from vault.secrets where name = 'secret_key';
select vault.create_secret('<new sb_secret_...>', 'secret_key');
```

Do this again whenever you rotate the secret key; otherwise every scheduled sync fails.

## 4. Set up the healthchecks.io ping (optional)

1. On healthchecks.io, create a check with a **period of 5 minutes** and a **grace time of 15
   minutes**, so it alerts when no sync has succeeded for about 20 minutes.
2. Give the function the ping URL:

   ```sh
   supabase secrets set HEALTHCHECKS_URL=https://hc-ping.com/<uuid> --project-ref <project-ref>
   ```

If this isn't set, the function skips the ping and nothing else changes.

## 5. Check that the sync runs

Trigger a Full Sync by hand rather than waiting for the hour:

```sh
curl -X POST "https://<project-ref>.supabase.co/functions/v1/sync" \
  -H "apikey: <sb_secret_...>" \
  -H "content-type: application/json" \
  -d '{"kind":"full"}'
```

It returns JSON with `received`, `inserted` and the ids of any Rejected Events. On the first run
expect about 7,000 received and inserted.

Then, after the next 5-minute mark, confirm that the schedule works by running this in the SQL
Editor:

```sql
select id, kind, started_at, finished_at, events_received, events_inserted, error
from sync_runs order by id desc limit 5;
```

If no new rows appear, look at the cron and HTTP layers:

```sql
select jobname, status, return_message, start_time
from cron.job_run_details join cron.job using (jobid)
order by start_time desc limit 5;

select id, status_code, error_msg, left(content, 200) as content
from net._http_response order by id desc limit 5;
```

| Symptom | Likely cause |
| --- | --- |
| `null value` errors in the cron run details | The Vault secrets are missing or misnamed (step 3) |
| HTTP 401 in `net._http_response` | `secret_key` in Vault isn't a valid secret key |
| HTTP 404 | The `sync` function isn't deployed, or `project_url` is wrong |
| A `sync_runs` row with an error | EONET was down or changed format; the next run retries |

## 6. Run the Backfill against production

The Backfill loads EONET's history back to 1980; the syncs only cover open Events and recent
changes. Put the production values in a `.env` file at the repo root. The file is gitignored, but
delete it afterwards anyway, because it holds the secret key.

```sh
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

```sh
pnpm backfill
```

It takes about 2 minutes, logs a count per year, and is safe to re-run. Expect about 25,000
Events and a database of about 70 MB. That fits the Supabase free plan's 500 MB.

## 7. Create the Cloudflare Pages project

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), open **Workers & Pages → Create →
   Pages → Connect to Git**, and pick the GitHub repo.
2. Set the build settings:

   | Setting | Value |
   | --- | --- |
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | `pnpm --filter @eonet/web build` |
   | Build output directory | `apps/web/dist` |
   | Root directory | `/` (leave empty) |

3. Add these environment variables for **both Production and Preview**:

   | Variable | Value |
   | --- | --- |
   | `PNPM_VERSION` | `11.0.9` |
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | The publishable key (`sb_publishable_...`) |

   Node 24 comes from the repo's `.node-version` file. The `VITE_` values are built into the
   JavaScript, so after changing them, redeploy from the **Deployments** tab.

4. Save and deploy. When the build finishes, open the `*.pages.dev` URL.

## 8. Check the live app

- The page loads the map, and the Category list is filled in. That shows the publishable key and
  the read API work.
- "Use my location", or clicking the map, lists nearby Events. Try somewhere in western North
  America with a 500 km Radius to be sure of results.
- Selecting an Event draws its Track.
- No "Data may be stale" banner is showing. If it is, the scheduled sync isn't succeeding; go back
  to step 5.

Optionally, add a custom domain under the Pages project's **Custom domains** tab.

## After the first deploy

- **Every push to `main`** runs CI. If the checks pass, CI applies new migrations and redeploys the
  `sync` function. Cloudflare Pages builds the web app from the same push on its own, without
  waiting for CI. If a change needs a new migration before the web app can use it, merge the
  migration first.
- **Pull requests** get CI checks and a Cloudflare preview deploy. Previews read the production
  database, which is safe because the publishable key can only call the read functions.
- **Rotating the secret key**: create a new secret key, update the `secret_key` Vault secret (step
  3), then revoke the old key. The sync function picks up the new key automatically.
- **Inactive free-plan projects** may be paused by Supabase. Check the current pausing policy for
  your plan; a paused project stops syncing and the app shows errors.

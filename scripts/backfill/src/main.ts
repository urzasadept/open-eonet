// Backfill: imports EONET's historical Events one year at a time. Safe to re-run, because it upserts.
import { recordSyncRun, type SyncResult, syncQueries } from "@eonet/shared";
import { supabaseMirrorStore } from "@eonet/supabase/mirror-store";
import { createClient } from "@supabase/supabase-js";

/** EONET's earliest Events are 1980 volcanoes; the first request also covers anything older. */
const OLDEST_EONET_YEAR = 1980;

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (the service-role key); see README.");
  process.exit(1);
}

const fetchWithRetry: typeof fetch = async (input, init) => {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(input, init);
      if (response.status < 500 || attempt === 3) return response;
    } catch (error) {
      if (attempt === 3) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
  }
};

const store = supabaseMirrorStore(
  createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } }),
);
const today = new Date().toISOString().slice(0, 10);
const currentYear = Number(today.slice(0, 4));

const total = await recordSyncRun(store, "backfill", async () => {
  const total: SyncResult = { received: 0, inserted: 0, rejected: [] };
  for (let year = OLDEST_EONET_YEAR; year <= currentYear; year++) {
    const start = year === OLDEST_EONET_YEAR ? "1800-01-01" : `${year}-01-01`;
    const end = year === currentYear ? today : `${year}-12-31`;
    const result = await syncQueries(store, [{ status: "all", start, end }], fetchWithRetry);
    total.received += result.received;
    total.inserted += result.inserted;
    total.rejected.push(...result.rejected);
    console.log(
      `${year}: ${result.received} received, ${result.inserted} new, ${result.rejected.length} rejected`,
    );
  }
  return total;
});

console.log(
  `Backfill done: ${total.received} received, ${total.inserted} new, ` +
    `${total.rejected.length} rejected (${total.rejected.map((event) => event.id).join(", ")})`,
);

import { type MirrorStore, recordSyncRun, SYNC_QUERIES, syncQueries } from "@eonet/shared";
import { withSupabase } from "@supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const RequestBody = z.object({ kind: z.enum(["incremental", "full"]) });

function supabaseStore(db: SupabaseClient): MirrorStore {
  return {
    async startRun(kind) {
      const { data, error } = await db.from("sync_runs").insert({ kind }).select("id").single();
      if (error) throw new Error(`Could not start sync run: ${error.message}`);
      return data.id;
    },
    async finishRun(runId, outcome) {
      const row =
        "error" in outcome
          ? { error: outcome.error }
          : {
              events_received: outcome.result.received,
              events_inserted: outcome.result.inserted,
              events_rejected: outcome.result.rejected.length,
              rejected_events: outcome.result.rejected,
            };
      const { error } = await db
        .from("sync_runs")
        .update({ ...row, finished_at: new Date().toISOString() })
        .eq("id", runId);
      if (error) throw new Error(`Could not finish sync run ${runId}: ${error.message}`);
    },
    async upsertEvents(events) {
      const { data, error } = await db.rpc("upsert_events", { payload: events });
      if (error) throw new Error(`upsert_events failed: ${error.message}`);
      return data;
    },
  };
}

async function pingHealthcheck() {
  const url = Deno.env.get("HEALTHCHECKS_URL");
  if (!url) return;
  try {
    await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    console.warn("healthchecks.io ping failed", error);
  }
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (request, ctx) => {
    const body = RequestBody.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return Response.json(
        { error: 'Body must be {"kind":"incremental"|"full"}' },
        { status: 400 },
      );
    }
    const { kind } = body.data;
    const store = supabaseStore(ctx.supabaseAdmin);
    try {
      const result = await recordSyncRun(store, kind, () => syncQueries(store, SYNC_QUERIES[kind]));
      await pingHealthcheck();
      return Response.json({
        kind,
        received: result.received,
        inserted: result.inserted,
        rejected: result.rejected.map((event) => event.id),
      });
    } catch (error) {
      console.error(`${kind} sync failed`, error);
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ kind, error: message }, { status: 500 });
    }
  }),
};

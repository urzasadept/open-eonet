import type { MirrorStore } from "@eonet/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A MirrorStore over a service-role client; shared by the `sync` Edge Function and the Backfill. */
export function supabaseMirrorStore(db: SupabaseClient): MirrorStore {
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

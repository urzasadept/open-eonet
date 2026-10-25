import { recordSyncRun, SYNC_QUERIES, syncQueries } from "@eonet/shared";
import { withSupabase } from "@supabase/server";
import { z } from "zod";
import { supabaseMirrorStore } from "../_shared/mirror-store.ts";

const RequestBody = z.object({ kind: z.enum(["incremental", "full"]) });

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
    const store = supabaseMirrorStore(ctx.supabaseAdmin);
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

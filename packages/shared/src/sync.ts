import {
  type EonetEvent,
  type EventsQuery,
  fetchEonetEvents,
  type RejectedEvent,
  type ValidatedEvents,
} from "./eonet.ts";

export type SyncKind = "incremental" | "full" | "backfill";

export const SYNC_QUERIES: Record<"incremental" | "full", EventsQuery[]> = {
  incremental: [{ days: 1 }],
  full: [{ status: "open" }, { status: "closed", days: 7 }],
};

export interface UpsertCounts {
  received: number;
  inserted: number;
}

export interface SyncResult extends UpsertCounts {
  rejected: RejectedEvent[];
}

/** Where a sync writes to; implemented over supabase-js by each runtime. */
export interface MirrorStore {
  startRun(kind: SyncKind): Promise<number>;
  finishRun(runId: number, outcome: { result: SyncResult } | { error: string }): Promise<void>;
  upsertEvents(events: EonetEvent[]): Promise<UpsertCounts>;
}

/**
 * Fetches and validates every query before returning, so a failed request or refused
 * response means nothing is written. Later queries win when an Event appears twice.
 */
export async function fetchMerged(
  queries: EventsQuery[],
  fetchFn: typeof fetch = fetch,
): Promise<ValidatedEvents> {
  const events = new Map<string, EonetEvent>();
  const rejected = new Map<string | null, RejectedEvent>();
  for (const query of queries) {
    const response = await fetchEonetEvents(query, fetchFn);
    for (const event of response.events) events.set(event.id, event);
    for (const event of response.rejected) rejected.set(event.id, event);
  }
  return { events: [...events.values()], rejected: [...rejected.values()] };
}

export async function upsertInBatches(
  store: MirrorStore,
  events: EonetEvent[],
  batchSize = 500,
): Promise<UpsertCounts> {
  const total = { received: 0, inserted: 0 };
  for (let start = 0; start < events.length; start += batchSize) {
    const counts = await store.upsertEvents(events.slice(start, start + batchSize));
    total.received += counts.received;
    total.inserted += counts.inserted;
  }
  return total;
}

/** Fetches the queries, then upserts the valid Events. */
export async function syncQueries(
  store: MirrorStore,
  queries: EventsQuery[],
  fetchFn: typeof fetch = fetch,
): Promise<SyncResult> {
  const { events, rejected } = await fetchMerged(queries, fetchFn);
  return { ...(await upsertInBatches(store, events)), rejected };
}

/** Wraps a sync in a `sync_runs` row that records its result, or its error before rethrowing. */
export async function recordSyncRun(
  store: MirrorStore,
  kind: SyncKind,
  work: () => Promise<SyncResult>,
): Promise<SyncResult> {
  const runId = await store.startRun(kind);
  try {
    const result = await work();
    await store.finishRun(runId, { result });
    return result;
  } catch (error) {
    await store.finishRun(runId, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

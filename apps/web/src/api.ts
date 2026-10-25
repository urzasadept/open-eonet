import {
  type Category,
  CategorySchema,
  type EventDetail,
  EventDetailSchema,
  type NearbyEvent,
  NearbyEventSchema,
  type SyncStatus,
  SyncStatusSchema,
} from "@eonet/shared/read-api";
import { PostgrestClient } from "@supabase/postgrest-js";
import * as z from "zod/mini";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see README).");
}

const db = new PostgrestClient(`${url}/rest/v1`, { headers: { apikey: publishableKey } });

async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
  schema: z.ZodMiniType<T>,
): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return z.parse(schema, data);
}

export interface NearbyQuery {
  lat: number;
  lon: number;
  radiusKm: number;
  activityWindowDays: number;
  category: string | null;
}

export function eventsNear(query: NearbyQuery): Promise<NearbyEvent[]> {
  return rpc(
    "events_near",
    {
      lat: query.lat,
      lon: query.lon,
      radius_km: query.radiusKm,
      activity_window_days: query.activityWindowDays,
      categories: query.category ? [query.category] : null,
    },
    z.array(NearbyEventSchema),
  );
}

export function eventDetail(id: string): Promise<EventDetail | null> {
  return rpc("event_detail", { id }, z.nullable(EventDetailSchema));
}

export function categories(): Promise<Category[]> {
  return rpc("categories", {}, z.array(CategorySchema));
}

export function syncStatus(): Promise<SyncStatus[]> {
  return rpc("sync_status", {}, z.array(SyncStatusSchema));
}

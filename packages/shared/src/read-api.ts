// Response shapes of the public read functions. Uses zod/mini to keep the web bundle small.
import * as z from "zod/mini";

export const RADIUS_OPTIONS_KM = [50, 100, 250, 500] as const;
export const DEFAULT_RADIUS_KM = 250;
export const DEFAULT_ACTIVITY_WINDOW_DAYS = 30;
export const MAX_ACTIVITY_WINDOW_DAYS = 365;

export const NearbyEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  categories: z.array(z.string()),
  latitude: z.number(),
  longitude: z.number(),
  latest_date: z.string(),
  magnitude_value: z.nullable(z.number()),
  magnitude_unit: z.nullable(z.string()),
  distance_km: z.number(),
});

const GeoJsonGeometry = z.union([
  z.object({ type: z.literal("Point"), coordinates: z.array(z.number()) }),
  z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.array(z.number()))) }),
]);

export const EventDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.nullable(z.string()),
  link: z.string(),
  closed_at: z.nullable(z.string()),
  categories: z.array(z.string()),
  sources: z.array(z.object({ id: z.string(), url: z.string() })),
  latitude: z.number(),
  longitude: z.number(),
  latest_date: z.string(),
  track: z.array(
    z.object({
      date: z.string(),
      geometry: GeoJsonGeometry,
      magnitude_value: z.nullable(z.number()),
      magnitude_unit: z.nullable(z.string()),
    }),
  ),
});

export const CategorySchema = z.object({ id: z.string(), title: z.string() });

export const SyncStatusSchema = z.object({
  kind: z.enum(["incremental", "full", "backfill"]),
  last_success_at: z.nullable(z.string()),
});

export type NearbyEvent = z.infer<typeof NearbyEventSchema>;
export type EventDetail = z.infer<typeof EventDetailSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

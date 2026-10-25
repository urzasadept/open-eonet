import type { EonetEvent, EonetGeometry } from "@eonet/shared";
import { createClient } from "@supabase/supabase-js";
import { inject } from "vitest";

const options = { auth: { persistSession: false, autoRefreshToken: false } };

export const anon = createClient(inject("supabaseUrl"), inject("publishableKey"), options);
export const service = createClient(inject("supabaseUrl"), inject("secretKey"), options);

/** Test Events live in the empty South Pacific so live EONET data never lands near them. */
export const ORIGIN = { lat: -50, lon: -130 };
export const TEST_PREFIX = "TEST_";

const DAY_MS = 86_400_000;

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().replace(/\.\d+Z$/, "Z");
}

/** A point `km` kilometres due north of ORIGIN (1° of latitude ≈ 111.19 km on the PostGIS sphere). */
export function northOfOrigin(km: number): [number, number] {
  return [ORIGIN.lon, ORIGIN.lat + km / 111.195];
}

export function point(
  coordinates: [number, number],
  date: string,
  magnitude?: { value: number; unit: string },
): EonetGeometry {
  return {
    date,
    type: "Point",
    coordinates,
    magnitudeValue: magnitude?.value ?? null,
    magnitudeUnit: magnitude?.unit ?? null,
  };
}

export function testEvent(
  id: string,
  overrides: Partial<EonetEvent> & Pick<EonetEvent, "geometry">,
): EonetEvent {
  return {
    id: `${TEST_PREFIX}${id}`,
    title: `Test event ${id}`,
    description: null,
    link: `https://eonet.gsfc.nasa.gov/api/v3/events/${TEST_PREFIX}${id}`,
    closed: null,
    categories: [{ id: "wildfires", title: "Wildfires" }],
    sources: [{ id: "TEST", url: "https://example.org/test" }],
    ...overrides,
  };
}

export async function upsertEvents(events: EonetEvent[]) {
  const { data, error } = await service.rpc("upsert_events", { payload: events });
  if (error) throw new Error(error.message);
  return data as { received: number; inserted: number };
}

export async function deleteTestEvents() {
  const { error } = await service.from("events").delete().like("id", `${TEST_PREFIX}%`);
  if (error) throw new Error(error.message);
}

export function nearOrigin(args: {
  radius_km: number;
  categories?: string[];
  activity_window_days?: number;
}) {
  return anon.rpc("events_near", { lat: ORIGIN.lat, lon: ORIGIN.lon, ...args });
}

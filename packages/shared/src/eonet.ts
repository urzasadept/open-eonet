import { z } from "zod";

export const EONET_EVENTS_URL = "https://eonet.gsfc.nasa.gov/api/v3/events";

/** EONET positions are `[lon, lat]`, never `[lat, lon]`. */
const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const Magnitude = {
  magnitudeValue: z.number().nullish(),
  magnitudeUnit: z.string().nullish(),
};

const PointGeometry = z.object({
  date: z.iso.datetime(),
  type: z.literal("Point"),
  coordinates: Position,
  ...Magnitude,
});

const PolygonGeometry = z.object({
  date: z.iso.datetime(),
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(Position).min(4)).min(1),
  ...Magnitude,
});

export const EonetGeometrySchema = z.discriminatedUnion("type", [PointGeometry, PolygonGeometry]);

export const EonetEventSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().nullish(),
  link: z.url(),
  closed: z.iso.datetime().nullable(),
  categories: z.array(z.object({ id: z.string().min(1), title: z.string() })).min(1),
  sources: z.array(z.object({ id: z.string(), url: z.string() })),
  geometry: z.array(EonetGeometrySchema).min(1),
});

export const EonetEventsResponseSchema = z.object({
  events: z.array(EonetEventSchema),
});

export type EonetGeometry = z.infer<typeof EonetGeometrySchema>;
export type EonetEvent = z.infer<typeof EonetEventSchema>;
export type EonetEventsResponse = z.infer<typeof EonetEventsResponseSchema>;

export function parseEventsResponse(json: unknown): EonetEventsResponse {
  return EonetEventsResponseSchema.parse(json);
}

export function parseEonetEvent(json: unknown): EonetEvent {
  return EonetEventSchema.parse(json);
}

export type EventsQuery =
  | { status: "open" }
  | { status: "open" | "closed" | "all"; days: number }
  | { status: "open" | "closed" | "all"; start: string; end: string };

export function eventsUrl(query: EventsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  return `${EONET_EVENTS_URL}?${params}`;
}

/** Fetches one EONET events page and validates it; throws on HTTP or schema errors. */
export async function fetchEonetEvents(
  query: EventsQuery,
  fetchFn: typeof fetch = fetch,
): Promise<EonetEvent[]> {
  const url = eventsUrl(query);
  const response = await fetchFn(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`EONET ${url} responded ${response.status}`);
  return parseEventsResponse(await response.json()).events;
}

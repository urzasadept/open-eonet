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

const EventsEnvelopeSchema = z.object({ events: z.array(z.unknown()) });

export type EonetGeometry = z.infer<typeof EonetGeometrySchema>;
export type EonetEvent = z.infer<typeof EonetEventSchema>;

/** An EONET Event that failed validation and is not mirrored. */
export interface RejectedEvent {
  id: string | null;
  reason: string;
}

export interface ValidatedEvents {
  events: EonetEvent[];
  rejected: RejectedEvent[];
}

/** Above this share of Rejected Events, a response is treated as a format change and refused. */
export const MAX_REJECTED_SHARE = 0.01;

export function parseEonetEvent(json: unknown): EonetEvent {
  return EonetEventSchema.parse(json);
}

/**
 * Validates an events response Event by Event. Throws if the envelope is malformed or more
 * than {@link MAX_REJECTED_SHARE} of its Events are rejected.
 */
export function validateEventsResponse(json: unknown): ValidatedEvents {
  const envelope = EventsEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new Error(`Malformed events response: ${z.prettifyError(envelope.error)}`);
  }
  const result: ValidatedEvents = { events: [], rejected: [] };
  for (const raw of envelope.data.events) {
    const parsed = EonetEventSchema.safeParse(raw);
    if (parsed.success) {
      result.events.push(parsed.data);
    } else {
      const id = (raw as { id?: unknown } | null)?.id;
      result.rejected.push({
        id: typeof id === "string" ? id : null,
        reason: z.prettifyError(parsed.error).slice(0, 500),
      });
    }
  }
  const total = envelope.data.events.length;
  if (result.rejected.length > total * MAX_REJECTED_SHARE) {
    const sample = result.rejected
      .slice(0, 3)
      .map((event) => `${event.id}: ${event.reason}`)
      .join("; ");
    throw new Error(`${result.rejected.length} of ${total} Events rejected, e.g. ${sample}`);
  }
  return result;
}

/** EONET returns only Open Events when `status` is omitted; `status: "all"` needs `start`/`end`. */
export type EventsQuery = {
  status?: "open" | "closed" | "all";
  days?: number;
  start?: string;
  end?: string;
};

export function eventsUrl(query: EventsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  return `${EONET_EVENTS_URL}?${params}`;
}

/** Fetches one EONET events response and validates it; throws on HTTP or validation failure. */
export async function fetchEonetEvents(
  query: EventsQuery,
  fetchFn: typeof fetch = fetch,
): Promise<ValidatedEvents> {
  const url = eventsUrl(query);
  const response = await fetchFn(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`EONET ${url} responded ${response.status}`);
  try {
    return validateEventsResponse(await response.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`EONET ${url}: ${message.slice(0, 2000)}`);
  }
}

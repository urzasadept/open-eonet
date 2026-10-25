import { describe, expect, it } from "vitest";
import closedEvent from "../fixtures/closed-event.json" with { type: "json" };
import openExcerpt from "../fixtures/open-excerpt.json" with { type: "json" };
import stormTrack from "../fixtures/storm-track.json" with { type: "json" };
import { parseEonetEvent, validateEventsResponse } from "../src/index.ts";

function withEvents(events: unknown[]) {
  return { ...openExcerpt, events };
}

describe("EONET v3 schemas", () => {
  it("parses an excerpt of the real open set", () => {
    const { events, rejected } = validateEventsResponse(openExcerpt);
    expect(events).toHaveLength(25);
    expect(rejected).toEqual([]);
    expect(events.every((event) => event.closed === null)).toBe(true);
  });

  it("parses a Closed Event with its closing date", () => {
    const event = parseEonetEvent(closedEvent);
    expect(event.id).toBe("EONET_25686");
    expect(event.closed).toBe("2026-10-24T00:00:00Z");
  });

  it("parses a storm with a multi-point Track in [lon, lat] order", () => {
    const event = parseEonetEvent(stormTrack);
    expect(event.categories.map((category) => category.id)).toEqual(["severeStorms"]);
    expect(event.geometry).toHaveLength(42);
    const first = event.geometry[0];
    expect(first?.type).toBe("Point");
    expect(first?.coordinates).toEqual([157.4, 11]);
    expect(first?.magnitudeUnit).toBe("kts");
  });

  it("parses a Polygon Geometry", () => {
    const polygon = {
      ...stormTrack,
      geometry: [
        {
          date: "2026-10-01T00:00:00Z",
          type: "Polygon",
          coordinates: [
            [
              [10, 40],
              [11, 40],
              [11, 41],
              [10, 40],
            ],
          ],
          magnitudeValue: null,
          magnitudeUnit: null,
        },
      ],
    };
    expect(parseEonetEvent(polygon).geometry[0]?.type).toBe("Polygon");
  });

  it("rejects an Event whose latitude is out of range, which signals swapped coordinates", () => {
    const swapped = structuredClone(stormTrack);
    const geometry = swapped.geometry[0] as { coordinates: number[] };
    geometry.coordinates = [11, 157.4];
    expect(() => parseEonetEvent(swapped)).toThrow();
  });
});

describe("validateEventsResponse", () => {
  it("rejects a payload whose events field is missing", () => {
    const { events: _events, ...malformed } = openExcerpt;
    expect(() => validateEventsResponse(malformed)).toThrow();
  });

  it("keeps valid Events and lists Rejected Events by id with a reason", () => {
    const events: unknown[] = Array.from({ length: 150 }, (_, index) => ({
      ...stormTrack,
      id: `EONET_${index}`,
    }));
    events[7] = {
      ...stormTrack,
      id: "EONET_BAD",
      geometry: [{ ...stormTrack.geometry[0], coordinates: [14, 200] }],
    };

    const result = validateEventsResponse(withEvents(events));

    expect(result.events).toHaveLength(149);
    expect(result.events.map((event) => event.id)).not.toContain("EONET_BAD");
    expect(result.rejected).toEqual([
      { id: "EONET_BAD", reason: expect.stringContaining("geometry") },
    ]);
  });

  it("fails the whole response when more than 1% of Events are rejected", () => {
    const events: unknown[] = Array.from({ length: 100 }, (_, index) => ({
      ...stormTrack,
      id: `EONET_${index}`,
    }));
    events[1] = { ...stormTrack, id: "EONET_BAD_1", geometry: "-82.85, 30.49" };
    events[2] = { ...stormTrack, id: "EONET_BAD_2", geometry: "-82.85, 30.49" };

    expect(() => validateEventsResponse(withEvents(events))).toThrow(/2 of 100 Events rejected/);
  });
});

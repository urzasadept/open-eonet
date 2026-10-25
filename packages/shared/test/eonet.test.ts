import { describe, expect, it } from "vitest";
import closedEvent from "../fixtures/closed-event.json" with { type: "json" };
import openExcerpt from "../fixtures/open-excerpt.json" with { type: "json" };
import stormTrack from "../fixtures/storm-track.json" with { type: "json" };
import { parseEonetEvent, parseEventsResponse } from "../src/index.ts";

describe("EONET v3 schemas", () => {
  it("parses an excerpt of the real open set", () => {
    const response = parseEventsResponse(openExcerpt);
    expect(response.events).toHaveLength(25);
    expect(response.events.every((event) => event.closed === null)).toBe(true);
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

  it("rejects a payload whose coordinates are not a [lon, lat] pair", () => {
    const malformed = structuredClone(openExcerpt);
    const geometry = malformed.events[0]?.geometry[0] as { coordinates: unknown };
    geometry.coordinates = "-82.85, 30.49";
    expect(() => parseEventsResponse(malformed)).toThrow();
  });

  it("rejects a payload whose events field is missing", () => {
    const { events: _events, ...malformed } = openExcerpt;
    expect(() => parseEventsResponse(malformed)).toThrow();
  });

  it("rejects a latitude out of range, which signals swapped coordinates", () => {
    const swapped = structuredClone(stormTrack);
    const geometry = swapped.geometry[0] as { coordinates: number[] };
    geometry.coordinates = [11, 157.4];
    expect(() => parseEonetEvent(swapped)).toThrow();
  });
});

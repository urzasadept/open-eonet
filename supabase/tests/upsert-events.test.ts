import type { EonetEvent } from "@eonet/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  anon,
  daysAgo,
  deleteTestEvents,
  nearOrigin,
  northOfOrigin,
  point,
  testEvent,
  upsertEvents,
} from "./helpers.ts";

afterEach(deleteTestEvents);

async function detail(id: string) {
  const { data, error } = await anon.rpc("event_detail", { id: `TEST_${id}` });
  if (error) throw new Error(error.message);
  return data;
}

describe("upsert_events", () => {
  it("is idempotent: upserting the same Events twice inserts them only once", async () => {
    const events = [
      testEvent("A", { geometry: [point(northOfOrigin(5), daysAgo(1))] }),
      testEvent("B", {
        geometry: [point(northOfOrigin(6), daysAgo(3)), point(northOfOrigin(7), daysAgo(2))],
      }),
    ];
    expect(await upsertEvents(events)).toEqual({ received: 2, inserted: 2 });
    expect(await upsertEvents(events)).toEqual({ received: 2, inserted: 0 });
    expect((await detail("B")).track).toHaveLength(2);
  });

  it("replaces the stored Track with EONET's", async () => {
    await upsertEvents([
      testEvent("T", {
        geometry: [
          point([0, -60], daysAgo(5)),
          point([1, -60], daysAgo(4)),
          point([2, -60], daysAgo(3)),
        ],
      }),
    ]);
    await upsertEvents([
      testEvent("T", { geometry: [point([5, -61], daysAgo(2)), point([6, -61], daysAgo(1))] }),
    ]);
    const event = await detail("T");
    expect(
      event.track.map((g: { geometry: { coordinates: number[] } }) => g.geometry.coordinates),
    ).toEqual([
      [5, -61],
      [6, -61],
    ]);
    expect([event.longitude, event.latitude]).toEqual([6, -61]);
  });

  it("records closure when EONET closes an Event, which removes it from Active results", async () => {
    const open = testEvent("C", { geometry: [point(northOfOrigin(5), daysAgo(1))] });
    await upsertEvents([open]);
    expect((await nearOrigin({ radius_km: 50 })).data).toHaveLength(1);

    const closed: EonetEvent = { ...open, closed: daysAgo(0) };
    await upsertEvents([closed]);
    expect((await detail("C")).closed_at).not.toBeNull();
    expect((await nearOrigin({ radius_km: 50 })).data).toHaveLength(0);
  });

  it("uses the most recent Geometry as the Latest Position, whatever the payload order", async () => {
    await upsertEvents([
      testEvent("ORDER", {
        geometry: [
          point([20, -55], daysAgo(1), { value: 99, unit: "kts" }),
          point([10, -55], daysAgo(9), { value: 10, unit: "kts" }),
        ],
      }),
    ]);
    const event = await detail("ORDER");
    expect([event.longitude, event.latitude]).toEqual([20, -55]);
    expect(event.track[0].geometry.coordinates).toEqual([10, -55]);
  });

  it("uses a polygon's centroid as its Latest Position", async () => {
    await upsertEvents([
      testEvent("POLY", {
        geometry: [
          {
            date: daysAgo(1),
            type: "Polygon",
            coordinates: [
              [
                [-131, -51],
                [-129, -51],
                [-129, -49],
                [-131, -49],
                [-131, -51],
              ],
            ],
            magnitudeValue: null,
            magnitudeUnit: null,
          },
        ],
      }),
    ]);
    const event = await detail("POLY");
    expect(event.longitude).toBeCloseTo(-130, 6);
    expect(event.latitude).toBeCloseTo(-50, 6);
    expect(event.track[0].geometry.type).toBe("Polygon");

    const { data } = await nearOrigin({ radius_km: 1 });
    expect(data?.map((row: { id: string }) => row.id)).toEqual(["TEST_POLY"]);
  });
});

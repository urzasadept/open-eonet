import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon,
  daysAgo,
  deleteTestEvents,
  nearOrigin,
  northOfOrigin,
  point,
  service,
  testEvent,
  upsertEvents,
} from "./helpers.ts";

beforeAll(async () => {
  await deleteTestEvents();
  await upsertEvents([
    testEvent("FAR", { geometry: [point(northOfOrigin(120), daysAgo(1))] }),
    testEvent("NEAR", {
      geometry: [point(northOfOrigin(10), daysAgo(2), { value: 1200, unit: "acres" })],
    }),
    testEvent("MID", { geometry: [point(northOfOrigin(50), daysAgo(3))] }),
    testEvent("OUTSIDE_250", { geometry: [point(northOfOrigin(300), daysAgo(1))] }),
    testEvent("STALE_40_DAYS", { geometry: [point(northOfOrigin(20), daysAgo(40))] }),
    testEvent("CLOSED", {
      closed: daysAgo(1),
      geometry: [point(northOfOrigin(30), daysAgo(2))],
    }),
    testEvent("VOLCANO", {
      categories: [{ id: "volcanoes", title: "Volcanoes" }],
      geometry: [point(northOfOrigin(40), daysAgo(5))],
    }),
  ]);
});

const ids = (rows: { id: string }[] | null) => rows?.map((row) => row.id) ?? [];

afterAll(deleteTestEvents);

describe("events_near", () => {
  it("returns Active Events within the Radius ordered by distance", async () => {
    const { data, error } = await nearOrigin({ radius_km: 250 });
    expect(error).toBeNull();
    expect(ids(data)).toEqual(["TEST_NEAR", "TEST_VOLCANO", "TEST_MID", "TEST_FAR"]);
    const near = data?.[0];
    expect(near.distance_km).toBeCloseTo(10, 0);
    expect(near.magnitude_value).toBe(1200);
    expect(near.magnitude_unit).toBe("acres");
    expect(near).not.toHaveProperty("track");
  });

  it("reaches farther Events with a larger Radius", async () => {
    const { data } = await nearOrigin({ radius_km: 500 });
    expect(ids(data)).toContain("TEST_OUTSIDE_250");
  });

  it("excludes Events whose latest Geometry is older than the Activity Window", async () => {
    const { data: defaultWindow } = await nearOrigin({ radius_km: 250 });
    expect(ids(defaultWindow)).not.toContain("TEST_STALE_40_DAYS");

    const { data: wideWindow } = await nearOrigin({ radius_km: 250, activity_window_days: 60 });
    expect(ids(wideWindow)).toContain("TEST_STALE_40_DAYS");

    const { data: narrowWindow } = await nearOrigin({ radius_km: 250, activity_window_days: 2 });
    expect(ids(narrowWindow)).toEqual(["TEST_FAR"]);
  });

  it("never returns Closed Events, however recent", async () => {
    const { data } = await nearOrigin({ radius_km: 250, activity_window_days: 365 });
    expect(ids(data)).not.toContain("TEST_CLOSED");
  });

  it("filters by Category", async () => {
    const { data: volcanoes } = await nearOrigin({ radius_km: 250, categories: ["volcanoes"] });
    expect(ids(volcanoes)).toEqual(["TEST_VOLCANO"]);

    const { data: either } = await nearOrigin({
      radius_km: 250,
      categories: ["volcanoes", "wildfires"],
    });
    expect(ids(either)).toHaveLength(4);
  });

  it.each([
    { radius_km: 501 },
    { radius_km: 0 },
    { radius_km: 100, activity_window_days: 366 },
    { radius_km: 100, activity_window_days: 0 },
  ])("rejects arguments beyond the caps: %o", async (args) => {
    const { data, error } = await nearOrigin(args);
    expect(data).toBeNull();
    expect(error?.code).toBe("22023");
  });

  it("accepts the maximum Radius and Activity Window", async () => {
    const { error } = await nearOrigin({ radius_km: 500, activity_window_days: 365 });
    expect(error).toBeNull();
  });

  it("rejects a Search Point outside valid coordinates", async () => {
    const { error } = await anon.rpc("events_near", { lat: 91, lon: 0, radius_km: 100 });
    expect(error?.code).toBe("22023");
  });

  it("returns at most 500 results", async () => {
    const crowd = Array.from({ length: 501 }, (_, index) =>
      testEvent(`CROWD_${index}`, { geometry: [point(northOfOrigin(400), daysAgo(1))] }),
    );
    await upsertEvents(crowd);
    const { data, error } = await nearOrigin({ radius_km: 500 });
    expect(error).toBeNull();
    expect(data).toHaveLength(500);
  });
});

describe("event_detail", () => {
  it("returns the Event with its Sources, closed_at and full Track ordered by date", async () => {
    await upsertEvents([
      testEvent("STORM", {
        categories: [{ id: "severeStorms", title: "Severe Storms" }],
        sources: [{ id: "JTWC", url: "https://example.org/jtwc" }],
        closed: daysAgo(1),
        geometry: [
          point([150, -50], daysAgo(3), { value: 35, unit: "kts" }),
          point([151, -51], daysAgo(2), { value: 45, unit: "kts" }),
        ],
      }),
    ]);
    const { data, error } = await anon.rpc("event_detail", { id: "TEST_STORM" });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: "TEST_STORM",
      categories: ["severeStorms"],
      sources: [{ id: "JTWC", url: "https://example.org/jtwc" }],
      latitude: -51,
      longitude: 151,
    });
    expect(Date.parse(data.closed_at)).toBe(Date.parse(daysAgo(1)));
    expect(data.track).toEqual([
      {
        date: expect.any(String),
        geometry: { type: "Point", coordinates: [150, -50] },
        magnitude_value: 35,
        magnitude_unit: "kts",
      },
      {
        date: expect.any(String),
        geometry: { type: "Point", coordinates: [151, -51] },
        magnitude_value: 45,
        magnitude_unit: "kts",
      },
    ]);
  });

  it("returns null for an unknown id", async () => {
    const { data, error } = await anon.rpc("event_detail", { id: "TEST_DOES_NOT_EXIST" });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("categories", () => {
  it("lists the Categories present in the mirror with EONET's titles", async () => {
    const { data, error } = await anon.rpc("categories");
    expect(error).toBeNull();
    expect(data).toEqual(
      expect.arrayContaining([
        { id: "wildfires", title: "Wildfires" },
        { id: "volcanoes", title: "Volcanoes" },
      ]),
    );
  });
});

describe("sync_status", () => {
  it("reports the last successful run of each kind, ignoring failed runs", async () => {
    const succeeded = new Date(Date.now() + 60_000).toISOString();
    const inserted = await service
      .from("sync_runs")
      .insert([
        { kind: "backfill", started_at: succeeded, finished_at: succeeded },
        {
          kind: "backfill",
          started_at: succeeded,
          finished_at: new Date(Date.now() + 120_000).toISOString(),
          error: "boom",
        },
      ])
      .select("id");
    try {
      const { data, error } = await anon.rpc("sync_status");
      expect(error).toBeNull();
      expect(data.map((row: { kind: string }) => row.kind).sort()).toEqual([
        "backfill",
        "full",
        "incremental",
      ]);
      const backfill = data.find((row: { kind: string }) => row.kind === "backfill");
      expect(Date.parse(backfill.last_success_at)).toBe(Date.parse(succeeded));
    } finally {
      const runIds = inserted.data?.map((row) => row.id) ?? [];
      await service.from("sync_runs").delete().in("id", runIds);
    }
  });
});

describe("anonymous access", () => {
  it.each(["events", "event_geometries", "sync_runs"])(
    "cannot read the %s table directly",
    async (table) => {
      const { error } = await anon.from(table).select("*").limit(1);
      expect(error?.code).toBe("42501");
    },
  );

  it("cannot insert, update or delete events", async () => {
    const insert = await anon.from("events").insert({ id: "TEST_ANON", title: "x" });
    const update = await anon.from("events").update({ title: "x" }).eq("id", "TEST_NEAR");
    const remove = await anon.from("events").delete().eq("id", "TEST_NEAR");
    expect(insert.error?.code).toBe("42501");
    expect(update.error?.code).toBe("42501");
    expect(remove.error?.code).toBe("42501");
  });

  it("cannot write sync runs", async () => {
    const { error } = await anon.from("sync_runs").insert({ kind: "full" });
    expect(error?.code).toBe("42501");
  });

  it("cannot call the upsert function", async () => {
    const { error } = await anon.rpc("upsert_events", {
      payload: [testEvent("ANON", { geometry: [point(northOfOrigin(1), daysAgo(1))] })],
    });
    expect(error?.code).toBe("42501");
    const { data } = await nearOrigin({ radius_km: 50 });
    expect(ids(data)).not.toContain("TEST_ANON");
  });
});

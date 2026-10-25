import {
  DEFAULT_ACTIVITY_WINDOW_DAYS,
  DEFAULT_RADIUS_KM,
  type EventDetail,
  type NearbyEvent,
  RADIUS_OPTIONS_KM,
} from "@eonet/shared/read-api";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "preact/hooks";
import { categories, eventDetail, eventsNear, syncStatus } from "./api.ts";
import {
  formatDateTime,
  formatDistance,
  formatMagnitude,
  isStale,
  lastSuccessfulSync,
} from "./format.ts";
import { type LatLon, MapView } from "./MapView.tsx";

const ACTIVITY_WINDOW_OPTIONS_DAYS = [7, 14, 30, 90, 180, 365];

type Locating = "idle" | "locating" | "denied" | "unavailable";

const roundPoint = ({ lat, lon }: LatLon): LatLon => ({
  lat: Math.round(lat * 1e4) / 1e4,
  lon: Math.round(lon * 1e4) / 1e4,
});

export function App() {
  const [searchPoint, setSearchPoint] = useState<LatLon | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [activityWindowDays, setActivityWindowDays] = useState(DEFAULT_ACTIVITY_WINDOW_DAYS);
  const [category, setCategory] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locating, setLocating] = useState<Locating>("idle");

  const categoryList = useQuery({
    queryKey: ["categories"],
    queryFn: categories,
    staleTime: Infinity,
  });
  const sync = useQuery({
    queryKey: ["sync_status"],
    queryFn: syncStatus,
    refetchInterval: 5 * 60_000,
  });
  const nearby = useQuery({
    queryKey: ["events_near", searchPoint, radiusKm, activityWindowDays, category],
    queryFn: () =>
      eventsNear({ ...(searchPoint as LatLon), radiusKm, activityWindowDays, category }),
    enabled: searchPoint !== null,
    placeholderData: keepPreviousData,
  });
  const detail = useQuery({
    queryKey: ["event_detail", selectedId],
    queryFn: () => eventDetail(selectedId as string),
    enabled: selectedId !== null,
  });

  const categoryTitle = (id: string) =>
    categoryList.data?.find((candidate) => candidate.id === id)?.title ?? id;

  const pickPoint = (point: LatLon) => {
    setSearchPoint(roundPoint(point));
    setSelectedId(null);
  };

  const locate = () => {
    if (!("geolocation" in navigator)) return setLocating("unavailable");
    setLocating("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating("idle");
        pickPoint({ lat: position.coords.latitude, lon: position.coords.longitude });
      },
      (error) => setLocating(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
      { timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const lastSync = sync.data ? lastSuccessfulSync(sync.data) : undefined;
  const events = nearby.data ?? [];

  return (
    <div class="layout">
      <header class="header">
        <h1>Eonet</h1>
        <p>Natural events near a location, from NASA's EONET.</p>
      </header>

      <MapView
        searchPoint={searchPoint}
        radiusKm={radiusKm}
        events={events}
        selectedId={selectedId}
        selected={detail.data ?? null}
        onPickPoint={pickPoint}
        onSelect={setSelectedId}
      />

      <aside class="sidebar">
        {lastSync !== undefined && isStale(lastSync) && (
          <div class="banner" role="status">
            Data may be stale:{" "}
            {lastSync
              ? `the last successful sync with EONET was at ${formatDateTime(lastSync.toISOString())}.`
              : "no successful sync with EONET yet."}
          </div>
        )}

        <section class="controls" aria-label="Search">
          <button type="button" onClick={locate} disabled={locating === "locating"}>
            {locating === "locating" ? "Locating…" : "Use my location"}
          </button>
          <p class="hint">
            {locating === "denied"
              ? "Location permission was denied. Click the map to place the Search Point instead."
              : locating === "unavailable"
                ? "Your location is unavailable. Click the map to place the Search Point instead."
                : "Or click the map to place the Search Point, then drag the pin to move it."}
          </p>
          <label>
            Radius
            <select
              value={radiusKm}
              onChange={(event) => setRadiusKm(Number(event.currentTarget.value))}
            >
              {RADIUS_OPTIONS_KM.map((km) => (
                <option key={km} value={km}>
                  {km} km
                </option>
              ))}
            </select>
          </label>
          <label>
            Updated within
            <select
              value={activityWindowDays}
              onChange={(event) => setActivityWindowDays(Number(event.currentTarget.value))}
            >
              {ACTIVITY_WINDOW_OPTIONS_DAYS.map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={category ?? ""}
              onChange={(event) => setCategory(event.currentTarget.value || null)}
            >
              <option value="">All categories</option>
              {categoryList.data?.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </select>
          </label>
        </section>

        {detail.data && (
          <EventDetailPanel
            event={detail.data}
            categoryTitle={categoryTitle}
            onClose={() => setSelectedId(null)}
          />
        )}

        <Results
          searchPoint={searchPoint}
          isLoading={nearby.isLoading || (nearby.isPlaceholderData && events.length === 0)}
          error={nearby.error}
          events={events}
          selectedId={selectedId}
          categoryTitle={categoryTitle}
          onSelect={setSelectedId}
        />

        <footer class="footer">
          Shows Open EONET Events whose latest report falls within the chosen window. EONET is not a
          warning service.
        </footer>
      </aside>
    </div>
  );
}

function Results(props: {
  searchPoint: LatLon | null;
  isLoading: boolean;
  error: Error | null;
  events: NearbyEvent[];
  selectedId: string | null;
  categoryTitle: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  if (!props.searchPoint) return null;
  if (props.isLoading) return <p class="status">Searching…</p>;
  if (props.error) return <p class="status error">Could not load events: {props.error.message}</p>;
  if (props.events.length === 0) {
    return (
      <div class="empty">
        <h2>No EONET events nearby</h2>
        <p>
          EONET only lists events its sources report: mostly wildfires in North America, plus
          storms, volcanoes and sea ice elsewhere. An empty list does not mean the area is safe;
          check your local authorities for warnings.
        </p>
      </div>
    );
  }
  return (
    <section aria-label="Nearby events">
      <h2 class="results-title">
        {props.events.length} {props.events.length === 1 ? "event" : "events"} nearby
      </h2>
      <ul class="results">
        {props.events.map((event) => (
          <li key={event.id}>
            <button
              type="button"
              class={event.id === props.selectedId ? "result selected" : "result"}
              aria-pressed={event.id === props.selectedId}
              onClick={() => props.onSelect(event.id)}
            >
              <span class="result-title">{event.title}</span>
              <span class="result-meta">
                {event.categories.map(props.categoryTitle).join(", ")} ·{" "}
                {formatDistance(event.distance_km)} away
              </span>
              <span class="result-meta">
                Latest report {formatDateTime(event.latest_date)}
                {formatMagnitude(event.magnitude_value, event.magnitude_unit) &&
                  ` · ${formatMagnitude(event.magnitude_value, event.magnitude_unit)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EventDetailPanel(props: {
  event: EventDetail;
  categoryTitle: (id: string) => string;
  onClose: () => void;
}) {
  const { event } = props;
  const first = event.track[0];
  const last = event.track.at(-1);
  return (
    <section class="detail" aria-label="Selected event">
      <div class="detail-header">
        <h2>{event.title}</h2>
        <button type="button" class="close" onClick={props.onClose} aria-label="Close details">
          ×
        </button>
      </div>
      <p class="result-meta">{event.categories.map(props.categoryTitle).join(", ")}</p>
      {event.description && <p>{event.description}</p>}
      <dl>
        <dt>Latest report</dt>
        <dd>{formatDateTime(event.latest_date)}</dd>
        {event.closed_at && (
          <>
            <dt>Closed by EONET</dt>
            <dd>{formatDateTime(event.closed_at)}</dd>
          </>
        )}
        {first && last && (
          <>
            <dt>Track</dt>
            <dd>
              {event.track.length} {event.track.length === 1 ? "report" : "reports"}
              {event.track.length > 1 &&
                `, ${formatDateTime(first.date)} to ${formatDateTime(last.date)}`}
            </dd>
          </>
        )}
        {last && formatMagnitude(last.magnitude_value, last.magnitude_unit) && (
          <>
            <dt>Latest magnitude</dt>
            <dd>{formatMagnitude(last.magnitude_value, last.magnitude_unit)}</dd>
          </>
        )}
      </dl>
      {event.sources.length > 0 && (
        <p>
          Sources:{" "}
          {event.sources.map((source, index) => (
            <span key={source.url}>
              {index > 0 && ", "}
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.id}
              </a>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

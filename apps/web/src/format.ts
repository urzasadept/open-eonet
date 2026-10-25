import type { SyncStatus } from "@eonet/shared/read-api";

const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const distance = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const magnitude = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

/** Formats an ISO timestamp in the user's local time zone. */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatDistance(km: number): string {
  return km < 1 ? "< 1 km" : `${distance.format(km)} km`;
}

export function formatMagnitude(value: number | null, unit: string | null): string | null {
  return value === null ? null : `${magnitude.format(value)} ${unit ?? ""}`.trim();
}

const STALE_AFTER_MS = 60 * 60 * 1000;

/** The most recent successful sync of any kind, or null if none ever succeeded. */
export function lastSuccessfulSync(statuses: SyncStatus[]): Date | null {
  const times = statuses
    .map((status) => status.last_success_at)
    .filter((time) => time !== null)
    .map((time) => new Date(time).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

export function isStale(lastSync: Date | null, now = Date.now()): boolean {
  return lastSync === null || now - lastSync.getTime() > STALE_AFTER_MS;
}

const CHINA_STANDARD_TIME_OFFSET_HOURS = 8;
const CHINA_STANDARD_TIME_OFFSET_MILLISECONDS =
  CHINA_STANDARD_TIME_OFFSET_HOURS * 60 * 60 * 1_000;
const UTC_SUFFIX = "Z";

export const DATABASE_TIME_ZONE_OFFSET = "+08:00";

/**
 * Formats an instant for durable database storage in fixed China Standard Time.
 * The explicit offset keeps the value unambiguous and independent of the host's
 * configured timezone.
 */
export function formatDatabaseTimestamp(
  value: Date | number = Date.now(),
): string {
  const instant = typeof value === "number" ? value : value.getTime();
  if (!Number.isFinite(instant)) {
    throw new RangeError("Cannot format an invalid database timestamp.");
  }

  return new Date(instant + CHINA_STANDARD_TIME_OFFSET_MILLISECONDS)
    .toISOString()
    .replace(UTC_SUFFIX, DATABASE_TIME_ZONE_OFFSET);
}

/** Converts any valid ISO timestamp to the database's canonical CST form. */
export function normalizeDatabaseTimestamp(value: string): string {
  return formatDatabaseTimestamp(Date.parse(value));
}

/**
 * Returns a CST timestamp that is at least one millisecond newer than a stored
 * value. Repositories use this when textual timestamp ordering drives recency.
 */
export function nextDatabaseTimestamp(
  previousTimestamp: string,
  now: number = Date.now(),
): string {
  const previous = Date.parse(previousTimestamp);
  const instant = Number.isFinite(previous)
    ? Math.max(now, previous + 1)
    : now;
  return formatDatabaseTimestamp(instant);
}

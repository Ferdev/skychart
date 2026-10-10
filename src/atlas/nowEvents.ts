export type NowEvent = {
  title: string;
  summary: string;
  starts_at: string;
  url: string;
  catalog_key: string | null;
};

/**
 * Removes a row that has the same title on the same UTC day as an earlier row.
 * The feed can give one close approach two times when its source changes the approach time.
 */
export function uniqueNowEvents(events: readonly NowEvent[]): NowEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.title.trim().toLowerCase()}|${utcDay(event.starts_at)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function utcDay(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toISOString().slice(0, 10);
}

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

/** The event types of the calendar subscription, as the `types` parameter of the address names them. */
export const CALENDAR_EVENT_TYPES = ["close_approach", "new_exoplanet"] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

/** The address of the calendar. All types together need no filter. */
export function calendarAddress(origin: string, types: readonly CalendarEventType[]): string {
  const selected = CALENDAR_EVENT_TYPES.filter((type) => types.includes(type));
  return `${origin}/calendar.ics${selected.length === CALENDAR_EVENT_TYPES.length ? "" : `?types=${selected.join(",")}`}`;
}

/** The same address for the subscribe action of a calendar application. */
export function webcalAddress(address: string): string {
  return address.replace(/^https?:/, "webcal:");
}

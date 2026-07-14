export const ANALYTICS_EVENTS = [
  "page_view", "search", "object", "compare", "share", "embed_loaded", "image_export",
  "tour_started", "tour_completed", "methodology", "citation_copied", "filter", "data_export", "cross_tool"
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
export type AnalyticsProperties = Record<string, string | number>;

export function trackAnalytics(name: AnalyticsEvent, properties: AnalyticsProperties = {}): void {
  const bounded = Object.fromEntries(Object.entries(properties).slice(0, 6).map(([key, value]) => [key, String(value).slice(0, 80)]));
  const payload = JSON.stringify({ name, path: location.pathname, referrer: referrerHostname(), properties: bounded });
  if (payload.length > 2_048 || navigator.webdriver) return;
  if (navigator.sendBeacon) navigator.sendBeacon("/api/events", new Blob([payload], { type: "application/json" }));
  else void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true });
}

export function trackEvent(event: string, properties: AnalyticsProperties = {}): void {
  window.dispatchEvent(new CustomEvent("cosmic-atlas:analytics", { detail: { event, ...properties } }));
  const canonical = event === "export" ? "image_export" : event;
  if (ANALYTICS_EVENTS.includes(canonical as AnalyticsEvent)) trackAnalytics(canonical as AnalyticsEvent, properties);
}

export const trackAnalyticsEvent = trackEvent;

export function installAnalytics(): void {
  trackAnalytics("page_view");
  document.addEventListener("click", (event) => {
    const name = (event.target as Element).closest<HTMLElement>("[data-analytics-event]")?.dataset.analyticsEvent as AnalyticsEvent | undefined;
    if (name && ANALYTICS_EVENTS.includes(name)) trackAnalytics(name);
  });
}

function referrerHostname(): string | undefined {
  try { return document.referrer ? new URL(document.referrer).hostname : undefined; }
  catch { return undefined; }
}

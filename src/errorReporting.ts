import * as Sentry from "@sentry/browser";

export function initializeErrorReporting(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, environment: import.meta.env.MODE, sendDefaultPii: false,
    beforeBreadcrumb: breadcrumb => {
      const url = breadcrumb.data?.url;
      return typeof url === "string" && /(?:\/targets\/r\/|\/api\/catalog\/target-snapshots|#targets=)/.test(url) ? null : breadcrumb;
    },
    beforeSend: event => {
      if (event.request?.url && /(?:\/targets\/r\/|#targets=)/.test(event.request.url)) {
        event.request = {}; event.breadcrumbs = [];
      }
      return event;
    } });
  if (import.meta.env.DEV) (window as Window & { forceSentryTest?: () => void }).forceSentryTest = () => { throw new Error("Cosmic Atlas forced browser test"); };
}

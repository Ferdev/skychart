import * as Sentry from "@sentry/browser";

export function initializeErrorReporting(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, environment: import.meta.env.MODE, sendDefaultPii: false });
  if (import.meta.env.DEV) (window as Window & { forceSentryTest?: () => void }).forceSentryTest = () => { throw new Error("Cosmic Atlas forced browser test"); };
}

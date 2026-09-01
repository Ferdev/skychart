#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to the staging or production Postgres URL}"
days="${1:-7}"
[[ "$days" =~ ^[1-9][0-9]{0,2}$ ]] || { echo "Usage: $0 [days: 1-999]" >&2; exit 2; }
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v days="$days" <<'SQL'
SELECT event_name, count(*) AS events, count(DISTINCT anonymous_id) AS anonymous_visitors
FROM analytics_events WHERE inserted_at >= now() - (:'days' || ' days')::interval
GROUP BY event_name ORDER BY events DESC, event_name;

SELECT properties->>'referrer_surface' AS search_or_assistant_surface,
       count(*) AS events,
       count(DISTINCT anonymous_id) AS anonymous_visitors
FROM analytics_events
WHERE inserted_at >= now() - (:'days' || ' days')::interval
  AND properties ? 'referrer_surface'
GROUP BY properties->>'referrer_surface'
ORDER BY events DESC, search_or_assistant_surface;
SQL

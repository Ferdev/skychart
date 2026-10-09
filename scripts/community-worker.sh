#!/usr/bin/env bash
set -Eeuo pipefail
export COMMUNITY_WORKER=true
export SKY_EVENTS_REFRESH_ENABLED=false
export ERL_FLAGS="${ERL_FLAGS:-+S 2:2}"
/app/bin/starsmap_api eval 'StarsmapApi.Release.migrate_community()'
exec /app/bin/starsmap_api start

# syntax=docker/dockerfile:1

ARG ELIXIR_VERSION=1.18.4
ARG OTP_VERSION=27.3.4
ARG DEBIAN_VERSION=bookworm-20250520-slim

ARG ELIXIR_IMAGE="hexpm/elixir:${ELIXIR_VERSION}-erlang-${OTP_VERSION}-debian-${DEBIAN_VERSION}"
ARG DEBIAN_IMAGE="debian:${DEBIAN_VERSION}"

FROM node:22-bookworm-slim AS frontend
ARG VITE_SENTRY_DSN
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY public public
COPY src src
COPY data data
COPY backend_phoenix/priv backend_phoenix/priv
RUN npm run build:phoenix

FROM ${ELIXIR_IMAGE} AS builder

ARG MIX_ENV=prod
ENV MIX_ENV=${MIX_ENV}

RUN apt-get update -y && apt-get install -y build-essential git \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend_phoenix

RUN mix local.hex --force && mix local.rebar --force

COPY backend_phoenix/mix.exs backend_phoenix/mix.lock ./
RUN mix deps.get --only ${MIX_ENV}
RUN mkdir config
COPY backend_phoenix/config/config.exs backend_phoenix/config/${MIX_ENV}.exs config/
RUN mix deps.compile

COPY backend_phoenix/lib lib
COPY backend_phoenix/priv priv
COPY --from=frontend /app/backend_phoenix/priv/static priv/static
RUN mix compile

COPY backend_phoenix/config/runtime.exs config/
RUN mix release

FROM ${DEBIAN_IMAGE} AS runner

ARG MIX_ENV=prod
ENV MIX_ENV=${MIX_ENV}
ENV PHX_SERVER=true
ENV PORT=4000
ENV PYTHON_BACKEND_URL=http://127.0.0.1:8765

RUN apt-get update -y && \
  apt-get install -y libstdc++6 openssl libncurses6 locales ca-certificates curl python3 python3-venv postgresql-client \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home /app app

COPY --from=builder --chown=app:app /app/backend_phoenix/_build/${MIX_ENV}/rel/starsmap_api ./
COPY --chown=app:app backend backend
COPY --chown=app:app data data
COPY --chown=app:app requirements.txt requirements.txt
COPY --chown=app:app scripts/docker-entrypoint.sh scripts/docker-entrypoint.sh
COPY --chown=app:app scripts/import_catalogs_if_needed.sh scripts/import_catalogs_if_needed.sh
COPY --chown=app:app scripts/import_gaia_bulk_catalog.py scripts/import_gaia_bulk_catalog.py
COPY --chown=app:app scripts/build_static_point_tiles.py scripts/build_static_point_tiles.py
COPY --chown=app:app scripts/smp3.py scripts/smp3.py
COPY --chown=app:app scripts/build_static_tiles_if_needed.sh scripts/build_static_tiles_if_needed.sh
COPY --chown=app:app scripts/build_and_upload_static_tiles.sh scripts/build_and_upload_static_tiles.sh
COPY --chown=app:app scripts/compose_bulk_catalog_release.py scripts/compose_bulk_catalog_release.py
COPY --chown=app:app scripts/configure_catalog_bucket_cors.sh scripts/configure_catalog_bucket_cors.sh

RUN python3 -m venv /app/.venv && \
  /app/.venv/bin/pip install --no-cache-dir --upgrade pip && \
  /app/.venv/bin/pip install --no-cache-dir -r requirements.txt && \
  chown -R app:app /app && \
  chmod +x /app/scripts/docker-entrypoint.sh /app/scripts/import_catalogs_if_needed.sh /app/scripts/build_static_point_tiles.py /app/scripts/build_static_tiles_if_needed.sh /app/scripts/build_and_upload_static_tiles.sh /app/scripts/compose_bulk_catalog_release.py /app/scripts/configure_catalog_bucket_cors.sh && \
  ln -s /app/erts-*/bin/epmd /usr/local/bin/epmd

USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

EXPOSE 4000

CMD ["/app/scripts/docker-entrypoint.sh"]

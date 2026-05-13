# Deployment

SkyChart deploys from GitHub Actions by branch:

- `trunk` deploys to `https://staging.skychart.org`
- `production` deploys to `https://skychart.org`

The deploy workflow uploads the repository to the server over SSH, builds the Phoenix-served frontend, runs Phoenix migrations/catalog import, updates the `current` symlink, and restarts the configured systemd services.

## Required GitHub secrets

Common secrets:

- `DEPLOY_SSH_KEY`: private SSH key accepted by the deploy user on the server.
- `DEPLOY_SSH_HOST`: fallback SSH host, used when environment-specific host is absent.
- `DEPLOY_SSH_USER`: fallback SSH user.
- `DEPLOY_SSH_PORT`: optional fallback SSH port; defaults to `22`.

Staging secrets:

- `STAGING_DEPLOY_PATH`, for example `/srv/skychart/staging`
- `STAGING_SSH_HOST` and `STAGING_SSH_USER` if different from the common values
- `STAGING_SSH_PORT` if different from the common value
- `STAGING_PHOENIX_SERVICE`, for example `skychart-staging-phoenix.service`
- `STAGING_PYTHON_SERVICE`, for example `skychart-staging-python.service`

Production secrets:

- `PRODUCTION_DEPLOY_PATH`, for example `/srv/skychart/production`
- `PRODUCTION_SSH_HOST` and `PRODUCTION_SSH_USER` if different from the common values
- `PRODUCTION_SSH_PORT` if different from the common value
- `PRODUCTION_PHOENIX_SERVICE`, for example `skychart-production-phoenix.service`
- `PRODUCTION_PYTHON_SERVICE`, for example `skychart-production-python.service`

## Server-side environment

Each deploy path may include a shared `.env` file loaded by `scripts/deploy-remote.sh` before build/migration:

```bash
# /srv/skychart/staging/.env or /srv/skychart/production/.env
DATABASE_URL=ecto://USER:PASS@127.0.0.1/DB_NAME
SECRET_KEY_BASE=...
PYTHON_BACKEND_URL=http://127.0.0.1:8765
POOL_SIZE=10
```

The workflow sets `PHX_HOST` automatically:

- staging: `staging.skychart.org`
- production: `skychart.org`

## Server layout

The workflow creates this structure under each deploy path:

```text
/srv/skychart/staging/
  .env
  current -> releases/<git-sha>
  releases/<git-sha>/
  shared/
```

Systemd units should run from the `current` symlink so each deploy can atomically switch releases.

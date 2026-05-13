# Deployment

SkyChart deploys with Kamal from GitHub Actions:

- `trunk` deploys to `https://staging.skychart.org`
- `production` deploys to `https://skychart.org`

The image is published to GHCR as `ghcr.io/ferdev/skychart`. Kamal runs one Phoenix/Python container per environment plus one Postgres accessory per environment.

## Branches

```bash
# staging
git push origin trunk

# production
git checkout production
git merge trunk
git push origin production
```

## Required GitHub secrets

- `SSH_PRIVATE_KEY`: private key accepted by `deploy@5.161.73.221`.
- `SECRET_KEY_BASE`: Phoenix secret key base.
- `POSTGRES_PASSWORD`: password for the Kamal Postgres accessories.
- `KAMAL_REGISTRY_PASSWORD`: optional; defaults to the GitHub Actions token if absent.

The workflows derive each `DATABASE_URL` from `POSTGRES_PASSWORD`:

- staging: `ecto://skychart:<password>@skychart-staging-postgres/skychart`
- production: `ecto://skychart:<password>@skychart-production-postgres/skychart`

## Kamal commands

From a machine with the deploy SSH key and GHCR credentials:

```bash
kamal accessory boot postgres -d staging
kamal deploy -d staging
kamal app logs -d staging

kamal accessory boot postgres -d production
kamal deploy -d production
kamal app logs -d production
```

## Runtime shape

The Docker image contains:

- Phoenix release from `backend_phoenix/`
- built frontend assets served by Phoenix
- Python ephemeris backend from `backend/server.py`
- catalog snapshots under `data/`
- catalog import helpers under `scripts/`
- `postgresql-client` for streaming large Gaia imports into Postgres

Container startup does:

1. start the Python backend on `127.0.0.1:8765`
2. run Phoenix migrations
3. import catalog snapshots into Postgres
4. start Phoenix on `PORT=4000`

After each Kamal deploy, `.kamal/hooks/post-deploy` runs `scripts/import_catalogs_if_needed.sh` once on the primary app container. That script rechecks migrations and catalog snapshots, then imports the two large Gaia slices only when their catalog groups are below the expected row counts:

- `gaia_500pc_stars`: `1,597,012` rows from the current Gaia TAP sync import.
- `gaia_10kpc_bright_stars`: `1,339,910` rows from the current Gaia TAP sync import.

Normal deploys skip the Gaia network import after those slices are already present. First-time environments can take much longer, so deploy workflows allow up to 180 minutes.

Kamal health checks hit `/api/health`.

## Domains

Kamal proxy handles:

- staging: `staging.skychart.org`
- production: `skychart.org`

The Hetzner Caddy edge proxy must route those hosts to Kamal proxy, matching the existing SwarmKit/Taleomatic/Estimo setup.

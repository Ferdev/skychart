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
- `CATALOG_TILE_AWS_ACCESS_KEY_ID`: S3-compatible access key for the static tile bucket.
- `CATALOG_TILE_AWS_SECRET_ACCESS_KEY`: S3-compatible secret key for the static tile bucket.

## Required GitHub variables

- `CATALOG_TILE_PUBLIC_BASE_URL`: public CDN/object-storage base URL ending in the active catalog version, for example `/catalog-tiles/v1`.
- `CATALOG_TILE_MANIFEST_URL`: production manifest URL, usually `CATALOG_TILE_PUBLIC_BASE_URL + /manifest.json`.
- `STAGING_CATALOG_TILE_MANIFEST_URL`: optional staging manifest URL. Staging and production may point at the same immutable manifest after a catalog release is verified.
- `CATALOG_TILE_S3_BUCKET`: object-storage bucket name.
- `CATALOG_TILE_S3_ENDPOINT_URL`: S3-compatible endpoint URL.
- `CATALOG_TILE_S3_REGION`: S3-compatible region for the bucket endpoint.
- `CATALOG_TILE_S3_ACL`: optional ACL, for providers that require `public-read`.

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
- static point-tile builders and S3-compatible upload tooling for the WebGL catalog layer

Container startup does:

1. start the Python backend on `127.0.0.1:8765`
2. run Phoenix migrations
3. import catalog snapshots into Postgres
4. start Phoenix on `PORT=4000`

After each Kamal deploy, `.kamal/hooks/post-deploy` runs `scripts/import_catalogs_if_needed.sh` once on the primary app container. That script rechecks migrations and catalog snapshots, then imports the two large Gaia slices only when their catalog groups are below the expected row counts:

- `gaia_500pc_stars`: `1,597,012` rows from the current Gaia TAP sync import.
- `gaia_10kpc_bright_stars`: `1,339,910` rows from the current Gaia TAP sync import between 500 pc and 10 kpc. The Gaia preflight query can report a much larger theoretical count than the importer can materialize safely on the shared production volume; normal deploys should skip once this operational baseline is present.

Normal deploys skip the Gaia network import after those slices are already present. Static point tiles are not built during normal app startup or post-deploy maintenance because a multi-million-row tile build is CPU, disk, and inode heavy. Build and upload them as a controlled one-off job after the new image is running, then verify the CDN manifest before judging the point-layer path. First-time environments can take much longer, so deploy workflows allow up to 180 minutes.

Useful import/tile environment switches:

- `GAIA_500PC_MIN_COUNT` overrides the expected 500 pc Gaia slice count.
- `GAIA_10KPC_MIN_COUNT` overrides the expected 10 kpc Gaia slice count.
- `CATALOG_IMPORT_SUMMARY=0` skips the final summary print during debugging.
- `CATALOG_IMPORT_VACUUM=0` skips post-import `VACUUM ANALYZE`.
- `CATALOG_STATIC_TILES=1` opts the import wrapper into static point-tile generation. Leave this unset during normal deploys.
- `CATALOG_TILE_OUTPUT_DIR=/path/to/catalog-tiles/v1` overrides the static tile output directory.
- `CATALOG_TILE_PUBLIC_BASE_URL=https://.../catalog-tiles/v1` controls the tile URL template written into the manifest.
- `CATALOG_TILE_S3_PREFIX=catalog-tiles/v1` controls where the CDN tile files are uploaded inside the bucket.

- `CATALOG_DYNAMIC_POINT_FALLBACK=1` re-enables `/api/catalog/points.bin` when `CATALOG_TILE_MANIFEST_URL` is configured. Leave this unset in staging/production so a static-manifest deployment cannot silently fall back to Postgres-backed rendering.

Preferred shared catalog tile release and CDN upload:

1. Deploy the app image normally to the environment whose database should be used as the catalog source.
2. Run the manual `Build Catalog Tiles` GitHub workflow.
   - Choose `target_environment=staging` to build from staging data, or `production` to build from production data.
   - Choose an immutable `catalog_version` such as `v2`; the default upload path is `catalog-tiles/<catalog_version>`.
3. Verify `CATALOG_TILE_PUBLIC_BASE_URL/manifest.json` returns `200` and has the expected source counts.
4. Set or confirm the staging/production manifest vars point at the desired immutable manifest:
   - `STAGING_CATALOG_TILE_MANIFEST_URL=https://.../catalog-tiles/v2/manifest.json`
   - `CATALOG_TILE_MANIFEST_URL=https://.../catalog-tiles/v2/manifest.json`
5. Re-run the environment deploy so Phoenix injects the selected manifest URL into the HTML.

Staging and production should keep separate writable Postgres databases. Do not point both apps at the same writable DB: staging migrations/importers can then mutate production state. Share the large visual catalog through immutable CDN tile artifacts instead. If a future dedicated catalog database is needed, expose it read-only to apps and version its schema separately from runtime app migrations.

The live CDN v1 manifest may still contain the older sparse sampling until the manual tile workflow is rerun with a new immutable version such as `v2`. The tile workflow runs `scripts/build_and_upload_static_tiles.sh` through Kamal on the primary app container for the selected environment, with:

- a process lock so two tile jobs cannot build at once
- `nice` priority, defaulting to `15`
- `--skip-if-current`, so a current manifest only uploads existing files and does not stream the catalog again
- immutable cache headers for `.bin` files
- short cache headers for `manifest.json`

Equivalent manual command:

```bash
kamal app exec -d production --primary --reuse \
  --env AWS_ACCESS_KEY_ID:... \
  --env AWS_SECRET_ACCESS_KEY:... \
  --env CATALOG_TILE_S3_BUCKET:... \
  --env CATALOG_TILE_S3_ENDPOINT_URL:... \
  --env CATALOG_TILE_S3_REGION:... \
  --env CATALOG_TILE_PUBLIC_BASE_URL:https://cdn.example.com/catalog-tiles/v1 \
  --env CATALOG_TILE_S3_PREFIX:catalog-tiles/v1 \
  --env CATALOG_TILE_NICE:15 \
  -- ./scripts/build_and_upload_static_tiles.sh
```

That command only builds the static tile pyramid and uploads it. It does not rerun imports, migrations, or vacuum. The builder writes to a temporary sibling directory and atomically replaces the active `catalog-tiles/v1` directory when complete.

The bucket/CDN must allow browser `GET` and `HEAD` requests for `manifest.json` and `.bin` tile files from `https://skychart.org` and any staging origin that uses the same tile set.

Kamal health checks hit `/api/health`.

## Domains

Kamal proxy handles:

- staging: `staging.skychart.org`
- production: `skychart.org`

The Hetzner Caddy edge proxy must route those hosts to Kamal proxy, matching the existing SwarmKit/Taleomatic/Estimo setup.

# Deployment

SkyChart uses Kamal and GitHub Actions:

- pushes to `trunk` deploy `https://staging.skychart.org`;
- pushes to `production` deploy `https://skychart.org`;
- the manual `Build Catalog Tiles` workflow publishes immutable tile
  artifacts independently of application deploys.

Deployment targets and credentials are intentionally kept out of the
repository.

## GitHub secrets

The shared SSH secrets belong at repository scope so staging, production, and
manual catalog workflows resolve the same pinned target identity.

- `DEPLOY_HOST`: SSH hostname or address used by Kamal.
- `DEPLOY_USER`: restricted SSH deployment account.
- `SSH_PRIVATE_KEY`: private key for the deployment account.
- `SSH_KNOWN_HOSTS`: pinned OpenSSH `known_hosts` entry for `DEPLOY_HOST`.
- `SECRET_KEY_BASE`: Phoenix signing secret.
- `ANALYTICS_HASH_SALT`: random salt for rotating anonymous analytics IDs.
- `POSTGRES_PASSWORD`: production Postgres password.
- `STAGING_DATABASE_URL`: read-only catalog database URL for staging.
- `SENTRY_DSN`: server error-reporting DSN.
- `KAMAL_REGISTRY_PASSWORD`: optional GHCR credential; workflows can use the
  GitHub Actions token when it is absent.
- `CATALOG_TILE_AWS_ACCESS_KEY_ID` and
  `CATALOG_TILE_AWS_SECRET_ACCESS_KEY`: object-storage credentials for tile
  publication.

`SSH_KNOWN_HOSTS` must be provisioned through a trusted channel and updated
deliberately when the server host key changes. Workflows enforce strict host
verification and do not discover or accept a key during deployment.

## GitHub variables

- `CATALOG_TILE_PUBLIC_BASE_URL`
- `CATALOG_TILE_MANIFEST_URL`
- `STAGING_CATALOG_TILE_MANIFEST_URL`
- `CATALOG_TILE_CARRY_FORWARD_MANIFEST_URL`, an audited release containing the
  immutable Gaia, DESI, and Quaia bulk layers. When omitted, the tile workflow
  uses `CATALOG_TILE_MANIFEST_URL`.
- `CATALOG_TILE_S3_BUCKET`
- `CATALOG_TILE_S3_ENDPOINT_URL`
- `CATALOG_TILE_S3_REGION`
- `CATALOG_TILE_S3_ACL` when required by the storage provider

Tile URLs should point at immutable version paths. Staging and production may
share the same verified artifact without sharing a writable database role.

## Branch promotion

```bash
# Stage and test the candidate.
git push origin trunk

# After staging and CI pass, promote the exact tested history.
git switch production
git merge --no-ff trunk
git push origin production
git switch trunk
```

## Local Kamal use

Kamal reads `DEPLOY_HOST` and `DEPLOY_USER` from the environment. SSH key
selection remains local OpenSSH configuration rather than a tracked path.

```bash
export DEPLOY_HOST=your-deploy-host
export DEPLOY_USER=your-deploy-user

kamal deploy -d staging
kamal app logs -d staging

kamal accessory boot postgres -d production
kamal deploy -d production
kamal app logs -d production
```

## Runtime shape

The image contains the Phoenix release, compiled frontend, internal Python
scientific service, catalog snapshots, import helpers, and tile tooling.
Container startup binds Python internally and exposes Phoenix on the configured
application port. Kamal proxy performs the external health check at
`/api/health`.

Production owns schema migrations and catalog imports. Staging uses a
read-only database role, disables analytics writes and sky-event refresh, and
does not run migrations or imports. This allows staging code to be tested
without mutating production data.

The post-deploy hook runs `scripts/import_catalogs_if_needed.sh` for production
only. It is idempotent and skips catalog groups that already meet their
validated minimum counts. Expensive static tile builds are never part of the
normal deployment path.

## Catalog tile release

1. Deploy and verify the application image.
2. Run the manual `Build Catalog Tiles` workflow against the intended source
   environment and choose a new immutable version. The workflow replaces the
   searchable-database Gaia subset with the audited bulk Gaia layer and carries
   DESI and Quaia forward; publication fails if those layers are missing or
   below their validated minimum counts.
3. Verify the published `manifest.json`, byte-range support, CORS headers,
   source counts, and representative tiles.
4. Update the staging manifest variable and verify rendering.
5. Point production at the same immutable manifest after staging passes.

The workflow serializes host-writing jobs so a deployment cleanup cannot race
an active tile build.

## Rollback

Application releases are rolled back with Kamal using the previous healthy
image. Catalog tiles are rolled back by restoring the previous immutable
manifest URL; existing versioned artifacts are not overwritten.

Before rollback, capture the failing release identifier and relevant logs.
After rollback, verify `/api/health`, the root page, catalog search, one object
page, and a representative static tile range request.

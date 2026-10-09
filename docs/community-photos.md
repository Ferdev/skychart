# Astronomy photo community

The community is behind `COMMUNITY_ENABLED`. The default is `false`. Browsing the
atlas remains public. Publishing and voting use verified email accounts.

The implementation includes object galleries, public photo and photographer
pages, map/Sky/3D cards, direct uploads, review and report queues, account export
and removal, appreciation votes, object covers, global and photographer rankings,
and a list of deep-sky objects that have no photo. The client refreshes the compact
cover index every 60 seconds. Movement uses existing positions and makes no photo
index request. The photos layer is stored in the `L=` URL parameter.

## Data and identity

`CommunityRepo` uses a separate database. Its migrations are in
`backend_phoenix/priv/community_repo/migrations`. The catalog repo and staging's
read-only catalog credentials are unchanged. Community migrations run before the
web or worker release starts. Ecto holds the migration lock. Migrations are additive.

`subjects` and `subject_keys` own photo identity. `declared_key` records the author's
selected key. The identity file contains 104 reciprocal Messier/OpenNGC groups,
reviewed M31/M87 aliases, and 24 Solar System targets. Run
`python3 scripts/build_object_identity_groups.py` to reproduce it. A missing source
row does not remove an existing subject. New bulk and transient preview targets
are rejected. Core bodies have public object pages without invented coordinates.

## Local setup

Install PostgreSQL and `libvips-tools`. Use the project's Node and Elixir toolchain.
For the task container, prefix Mix commands with
`ERL_FLAGS='+S 2:2' mise exec elixir@1.15.8 erlang@26.2.5.21 --`.

Create a separate local database, then configure the local service:

```bash
createdb -U postgres starsmap_community_dev
export COMMUNITY_ENABLED=true
export COMMUNITY_DATABASE_URL=postgresql://postgres@localhost/starsmap_community_dev
export COMMUNITY_PGSOCKET_DIR=/var/run/postgresql  # local socket, if needed
export COMMUNITY_ORIGIN=http://127.0.0.1:4020
export COMMUNITY_SECRET="$(openssl rand -hex 32)"
export COMMUNITY_MEDIA_ROOT=/tmp/cosmic-atlas-community
export COMMUNITY_STORAGE=local
cd backend_phoenix
mix ecto.migrate -r StarsmapApi.CommunityRepo
PORT=4020 mix phx.server
```

The local adapter issues a 15-minute, write-once upload URL. Run a second release
process with `COMMUNITY_WORKER=true` to process jobs. Its HTTP endpoint is disabled.
Use the same secret, database and media root. A webhook mail service must be
configured for interactive sign-in. Tests substitute mail delivery and use real
PostgreSQL and libvips; they never send mail. The Vite server proxies community
routes to Phoenix.

## Production and staging configuration

Each environment needs its own writable community database, media bucket,
credentials, session secret, and backup destination. Do not point either community
repo at the catalog database. The runtime rejects matching database host/name
pairs and rejects local storage in production.

Set the corresponding `STAGING_` or `PRODUCTION_` GitHub variables/secrets below.
`COMMUNITY_ENABLED` defaults to `false` in both deployment workflows. Set it to
`true` only after the external services and recovery proof are ready.

| Setting | Type | Purpose |
| --- | --- | --- |
| `COMMUNITY_ENABLED` | variable | Feature switch |
| `COMMUNITY_DATABASE_URL` | secret | Separate writable database |
| `COMMUNITY_SECRET` | secret | At least 32 random bytes; different per environment |
| `COMMUNITY_ORIGIN` | variable | Exact HTTPS origin, with no path or trailing slash |
| `COMMUNITY_S3_BUCKET` | secret | Dedicated media bucket |
| `COMMUNITY_S3_ACCESS_KEY_ID`, `COMMUNITY_S3_SECRET_ACCESS_KEY` | secrets | Media credentials |
| `COMMUNITY_S3_ENDPOINT`, `COMMUNITY_S3_REGION` | variables | S3-compatible endpoint and region |
| `COMMUNITY_MEDIA_URL` | variable | Separate HTTPS media/CDN origin |
| `COMMUNITY_MAIL_URL`, `COMMUNITY_MAIL_TOKEN` | variable, secret | HTTPS mail webhook and Bearer token |
| `COMMUNITY_BACKUP_URI`, `COMMUNITY_BACKUP_ENDPOINT` | variables | Off-host backup prefix and S3 endpoint |
| `COMMUNITY_BACKUP_SECRET` | secret | Independent backup encryption password |
| `COMMUNITY_BACKUP_ACCESS_KEY_ID`, `COMMUNITY_BACKUP_SECRET_ACCESS_KEY` | secrets | Separate backup credentials |

The webhook receives JSON `{email, code, expires_in: 600}`. It must send the
six-digit code to that address and return HTTP 2xx. It must not log the code.
Email enumeration responses are generic. Codes expire after ten minutes and five
failed attempts. The database limits requests to ten per email per rolling day.
Sessions expire after 30 days and are revocable. Production cookies are HttpOnly,
Secure, SameSite=Lax and have the `__Host-` prefix. Every write checks the exact
origin. Authenticated writes also require a session-bound CSRF token and JSON.

Bucket prefixes:

- `uploads/`: private incoming bytes. Use a seven-day lifecycle for abandoned
  uploads as a second control.
- `masters/`: private metadata-stripped master and private derivatives.
- `public/`: only approved WebP derivatives. The CDN can read this prefix only.

Permit browser PUT from the exact application origin, including `If-None-Match`.
The signed PUT fixes the content length and requires a new object. The browser
sets Content-Length from its File body; do not set that forbidden header in JS.
Verify conditional PUT support with the selected S3 provider. Return
`Access-Control-Allow-Origin: *` for public GET/HEAD images. Do not make incoming
uploads or masters public. Application media routes check current publication
before a CDN redirect. Public images use content hashes and a 60-second cache
lifetime. Takedown removes gallery/index entries immediately; the separate
`publish` queue removes public objects. Monitor its queue age and failures. A
previously downloaded copy cannot be recalled. Purge a CDN cache when its operator
requires a separate purge in addition to deleting its origin object.

Kamal adds `community_worker` only when the feature is enabled. The worker has
one CPU and a 1152 MiB memory limit, one `media` job and one small `publish` job at
a time. libvips and solve processes are limited to 768 MiB each and run in the
serial media queue. Scratch files are removed on success and failure. Solver
index files are not included in the image.

## Upload policy and moderation

JPEG, PNG and single-frame TIFF: at most 60,000,000 bytes and 120,000,000 pixels.
Each account can reserve 20 uploads per rolling 24 hours. The author must confirm
publishing rights, choose a licence, and enter a capture time. Synthetic AI images
are not accepted. Composite/strong processing must be declared. Capture time is
UTC. The first three published photos need review; later photos publish after
processing. Rejected submissions do not count as approvals.

The worker verifies signatures/dimensions, converts to sRGB, strips metadata,
keeps a full-resolution PNG master, and makes WebP images of 96, 320 and 1600 px.
Source ETags freeze S3 inputs; completion is idempotent. SHA-256, a luminance
similarity hash and a dominant color are recorded. A similarity hash is a review
signal, not proof of ownership. Successful sources are removed after seven days.
Abandoned and failed uploads are also cleaned daily. Account removal revokes
sessions, anonymizes identity, hides public photos and queues removal of all media.

Grant the first moderator role after the owner has verified their account:

```elixir
StarsmapApi.Release.community_role("owner-handle", "admin")
```

This is an operator release command, not a public API. The Review dialog supports
approvals, reports, hiding, rejection, account suspension/restoration and vote
cancellation. Each action has a reason and an audit record. Authors see the latest
moderation reason in their private account data. The terms/rules/privacy/takedown
pages are initial product texts. Add the operator contact and obtain legal review
before opening public registration.

## Permission-reviewed seed photos

Use a JSON manifest with at most 100 entries. Authors must exist in the community
database. Each entry supplies `file`, `author_handle`, `key`, `title`, `caption`,
`captured_at` (ISO UTC), `licence`, `equipment`, `processing`, `composite`, and
`rights_confirmed: true`. Use only photos whose display rights were reviewed.
Do not use generated test images as public astronomy content.

Run with queues disabled in the importing process:

```elixir
StarsmapApi.Release.import_community("/private/seed-photos.json", "owner-handle")
```

This uses the same quota, decode, storage and moderation path as an upload. It
keeps the declared target and credits. Initial real photos are an external input;
this change does not add images from photographers without permission.

## Rankings

Ranking version 1 uses one positive vote per user/photo. Self-votes and votes from
accounts younger than 24 hours fail. Vote number k from a voter to a photographer
has weight 1/k, ordered by timestamp and UUID. Object covers use total weight,
then publication time and UUID. Trending uses a 72-hour half-life and at least
three voters. Photographer listings use the weighted h-index, then cover count,
first-photo count, and handle. First-photo credit is recorded once per subject.
Hidden or removed photos do not display the credit. Scores are calculated from durable votes; covers are transactionally
updated after votes, removals and suspension. No popularity value changes the
scientific catalog. A stable choice per browser session gives recent photos 15% of subject-card
exposure for seven days. It does not change gallery ranks. Ranking version-one
snapshots run every ten minutes; public reads still check current visibility.

## Astrometry

Authors can supply a square-pixel TAN solution in ICRS/J2000. Other projections,
invalid extents and fields wider than 30 degrees are rejected. A bounded optional
Astrometry.net adapter uses a 1600 px derivative, a 30-second CPU limit and a
45-second wall limit. Install `solve-field` and an index volume separately. A
missing or failed solver leaves the ordinary object-linked photo usable.

Solver results retain the CD matrix and reference pixel, including parity and
noncentral reference pixels. SIP/distorted solutions are not shown as TAN. Named
Messier/OpenNGC context labels are limited to 50 per image from at most 1000
candidates. They are annotations, not measurements or a complete source extract.
The Sky view shows labelled footprints from Earth only. The 3D view can show one
selected static photo plane at its catalog distance, labelled “view from Earth”.
Moving bodies stay cards. Survey comparison opens the existing credited DSS2
field separately; orientation can differ. Opacity does not alter catalog data.

## Backup and recovery

The worker schedules an encrypted off-host custom-format database dump daily at
02:00 UTC when `COMMUNITY_BACKUP_URI` is configured. Media storage needs its own
versioning/backup policy. Keep the encryption secret outside the database and
media credentials. Monitor failed Oban jobs and prove recovery before activation.

```bash
bash scripts/community-backup.sh backup /private/community.dump.gpg
# Set a distinct, empty recovery database URL. This command refuses a populated DB.
export COMMUNITY_RESTORE_TEST_URL=postgresql://recovery-host/community_recovery
bash scripts/community-backup.sh restore-test /private/community.dump.gpg
```

Use an isolated recovery environment weekly. Verify photo/vote/subject counts,
private media integrity, and the latest takedown audit against the current system
before promoting restored data. The restore test prints counts and migration IDs.
The repository does not provision paid backup storage or modify production.

## Verification and activation inputs

Run `npm run build:phoenix`, `npm run test:community`, the Python guardrails, Mix
compile/tests, and the community smoke/mobile browser specs with one worker in a
small container. Browser tests use transport fixtures. Backend tests use real
PostgreSQL, real image processing and a mail stub. Exercise real presigned S3 PUT,
CDN headers, real email, solver indexes, worker restart and recovery on staging
before activation. No production deployment or paid service creation is part of
this repository change.


## Local verification record (2026-10-08)

- The Phoenix suite passes 143 tests against PostgreSQL. Frontend builds and all
  Node test scripts pass. The Python suite passes 147 tests and four subtests;
  one existing offline catalog test is skipped because DuckDB is not installed.
- Real libvips tests cover a 52.8 MB 16-bit TIFF, full-resolution output, private
  text removal, derivative limits, excessive pixels, false types and multi-page
  TIFF rejection. A serial stress run accepts 16 large TIFF fixtures and rejects
  four invalid fixtures across 20 jobs. It takes 94.2 seconds, with a measured
  child-process peak of 66.77 MiB and fixture/scratch peak of 50.65 MiB. These are
  constructed fixtures, not a proof for every possible decoder input.
- An encrypted dump restores two photos, one vote, one subject and a removal
  audit into an empty isolated database. Photo, vote and audit contents match
  their source. The temporary recovery databases were then removed.
- Seven community browser checks cover desktop, mobile, all nine locales and
  performance, using API transport fixtures. A comparison with
  200 photo subjects displays at most 24 map cards and makes zero photo-index
  requests during navigation. The final comparison records p95 frame intervals
  of 378.2 ms without photos and 387.6 ms with photos; medians are 202.6 ms and
  278.6 ms. The relative p95 guard passes. Repeat the comparison on staging;
  this task container has a shared CPU and does not represent production speed.
- Live S3 conditional PUT/CORS/CDN behavior, mail delivery, solver indexes,
  container deploy size, host capacity, worker restart and production/staging
  recovery remain activation checks. No live deployment was performed.

## Operator usage checks

Each upload reserves bytes against the daily account limit, including unfinished
uploads. There is no separate monthly account allowance in this release. Inspect
rolling usage in the community database:

```sql
SELECT status, count(*) AS uploads, sum(size_bytes) AS reserved_upload_bytes
FROM photos WHERE inserted_at > now() - interval '30 days' GROUP BY status;
SELECT count(*) AS failed_jobs FROM oban_jobs WHERE state IN ('discarded', 'retryable');
```

Reserved source bytes differ from stored master/derivative bytes. Check the media
provider's prefix totals, lifecycle status and billing for actual storage cost.
Budget the full-resolution private masters and keep alerts for failed jobs and
public deletion queue age. Similarity hashes are available in `photos.assets`
for moderator investigation; they do not prove copyright ownership.

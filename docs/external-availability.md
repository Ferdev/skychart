# External availability check

Definition of done: a runner outside the apps server checks the public HTTPS
health endpoint, accepts only the expected healthy JSON, and reports transport,
HTTP, or application failures as a failed workflow. A normal check should take
less than a minute. It reads no account data and changes no production state.

The scheduled GitHub Actions workflow runs every 15 minutes and can also be
dispatched manually. It uses a GitHub-hosted runner, so failure of the apps host
does not also stop this check. Scheduling is best effort. Failed runs appear in
Actions; email delivery depends on the user's GitHub notification settings and
has not been verified. This check covers the public SkyChart API, not every app
or an authenticated user journey.

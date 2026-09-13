# Session 1271 measurement recovery

This directory records the restart contract for the long-running storage audit.
It contains no credentials and does not authorize new catalogue scope, imports,
deployments, infrastructure, or spending.

The Apps Server jobs are installed as persistent system units from `systemd/`.
The matching tmpfiles rule excludes their owned scratch tree from age-based
cleanup. The scripts themselves enforce exclusive writer locks, pinned inputs,
durable per-partition receipts, and the 60 GiB free-space floor.

Install or repair without restarting healthy jobs:

```sh
sudo install -m 0644 systemd/*.service /etc/systemd/system/
sudo install -m 0644 tmpfiles.d/skychart-storage-1271.conf /etc/tmpfiles.d/
sudo systemctl daemon-reload
sudo systemctl enable \
  skychart-storage-1271-allwise-full-v2.service \
  skychart-storage-1271-allwise-packed-full-v2.service \
  skychart-storage-1271-allwise-mep-full-v1.service \
  skychart-storage-1271-allwise-reject-full-v1.service \
  skychart-storage-1271-legacy-tractor-full.service
```

Do not issue `restart` against a healthy unit. Read `jobs.json`, verify the
current full PID and service identity, then inspect its receipt/progress file.
An `active (exited)` unit with `RemainAfterExit=yes` is complete, while an
`active (running)` unit is still working.

Gaia currently runs in the retained Rondar task container and writes to the
durable `rondar-production-task-1271-workspace` volume. Its receipt-validated
script is resumable, but it is not yet independently restarted after a Docker
host reboot. Keep the container and volume retained. Before any restart, verify
that no writer owns `data/storage-exhaustive-1271/gaia-full/.lock`, then resume
the exact command in `jobs.json`; never start a second writer.

Routine status collection must read machine state directly. It must not wake a
model merely because a timer elapsed. Resume the assistant only for a completed
campaign, a bounded failure requiring diagnosis, an actionable dependency, or
a real user message.

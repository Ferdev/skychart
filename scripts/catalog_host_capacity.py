#!/usr/bin/env python3
"""Read-only Linux capacity report. Run on the intended import host.

Optional arguments are existing directories on intended catalog storage volumes.
Does not connect to a database, enumerate credentials, allocate storage or import.
Running inside a container reports that execution context, not the remote host.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess


def read_optional(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None


def report(paths):
    memory = {}
    for line in (read_optional('/proc/meminfo') or '').splitlines():
        key, value = line.split(':', 1)
        if key in {'MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'}:
            memory[key + '_bytes'] = int(value.split()[0]) * 1024
    docker = {'root': None, 'availability': 'not_installed'}
    if shutil.which('docker'):
        try:
            result = subprocess.run(
                ['docker', 'info', '--format', '{{json .DockerRootDir}}'],
                capture_output=True, text=True, timeout=15, check=False)
            if result.returncode == 0:
                docker = {'root': json.loads(result.stdout), 'availability': 'readable'}
            else:
                docker['availability'] = 'unavailable_or_not_permitted'
        except (subprocess.TimeoutExpired, OSError, ValueError):
            docker['availability'] = 'unavailable_or_invalid_report'
    if docker['root']:
        paths = [*paths, docker['root']]
    filesystems = []
    for path in dict.fromkeys(paths):
        try:
            usage = shutil.disk_usage(path)
            filesystems.append(dict(path=path, total_bytes=usage.total,
                                    used_bytes=usage.used, free_bytes=usage.free,
                                    device=os.stat(path).st_dev))
        except OSError:
            filesystems.append(dict(path=path, availability='unreadable'))
    return {
        'schema_version': 1,
        'observed_at': datetime.now(timezone.utc).isoformat(),
        'execution_context': 'machine/container where this command runs; verify it is the intended import host',
        'logical_cpus': os.cpu_count(),
        'memory': memory,
        'cgroup_v2': {name: read_optional('/sys/fs/cgroup/' + name)
                      for name in ('cpu.max', 'memory.max', 'memory.current')},
        'filesystems': filesystems,
        'docker': docker,
        'capacity_approved': False,
        'notes': [
            'Filesystem entries with the same device share capacity; do not add them together.',
            'Cgroup limits can be lower than machine totals; inspect the actual import execution context.',
            'Free disk is shared headroom, not a reservation for catalog imports.',
            'Database placement, container limits, competing workloads and import throughput still require assessment.'
        ]
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='*', default=['/'])
    args = parser.parse_args()
    print(json.dumps(report(args.paths), indent=2))

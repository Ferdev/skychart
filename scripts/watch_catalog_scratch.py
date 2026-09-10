#!/usr/bin/env python3
"""Read-only sampled disk high-water report for one investigation process.

Includes open unlinked temporary files via /proc, which directory totals miss.
Does not establish an exact instantaneous peak between samples.
"""
import argparse
import json
import os
from pathlib import Path
import time
from investigate_catalog_storage import footprint


def watch(pid, root, output, interval=.1, max_seconds=1300):
    if interval<=0 or max_seconds<0:raise ValueError('invalid observation interval/duration')
    proc=Path('/proc')/str(pid)
    command=(proc/'cmdline').read_bytes()
    if not any(name in command for name in (b'measure_xsc_partitions.py',b'measure_gaia_full_partitions.py')):
        raise ValueError('only investigation-owned catalog measurement processes may be observed')
    started=time.monotonic();samples=0
    peak={'logical_bytes':0,'allocated_bytes':0,'open_unlinked_bytes':0}
    while proc.exists() and (not max_seconds or time.monotonic()-started<max_seconds):
        sizes=footprint(root)
        unlinked={}
        try:
            for fd in (proc/'fd').iterdir():
                try:
                    st=fd.stat()
                    if st.st_nlink==0 and st.st_size>0:
                        unlinked[(st.st_dev,st.st_ino)]=st
                except OSError:pass
        except OSError:pass
        extra=sum(st.st_size for st in unlinked.values())
        sizes['logical_bytes']+=extra
        sizes['allocated_bytes']+=sum(st.st_blocks*512 for st in unlinked.values())
        sizes['open_unlinked_bytes']=extra
        for key in peak:peak[key]=max(peak[key],sizes[key])
        samples+=1
        checkpoint={'pid':pid,'scope':'owned root plus observed process unlinked files; other directories excluded',
                    'sample_interval_ms':interval*1000,'samples':samples,'observed_peak':peak,
                    'observed_seconds':time.monotonic()-started,'instantaneous_peak_exact':False,
                    'note':'Monitoring started after the worker; earlier and between-sample peaks are unmeasured.'}
        temporary=output.with_suffix('.json.tmp');temporary.write_text(json.dumps(checkpoint,indent=2)+'\n');temporary.replace(output)
        time.sleep(interval)
    result={'scope':'investigation filesystem plus open unlinked files of the observed process; Postgres separate',
            'sample_interval_ms':interval*1000,'samples':samples,'observed_seconds':time.monotonic()-started,
            'observed_peak':peak,'instantaneous_peak_exact':False,
            'note':'Monitoring began after the build started; early transient allocations and between-sample peaks remain unmeasured.'}
    output.write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('pid',type=int);p.add_argument('root',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--interval',type=float,default=.1)
    p.add_argument('--seconds',type=float,default=1300,help='0 observes until the process exits')
    a=p.parse_args();print(json.dumps(watch(a.pid,a.root,a.output,a.interval,a.seconds),indent=2))

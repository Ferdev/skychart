#!/usr/bin/env python3
"""Measure pinned full BASS DR2 object, observing and new-redshift tables.

Exact source ID lookup retains repeated observations and component labels in
full detail; it does not merge catalogue components or assert identities.
"""
import argparse
from pathlib import Path
from measure_radio_catalogs import measure_tables

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args()
    measure_tables(a.root,[('bass-dr2','table8.dat',['ID','m_ID']),
                          ('bass-dr2','table9.dat',['ID','m_ID','CName']),
                          ('bass-dr2','table11.dat',['ID','CName'])],'bass-owned-storage')

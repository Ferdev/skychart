#!/usr/bin/env python3
"""Measure all eight pinned Fornax VII/180 tables using their declared schemas."""
import argparse
from pathlib import Path
from measure_radio_catalogs import measure_tables

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args()
    specifications=[('fornax-cluster','p2tbl2.dat',['FCC']),
                    ('fornax-cluster','p2tbl3.dat',['FCC','bgGal']),
                    ('fornax-cluster','notes.dat',['FCC','bgGal'])]
    specifications += [('fornax-cluster',f'p3tbl{i}.dat',['N','Name']) for i in range(2,7)]
    measure_tables(a.root,specifications,'fornax-owned-storage',
                   {f'p3tbl{i}.dat':'p3tbl*.dat' for i in range(2,7)})

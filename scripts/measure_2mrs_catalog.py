#!/usr/bin/env python3
"""Measure all ten pinned 2MRS science, exclusion, quality and reference tables."""
import argparse
from pathlib import Path
from measure_radio_catalogs import measure_tables

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args()
    specs=[('2mrs',f'table{i}.dat',['Bibcode'] if i==4 else ['ID']) for i in [3,4,6,7,8,9,10,11,12,13]]
    measure_tables(a.root,specs,'2mrs-owned-storage',{'table6.dat':'table[67].dat','table7.dat':'table[67].dat'})

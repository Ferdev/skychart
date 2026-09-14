#!/usr/bin/env python3
"""Measure all five pinned Abell VII/110A structured tables without identity merging."""
import argparse
from pathlib import Path
from measure_radio_catalogs import measure_tables

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args()
    measure_tables(a.root,[('abell','table3.dat',['ACO']),('abell','table4.dat',['ACO']),
                          ('abell','table5.dat',['ACOS','S']),('abell','table6.dat',['ABELL']),
                          ('abell','notes.dat',['ACO','Prefix','Field'])],'abell-owned-storage')

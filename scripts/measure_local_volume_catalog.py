#!/usr/bin/env python3
"""Measure every pinned Local Volume science/reference table without merging facts."""
import argparse
from pathlib import Path
from measure_radio_catalogs import measure_tables

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args()
    specifications=[('local-volume','table1.dat',['Name']),('local-volume','table2.dat',['Name']),
                    ('local-volume','table3.dat',['Name','r_mag']),('local-volume','table4.dat',['Name','r_HRV']),
                    ('local-volume','table5.dat',['Name','r_W50']),('local-volume','table6.dat',['Name','r_DM']),
                    ('local-volume','refs.dat',['Ref','BibCode'])]
    measure_tables(a.root,specifications,'local-volume-owned-storage')

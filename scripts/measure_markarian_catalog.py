#!/usr/bin/env python3
"""Measure all seven structured Markarian VII/172 tables; retain nonunique names."""
import argparse
from pathlib import Path
from measure_radio_catalogs import measure_tables

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args()
    measure_tables(a.root,[('markarian','table7.dat',['Mrk']),('markarian','notes.dat',['Mrk']),
                          ('markarian','table6.dat',['Name','Nref']),('markarian','table8.dat',['Mrk','Name']),
                          ('markarian','table9.dat',['Mrk','Name']),('markarian','table10.dat',['Mrk','Name']),
                          ('markarian','refs.dat',['Nref'])],'markarian-owned-storage')

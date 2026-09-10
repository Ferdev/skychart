#!/usr/bin/env python3
"""Measure the full pinned 2QZ/6QZ catalogue and three repeat-observation tables."""
import argparse
from pathlib import Path
from measure_radio_catalogs import measure_tables

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args()
    repeats=['ngp_rep.dat','sgp_rep.dat','6qz_rep.dat']
    specs=[('2qz','2qz.dat',['2QZ','intNo','intName'])]+[('2qz',name,['2QZ','intName']) for name in repeats]
    measure_tables(a.root,specs,'2qz-owned-storage',
                   {name:'ngp_rep.dat sgp_rep.dat 6qz_rep.dat' for name in repeats})

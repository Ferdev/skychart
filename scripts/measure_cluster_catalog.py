#!/usr/bin/env python3
"""Measure the complete pinned Harris CDS VII/202 table (147 records)."""
import argparse
from pathlib import Path
from measure_radio_catalogs import measure_tables

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args()
    measure_tables(a.root,[('clusters','catalog',['ID','Name'])],'clusters-owned-storage')

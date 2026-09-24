#!/usr/bin/env python3
"""Measure all sixteen pinned V/84 nebula, measurement, candidate and reference tables."""
import argparse
from pathlib import Path
from measure_radio_catalogs import measure_tables

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args()
    names=['main.dat','diam.dat','dist.dat','dista.dat','hbeta.dat','intens.dat','iue.dat','iras.dat',
           'nir.dat','radio.dat','vel.dat','cstar.dat','notes.dat','pospn.dat','notpn.dat','refs.dat']
    specs=[('nebulae',name,['Ref'] if name=='refs.dat' else ['Name','PK'] if name in ['pospn.dat','notpn.dat'] else ['PNG']) for name in names]
    measure_tables(a.root,specs,'nebulae-owned-storage',{'dist.dat':'dist.dat dista.dat','dista.dat':'dist.dat dista.dat'},
                   {'iue.dat':77,'nir.dat':106})  # nir row 102 has one verified trailing space.

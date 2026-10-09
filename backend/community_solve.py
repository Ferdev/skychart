"""Optional bounded Astrometry.net adapter. Index files stay outside the image."""
import json
import math
from pathlib import Path
import resource
import shutil
import subprocess
import sys

def read_wcs(path):
    data = path.read_bytes()[:28800]
    cards = {}
    for offset in range(0, len(data), 80):
        card = data[offset:offset+80].decode('ascii', errors='strict')
        key = card[:8].strip()
        if key == 'END':
            break
        if card[8:10] == '= ':
            value = card[10:].split('/')[0].strip().strip("'")
            cards[key] = value
    if cards.get('CTYPE1') != 'RA---TAN' or cards.get('CTYPE2') != 'DEC--TAN':
        raise ValueError('Unsupported WCS projection')
    if cards.get('RADESYS', 'ICRS') not in ('ICRS', 'FK5') or float(cards.get('EQUINOX', '2000')) != 2000:
        raise ValueError('Unsupported reference frame or epoch')
    if any(k.startswith(('PV', 'A_', 'B_', 'AP_', 'BP_')) for k in cards):
        raise ValueError('Unsupported WCS distortion')
    a,b,c,d = [float(cards[k].replace('D','E')) for k in ('CD1_1','CD1_2','CD2_1','CD2_2')]
    sx,sy=math.hypot(a,c),math.hypot(b,d)
    if sx<=0 or sy<=0 or abs(sx-sy)/sx > .01 or abs(a*b+c*d)/(sx*sy)>.01:
        raise ValueError('Non-square or distorted WCS needs a full matrix adapter')
    return {'ra_deg':float(cards['CRVAL1'])%360,'dec_deg':float(cards['CRVAL2']),
            'pixel_scale_arcsec':sx*3600,'rotation_deg':math.degrees(math.atan2(c,a)),
            'cd':[a,b,c,d],'crpix':[float(cards['CRPIX1']),float(cards['CRPIX2'])],
            'width':int(cards['IMAGEW']),'height':int(cards['IMAGEH'])}

def solve(image, output):
    executable = shutil.which('solve-field')
    if not executable:
        raise ValueError('Plate solver is not configured')
    output.mkdir(parents=True,exist_ok=True)
    # Disable SIP output; the client accepts explicit TAN matrices only.
    subprocess.run([executable,'--overwrite','--no-plots','--no-tweak','--cpulimit','30','--dir',str(output),str(image)],
                   check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=45)
    return read_wcs(output / (image.stem+'.wcs'))

if __name__=='__main__':
    resource.setrlimit(resource.RLIMIT_AS,(768*1024*1024,768*1024*1024))
    resource.setrlimit(resource.RLIMIT_CPU,(40,40))
    resource.setrlimit(resource.RLIMIT_FSIZE,(128*1024*1024,128*1024*1024))
    try:
        print(json.dumps(solve(Path(sys.argv[1]),Path(sys.argv[2]))))
    except (ValueError,KeyError,OSError,subprocess.SubprocessError):
        print(json.dumps({'error':'No supported plate solution was found'}))
        sys.exit(1)

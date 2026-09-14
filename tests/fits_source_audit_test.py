import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

import fitsio
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from audit_fits_source import audit


class FitsSourceAuditTest(unittest.TestCase):
    def test_full_scan_arrays_nulls_and_checksum_or_truncation_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.fits'
            rows = np.zeros(3, dtype=[('id', 'i8'), ('flux', 'f4', (2,))])
            rows['id'] = [2**60 + 1, -999, 0]
            rows['flux'] = [[1, np.nan], [0, 2], [np.inf, 3]]
            fitsio.write(source, rows, header={'TNULL1': -999})
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            result = audit(source, digest, batch_rows=2)
            table = result['hdus'][1]
            self.assertEqual(table['rows_read'], 3)
            self.assertEqual(table['field_statistics']['id']['integer_null_sentinels'], 1)
            self.assertEqual(table['field_statistics']['flux']['values_read'], 6)
            self.assertEqual(table['field_statistics']['flux']['nonfinite_values'], 2)
            self.assertIsNone(result['full_serving_bytes'])
            with self.assertRaisesRegex(ValueError, 'checksum'):
                audit(source, '0' * 64)
            source.write_bytes(source.read_bytes()[:-1])
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, 'truncated'):
                audit(source, digest)


if __name__ == '__main__':
    unittest.main()

from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from audit_votable_source import audit


class VotableSourceAuditTest(unittest.TestCase):
    def test_trailing_overflow_and_malformed_rows_never_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'source.xml'
            xml='<VOTABLE><RESOURCE><INFO name="QUERY_STATUS" value="OK"/><TABLE><FIELD name="id" datatype="long"/><FIELD name="distance" datatype="double" unit="pc"/><DATA><TABLEDATA><TR><TD>9007199254740993</TD><TD/></TR></TABLEDATA></DATA></TABLE>{}</RESOURCE></VOTABLE>'
            path.write_text(xml.format(''))
            r=audit(path,1)
            self.assertEqual(r['columns'],2)
            self.assertEqual(r['empty_cell_counts']['distance'],1)
            self.assertEqual(r['fields'][1]['attributes']['unit'],'pc')
            self.assertIsNone(r['full_serving_bytes'])
            path.write_text(xml.format('<INFO name="QUERY_STATUS" value="OVERFLOW"/>'))
            with self.assertRaisesRegex(ValueError,'OVERFLOW'):audit(path,1)
            path.write_text(xml.format('').replace('<TD/>',''))
            with self.assertRaisesRegex(ValueError,'field count'):audit(path,1)


if __name__=='__main__':unittest.main()

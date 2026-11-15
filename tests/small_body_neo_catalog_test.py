"""Completeness and refresh checks for near-Earth asteroids."""
import copy
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from small_body_dwarf_planet_catalog_test import load_builder, ROOT


class NearEarthCatalogTests(unittest.TestCase):
    def setUp(self):
        self.builder = load_builder()
        self.adapter = next(a for a in self.builder.SOURCE_ADAPTERS if a['name'] == self.builder.NEO_ADAPTER_NAME)

    def row(self, designation='1998 KY26', spkid='50012415', **changes):
        return dict(spkid=spkid, pdes=designation, full_name=f'({designation})', kind='au', neo='Y',
                    e='0.2', a='1.23', epoch='2461200.5', ma='146', n='0.724', i='1.49',
                    om='84.2', w='210', H='25.91', diameter='0.011', **changes)

    def page(self, rows, count):
        return {'fields': self.builder.FIELDS, 'count': str(count),
                'data': [[r.get(f) for f in self.builder.FIELDS] for r in rows]}

    def test_fetches_every_page_without_brightness_or_size_filter(self):
        rows = [self.row(), self.row('2026 A1', '9'), self.row('2026 A2', '10')]
        rows[1]['H'] = None
        rows[1]['diameter'] = None
        with patch.object(self.builder, 'SBDB_PAGE_SIZE', 2), patch.object(
            self.builder, 'fetch_json', side_effect=[self.page(rows[:2], 3), self.page(rows[2:], 3)]
        ) as fetch:
            result, meta = self.builder.fetch_rows([self.adapter])
        self.assertEqual(len(result), 3)
        self.assertEqual(meta[0]['returned_count'], 3)
        self.assertEqual([call.args[0]['limit-from'] for call in fetch.call_args_list], ['0', '2'])
        for call in fetch.call_args_list:
            self.assertNotIn('sb-cdata', call.args[0])
            self.assertEqual(call.args[0]['sort'], 'spkid')
        objects = self.builder.build_objects(result, 2461200.5, meta)
        self.assertEqual(len(objects), 3)
        unknown = next(o for o in objects if o['external_ids']['jpl_spkid'] == '9')
        self.assertNotIn('absolute_magnitude', unknown)
        self.assertEqual(meta[0]['rejected_count'], 0)

    def test_rejects_incomplete_duplicate_and_changed_pages(self):
        first = self.page([self.row()], 2)
        cases = [self.page([], 2), self.page([self.row()], 2), self.page([self.row('2026 A1', '9')], 3)]
        for second in cases:
            with self.subTest(second=second), patch.object(self.builder, 'SBDB_PAGE_SIZE', 1), patch.object(
                self.builder, 'fetch_json', side_effect=[first, second]
            ), self.assertRaises(ValueError):
                self.builder.fetch_rows([self.adapter])

    def test_reports_unusable_orbits(self):
        rows = [self.row(), self.row('2026 A1', '9')]
        rows[1]['e'] = '1.1'
        with patch.object(self.builder, 'fetch_json', return_value=self.page(rows, 2)):
            fetched, meta = self.builder.fetch_rows([self.adapter])
        objects = self.builder.build_objects(fetched, 2461200.5, meta)
        self.assertEqual(len(objects), 1)
        self.assertEqual(meta[0]['imported_count'], 1)
        self.assertEqual(meta[0]['rejected_count'], 1)
        self.assertEqual(meta[0]['rejected_designations'], ['2026 A1'])

    def test_overlapping_selections_produce_one_object(self):
        other = {'name': 'largest_diameter_asteroids', 'api': 'sbdb_query', 'family': 'asteroid', 'params': {}}
        with patch.object(self.builder, 'fetch_json', return_value=self.page([self.row()], 1)):
            rows, meta = self.builder.fetch_rows([other, self.adapter])
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(rows[0]['_selection']), 2)
        self.builder.build_objects(rows, 2461200.5, meta)
        self.assertEqual([m['imported_count'] for m in meta], [1, 1])

    def test_refresh_preserves_other_records_and_is_repeatable(self):
        keep = {'key': 'keep', 'facts': {'selection_slices': ['periodic_and_named_comets']}}
        old_neo = {'key': 'old', 'facts': {'selection_slices': ['bright_near_earth_asteroids']}}
        overlap = {'key': 'jpl-sbdb-50012415', 'facts': {'selection_slices': ['largest_diameter_asteroids', 'bright_near_earth_asteroids']}}
        former_neo = {'key': 'former', 'facts': {'selection_slices': ['largest_diameter_asteroids', 'bright_near_earth_asteroids']}}
        payload = {'objects': [keep, old_neo, overlap, former_neo], 'generated_at_utc': '2026-01-01T00:00:00Z',
                   'selection': {}, 'source': {'query_slices': [{'name': 'bright_near_earth_asteroids'}]}}
        now = datetime(2026, 11, 15, tzinfo=timezone.utc)
        with patch.object(self.builder, 'fetch_json', return_value=self.page([self.row()], 1)):
            result = self.builder.refresh_neos(copy.deepcopy(payload), now)
            repeated = self.builder.refresh_neos(copy.deepcopy(result), now)
        self.assertEqual(result['objects'], repeated['objects'])
        self.assertEqual(result['objects'][0], keep)
        self.assertEqual(len(result['objects']), 3)
        self.assertEqual(result['objects'][1]['facts']['selection_slices'], ['largest_diameter_asteroids', self.builder.NEO_ADAPTER_NAME])
        self.assertEqual(result['objects'][2]['facts']['selection_slices'], ['largest_diameter_asteroids'])
        self.assertEqual(len(repeated['source']['source_adapters']), 1)
        self.assertEqual(result['source']['query_slices'], [])

    def test_atomic_writer_preserves_existing_catalog_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'small_bodies.json'
            path.write_text('original')
            with patch.object(self.builder, 'validate_static_recognized_dwarfs'), self.assertRaises(ValueError):
                self.builder.write_catalog({'objects': [{'key': 'x', 'name': 'x', 'object_type': 'asteroid', 'x_au': float('nan')}]}, path)
            self.assertEqual(path.read_text(), 'original')
            self.assertFalse(path.with_suffix('.json.tmp').exists())
            with patch.object(self.builder, 'validate_static_recognized_dwarfs'):
                self.builder.write_catalog({'objects': [{'key': 'x', 'name': 'x', 'object_type': 'asteroid'}]}, path)
            self.assertEqual(json.loads(path.read_text())['object_count'], 1)

    def test_saved_snapshot_contains_ky26_and_complete_selection(self):
        payload = json.loads((ROOT / 'data/catalogs/small_bodies.json').read_text())
        meta = next(a for a in payload['source']['source_adapters'] if a['name'] == self.builder.NEO_ADAPTER_NAME)
        self.assertEqual(meta['returned_count'], int(meta['total_matching_count']))
        self.assertEqual(meta['imported_count'] + meta['rejected_count'], meta['returned_count'])
        rows = [o for o in payload['objects'] if self.builder.NEO_ADAPTER_NAME in o['facts'].get('selection_slices', [])]
        self.assertEqual(len(rows), meta['imported_count'])
        ky26 = next(o for o in rows if o['external_ids']['primary_designation'] == '1998 KY26')
        self.assertIn('1998 KY26', ky26['aliases'])
        self.assertEqual(ky26['object_type'], 'asteroid')
        self.assertTrue(ky26['facts']['neo'])
        self.assertEqual(len({o['key'] for o in payload['objects']}), payload['object_count'])
        self.assertLess((ROOT / 'data/catalogs/small_bodies.json').stat().st_size, 100 * 1024 * 1024)


if __name__ == '__main__':
    unittest.main()

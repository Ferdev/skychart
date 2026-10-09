#!/usr/bin/env python3
"""Fixed-row guardrails for the Gaia local catalog builder and its SIMBAD names. No test uses the network."""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = ROOT / "data" / "catalogs" / "gaia_local_stars.json"
THREAD_STAR = "3220388198192519424"
DELTA_OPHIUCHI = "4357027756659697664"


def load_builder():
    module_path = ROOT / "scripts" / "build_gaia_local_catalog.py"
    spec = importlib.util.spec_from_file_location("build_gaia_local_catalog", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def gaia_row(source_id: str, **values: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "source_id": source_id,
        "ra": 80.86,
        "dec": -1.33,
        "parallax": 28.075,
        "parallax_over_error": 1598.0,
        "phot_g_mean_mag": 10.51,
        "bp_rp": 1.74,
        "pmra": -3.4,
        "pmdec": 70.8,
        "radial_velocity": 10.5,
        "astrometric_params_solved": 31,
    }
    row.update(values)
    return row


# SIMBAD pads its names to fixed columns; these rows keep that form.
SIMBAD_ROWS = [
    [f"Gaia DR3 {THREAD_STAR}", "StKM 1-561", "TIC 4206066"],
    [f"Gaia DR3 {THREAD_STAR}", "StKM 1-561", "StKM 1-561"],
    [f"Gaia DR3 {THREAD_STAR}", "StKM 1-561", f"Gaia DR3 {THREAD_STAR}"],
    [f"Gaia DR3 {THREAD_STAR}", "StKM 1-561", "TYC 4753-1591-1"],
    [f"Gaia DR3 {THREAD_STAR}", "StKM 1-561", "2MASS J05232636-0119380"],
    [f"Gaia DR3 {THREAD_STAR}", "StKM 1-561", "UCAC4 444-009590"],
    [f"Gaia DR3 {DELTA_OPHIUCHI}", "* del Oph", "TIC 74040747"],
    [f"Gaia DR3 {DELTA_OPHIUCHI}", "* del Oph", "HIP 79593"],
    [f"Gaia DR3 {DELTA_OPHIUCHI}", "* del Oph", "*   1 Oph"],
    [f"Gaia DR3 {DELTA_OPHIUCHI}", "* del Oph", "* del Oph"],
    [f"Gaia DR3 {DELTA_OPHIUCHI}", "* del Oph", "HD 146051"],
    [f"Gaia DR3 {DELTA_OPHIUCHI}", "* del Oph", "HR  6056"],
    [f"Gaia DR3 {DELTA_OPHIUCHI}", "* del Oph", "SAO 141052"],
    [f"Gaia DR3 {DELTA_OPHIUCHI}", "* del Oph", "NAME Yed Prior"],
    [f"Gaia DR3 {DELTA_OPHIUCHI}", "* del Oph", "TIC 1203373581"],
    ["Gaia DR3 3754369799792120832", "Gaia DR3 3754369799792120832", "Gaia DR3 3754369799792120832"],
    ["Gaia DR3 3754369799792120832", "Gaia DR3 3754369799792120832", "TIC 99"],
]


class GaiaLocalCatalogBuilderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.builder = load_builder()
        cls.queries: list[str] = []

        def fetch(url: str, query: str) -> dict[str, Any]:
            cls.queries.append(query)
            assert url == cls.builder.SIMBAD_TAP_URL
            return {"data": [row for row in SIMBAD_ROWS if f"'{row[0]}'" in query]}

        cls.source_ids = [THREAD_STAR, DELTA_OPHIUCHI, "3754369799792120832", "1"]
        cls.names = cls.builder.fetch_simbad_names(cls.source_ids, fetch=fetch, batch_size=2)
        rows = [gaia_row(source_id, phot_g_mean_mag=10.0 + index) for index, source_id in enumerate(cls.source_ids)]
        cls.stars = {star["source_id"]: star for star in cls.builder.build_stars(rows, cls.names)}

    def test_name_query_matches_the_exact_gaia_name_in_batches(self) -> None:
        self.assertEqual(len(self.queries), 2)
        self.assertIn(f"'Gaia DR3 {THREAD_STAR}', 'Gaia DR3 {DELTA_OPHIUCHI}'", self.queries[0])
        self.assertIn("FROM ident AS g", self.builder.SIMBAD_NAME_QUERY)
        self.assertIn("g.id IN", self.builder.SIMBAD_NAME_QUERY)
        self.assertNotIn("CONTAINS", self.builder.SIMBAD_NAME_QUERY.upper())
        self.assertEqual(sorted(self.names), sorted([THREAD_STAR, DELTA_OPHIUCHI, "3754369799792120832"]))

    def test_source_ids_that_are_not_numbers_never_reach_the_query(self) -> None:
        queries: list[str] = []
        self.builder.fetch_simbad_names(["1') OR 1=1 --", "7"], fetch=lambda _url, query: queries.append(query) or {"data": []})
        self.assertEqual(len(queries), 1)
        self.assertIn("IN ('Gaia DR3 7')", queries[0])

    def test_the_thread_star_gets_its_tic_number_and_its_simbad_name(self) -> None:
        star = self.stars[THREAD_STAR]
        self.assertEqual(star["key"], f"gaia-dr3-{THREAD_STAR}")
        self.assertEqual(star["name"], "StKM 1-561")
        self.assertEqual(star["simbad_main_id"], "StKM 1-561")
        self.assertEqual(
            star["aliases"],
            [
                f"Gaia DR3 {THREAD_STAR}",
                f"Gaia {THREAD_STAR}",
                THREAD_STAR,
                "StKM 1-561",
                "TIC 4206066",
                "TYC 4753-1591-1",
                "2MASS J05232636-0119380",
            ],
        )

    def test_a_bright_star_gets_proper_bayer_and_catalog_names_in_a_fixed_order(self) -> None:
        star = self.stars[DELTA_OPHIUCHI]
        self.assertEqual(star["name"], "del Oph")
        self.assertEqual(star["simbad_main_id"], "* del Oph")
        self.assertEqual(
            star["aliases"][3:],
            ["del Oph", "Yed Prior", "1 Oph", "HD 146051", "HIP 79593", "HR 6056", "TIC 1203373581", "TIC 74040747"],
        )
        self.assertNotIn("SAO 141052", star["aliases"])

    def test_a_star_with_only_a_gaia_name_in_simbad_keeps_that_name(self) -> None:
        star = self.stars["3754369799792120832"]
        self.assertEqual(star["name"], "Gaia DR3 3754369799792120832")
        self.assertNotIn("simbad_main_id", star)
        self.assertEqual(star["aliases"][-1], "TIC 99")

    def test_a_star_that_simbad_does_not_know_is_unchanged(self) -> None:
        star = self.stars["1"]
        self.assertEqual(star["name"], "Gaia DR3 1")
        self.assertEqual(star["aliases"], ["Gaia DR3 1", "Gaia 1", "1"])
        self.assertEqual(star, self.builder.reject_none(self.builder.build_star(gaia_row("1", phot_g_mean_mag=13.0))))

    def test_simbad_names_lose_their_padding_and_their_type_markers(self) -> None:
        self.assertEqual(self.builder.normalize_designation("HD  27697"), "HD 27697")
        self.assertEqual(self.builder.simbad_alias("*  61 Tau"), (1, "61 Tau"))
        self.assertEqual(self.builder.simbad_alias("V* YZ Cet"), (2, "YZ Cet"))
        self.assertEqual(self.builder.simbad_alias("TOI-700")[1], "TOI-700")
        self.assertIsNone(self.builder.simbad_alias("Gaia DR2 4357027756656094208"))
        self.assertIsNone(self.builder.simbad_alias("NAME "))
        self.assertEqual(self.builder.simbad_display_name("NAME Barnard's star"), "Barnard's star")
        self.assertEqual(self.builder.simbad_display_name("LP   92-279"), "LP 92-279")
        self.assertIsNone(self.builder.simbad_display_name("Gaia DR3 12"))
        self.assertIsNone(self.builder.simbad_display_name(None))

    def test_names_do_not_change_a_measured_value(self) -> None:
        plain = self.builder.reject_none(self.builder.build_star(gaia_row(THREAD_STAR, phot_g_mean_mag=10.0)))
        named = self.stars[THREAD_STAR]
        for key, value in plain.items():
            if key not in {"name", "aliases"}:
                self.assertEqual(named[key], value, key)

    def test_coverage_counts_the_named_stars(self) -> None:
        coverage = self.builder.name_coverage(list(self.stars.values()))
        self.assertEqual(coverage, {"stars": 4, "with_simbad_name": 2, "with_tic": 3, "with_hd": 1, "with_hip": 1, "with_2mass": 1})


class GaiaLocalSnapshotTest(unittest.TestCase):
    """Checks the checked-in snapshot against its own counts."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.builder = load_builder()
        cls.payload = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        cls.stars = cls.payload["stars"]

    def test_snapshot_counts_and_name_source(self) -> None:
        self.assertEqual(self.payload["schema_version"], 2)
        self.assertEqual(self.payload["star_count"], len(self.stars))
        self.assertEqual(self.payload["name_coverage"], self.builder.name_coverage(self.stars))
        self.assertEqual(self.payload["name_source"]["tap_url"], self.builder.SIMBAD_TAP_URL)
        self.assertIn("no positional match", self.payload["name_source"]["match"])

    def test_each_star_keeps_its_gaia_key_and_gaia_aliases(self) -> None:
        keys = set()
        for star in self.stars:
            source_id = star["source_id"]
            self.assertEqual(star["key"], f"gaia-dr3-{source_id}")
            self.assertEqual(star["aliases"][:3], [f"Gaia DR3 {source_id}", f"Gaia {source_id}", source_id])
            self.assertEqual(len(star["aliases"]), len(set(star["aliases"])), source_id)
            self.assertTrue(star["name"].strip())
            keys.add(star["key"])
        self.assertEqual(len(keys), len(self.stars))

    def test_the_thread_star_has_its_tic_number(self) -> None:
        star = next(star for star in self.stars if star["source_id"] == THREAD_STAR)
        self.assertIn("TIC 4206066", star["aliases"])
        self.assertNotEqual(star["name"], f"Gaia DR3 {THREAD_STAR}")


if __name__ == "__main__":
    unittest.main()

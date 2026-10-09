#!/usr/bin/env python3
"""Fixed-row guardrails for the exoplanet catalog builder. No test uses the network."""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = ROOT / "data" / "catalogs" / "exoplanet_systems.json"


def load_builder():
    module_path = ROOT / "scripts" / "build_exoplanet_catalog.py"
    spec = importlib.util.spec_from_file_location("build_exoplanet_catalog", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def link(reference_id: str, label: str) -> str:
    return f"<a refstr={reference_id} href=https://ui.adsabs.harvard.edu/abs/{reference_id}/abstract target=ref>{label}</a>"


CALCULATED = "<a refstr=CALCULATED_VALUE href=/docs/pscp_calc.html target=_blank>Calculated Value</a>"


def composite_row(name: str, host: str, **values: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "pl_name": name,
        "hostname": host,
        "ra": 10.0,
        "dec": -5.0,
        "sy_dist": 12.0,
        "sy_pnum": 1,
        "sy_snum": 1,
        "sy_mnum": 0,
        "discoverymethod": "Transit",
        "disc_year": 2020,
    }
    row.update(values)
    return row


TRANSIT_ROW = composite_row(
    "Fixture b",
    "Fixture",
    hd_name="HD 1",
    st_teff=5800.0,
    pl_rade=1.1,
    pl_rade_reflink=link("PAPER_A", "Paper A 2021"),
    pl_bmasse=1.3,
    pl_bmasse_reflink=link("PAPER_A", "Paper A 2021"),
    pl_bmassprov="Mass",
    pl_eqt=250.0,
    pl_insol=0.6,
    pl_orbper=6.1,
    pl_orbpererr1=0.00004,
    pl_orbpererr2=-0.00003,
    pl_orbperlim=0,
    pl_orbper_reflink=link("PAPER_A", "Paper A 2021"),
    pl_orbsmax=0.029,
    pl_orbsmaxerr1=0.002,
    pl_orbsmaxerr2=-0.002,
    pl_orbsmaxlim=0,
    pl_orbsmax_reflink=link("PAPER_A", "Paper A 2021"),
    pl_orbeccen=0.005,
    pl_orbeccenlim=0,
    pl_orbincl=89.8,
    pl_orbincllim=0,
    pl_orblper=108.0,
    pl_orblperlim=0,
    pl_orblper_reflink=link("PAPER_A", "Paper A 2021"),
    pl_tranmid=2457660.36,
    pl_tranmiderr1=0.0002,
    pl_tranmiderr2=-0.0001,
    pl_tranmidlim=0,
    pl_tranmid_systemref="BJD-TDB",
    pl_tranmid_reflink=link("PAPER_A", "Paper A 2021"),
    tran_flag=1,
    rv_flag=0,
    ttv_flag=1,
    cb_flag=0,
    pl_controv_flag=0,
)

RADIAL_VELOCITY_ROW = composite_row(
    "Velocity b",
    "Velocity",
    discoverymethod="Radial Velocity",
    pl_rade=14.1,
    pl_rade_reflink=CALCULATED,
    pl_bmasse=190.0,
    pl_bmasse_reflink=link("PAPER_B", "Paper B 2004"),
    pl_bmassprov="Msini",
    pl_orbper=4.23,
    pl_orbpererr1=0.00001,
    pl_orbpererr2=-0.00001,
    pl_orbperlim=0,
    pl_orbper_reflink=link("PAPER_B", "Paper B 2004"),
    pl_orbsmax=0.052,
    pl_orbsmaxlim=0,
    pl_orbsmax_reflink=CALCULATED,
    pl_orbeccen=0.01,
    pl_orbeccenlim=1,
    pl_orblper=58.0,
    pl_orblperlim=0,
    pl_orblper_reflink=link("PAPER_B", "Paper B 2004"),
    pl_orbtper=2452497.0,
    pl_orbtpererr1=0.02,
    pl_orbtpererr2=-0.02,
    pl_orbtperlim=0,
    pl_orbtper_systemref="BJD",
    pl_orbtper_reflink=link("PAPER_B", "Paper B 2004"),
    tran_flag=0,
    rv_flag=1,
)

NO_TIMING_ROW = composite_row(
    "Imaged b",
    "Imaged",
    discoverymethod="Imaging",
    pl_rade=12.0,
    pl_rade_reflink=link("PAPER_C", "Paper C 2019"),
    pl_orbsmax=42.0,
    pl_orbsmaxlim=0,
    pl_orbsmax_reflink=link("PAPER_C", "Paper C 2019"),
    ima_flag=1,
)

NO_ORBIT_SIZE_ROW = composite_row(
    "Lensed b",
    "Lensed",
    discoverymethod="Microlensing",
    pl_bmasse=300.0,
    pl_bmassprov="Mass",
    pl_orbper=900.0,
    pl_orbperlim=0,
    pl_tranmid=2455000.0,
    pl_tranmidlim=0,
    micro_flag=1,
)

MIXED_ROW = composite_row(
    "Mixed b",
    "Mixed",
    pl_rade=2.0,
    pl_rade_reflink=link("PAPER_D", "Paper D 2025"),
    pl_orbper=11.18465,
    pl_orbpererr1=0.0005,
    pl_orbpererr2=-0.0005,
    pl_orbperlim=0,
    pl_orbper_reflink=link("PAPER_D", "Paper D 2025"),
    pl_orbsmax=0.048,
    pl_orbsmaxlim=0,
    pl_orbsmax_reflink=link("PAPER_D", "Paper D 2025"),
    pl_tranmid=2457897.9,
    pl_tranmiderr1=0.3,
    pl_tranmiderr2=-0.2,
    pl_tranmidlim=0,
    pl_tranmid_systemref="BJD",
    pl_tranmid_reflink=link("PAPER_E", "Paper E 2020"),
)

MIXED_PAPER_ROWS = [
    {
        "pl_name": "Mixed b",
        "default_flag": 0,
        "pl_refname": link("PAPER_OLD", "Paper Old 2016"),
        "pl_pubdate": "2016-08",
        "pl_orbper": 11.186,
        "pl_orbperlim": 0,
        "pl_tranmid": 2451634.7,
        "pl_tranmidlim": 0,
        "pl_tsystemref": "JD",
    },
    {
        "pl_name": "Mixed b",
        "default_flag": 0,
        "pl_refname": link("PAPER_E", "Paper E 2020"),
        "pl_pubdate": "2020-01",
        "pl_orbper": 11.185,
        "pl_orbpererr1": 0.001,
        "pl_orbpererr2": -0.001,
        "pl_orbperlim": 0,
        "pl_tranmid": 2457897.9,
        "pl_tranmiderr1": 0.3,
        "pl_tranmiderr2": -0.2,
        "pl_tranmidlim": 0,
        "pl_tsystemref": "BJD",
    },
    {
        "pl_name": "Mixed b",
        "default_flag": 1,
        "pl_refname": link("PAPER_D", "Paper D 2025"),
        "pl_pubdate": "2025-07",
        "pl_orbper": 11.18465,
        "pl_orbperlim": 0,
        "pl_tranmid": None,
    },
]


def planets_by_name(systems: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {planet["name"]: planet for system in systems for planet in system["planets"]}


class ExoplanetCatalogBuilderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.builder = load_builder()
        cls.rows = [TRANSIT_ROW, RADIAL_VELOCITY_ROW, NO_TIMING_ROW, NO_ORBIT_SIZE_ROW, MIXED_ROW]
        cls.systems = cls.builder.build_systems(cls.rows, MIXED_PAPER_ROWS)
        cls.planets = planets_by_name(cls.systems)

    def test_queries_name_the_orbit_columns_and_the_per_paper_table(self) -> None:
        for column in [
            "pl_orbeccen", "pl_orbincl", "pl_orblper", "pl_tranmid", "pl_orbtper",
            "pl_tranmid_systemref", "pl_orbtper_systemref", "pl_bmassprov", "pl_eqt", "pl_insol",
            "pl_orbpererr1", "pl_orbsmaxerr2", "pl_orbeccenlim", "pl_orbincllim", "pl_orblperlim",
            "pl_tranmiderr1", "pl_orbtpererr2", "tran_flag", "rv_flag", "ima_flag", "micro_flag",
            "ttv_flag", "cb_flag", "pl_controv_flag", "pl_orbper_reflink", "pl_tranmid_reflink",
            "pl_orbtper_reflink", "pl_orbsmax_reflink", "pl_rade_reflink", "pl_bmasse_reflink",
        ]:
            self.assertIn(column, self.builder.QUERY)
        self.assertIn("from pscomppars", self.builder.QUERY)
        self.assertIn("from ps\n", self.builder.EPHEMERIS_QUERY)
        self.assertIn("default_flag", self.builder.EPHEMERIS_QUERY)
        self.assertEqual(self.builder.SCHEMA_VERSION, 2)

    def test_transit_planet_keeps_one_paper_composite_ephemeris(self) -> None:
        planet = self.planets["Fixture b"]
        self.assertEqual(planet["key"], "exoplanet-fixture-b")
        self.assertEqual(planet["orbit_display_state"], "position")
        self.assertEqual(planet["ephemeris_reference_type"], "conjunction")
        self.assertEqual(planet["ephemeris_source_table"], "pscomppars")
        self.assertEqual(planet["ephemeris_time_system"], "BJD-TDB")
        self.assertEqual(planet["ephemeris_reference_time_jd"], 2457660.36)
        self.assertEqual(planet["ephemeris_reference_time_jd_err_plus"], 0.0002)
        self.assertEqual(planet["ephemeris_reference_time_jd_err_minus"], 0.0001)
        self.assertEqual(planet["ephemeris_period_days"], 6.1)
        self.assertEqual(planet["period_days_err_minus"], 0.00003)
        self.assertNotIn("ephemeris_mixed_references", planet)
        self.assertNotIn("ephemeris_argument_of_periastron_deg", planet)
        self.assertTrue(planet["detected_by_transit"])
        self.assertTrue(planet["transit_timing_variations"])
        self.assertNotIn("detected_by_radial_velocity", planet)
        self.assertNotIn("radius_calculated", planet)
        self.assertEqual(
            planet["references"],
            [{
                "label": "Paper A 2021",
                "url": "https://ui.adsabs.harvard.edu/abs/PAPER_A/abstract",
                "quantities": ["period", "semi_major_axis", "radius", "mass"],
            }],
        )

    def test_radial_velocity_planet_uses_periastron_time_and_flags_archive_values(self) -> None:
        planet = self.planets["Velocity b"]
        self.assertEqual(planet["orbit_display_state"], "position")
        self.assertEqual(planet["ephemeris_reference_type"], "periastron")
        self.assertEqual(planet["ephemeris_argument_of_periastron_deg"], 58.0)
        self.assertEqual(planet["ephemeris_time_system"], "BJD")
        self.assertTrue(planet["minimum_mass"])
        self.assertTrue(planet["radius_calculated"])
        self.assertTrue(planet["semi_major_axis_calculated"])
        self.assertEqual(planet["eccentricity_limit"], 1)
        self.assertNotIn("inclination_deg", planet)
        quantities = [quantity for reference in planet["references"] for quantity in reference["quantities"]]
        self.assertEqual(quantities, ["period", "mass"])

    def test_periastron_time_without_its_argument_gives_no_position(self) -> None:
        row = dict(RADIAL_VELOCITY_ROW, pl_name="Velocity c", pl_orblper=None)
        planet = planets_by_name(self.builder.build_systems([row]))["Velocity c"]
        self.assertEqual(planet["orbit_display_state"], "orbit_only")
        self.assertFalse([key for key in planet if key.startswith("ephemeris_")])

    def test_planet_with_no_timing_has_an_orbit_only(self) -> None:
        planet = self.planets["Imaged b"]
        self.assertEqual(planet["orbit_display_state"], "orbit_only")
        self.assertEqual(planet["semi_major_axis_au"], 42.0)
        self.assertNotIn("period_days", planet)
        self.assertFalse([key for key in planet if key.startswith("ephemeris_")])

    def test_planet_with_no_orbit_size_has_no_orbit(self) -> None:
        planet = self.planets["Lensed b"]
        self.assertEqual(planet["orbit_display_state"], "none")
        self.assertNotIn("semi_major_axis_au", planet)
        self.assertEqual(planet["period_days"], 900.0)
        self.assertFalse([key for key in planet if key.startswith("ephemeris_")])

    def test_mixed_papers_take_one_paper_row_from_the_per_paper_table(self) -> None:
        planet = self.planets["Mixed b"]
        self.assertEqual(planet["ephemeris_source_table"], "ps")
        self.assertEqual(planet["ephemeris_reference_label"], "Paper E 2020")
        self.assertEqual(planet["ephemeris_period_days"], 11.185)
        self.assertEqual(planet["ephemeris_reference_time_jd"], 2457897.9)
        self.assertEqual(planet["period_days"], 11.18465)
        self.assertNotIn("ephemeris_mixed_references", planet)

    def test_default_paper_row_wins_over_a_newer_paper(self) -> None:
        paper_rows = [dict(row) for row in MIXED_PAPER_ROWS]
        paper_rows[0]["default_flag"] = 1
        planet = planets_by_name(self.builder.build_systems([MIXED_ROW], paper_rows))["Mixed b"]
        self.assertEqual(planet["ephemeris_reference_label"], "Paper Old 2016")
        self.assertEqual(planet["ephemeris_time_system"], "JD")

    def test_mixed_papers_without_a_one_paper_row_keep_the_values_and_set_the_flag(self) -> None:
        planet = planets_by_name(self.builder.build_systems([MIXED_ROW], []))["Mixed b"]
        self.assertEqual(planet["orbit_display_state"], "position")
        self.assertEqual(planet["ephemeris_source_table"], "pscomppars")
        self.assertTrue(planet["ephemeris_mixed_references"])
        self.assertEqual(planet["ephemeris_period_days"], 11.18465)

    def test_reference_time_after_the_snapshot_is_not_a_measured_epoch(self) -> None:
        from datetime import datetime, timezone

        snapshot = datetime(2026, 10, 8, tzinfo=timezone.utc)
        wrong_offset = dict(TRANSIT_ROW, pl_name="Offset b", pl_tranmid=2467660.36)
        long_orbit = dict(TRANSIT_ROW, pl_name="Offset c", pl_orbper=9100.0, pl_tranmid=2461699.0)
        planets = planets_by_name(self.builder.build_systems([wrong_offset, long_orbit], [], snapshot))
        self.assertEqual(planets["Offset b"]["orbit_display_state"], "orbit_only")
        self.assertEqual(planets["Offset c"]["orbit_display_state"], "position")

    def test_limits_are_not_measurements(self) -> None:
        period_limit = dict(TRANSIT_ROW, pl_name="Limit b", pl_orbperlim=-1)
        size_limit = dict(TRANSIT_ROW, pl_name="Limit c", pl_orbsmaxlim=-1)
        planets = planets_by_name(self.builder.build_systems([period_limit, size_limit]))
        self.assertEqual(planets["Limit b"]["orbit_display_state"], "orbit_only")
        self.assertEqual(planets["Limit b"]["period_days_limit"], -1)
        self.assertEqual(planets["Limit c"]["orbit_display_state"], "orbit_only")
        self.assertEqual(planets["Limit c"]["semi_major_axis_au_limit"], -1)

    def test_records_have_no_null_fields_and_hosts_keep_their_fields(self) -> None:
        def nulls(value: Any) -> bool:
            if isinstance(value, dict):
                return any(nulls(item) for item in value.values())
            if isinstance(value, list):
                return any(nulls(item) for item in value)
            return value is None

        self.assertFalse(nulls(self.systems))
        host = next(system for system in self.systems if system["name"] == "Fixture")
        self.assertEqual(host["key"], "exosys-fixture")
        self.assertEqual(host["aliases"], ["HD 1", "Fixture b"])
        self.assertEqual(host["exoplanet_count"], 1)
        self.assertEqual(host["color"], "#ffd28c")
        self.assertNotIn("spectral_type", host)

    def test_planet_keys_follow_the_importer_rule(self) -> None:
        self.assertEqual(self.builder.planet_key("TRAPPIST-1 e"), "exoplanet-trappist-1-e")
        self.assertEqual(self.builder.planet_key("2MASS J0249-0557 c"), "exoplanet-2mass-j0249-0557-c")
        self.assertEqual(self.builder.planet_key("WISE 0458+6434 b"), "exoplanet-wise-0458-plus-6434-b")
        self.assertEqual(self.builder.planet_key("Barnard's Star b"), "exoplanet-barnard-s-star-b")

    def test_reference_links_become_plain_fields(self) -> None:
        reference = self.builder.parse_reference(
            "<a refstr=SU_AMP_AACUTE_REZ_2025 href=https://ui.adsabs.harvard.edu/abs/2025A&A...700A..11M/abstract target=ref>Su&aacute;rez Mascare&ntilde;o et al. 2025</a>"
        )
        self.assertEqual(reference["label"], "Suárez Mascareño et al. 2025")
        self.assertEqual(reference["url"], "https://ui.adsabs.harvard.edu/abs/2025A&A...700A..11M/abstract")
        calculated = self.builder.parse_reference(CALCULATED)
        self.assertEqual(calculated["id"], "CALCULATED_VALUE")
        self.assertEqual(calculated["url"], "https://exoplanetarchive.ipac.caltech.edu/docs/pscp_calc.html")
        self.assertIsNone(self.builder.parse_reference(None))

    def test_key_comparison_reports_removed_and_added_keys(self) -> None:
        previous = [{"key": "exosys-old", "planets": [{"name": "Old b"}]}, {"key": "exosys-fixture", "planets": [{"name": "Fixture b"}]}]
        changes = self.builder.compare_keys(previous, self.systems)
        self.assertEqual(changes["removed"], ["exoplanet-old-b", "exosys-old"])
        self.assertIn("exoplanet-mixed-b", changes["added"])
        self.assertNotIn("exoplanet-fixture-b", changes["added"])

    def test_coverage_counts_each_display_state(self) -> None:
        coverage = self.builder.coverage(self.systems)
        self.assertEqual(coverage["orbit_display_state"], {"none": 1, "orbit_only": 1, "position": 3})
        self.assertEqual(coverage["ephemeris_reference_type"], {"conjunction": 2, "periastron": 1})
        self.assertEqual(coverage["ephemeris_source_table"], {"ps": 1, "pscomppars": 2})


class ExoplanetSnapshotTest(unittest.TestCase):
    """Checks the checked-in snapshot against its own counts."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.builder = load_builder()
        cls.payload = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        cls.planets = [planet for system in cls.payload["systems"] for planet in system["planets"]]

    def test_snapshot_counts_agree_with_its_records(self) -> None:
        self.assertEqual(self.payload["schema_version"], 2)
        self.assertEqual(self.payload["system_count"], len(self.payload["systems"]))
        self.assertEqual(self.payload["planet_count"], len(self.planets))
        self.assertEqual(self.payload["coverage"], self.builder.coverage(self.payload["systems"]))
        states = Counter(planet["orbit_display_state"] for planet in self.planets)
        self.assertEqual(set(states), {"position", "orbit_only", "none"})
        self.assertEqual(states["none"], sum(1 for planet in self.planets if "semi_major_axis_au" not in planet))

    def test_snapshot_source_block_stays_small_for_api_rows(self) -> None:
        self.assertEqual(self.payload["source"]["table"], "pscomppars")
        self.assertEqual(self.payload["source"]["ephemeris_table"], "ps")
        self.assertNotIn("query", self.payload["source"])
        self.assertEqual(self.payload["queries"], {"pscomppars": self.builder.QUERY, "ps": self.builder.EPHEMERIS_QUERY})

    def test_snapshot_keys_are_unique_and_follow_the_key_rules(self) -> None:
        keys = [system["key"] for system in self.payload["systems"]] + [planet["key"] for planet in self.planets]
        self.assertEqual(len(keys), len(set(keys)))
        for planet in self.planets:
            self.assertEqual(planet["key"], self.builder.planet_key(planet["name"]))

    def test_each_calculated_position_has_a_complete_ephemeris(self) -> None:
        from datetime import datetime

        generated_at = datetime.fromisoformat(self.payload["generated_at_utc"].replace("Z", "+00:00"))
        snapshot_jd = self.builder.julian_day(generated_at)
        for planet in self.planets:
            has_ephemeris = "ephemeris_reference_type" in planet
            self.assertEqual(has_ephemeris, planet["orbit_display_state"] == "position", planet["name"])
            if not has_ephemeris:
                continue
            self.assertGreater(planet["semi_major_axis_au"], 0)
            self.assertGreater(planet["ephemeris_period_days"], 0)
            self.assertGreater(planet["ephemeris_reference_time_jd"], 2_000_000)
            self.assertLessEqual(planet["ephemeris_reference_time_jd"], snapshot_jd + planet["ephemeris_period_days"])
            if planet["ephemeris_reference_type"] == "periastron":
                self.assertIn("ephemeris_argument_of_periastron_deg", planet)

    def test_host_planet_lists_carry_no_null_fields(self) -> None:
        for system in self.payload["systems"]:
            self.assertNotIn(None, system.values())
        for planet in self.planets:
            self.assertNotIn(None, planet.values())


if __name__ == "__main__":
    unittest.main()

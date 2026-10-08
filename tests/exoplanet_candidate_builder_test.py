#!/usr/bin/env python3
"""Fixed-row guardrails for the planet candidate catalog builder. No test uses the network."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
import unittest
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = ROOT / "data" / "catalogs" / "exoplanet_candidates.json"
SNAPSHOT_TIME = datetime(2026, 10, 1, tzinfo=timezone.utc)


def load_builder():
    module_path = ROOT / "scripts" / "build_exoplanet_candidate_catalog.py"
    spec = importlib.util.spec_from_file_location("build_exoplanet_candidate_catalog", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def toi_row(toi: str, **values: Any) -> dict[str, Any]:
    """One row of the TOI table. The star is a Sun twin, so the orbit size is easy to check."""
    row: dict[str, Any] = {
        "toi": toi,
        "toipfx": int(toi.split(".")[0]),
        "tid": 1000 + int(toi.split(".")[0]),
        "tfopwg_disp": "PC",
        "ra": 80.0,
        "dec": -1.0,
        "st_dist": 50.0,
        "st_tmag": 9.5,
        "st_teff": 5772.0,
        "st_logg": 4.438,
        "st_loggerr1": 0.1,
        "st_loggerr2": -0.1,
        "st_rad": 1.0,
        "st_raderr1": 0.05,
        "st_raderr2": -0.05,
        "pl_tranmid": 2460000.5,
        "pl_tranmiderr1": 0.002,
        "pl_tranmiderr2": -0.002,
        "pl_tranmidlim": 0,
        "pl_orbper": 365.25,
        "pl_orbpererr1": 0.01,
        "pl_orbpererr2": -0.01,
        "pl_orbperlim": 0,
        "pl_trandurh": 3.0,
        "pl_trandep": 900.0,
        "pl_rade": 2.5,
        "pl_radeerr1": 0.2,
        "pl_radeerr2": -0.2,
        "pl_radelim": 0,
        "pl_insol": 1.0,
        "pl_eqt": 255.0,
        "toi_created": "2024-01-02 03:04:05",
        "rowupdate": "2025-06-07 08:09:10",
    }
    row.update(values)
    return row


class ExoplanetCandidateBuilderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.builder = load_builder()

    def build(self, *rows: dict[str, Any]) -> list[dict[str, Any]]:
        return self.builder.build_systems(list(rows), SNAPSHOT_TIME)

    def candidate(self, **values: Any) -> dict[str, Any]:
        return self.build(toi_row("100.01", **values))[0]["candidates"][0]

    def test_query_takes_only_the_candidate_dispositions(self) -> None:
        self.assertIn("from toi", self.builder.QUERY)
        self.assertIn("tfopwg_disp in ('PC', 'APC')", self.builder.QUERY)
        self.assertEqual(sorted(self.builder.CANDIDATE_DISPOSITIONS), ["APC", "PC"])
        for column in ("pl_tranmid", "pl_orbper", "st_logg", "st_rad", "st_dist", "tid"):
            self.assertIn(column, self.builder.QUERY)

    def test_star_and_candidate_get_toi_names_and_keys(self) -> None:
        system = self.build(toi_row("100.02"), toi_row("100.01", tfopwg_disp="APC"))[0]
        self.assertEqual(system["key"], "toi-100")
        self.assertEqual(system["name"], "TOI-100")
        self.assertEqual(system["aliases"], ["TOI-100", "TIC 1100"])
        self.assertEqual(system["tic_id"], "1100")
        self.assertEqual(system["candidate_count"], 2)
        self.assertEqual([candidate["key"] for candidate in system["candidates"]], ["toi-100-01", "toi-100-02"])
        self.assertEqual([candidate["name"] for candidate in system["candidates"]], ["TOI-100.01", "TOI-100.02"])
        self.assertEqual(system["candidates"][0]["disposition"], "ambiguous_planet_candidate")
        self.assertEqual(system["candidates"][0]["tfopwg_disposition"], "APC")
        self.assertEqual(system["candidates"][1]["disposition"], "planet_candidate")

    def test_orbit_size_comes_from_the_period_and_the_calculated_star_mass(self) -> None:
        system = self.build(toi_row("100.01"))[0]
        candidate = system["candidates"][0]
        self.assertAlmostEqual(system["stellar_mass_solar"], 1.0, places=9)
        self.assertTrue(system["stellar_mass_atlas_calculated"])
        self.assertAlmostEqual(candidate["semi_major_axis_au"], 1.0, places=9)
        self.assertTrue(candidate["semi_major_axis_atlas_calculated"])
        # sigma_M / M = hypot(ln(10) * 0.1, 2 * 0.05); sigma_a / a is one third of it.
        expected = math.hypot(math.log(10) * 0.1, 0.1) / 3
        self.assertAlmostEqual(candidate["semi_major_axis_au_err_plus"], expected, places=9)
        self.assertAlmostEqual(candidate["semi_major_axis_au_err_minus"], expected, places=9)

    def test_a_smaller_star_gives_a_smaller_orbit_for_the_same_period(self) -> None:
        candidate = self.candidate(st_logg=4.438 + math.log10(2.0), st_rad=0.5, pl_orbper=365.25 / 8)
        # Mass = 2 * 0.25 = 0.5 solar; a^3 = 0.5 / 64.
        self.assertAlmostEqual(candidate["semi_major_axis_au"], (0.5 / 64) ** (1 / 3), places=9)

    def test_a_candidate_with_orbit_and_transit_time_has_a_position(self) -> None:
        candidate = self.candidate()
        self.assertEqual(candidate["orbit_display_state"], "position")
        self.assertEqual(candidate["ephemeris_reference_type"], "conjunction")
        self.assertEqual(candidate["ephemeris_time_system"], "BJD-TDB")
        self.assertEqual(candidate["ephemeris_source_table"], "toi")
        self.assertEqual(candidate["ephemeris_period_days"], 365.25)
        self.assertEqual(candidate["ephemeris_period_days_err_minus"], 0.01)
        self.assertEqual(candidate["ephemeris_reference_time_jd"], 2460000.5)
        self.assertEqual(candidate["ephemeris_reference_time_jd_err_plus"], 0.002)
        self.assertTrue(candidate["detected_by_transit"])
        self.assertEqual(candidate["transit_depth_ppm"], 900.0)
        self.assertEqual(candidate["transit_duration_hours"], 3.0)
        self.assertEqual(candidate["toi_created"], "2024-01-02")
        self.assertEqual(candidate["toi_updated"], "2025-06-07")

    def test_a_candidate_without_a_transit_time_has_an_orbit_only(self) -> None:
        candidate = self.candidate(pl_tranmid=None)
        self.assertEqual(candidate["orbit_display_state"], "orbit_only")
        self.assertNotIn("ephemeris_reference_type", candidate)
        self.assertAlmostEqual(candidate["semi_major_axis_au"], 1.0, places=9)

    def test_a_transit_time_after_the_snapshot_is_not_a_measured_epoch(self) -> None:
        snapshot_jd = self.builder.julian_day(SNAPSHOT_TIME)
        self.assertEqual(self.candidate(pl_tranmid=snapshot_jd + 300)["orbit_display_state"], "position")
        self.assertEqual(self.candidate(pl_tranmid=snapshot_jd + 400)["orbit_display_state"], "orbit_only")

    def test_no_period_or_no_star_data_gives_no_orbit(self) -> None:
        for values in (
            {"pl_orbper": None},
            {"pl_orbper": 0.0},
            {"pl_orbperlim": 1},
            {"st_logg": None},
            {"st_rad": None},
            {"st_rad": 0.0},
        ):
            candidate = self.candidate(**values)
            self.assertEqual(candidate["orbit_display_state"], "none", values)
            self.assertNotIn("semi_major_axis_au", candidate, values)
            self.assertNotIn("ephemeris_reference_type", candidate, values)

    def test_a_star_mass_that_is_not_credible_gives_no_orbit(self) -> None:
        # log(g) of a giant with the radius of a dwarf, and the opposite case.
        self.assertEqual(self.candidate(st_logg=2.0, st_rad=1.0)["orbit_display_state"], "none")
        self.assertEqual(self.candidate(st_logg=4.438, st_rad=10.0)["orbit_display_state"], "none")
        system = self.build(toi_row("100.01", st_logg=2.0))[0]
        self.assertNotIn("stellar_mass_solar", system)
        self.assertNotIn("stellar_mass_atlas_calculated", system)

    def test_a_star_mass_with_an_uncertainty_as_large_as_the_mass_gives_no_orbit(self) -> None:
        self.assertEqual(self.candidate(st_loggerr1=0.4, st_loggerr2=-0.4)["orbit_display_state"], "position")
        self.assertEqual(self.candidate(st_loggerr1=0.5, st_loggerr2=-0.1)["orbit_display_state"], "none")
        self.assertEqual(self.candidate(st_raderr1=0.5, st_raderr2=-0.5)["orbit_display_state"], "none")

    def test_orbit_size_without_star_uncertainties_has_no_uncertainty(self) -> None:
        candidate = self.candidate(st_loggerr1=None, st_loggerr2=None)
        self.assertAlmostEqual(candidate["semi_major_axis_au"], 1.0, places=9)
        self.assertNotIn("semi_major_axis_au_err_plus", candidate)

    def test_a_star_without_a_distance_is_not_in_the_catalog(self) -> None:
        rows = [toi_row("100.01"), toi_row("200.01", st_dist=None), toi_row("300.01", st_dist=0.0), toi_row("400.01", ra=None)]
        systems = self.build(*rows)
        self.assertEqual([system["key"] for system in systems], ["toi-100"])
        coverage = self.builder.coverage(rows, systems)
        self.assertEqual(coverage["source_rows"], 4)
        self.assertEqual(coverage["excluded_no_distance"], 3)

    def test_other_dispositions_and_bad_toi_numbers_are_dropped(self) -> None:
        rows = [toi_row("100.01", tfopwg_disp="FP"), toi_row("100.02", tfopwg_disp="CP"), toi_row("100.04"), toi_row("100.03")]
        rows[2]["toi"] = "not-a-number"
        systems = self.build(*rows)
        self.assertEqual([candidate["key"] for candidate in systems[0]["candidates"]], ["toi-100-03"])
        self.assertEqual(self.build(toi_row("500.01", tfopwg_disp="FA")), [])

    def test_systems_are_in_toi_number_order(self) -> None:
        systems = self.build(toi_row("1000.01"), toi_row("99.01"), toi_row("250.01"))
        self.assertEqual([system["key"] for system in systems], ["toi-99", "toi-250", "toi-1000"])

    def test_records_have_no_null_fields(self) -> None:
        system = self.build(toi_row("100.01", pl_rade=None, pl_eqt=None, st_teff=None, ctoi_alias=None))[0]
        self.assertTrue(all(value is not None for value in system.values()))
        candidate = system["candidates"][0]
        self.assertTrue(all(value is not None for value in candidate.values()))
        self.assertNotIn("radius_earth", candidate)
        self.assertNotIn("equilibrium_temperature_k", candidate)
        self.assertEqual(system["color"], "#f0c987")

    def test_coverage_counts_each_disposition_and_display_state(self) -> None:
        rows = [toi_row("100.01"), toi_row("100.02", tfopwg_disp="APC", pl_tranmid=None), toi_row("200.01", st_logg=None)]
        coverage = self.builder.coverage(rows, self.build(*rows))
        self.assertEqual(coverage["disposition"], {"ambiguous_planet_candidate": 1, "planet_candidate": 2})
        self.assertEqual(coverage["orbit_display_state"], {"none": 1, "orbit_only": 1, "position": 1})


class ExoplanetCandidateSnapshotTest(unittest.TestCase):
    """Checks the checked-in snapshot against its own counts."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.builder = load_builder()
        cls.payload = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        cls.systems = cls.payload["systems"]
        cls.candidates = [candidate for system in cls.systems for candidate in system["candidates"]]

    def test_snapshot_counts_agree_with_its_records(self) -> None:
        self.assertEqual(self.payload["schema_version"], self.builder.SCHEMA_VERSION)
        self.assertEqual(self.payload["system_count"], len(self.systems))
        self.assertEqual(self.payload["candidate_count"], len(self.candidates))
        coverage = self.payload["coverage"]
        self.assertEqual(coverage["disposition"], dict(sorted(Counter(candidate["disposition"] for candidate in self.candidates).items())))
        self.assertEqual(
            coverage["orbit_display_state"],
            dict(sorted(Counter(candidate["orbit_display_state"] for candidate in self.candidates).items())),
        )
        self.assertEqual(coverage["source_rows"], len(self.candidates) + coverage["excluded_no_distance"])

    def test_snapshot_source_block_stays_small_for_api_rows(self) -> None:
        source = self.payload["source"]
        self.assertEqual(source["table"], "toi")
        self.assertEqual(source["dispositions"], ["APC", "PC"])
        self.assertLess(len(json.dumps(source)), 600)
        self.assertIn("tfopwg_disp in ('PC', 'APC')", self.payload["queries"]["toi"])

    def test_snapshot_keys_are_unique_and_follow_the_key_rules(self) -> None:
        keys = [system["key"] for system in self.systems] + [candidate["key"] for candidate in self.candidates]
        self.assertEqual(len(keys), len(set(keys)))
        for system in self.systems:
            self.assertRegex(system["key"], r"^toi-\d+$")
            self.assertEqual(system["name"], f"TOI-{system['key'][4:]}")
            self.assertGreater(system["distance_pc"], 0)
            self.assertEqual(system["candidate_count"], len(system["candidates"]))
            for candidate in system["candidates"]:
                self.assertRegex(candidate["key"], rf"^{system['key']}-\d+$")

    def test_each_candidate_is_marked_as_a_candidate(self) -> None:
        self.assertEqual({candidate["disposition"] for candidate in self.candidates}, {"planet_candidate", "ambiguous_planet_candidate"})
        self.assertEqual({candidate["tfopwg_disposition"] for candidate in self.candidates}, {"PC", "APC"})

    def test_each_calculated_position_has_a_complete_ephemeris(self) -> None:
        snapshot_jd = self.builder.julian_day(datetime.fromisoformat(self.payload["generated_at_utc"].replace("Z", "+00:00")))
        for candidate in self.candidates:
            state = candidate["orbit_display_state"]
            if state == "none":
                self.assertNotIn("semi_major_axis_au", candidate)
                self.assertNotIn("ephemeris_reference_type", candidate)
                continue
            self.assertGreater(candidate["semi_major_axis_au"], 0)
            self.assertTrue(candidate["semi_major_axis_atlas_calculated"])
            if "semi_major_axis_au_err_plus" in candidate:
                self.assertLess(candidate["semi_major_axis_au_err_plus"], candidate["semi_major_axis_au"] / 3)
            if state == "orbit_only":
                self.assertNotIn("ephemeris_reference_type", candidate)
                continue
            self.assertEqual(state, "position")
            self.assertEqual(candidate["ephemeris_reference_type"], "conjunction")
            self.assertEqual(candidate["ephemeris_time_system"], "BJD-TDB")
            self.assertGreater(candidate["ephemeris_period_days"], 0)
            self.assertLessEqual(candidate["ephemeris_reference_time_jd"], snapshot_jd + candidate["ephemeris_period_days"])
            self.assertGreater(candidate["ephemeris_reference_time_jd"], 2_450_000)


if __name__ == "__main__":
    unittest.main()

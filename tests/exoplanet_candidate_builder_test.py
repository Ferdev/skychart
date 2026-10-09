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
        return self.builder.build_toi_systems(list(rows), SNAPSHOT_TIME)

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
        self.assertEqual(system["candidates"][1]["disposition_source"], "TFOPWG disposition PC")
        self.assertEqual(system["candidates"][1]["source_catalog"], "TESS Objects of Interest")
        self.assertEqual(system["catalog"], "toi")
        self.assertEqual(system["host_identifiers"], ["TIC 1100"])

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
        coverage = self.builder.catalog_coverage(len(rows), systems)
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
        coverage = self.builder.catalog_coverage(len(rows), self.build(*rows))
        self.assertEqual(coverage["disposition"], {"ambiguous_planet_candidate": 1, "planet_candidate": 2})
        self.assertEqual(coverage["orbit_display_state"], {"none": 1, "orbit_only": 1, "position": 1})


def koi_row(name: str, **values: Any) -> dict[str, Any]:
    """One row of the cumulative KOI table."""
    row: dict[str, Any] = {
        "kepoi_name": name,
        "kepler_name": None,
        "kepid": 7000000 + int(name[1:6]),
        "koi_disposition": "CANDIDATE",
        "koi_score": 0.9,
        "koi_period": 10.0,
        "koi_period_err1": 0.00002,
        "koi_period_err2": -0.00002,
        "koi_time0": 2455000.25,
        "koi_time0_err1": 0.001,
        "koi_time0_err2": -0.001,
        "koi_sma": 0.09,
        "koi_incl": 88.5,
        "koi_prad": 2.0,
        "koi_prad_err1": 0.3,
        "koi_prad_err2": -0.2,
        "koi_teq": 800.0,
        "koi_insol": 90.0,
        "koi_depth": 400.0,
        "koi_duration": 3.5,
        "koi_steff": 5600.0,
        "koi_slogg": 4.4,
        "koi_srad": 0.95,
        "koi_smass": 0.97,
        "koi_kepmag": 14.2,
        "ra": 290.0,
        "dec": 45.0,
    }
    row.update(values)
    return row


def k2_row(name: str, **values: Any) -> dict[str, Any]:
    """One default row of the K2 Planets and Candidates table."""
    row: dict[str, Any] = {
        "pl_name": name,
        "hostname": name.split(".")[0],
        "epic_hostname": name.split(".")[0],
        "epic_candname": name,
        "tic_id": "TIC 555",
        "gaia_dr3_id": "Gaia DR3 777",
        "hd_name": None,
        "hip_name": None,
        "disposition": "CANDIDATE",
        "disp_refname": "Fixture et al. 2019",
        "pl_refname": "<a refstr=FIXTURE_2019 href=https://ui.adsabs.harvard.edu/abs/2019Fix/abstract target=ref>Fixture et al. 2019</a>",
        "pl_orbper": 365.25,
        "pl_orbpererr1": 0.01,
        "pl_orbpererr2": -0.02,
        "pl_orbperlim": 0,
        "pl_orbsmax": None,
        "pl_tranmid": 2457000.5,
        "pl_tranmiderr1": 0.003,
        "pl_tranmiderr2": -0.003,
        "pl_tranmidlim": 0,
        "pl_tsystemref": "BJD",
        "pl_rade": 1.5,
        "pl_radeerr1": 0.1,
        "pl_radeerr2": -0.1,
        "pl_radelim": 0,
        "pl_trandep": 0.0556,
        "pl_trandur": 3.4,
        "st_teff": 4500.0,
        "st_rad": 1.0,
        "st_raderr1": 0.05,
        "st_raderr2": -0.05,
        "st_mass": 1.0,
        "st_masserr1": 0.03,
        "st_masserr2": -0.06,
        "st_logg": None,
        "sy_dist": 200.0,
        "ra": 130.0,
        "dec": 10.0,
    }
    row.update(values)
    return row


class OtherCandidateCatalogsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.builder = load_builder()

    def koi(self, *rows: dict[str, Any], distances: dict[int, dict[str, float]] | None = None) -> list[dict[str, Any]]:
        if distances is None:
            distances = {row["kepid"]: {"distance_pc": 900.0, "distance_pc_err_plus": 20.0, "distance_pc_err_minus": 18.0} for row in rows}
        return self.builder.build_koi_systems(list(rows), distances, SNAPSHOT_TIME)

    def k2(self, *rows: dict[str, Any]) -> list[dict[str, Any]]:
        return self.builder.build_k2_systems(list(rows), SNAPSHOT_TIME)

    def test_queries_take_only_candidates_and_the_default_k2_row(self) -> None:
        self.assertIn("from cumulative", self.builder.KOI_QUERY)
        self.assertIn("koi_disposition in ('CANDIDATE', 'CONFIRMED')", self.builder.KOI_QUERY)
        self.assertIn("from k2pandc", self.builder.K2_QUERY)
        self.assertIn("disposition = 'CANDIDATE'", self.builder.K2_QUERY)
        self.assertIn("default_flag = 1", self.builder.K2_QUERY)
        self.assertIn('"J/AJ/159/280/table2"', self.builder.KOI_DISTANCE_QUERY)
        self.assertIn("KIC IN", self.builder.KOI_DISTANCE_QUERY)

    def test_koi_distances_come_by_exact_kic_number_in_batches(self) -> None:
        queries: list[str] = []

        def fetch(query: str) -> list[list[Any]]:
            queries.append(query)
            return [[7, 500.5, 12.0, -11.0]] if "(7,9)" in query else [[11, None, None, None], [13, 0.0, 1.0, -1.0]]

        distances = self.builder.fetch_koi_distances([9, 7, 13, 11, 7], fetch=fetch, batch_size=2)
        self.assertEqual(len(queries), 2)
        self.assertIn("KIC IN (7,9)", queries[0])
        self.assertIn("KIC IN (11,13)", queries[1])
        self.assertEqual(distances, {7: {"distance_pc": 500.5, "distance_pc_err_plus": 12.0, "distance_pc_err_minus": 11.0}})

    def test_a_koi_candidate_keeps_the_pipeline_orbit_size_and_the_bjd_transit_time(self) -> None:
        system = self.koi(koi_row("K00753.01"), koi_row("K00753.02", koi_sma=None))[0]
        self.assertEqual(system["key"], "koi-753")
        self.assertEqual(system["name"], "KOI-753")
        self.assertEqual(system["catalog"], "koi")
        self.assertEqual(system["aliases"], ["KOI-753", "KIC 7000753"])
        self.assertEqual(system["host_identifiers"], ["KOI-753", "KIC 7000753"])
        self.assertEqual(system["distance_pc"], 900.0)
        self.assertEqual(system["distance_pc_err_minus"], 18.0)
        self.assertEqual(system["distance_source"], "Berger et al. 2020")
        self.assertEqual(system["stellar_mass_solar"], 0.97)
        self.assertNotIn("stellar_mass_atlas_calculated", system)
        first, second = system["candidates"]
        self.assertEqual(first["key"], "koi-753-01")
        self.assertEqual(first["name"], "KOI-753.01")
        self.assertEqual(first["aliases"], ["KOI 753.01", "K00753.01"])
        self.assertEqual(first["disposition"], "planet_candidate")
        self.assertEqual(first["disposition_source"], "Kepler KOI disposition CANDIDATE")
        self.assertEqual(first["source_catalog"], "Kepler Objects of Interest")
        self.assertEqual(first["semi_major_axis_au"], 0.09)
        self.assertTrue(first["semi_major_axis_calculated"])
        self.assertNotIn("semi_major_axis_atlas_calculated", first)
        self.assertEqual(first["inclination_deg"], 88.5)
        self.assertEqual(first["radius_earth_err_minus"], 0.2)
        self.assertEqual(first["orbit_display_state"], "position")
        self.assertEqual(first["ephemeris_reference_time_jd"], 2455000.25)
        self.assertEqual(first["ephemeris_reference_time_jd_err_plus"], 0.001)
        self.assertEqual(first["ephemeris_period_days_err_minus"], 0.00002)
        self.assertEqual(first["ephemeris_time_system"], "BJD-TDB")
        self.assertEqual(first["ephemeris_source_table"], "cumulative")
        self.assertEqual(second["orbit_display_state"], "none")
        self.assertNotIn("ephemeris_reference_type", second)

    def test_a_koi_star_with_a_confirmed_planet_names_its_confirmed_host(self) -> None:
        rows = [
            koi_row("K00157.07"),
            koi_row("K00157.01", koi_disposition="CONFIRMED", kepler_name="Kepler-11 b"),
            koi_row("K00157.02", koi_disposition="CONFIRMED", kepler_name="Kepler-11 c"),
        ]
        systems = self.koi(*rows)
        self.assertEqual(len(systems), 1)
        self.assertEqual([candidate["key"] for candidate in systems[0]["candidates"]], ["koi-157-07"])
        self.assertEqual(systems[0]["host_identifiers"], ["Kepler-11", "KOI-157", "KIC 7000157"])

    def test_a_koi_star_without_a_distance_is_not_in_the_catalog(self) -> None:
        rows = [koi_row("K00010.01"), koi_row("K00020.01"), koi_row("K00030.01", koi_disposition="CONFIRMED", kepler_name="Kepler-9 b")]
        systems = self.koi(*rows, distances={7000010: {"distance_pc": 300.0}})
        self.assertEqual([system["key"] for system in systems], ["koi-10"])
        coverage = self.builder.catalog_coverage(2, systems)
        self.assertEqual((coverage["source_rows"], coverage["excluded_no_distance"], coverage["stars"], coverage["candidates"]), (2, 1, 1, 1))

    def test_a_k2_candidate_gets_its_orbit_from_the_published_star_mass(self) -> None:
        system = self.k2(k2_row("EPIC 201111557.01"))[0]
        self.assertEqual(system["key"], "epic-201111557")
        self.assertEqual(system["name"], "EPIC 201111557")
        self.assertEqual(system["catalog"], "k2")
        self.assertEqual(system["aliases"], ["EPIC 201111557", "TIC 555", "Gaia DR3 777"])
        self.assertEqual(system["host_identifiers"], ["EPIC 201111557", "TIC 555", "Gaia DR3 777"])
        self.assertEqual(system["tic_id"], "555")
        self.assertEqual(system["stellar_mass_solar"], 1.0)
        self.assertNotIn("stellar_mass_atlas_calculated", system)
        candidate = system["candidates"][0]
        self.assertEqual(candidate["key"], "epic-201111557-01")
        self.assertEqual(candidate["name"], "EPIC 201111557.01")
        self.assertNotIn("aliases", candidate)
        self.assertEqual(candidate["disposition_source"], "K2 disposition CANDIDATE, Fixture et al. 2019")
        self.assertAlmostEqual(candidate["semi_major_axis_au"], 1.0, places=9)
        self.assertTrue(candidate["semi_major_axis_atlas_calculated"])
        # sigma_a / a is one third of the larger relative mass uncertainty.
        self.assertAlmostEqual(candidate["semi_major_axis_au_err_plus"], 0.06 / 3, places=9)
        self.assertEqual(candidate["transit_depth_ppm"], 556.0)
        self.assertEqual(candidate["transit_duration_hours"], 3.4)
        self.assertEqual(candidate["period_days_err_minus"], 0.02)
        self.assertEqual(candidate["ephemeris_time_system"], "BJD")
        self.assertEqual(candidate["ephemeris_source_table"], "k2pandc")
        self.assertEqual(candidate["orbit_display_state"], "position")
        self.assertEqual(
            candidate["references"],
            [{"label": "Fixture et al. 2019", "url": "https://ui.adsabs.harvard.edu/abs/2019Fix/abstract", "quantities": ["period", "radius"]}],
        )

    def test_a_published_k2_orbit_size_is_kept_and_a_confirmed_host_name_is_an_identifier(self) -> None:
        row = k2_row("EPIC 206135682.04", hostname="K2-368", pl_name="K2-368 e", pl_orbsmax=0.2, pl_orbsmaxerr1=0.01, pl_orbsmaxerr2=-0.02, pl_orbsmaxlim=0)
        system = self.k2(row)[0]
        candidate = system["candidates"][0]
        self.assertEqual(system["host_identifiers"], ["K2-368", "TIC 555", "EPIC 206135682", "Gaia DR3 777"])
        self.assertEqual(candidate["aliases"], ["K2-368 e"])
        self.assertEqual(candidate["semi_major_axis_au"], 0.2)
        self.assertEqual(candidate["semi_major_axis_au_err_minus"], 0.02)
        self.assertNotIn("semi_major_axis_atlas_calculated", candidate)
        self.assertEqual(candidate["references"][0]["quantities"], ["period", "semi_major_axis", "radius"])

    def test_k2_rows_without_star_mass_or_distance_give_no_orbit_or_no_record(self) -> None:
        no_mass = self.k2(k2_row("EPIC 300000001.01", st_mass=None))[0]
        self.assertEqual(no_mass["candidates"][0]["orbit_display_state"], "none")
        self.assertNotIn("stellar_mass_solar", no_mass)
        from_gravity = self.k2(k2_row("EPIC 300000002.01", st_mass=None, st_logg=4.438))[0]
        self.assertAlmostEqual(from_gravity["candidates"][0]["semi_major_axis_au"], 1.0, places=9)
        self.assertTrue(from_gravity["stellar_mass_atlas_calculated"])
        limit = self.k2(k2_row("EPIC 300000003.01", pl_orbperlim=1))[0]
        self.assertEqual(limit["candidates"][0]["orbit_display_state"], "none")
        self.assertEqual(self.k2(k2_row("EPIC 300000004.01", sy_dist=None)), [])
        self.assertEqual(self.k2(k2_row("EPIC 300000005.01", disposition="CONFIRMED")), [])

    def test_the_community_report_of_tic_4206066_has_two_signals_with_the_published_values(self) -> None:
        systems = self.builder.build_community_systems(self.builder.COMMUNITY_REPORTS, SNAPSHOT_TIME)
        system = next(system for system in systems if system["key"] == "tic-4206066")
        self.assertEqual(system["catalog"], "community")
        self.assertEqual(system["name"], "TIC 4206066")
        self.assertEqual(system["aliases"], ["TIC 4206066", "StKM 1-561", "Gaia DR3 3220388198192519424"])
        self.assertEqual(system["host_identifiers"], ["TIC 4206066"])
        self.assertEqual(system["distance_pc"], 35.6)
        self.assertEqual(system["stellar_mass_solar"], 0.606)
        self.assertEqual(system["report_url"], "https://doi.org/10.5281/zenodo.22967456")
        self.assertNotIn("stellar_mass_solar_err", system)
        self.assertNotIn("report", system)
        first, second = sorted(system["candidates"], key=lambda candidate: candidate["period_days"])
        self.assertEqual(first["key"], "tic-4206066-3-18d")
        self.assertEqual(first["disposition"], "community_report")
        self.assertIn("not peer reviewed", first["disposition_source"])
        self.assertEqual(first["period_days"], 3.182785)
        self.assertEqual(first["period_days_err_plus"], 0.000006)
        self.assertEqual(first["ephemeris_reference_time_jd"], 2460998.736)
        self.assertEqual(first["ephemeris_reference_time_jd_err_minus"], 0.003)
        self.assertEqual(first["ephemeris_time_system"], "BJD-TDB")
        self.assertEqual(first["radius_earth"], 1.4)
        self.assertEqual(first["radius_earth_err_plus"], 0.1)
        self.assertEqual(first["orbit_display_state"], "position")
        self.assertTrue(first["semi_major_axis_atlas_calculated"])
        # a^3 = M P^2 with the published star mass of 0.606 solar masses.
        self.assertAlmostEqual(first["semi_major_axis_au"], (0.606 * (3.182785 / 365.25) ** 2) ** (1 / 3), places=12)
        self.assertAlmostEqual(first["semi_major_axis_au_err_plus"] / first["semi_major_axis_au"], 0.015 / 0.606 / 3, places=9)
        self.assertIn("no statistical validation", first["candidate_note"])
        self.assertEqual(second["key"], "tic-4206066-11-13d")
        self.assertEqual(second["period_days"], 11.13274)
        self.assertEqual(second["ephemeris_reference_time_jd"], 2461000.865)
        self.assertNotIn("radius_earth_err_plus", second)
        self.assertIn("Tentative", second["candidate_note"])
        self.assertAlmostEqual(second["semi_major_axis_au"], (0.606 * (11.13274 / 365.25) ** 2) ** (1 / 3), places=12)
        self.assertEqual(first["references"][0]["url"], "https://doi.org/10.5281/zenodo.22967456")

    def test_the_payload_has_one_small_source_block_and_one_coverage_block_for_each_catalog(self) -> None:
        payload = self.builder.build_payload([toi_row("100.01")], [koi_row("K00753.01")], {7000753: {"distance_pc": 900.0}}, [k2_row("EPIC 201111557.01")])
        self.assertEqual(payload["schema_version"], 2)
        self.assertEqual(sorted(payload["sources"]), ["community", "k2", "koi", "toi"])
        self.assertEqual(sorted(payload["coverage"]), ["community", "k2", "koi", "toi"])
        self.assertEqual([system["catalog"] for system in payload["systems"]], ["toi", "koi", "k2", "community"])
        self.assertEqual(payload["candidate_count"], 5)
        self.assertEqual(payload["system_count"], 4)
        for source in payload["sources"].values():
            self.assertLess(len(json.dumps(source)), 600)


class ExoplanetCandidateSnapshotTest(unittest.TestCase):
    """Checks the checked-in snapshot against its own counts."""

    KEY_RULES = {"toi": r"^toi-\d+$", "koi": r"^koi-\d+$", "k2": r"^epic-\d+$", "community": r"^tic-\d+$"}

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
        self.assertEqual(sorted(self.payload["coverage"]), ["community", "k2", "koi", "toi"])
        for catalog, coverage in self.payload["coverage"].items():
            systems = [system for system in self.systems if system["catalog"] == catalog]
            self.assertEqual(coverage, self.builder.catalog_coverage(coverage["source_rows"], systems), catalog)
            self.assertGreater(coverage["candidates"], 0, catalog)

    def test_snapshot_source_blocks_stay_small_for_api_rows(self) -> None:
        self.assertEqual(self.payload["sources"], self.builder.SOURCES)
        for source in self.payload["sources"].values():
            self.assertLess(len(json.dumps(source)), 600)
        self.assertIn("tfopwg_disp in ('PC', 'APC')", self.payload["queries"]["toi"])
        self.assertNotIn("source", self.payload)

    def test_snapshot_keys_are_unique_and_follow_the_key_rules(self) -> None:
        keys = [system["key"] for system in self.systems] + [candidate["key"] for candidate in self.candidates]
        self.assertEqual(len(keys), len(set(keys)))
        for system in self.systems:
            self.assertRegex(system["key"], self.KEY_RULES[system["catalog"]])
            self.assertGreater(system["distance_pc"], 0)
            self.assertEqual(system["candidate_count"], len(system["candidates"]))
            self.assertTrue(system["host_identifiers"], system["key"])
            for candidate in system["candidates"]:
                self.assertTrue(candidate["key"].startswith(f"{system['key']}-"), candidate["key"])

    def test_each_candidate_is_marked_as_a_candidate(self) -> None:
        self.assertEqual({candidate["disposition"] for candidate in self.candidates}, {"planet_candidate", "ambiguous_planet_candidate", "community_report"})
        for candidate in self.candidates:
            self.assertTrue(candidate["disposition_source"], candidate["key"])
            self.assertTrue(candidate["source_catalog"], candidate["key"])

    def test_each_calculated_position_has_a_complete_ephemeris(self) -> None:
        snapshot_jd = self.builder.julian_day(datetime.fromisoformat(self.payload["generated_at_utc"].replace("Z", "+00:00")))
        for candidate in self.candidates:
            state = candidate["orbit_display_state"]
            if state == "none":
                self.assertNotIn("semi_major_axis_au", candidate)
                self.assertNotIn("ephemeris_reference_type", candidate)
                continue
            self.assertGreater(candidate["semi_major_axis_au"], 0)
            # An orbit size is a published value, a value of the Kepler pipeline, or an atlas calculation with its flag.
            self.assertLessEqual(("semi_major_axis_atlas_calculated" in candidate) + ("semi_major_axis_calculated" in candidate), 1)
            if "semi_major_axis_au_err_plus" in candidate and "semi_major_axis_atlas_calculated" in candidate:
                self.assertLess(candidate["semi_major_axis_au_err_plus"], candidate["semi_major_axis_au"] / 3)
            if state == "orbit_only":
                self.assertNotIn("ephemeris_reference_type", candidate)
                continue
            self.assertEqual(state, "position")
            self.assertEqual(candidate["ephemeris_reference_type"], "conjunction")
            self.assertIn(candidate["ephemeris_time_system"], {"BJD-TDB", "BJD"})
            self.assertGreater(candidate["ephemeris_period_days"], 0)
            self.assertLessEqual(candidate["ephemeris_reference_time_jd"], snapshot_jd + candidate["ephemeris_period_days"])
            self.assertGreater(candidate["ephemeris_reference_time_jd"], 2_450_000)

    def test_the_thread_star_has_its_two_reported_signals(self) -> None:
        system = next(system for system in self.systems if system["key"] == "tic-4206066")
        self.assertEqual([candidate["key"] for candidate in system["candidates"]], ["tic-4206066-11-13d", "tic-4206066-3-18d"])
        self.assertEqual({candidate["disposition"] for candidate in system["candidates"]}, {"community_report"})


if __name__ == "__main__":
    unittest.main()

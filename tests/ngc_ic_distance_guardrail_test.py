from scripts.build_ngc_ic_catalog import build_object


def test_ngc_224_does_not_treat_openngc_pax_as_parallax():
    row = {
        "Name": "NGC0224",
        "Type": "G",
        "RA": "00:42:44.30",
        "Dec": "+41:16:09.2",
        "Pax": "6",
        "RadVel": "-300",
        "Redshift": "-0.001",
        "Common names": "Andromeda Galaxy",
        "M": "031",
    }

    obj = build_object(row)

    assert obj is not None
    assert obj["key"] == "ngc-224"
    assert obj["distance_quality"] == "not_available"
    assert "distance_pc" not in obj
    assert "distance_ly" not in obj
    assert 543.59 not in obj.values()


def test_openngc_galactic_class_never_uses_redshift_or_radial_velocity_distance():
    row = {
        "Name": "NGC9999",
        "Type": "OCl",
        "RA": "12:00:00",
        "Dec": "+10:00:00",
        "Redshift": "0.02",
        "RadVel": "6000",
    }

    obj = build_object(row)

    assert obj is not None
    assert obj["distance_quality"] == "not_available"
    assert "distance_pc" not in obj
    assert "distance_ly" not in obj

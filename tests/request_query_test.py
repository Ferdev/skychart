import pytest

from backend.errors import QueryInputError
from backend.request_query import parse_catalog_keys, parse_trail_body_keys


@pytest.mark.parametrize("query, expected", [
    ({}, []),
    ({"keys": [""]}, []),  # Sky-share requests include an empty keys parameter.
    ({"keys": ["Earth, moon", "earth"]}, ["earth", "moon"]),
    ({"keys": ["spacecraft-31"]}, ["spacecraft-31"]),
])
def test_ephemeris_keys_accept_core_and_spacecraft_objects(query, expected):
    assert parse_catalog_keys(query) == expected


def test_unknown_ephemeris_key_is_an_input_error():
    with pytest.raises(QueryInputError, match="Unknown object key"):
        parse_catalog_keys({"keys": ["unknown-object"]})


def test_trails_reject_spacecraft_without_restricting_ephemeris_keys():
    with pytest.raises(QueryInputError, match="Spacecraft trails are not supported"):
        parse_trail_body_keys(["earth,spacecraft-31"])
    assert parse_trail_body_keys(["Earth,moon,earth"]) == ["earth", "moon"]


def test_unknown_trail_key_is_an_input_error():
    with pytest.raises(QueryInputError, match="Unknown body key"):
        parse_trail_body_keys(["unknown-object"])

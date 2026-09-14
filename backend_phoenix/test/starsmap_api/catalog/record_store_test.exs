defmodule StarsmapApi.Catalog.RecordStoreTest do
  use StarsmapApi.DataCase
  alias StarsmapApi.Catalog.RecordStore, as: Store

  defp record(id, attrs \\ %{}) do
    Map.merge(
      %{
        "provider" => "fixture",
        "catalog" => "sources",
        "release" => "v1",
        "source_id" => id,
        "name" => "source #{id}",
        "documentation" => "fixture:source-schema",
        "aliases" => [],
        "astrometry" => %{},
        "measurements" => []
      },
      attrs
    )
  end

  test "metadata, a blend, binary components and a moving body retain independent identities" do
    records = [
      record("18446744073709551615"),
      record("blend", %{
        "relationships" => [%{"kind" => "unresolved_blend", "candidates" => ["A", "B"]}]
      }),
      record("A", %{"relationships" => [%{"kind" => "component_of", "source_id" => "system"}]}),
      record("B", %{"relationships" => [%{"kind" => "component_of", "source_id" => "system"}]}),
      record("moving", %{
        "ephemeris" => %{
          "model" => "jpl",
          "epoch" => "2026-09-08",
          "provenance" => "fixture:orbit"
        }
      })
    ]

    keys = Enum.map(records, &Store.put_record!/1)
    assert length(Enum.uniq(keys)) == 5

    for {key, record} <- Enum.zip(keys, records),
        do: assert(Store.get_record(key) == Store.normalize!(record))

    assert Store.get_record(hd(keys))["source_id"] == "18446744073709551615"
    refute Store.get_record(hd(keys))["capabilities"]["spatial_position"]
    assert Store.get_record(List.last(keys))["capabilities"]["dynamic_ephemeris"]
  end

  test "nonpositive parallax is retained and cannot itself claim spatial placement" do
    r =
      record("negative", %{
        "astrometry" => %{"ra_deg" => 0, "dec_deg" => -90, "frame" => "ICRS", "epoch" => 2016.0},
        "measurements" => [
          %{"field" => "parallax", "value" => -0.3, "unit" => "mas", "error" => 0.9}
        ]
      })

    stored = Store.get_record(Store.put_record!(r))
    assert stored["capabilities"]["angular_position"]
    refute stored["capabilities"]["spatial_position"]
    assert stored["measurements"] == r["measurements"]
    assert_raise ArgumentError, fn -> Store.put_record!(Map.put(r, "spatial", %{"x_au" => 0})) end
    assert_raise ArgumentError, fn -> Store.put_record!(Map.put(r, "source_id", 123)) end
  end

  test "retries are idempotent; altered contents require a new release" do
    r = record("same", %{"aliases" => ["HD 1", "HIP 1"]})
    key = Store.put_record!(r)
    assert Store.put_record!(r) == key
    assert_raise ArgumentError, fn -> Store.put_record!(Map.put(r, "name", "changed")) end
    new_key = Store.put_record!(Map.put(r, "release", "v2"))
    refute new_key == key
    assert Store.get_record(key)["release"] == "v1"
  end

  test "ambiguous associations remain separate and retractions preserve their history" do
    key = Store.put_record!(record("blend"))

    evidence = %{
      evidence_key: "e1",
      record_key: key,
      public_key: "hip-1",
      status: "candidate",
      method: "published_identifier",
      provenance: %{"release" => "crossmatch-v1", "score" => 0.6}
    }

    Store.append_evidence!(evidence)
    Store.append_evidence!(%{evidence | evidence_key: "e2", public_key: "hip-2"})
    assert [%{status: "candidate"}] = Store.evidence_for("hip-1").evidence
    assert [%{status: "candidate"}] = Store.evidence_for("hip-2").evidence

    Store.append_evidence!(
      Map.merge(evidence, %{evidence_key: "e3", status: "retracted", supersedes: "e1"})
    )

    assert Store.evidence_for("hip-1").evidence == []
    assert length(Store.evidence_for("hip-2").evidence) == 1

    assert Repo.one(from e in "catalog_identification_evidence", select: count(e.evidence_key)) ==
             3

    assert Store.get_record(key)
  end

  test "published same-object evidence preserves the legacy public key and competing facts" do
    for {id, provider, mass} <- [{"one", "survey-a", 1.0}, {"two", "survey-b", 1.3}] do
      key =
        Store.put_record!(
          record(id, %{
            "provider" => provider,
            "measurements" => [%{"field" => "mass", "value" => mass, "unit" => "solar_mass"}]
          })
        )

      Store.append_evidence!(%{
        evidence_key: id,
        record_key: key,
        public_key: "hip-123",
        status: "confirmed",
        method: "published_identifier",
        provenance: %{"table" => "fixture:xmatch"}
      })
    end

    assert length(Store.evidence_for("hip-123").evidence) == 2
  end

  test "the database rejects mutations of historical source records" do
    key = Store.put_record!(record("immutable"))

    assert_raise Postgrex.Error, ~r/catalog history is immutable/, fn ->
      Repo.query!(
        "UPDATE catalog_record_versions SET source_id = 'changed' WHERE record_key = $1",
        [key]
      )
    end
  end
end

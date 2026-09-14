defmodule StarsmapApi.Catalog.GaiaObjectCacheTest do
  use StarsmapApi.DataCase, async: true

  alias StarsmapApi.Catalog.GaiaObjectCache
  alias StarsmapApi.Catalog.PublicObjects
  alias StarsmapApi.Repo

  test "hydrates a Gaia source from the local cache without an upstream call" do
    payload = %{"key" => "gaia_dr3_123", "name" => "Gaia DR3 123", "object_type" => "star"}
    Repo.insert!(%GaiaObjectCache{source_id: 123, payload: payload})
    assert {:ok, cached} = PublicObjects.gaia_object("123")
    assert cached["frame_contract"] == "legacy-gaia-23.43928-2016"
    assert Map.delete(cached, "frame_contract") == payload
  end

  test "preserves the declared frame of new cached records" do
    payload = %{
      "key" => "gaia_dr3_124",
      "name" => "Gaia DR3 124",
      "frame_contract" => "heliocentric-ecliptic-J2000-v1"
    }

    Repo.insert!(%GaiaObjectCache{source_id: 124, payload: payload})
    assert {:ok, ^payload} = PublicObjects.gaia_object("124")
  end

  test "rejects malformed source ids" do
    assert {:error, :invalid_source_id} = PublicObjects.gaia_object("123 or 1=1")
  end
end

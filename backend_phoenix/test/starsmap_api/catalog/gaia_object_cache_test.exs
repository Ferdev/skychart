defmodule StarsmapApi.Catalog.GaiaObjectCacheTest do
  use StarsmapApi.DataCase, async: true

  alias StarsmapApi.Catalog
  alias StarsmapApi.Catalog.GaiaObjectCache
  alias StarsmapApi.Repo

  test "hydrates a Gaia source from the local cache without an upstream call" do
    payload = %{"key" => "gaia_dr3_123", "name" => "Gaia DR3 123", "object_type" => "star"}
    Repo.insert!(%GaiaObjectCache{source_id: 123, payload: payload})
    assert {:ok, ^payload} = Catalog.gaia_object("123")
  end

  test "rejects malformed source ids" do
    assert {:error, :invalid_source_id} = Catalog.gaia_object("123 or 1=1")
  end
end

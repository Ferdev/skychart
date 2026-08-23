defmodule StarsmapApi.Catalog.DesiObjectTest do
  use StarsmapApi.DataCase, async: false

  alias StarsmapApi.Catalog.DesiObject
  alias StarsmapApi.Catalog.PublicCache
  alias StarsmapApi.Catalog.PublicObjects

  @target_id "39633286493899023"
  @csv """
  targetid,ra,dec,z,zwarn,spectype,zcat_primary,flux_r
  39633286493899023,227.2928137114773,52.53885918418612,0.01114409699928142,0,GALAXY,t,117.716805
  """

  setup do
    PublicCache.clear()
    test_process = self()

    Application.put_env(:starsmap_api, :desi_query_fetcher, fn target_id ->
      send(test_process, {:desi_query, target_id})
      {:ok, @csv}
    end)

    on_exit(fn ->
      Application.delete_env(:starsmap_api, :desi_query_fetcher)
      PublicCache.clear()
    end)

    :ok
  end

  test "hydrates the tile-only DESI record with survey coordinates and caches it" do
    assert {:ok, payload} = DesiObject.lookup(@target_id)
    assert_receive {:desi_query, @target_id}

    assert payload.key == "desi-dr1-#{@target_id}"
    assert payload.object_type == "galaxy"
    assert payload.catalog_group == "desi_dr1_galaxies"
    assert payload.position_model == "catalog_redshift_comoving"
    assert payload.astrometry.ra_deg == 227.2928137114773
    assert payload.astrometry.dec_deg == 52.53885918418612
    assert_in_delta payload.astrometry.apparent_magnitude, 17.3229038344, 1.0e-9
    assert_in_delta payload.facts.redshift, 0.01114409699928142, 1.0e-15
    assert_in_delta payload.position.x_au, -4_190_682_128_246.59, 1.0
    assert_in_delta payload.position.y_au, -958_131_612_681.30, 1.0
    assert_in_delta payload.position.z_au, 9_204_120_788_104.85, 2.0

    assert {:ok, cached} = DesiObject.lookup(@target_id)
    assert cached == payload
    refute_receive {:desi_query, @target_id}
  end

  test "generic object lookup restores a cold DESI permalink" do
    assert {:ok, payload} = PublicObjects.get_by_key("desi-dr1-#{@target_id}")
    assert payload.astrometry.ra_deg == 227.2928137114773
    assert payload.external_ids.desi_targetid == @target_id
  end

  test "rejects malformed target IDs before querying the upstream catalog" do
    assert {:error, :invalid_target_id} = DesiObject.lookup("3963 or 1=1")
    refute_receive {:desi_query, _}
  end

  test "rejects a mismatched upstream row" do
    Application.put_env(:starsmap_api, :desi_query_fetcher, fn _target_id ->
      {:ok, String.replace(@csv, @target_id, "39633286493899024")}
    end)

    assert {:error, :not_found} = DesiObject.lookup(@target_id)
  end
end

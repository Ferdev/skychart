defmodule StarsmapApi.SpacecraftTest do
  use ExUnit.Case, async: false
  alias StarsmapApi.Spacecraft
  alias StarsmapApi.Catalog.PublicObjects

  test "mission metadata is searchable by alias without a database or current position" do
    [webb] = Spacecraft.search("JWST", [], [])
    assert webb.key == "spacecraft-170"
    assert is_nil(webb.position)
    assert Spacecraft.search("JWST", [], ["star"]) == []

    result =
      StarsmapApi.Catalog.Search.search(%{
        "q" => "Voyager",
        "types" => "spacecraft",
        "limit" => "1"
      })

    assert result.total == 2
    assert result.has_more

    second =
      StarsmapApi.Catalog.Search.search(%{
        "q" => "Voyager",
        "types" => "spacecraft",
        "limit" => "1",
        "offset" => "1"
      })

    refute second.has_more
    assert hd(result.objects).key != hd(second.objects).key
    assert Spacecraft.search("Voyager", ["spacecraft"], ["spacecraft"]) |> length() == 2
  end

  test "stable public identities preserve historical mission coverage" do
    assert {:ok, cassini} = PublicObjects.get_by_key("spacecraft-82")
    assert cassini.object_type == "spacecraft"
    assert cassini.facts["end_utc"] == "2017-09-15T10:31:00Z"
    assert {:ok, observer} = PublicObjects.public_observer("spacecraft-31")
    assert observer.position_model == "jpl_spacecraft_vectors"
    assert {:ok, [_ | _]} = PublicObjects.external_links_by_key("spacecraft-31")
    assert {:error, :not_found} = PublicObjects.get_by_key("spacecraft-unknown")
  end

  defmodule EphemerisFixture do
    def snapshot(_epoch, keys) do
      body =
        if keys == [] do
          %{
            "key" => "earth",
            "name" => "Earth",
            "position" => %{"x_au" => 1, "y_au" => 0, "z_au" => 0}
          }
        else
          %{
            "key" => hd(keys),
            "name" => "Voyager 1",
            "object_type" => "spacecraft",
            "position" =>
              if(hd(keys) == "spacecraft-31",
                do: %{"x_au" => 100, "y_au" => 20, "z_au" => 30},
                else: nil
              )
          }
        end

      {:ok, %{"bodies" => [body]}}
    end
  end

  test "Sky shares resolve spacecraft at the selected epoch and reject missing positions" do
    previous = Application.get_env(:starsmap_api, :sky_share_ephemeris_provider)
    Application.put_env(:starsmap_api, :sky_share_ephemeris_provider, EphemerisFixture)

    on_exit(fn ->
      if previous,
        do: Application.put_env(:starsmap_api, :sky_share_ephemeris_provider, previous),
        else: Application.delete_env(:starsmap_api, :sky_share_ephemeris_provider)
    end)

    assert {:ok, observer, _scene} =
             StarsmapApi.SkyShare.Context.resolve("spacecraft-31", ~U[2026-09-06 00:00:00Z])

    assert observer.object_type == "spacecraft"

    assert {:error, :invalid_observer_position} =
             StarsmapApi.SkyShare.Context.resolve("spacecraft-82", ~U[2026-09-06 00:00:00Z])
  end

  test "public spacecraft pages render unknown astrometry without inventing coordinates" do
    conn = Plug.Test.conn(:get, "/o/spacecraft-31")
    conn = StarsmapApiWeb.ObjectPageController.show(conn, %{"key" => "spacecraft-31"})
    assert conn.status == 200
    assert conn.resp_body =~ "Voyager 1"

    assert conn.resp_body =~ "jpl_spacecraft_vectors" or
             conn.resp_body =~ "Provider spacecraft trajectory"
  end
end

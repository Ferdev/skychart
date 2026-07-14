defmodule StarsmapApi.SkyEvents.RefresherTest do
  use StarsmapApi.DataCase, async: false
  alias StarsmapApi.SkyEvents.Refresher

  test "parses the month-name timestamps returned by JPL CNEOS" do
    assert {:ok, ~U[2026-07-19 02:04:00Z]} = Refresher.parse_date("2026-Jul-19 02:04")
    assert :error = Refresher.parse_date("not-a-cneos-date")
  end

  test "parses NASA publication dates with month precision" do
    assert [%{starts_at: ~U[2026-07-01 00:00:00Z], title: "TOI-4311 b confirmed"}] =
             Refresher.parse_exoplanet(%{
               "pl_name" => "TOI-4311 b",
               "hostname" => "TOI-4311",
               "disc_pubdate" => "2026-07"
             })
  end

  test "parsing upstream events leaves optional catalog binding out of ingestion" do
    assert [event = %{title: "TOI-4311 b confirmed"}] =
             Refresher.parse_exoplanet(%{
               "pl_name" => "TOI-4311 b",
               "hostname" => "TOI-4311",
               "disc_pubdate" => "2026-07"
             })

    refute Map.has_key?(event, :catalog_key)
  end

  test "one unavailable source does not block a healthy source" do
    fetcher = fn
      :cneos -> {:error, {:upstream_status, 500}}
      :exoplanets -> {:ok, []}
    end

    assert {:ok, 0} = Refresher.refresh(fetcher)
  end

  test "accepts successful Hackney responses with an eagerly loaded body" do
    body = ~s({"events":[]})

    assert {:ok, ^body} = Refresher.normalize_response({:ok, 200, [], body})

    assert {:error, {:upstream_status, 503}} =
             Refresher.normalize_response({:ok, 503, [], "unavailable"})
  end

  test "an exception from one source does not block a healthy source" do
    fetcher = fn
      :cneos -> raise "invalid upstream response"
      :exoplanets -> {:ok, []}
    end

    assert {:ok, 0} = Refresher.refresh(fetcher)
  end

  test "all upstream failures do not crash scheduler" do
    fetcher = fn source -> {:error, {source, :unavailable}} end

    assert {:error,
            {:all_sources_failed,
             [cneos: {:cneos, :unavailable}, exoplanets: {:exoplanets, :unavailable}]}} =
             Refresher.refresh(fetcher)

    assert {:ok, pid} =
             GenServer.start_link(Refresher,
               fetcher: fetcher,
               initial_delay: 0,
               interval: 20,
               jitter_seed: 1
             )

    Process.sleep(10)
    assert Process.alive?(pid)
  end
end

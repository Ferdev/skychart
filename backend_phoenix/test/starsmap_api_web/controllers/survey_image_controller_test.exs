defmodule StarsmapApiWeb.SurveyImageControllerTest do
  use StarsmapApiWeb.ConnCase, async: false

  defmodule FailoverHttpClient do
    def request(:get, url, _headers, <<>>, options) do
      send(self(), {:survey_image_request, url, options})

      if String.contains?(url, "alasky.cds.unistra.fr") do
        {:error, :timeout}
      else
        {:ok, 200, [{"content-type", "image/jpeg"}], <<255, 216, 255, 217>>}
      end
    end
  end

  defmodule FailingHttpClient do
    def request(:get, url, _headers, <<>>, _options) do
      send(self(), {:survey_image_request, url})
      {:ok, 503, [{"content-type", "text/plain"}], "unavailable"}
    end
  end

  defmodule TransientLegacyHttpClient do
    def request(:get, url, _headers, <<>>, _options) do
      send(self(), {:survey_image_request, url})

      case Process.get(:legacy_request_count, 0) do
        0 ->
          Process.put(:legacy_request_count, 1)
          {:error, :timeout}

        _count ->
          {:ok, 200, [{"content-type", "image/jpeg"}], <<255, 216, 255, 217>>}
      end
    end
  end

  setup do
    original_http_client = Application.get_env(:starsmap_api, :survey_image_http_client)
    Application.put_env(:starsmap_api, :survey_image_http_client, FailoverHttpClient)

    on_exit(fn ->
      if original_http_client do
        Application.put_env(:starsmap_api, :survey_image_http_client, original_http_client)
      else
        Application.delete_env(:starsmap_api, :survey_image_http_client)
      end
    end)
  end

  test "proxies DSS2 through the secondary CDS host when the primary fails", %{conn: conn} do
    conn =
      get(
        conn,
        ~p"/api/survey-image?provider=dss2&ra=171.413935&dec=-3.348847&fov=0.120"
      )

    assert response(conn, 200) == <<255, 216, 255, 217>>
    assert get_resp_header(conn, "content-type") == ["image/jpeg; charset=utf-8"]

    assert get_resp_header(conn, "cache-control") == [
             "public, max-age=86400, stale-if-error=604800"
           ]

    assert_received {:survey_image_request, primary_url, primary_options}
    assert_received {:survey_image_request, secondary_url, secondary_options}
    assert primary_url =~ "https://alasky.cds.unistra.fr/hips-image-services/hips2fits?"
    assert secondary_url =~ "https://alaskybis.cds.unistra.fr/hips-image-services/hips2fits?"

    for url <- [primary_url, secondary_url] do
      query = URI.parse(url).query |> URI.decode_query()
      assert query["hips"] == "CDS/P/DSS2/color"
      assert query["ra"] == "171.413935"
      assert query["dec"] == "-3.348847"
      assert query["fov"] == "0.120000"
      assert query["width"] == "512"
      assert query["height"] == "320"
    end

    for options <- [primary_options, secondary_options] do
      assert options[:pool] == false
      assert options[:follow_redirect]
      assert options[:connect_timeout] == 3_000
      assert options[:recv_timeout] == 8_000
    end
  end

  test "constructs a fixed Legacy Surveys cutout instead of accepting an arbitrary URL", %{
    conn: conn
  } do
    conn =
      get(
        conn,
        ~p"/api/survey-image?provider=legacy-dr11&ra=180.62&dec=22.058&fov=0.12"
      )

    assert response(conn, 200) == <<255, 216, 255, 217>>
    assert_received {:survey_image_request, url, _options}
    assert url =~ "https://www.legacysurvey.org/viewer/jpeg-cutout?"
    query = URI.parse(url).query |> URI.decode_query()
    assert query["layer"] == "ls-dr11"
    assert query["pixscale"] == "0.843750"
    refute_received {:survey_image_request, _second_url, _options}
  end

  test "rejects unsupported providers and out-of-range coordinates", %{conn: conn} do
    conn = get(conn, ~p"/api/survey-image?provider=other&ra=400&dec=0&fov=0.12")

    assert %{"error" => "invalid survey image parameters"} = json_response(conn, 422)
    refute_received {:survey_image_request, _url, _options}
  end

  test "retries a transient Legacy Surveys failure once", %{conn: conn} do
    Application.put_env(:starsmap_api, :survey_image_http_client, TransientLegacyHttpClient)
    Process.delete(:legacy_request_count)

    conn =
      get(
        conn,
        ~p"/api/survey-image?provider=legacy-dr11&ra=180.62&dec=22.058&fov=0.12"
      )

    assert response(conn, 200) == <<255, 216, 255, 217>>
    assert_received {:survey_image_request, first_url}
    assert_received {:survey_image_request, second_url}
    assert first_url == second_url
  end

  test "reports provider outages without caching them as missing coverage", %{conn: conn} do
    Application.put_env(:starsmap_api, :survey_image_http_client, FailingHttpClient)

    conn = get(conn, ~p"/api/survey-image?provider=dss2&ra=171&dec=-3&fov=0.12")

    assert %{"error" => "survey image providers unavailable"} = json_response(conn, 502)
    assert get_resp_header(conn, "cache-control") == ["no-store"]
    assert_received {:survey_image_request, primary_url}
    assert_received {:survey_image_request, secondary_url}
    assert primary_url =~ "alasky.cds.unistra.fr"
    assert secondary_url =~ "alaskybis.cds.unistra.fr"
  end
end

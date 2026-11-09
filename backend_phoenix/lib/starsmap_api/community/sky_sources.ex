defmodule StarsmapApi.Community.SkySources do
  @moduledoc """
  The outside services of the sweep. Each call is a read. A failure gives `:error`, and the
  sweep then makes no candidate. No call sends a photo or an account detail. A call
  to the JPL service has the capture time and the coarse site of one photo.
  """
  @callback small_bodies(DateTime.t(), number, number, number, number, number) ::
              {:ok, list(map)} | :error
  @callback dr11(number, number, number) :: {:ok, list(map)} | :error
  @callback transients(number, number, number) :: {:ok, list(map)} | :error

  def adapter,
    do: Application.get_env(:starsmap_api, :community_sky_sources, __MODULE__.Http)

  @doc "`02:10:30.50` and `+05 10'30.5\"` as degrees."
  # A part that does not parse gives nil, so that only that row leaves the list.
  def sexagesimal(ra, dec) when is_binary(ra) and is_binary(dec) do
    with [{hh, _}, {min, _}, {sec, _}] <- ra |> String.split(":") |> Enum.map(&Float.parse/1),
         [{dd, _}, {mm, _}, {ss, _}] <-
           ~r/([+-]?\d+)[^\d]+(\d+)[^\d]+([\d.]+)/
           |> Regex.run(String.trim(dec), capture: :all_but_first)
           |> List.wrap()
           |> Enum.map(&Float.parse/1) do
      sign = if String.starts_with?(String.trim(dec), "-"), do: -1, else: 1
      {(hh + min / 60 + sec / 3600) * 15, sign * (abs(dd) + mm / 60 + ss / 3600)}
    else
      _ -> nil
    end
  end

  def sexagesimal(_ra, _dec), do: nil

  @doc "The rows of the JPL response, without the fields that the sweep does not use."
  def parse_small_bodies(payload, limit_magnitude) do
    (payload["data_first_pass"] || [])
    |> Enum.flat_map(fn row ->
      with [name, ra, dec | _] <- row,
           {ra_deg, dec_deg} <- sexagesimal(ra, dec),
           {magnitude, _} <- Float.parse(to_string(Enum.at(row, 6))),
           true <- magnitude <= limit_magnitude do
        [%{name: String.trim(name), ra: ra_deg, dec: dec_deg, magnitude: magnitude}]
      else
        _ -> []
      end
    end)
  end

  @doc "The rows of a CSV response of the catalog service: `ra,dec,mag_r`."
  def parse_survey(csv) do
    csv
    |> String.split("\n", trim: true)
    |> Enum.drop(1)
    |> Enum.flat_map(fn line ->
      case String.split(line, ",") do
        [ra, dec, mag | _] ->
          with {ra_deg, _} <- Float.parse(ra), {dec_deg, _} <- Float.parse(dec) do
            magnitude =
              case Float.parse(mag) do
                {value, _} -> value
                _ -> nil
              end

            [%{ra: ra_deg, dec: dec_deg, mag: magnitude}]
          else
            _ -> []
          end

        _ ->
          []
      end
    end)
  end

  defmodule Http do
    @moduledoc false
    @behaviour StarsmapApi.Community.SkySources
    alias StarsmapApi.Community.SkySources

    @bodies_limit_magnitude 21.0
    @survey_rows 60_000
    @transient_page_rows 500
    @transient_pages 6

    defp get(url) do
      case :hackney.request(:get, url, [{"user-agent", "cosmic-atlas"}], "",
             pool: false,
             follow_redirect: true,
             connect_timeout: 5_000,
             recv_timeout: 60_000
           ) do
        {:ok, 200, _, body} when is_binary(body) -> {:ok, body}
        {:ok, 200, _, ref} -> :hackney.body(ref)
        _ -> :error
      end
    end

    defp clock(deg) do
      total = deg / 15 * 3600
      h = trunc(total / 3600)
      m = trunc((total - h * 3600) / 60)
      s = total - h * 3600 - m * 60
      "#{pad(h)}-#{pad(m)}-#{pad(trunc(s))}"
    end

    defp angle(deg) do
      total = abs(deg) * 3600
      d = trunc(total / 3600)
      m = trunc((total - d * 3600) / 60)
      s = trunc(total - d * 3600 - m * 60)
      "#{if deg < 0, do: "M", else: ""}#{pad(d)}-#{pad(m)}-#{pad(s)}"
    end

    defp pad(value), do: value |> to_string() |> String.pad_leading(2, "0")

    @impl true
    def small_bodies(time, lat, lon, ra, dec, half_width) do
      moment = time |> DateTime.truncate(:second) |> Calendar.strftime("%Y-%m-%d_%H:%M:%S")

      results =
        for kind <- ["a", "c"] do
          query =
            URI.encode_query(%{
              "sb-kind" => kind,
              "lat" => lat,
              "lon" => lon,
              "alt" => 0,
              "obs-time" => moment,
              "fov-ra-center" => clock(ra),
              "fov-ra-hwidth" => half_width,
              "fov-dec-center" => angle(dec),
              "fov-dec-hwidth" => half_width
            })

          with {:ok, body} <- get("https://ssd-api.jpl.nasa.gov/sb_ident.api?" <> query),
               {:ok, payload} <- Jason.decode(body) do
            {:ok, SkySources.parse_small_bodies(payload, @bodies_limit_magnitude)}
          else
            _ -> :error
          end
        end

      if :error in results,
        do: :error,
        else: {:ok, Enum.flat_map(results, fn {:ok, rows} -> rows end)}
    end

    @impl true
    def dr11(ra, dec, radius) do
      adql =
        "SELECT TOP #{@survey_rows} ra,dec,mag_r FROM ls_dr11.tractor " <>
          "WHERE 't'=q3c_radial_query(ra,dec,#{ra},#{dec},#{radius})"

      query =
        URI.encode_query(%{
          "REQUEST" => "doQuery",
          "LANG" => "ADQL",
          "FORMAT" => "csv",
          "QUERY" => adql
        })

      case get("https://datalab.noirlab.edu/tap/sync?" <> query) do
        {:ok, csv} ->
          rows = SkySources.parse_survey(csv)
          # A cut list hides stars, and a hidden star would look new.
          if length(rows) >= @survey_rows, do: :error, else: {:ok, rows}

        _ ->
          :error
      end
    end

    @impl true
    def transients(ra, dec, radius), do: transient_pages(ra, dec, radius, 1, [])

    # A cut list hides a known object, and a hidden object would look new.
    defp transient_pages(_ra, _dec, _radius, page, _rows) when page > @transient_pages,
      do: :error

    defp transient_pages(ra, dec, radius, page, rows) do
      query =
        URI.encode_query(%{
          "ra" => ra,
          "dec" => dec,
          "radius" => min(radius * 3600, 3600),
          "page_size" => @transient_page_rows,
          "page" => page
        })

      with {:ok, body} <- get("https://api.alerce.online/ztf/v1/objects/?" <> query),
           {:ok, %{"items" => items}} <- Jason.decode(body) do
        all = rows ++ Enum.map(items, &%{name: &1["oid"], ra: &1["meanra"], dec: &1["meandec"]})

        if length(items) < @transient_page_rows,
          do: {:ok, all},
          else: transient_pages(ra, dec, radius, page + 1, all)
      else
        _ -> :error
      end
    end
  end
end

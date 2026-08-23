defmodule StarsmapApi.Catalog.DesiObject do
  @moduledoc """
  Resolves a selectable DESI DR1 tile source into its public scientific record.

  The production DESI layer is a compact static point pyramid, so its records
  intentionally omit RA/Dec, redshift, and the line-of-sight coordinate. This
  module restores those fields on demand from NOIRLab's public DESI DR1 copy.
  """

  alias StarsmapApi.Catalog.PublicCache

  @anonymous_token "anonymous.0.0.anon_access"
  @query_url "https://datalab.noirlab.edu/query/query"
  @cache_ttl_ms :timer.hours(24)
  @c_km_s 299_792.458
  @h0_km_s_mpc 67.66
  @omega_m 0.30966
  @omega_lambda 1.0 - @omega_m
  @au_per_pc 206_264.80624709636
  @obliquity_deg 23.43928
  @light_years_per_parsec 3.26156

  def lookup(target_id) when is_binary(target_id) do
    with true <- valid_target_id?(target_id) do
      cache_key = {:desi_dr1_object, target_id}

      case PublicCache.get(cache_key) do
        {:ok, payload} ->
          {:ok, payload}

        :error ->
          case load(target_id) do
            {:ok, payload} = result ->
              PublicCache.put(cache_key, payload, @cache_ttl_ms)
              result

            error ->
              error
          end
      end
    else
      _ -> {:error, :invalid_target_id}
    end
  end

  def lookup(_), do: {:error, :invalid_target_id}

  defp load(target_id) do
    with {:ok, csv} <- fetch_csv(target_id),
         {:ok, row} <- parse_csv(csv),
         true <- row.target_id == target_id,
         true <- row.primary,
         true <- row.zwarn == 0,
         true <- row.redshift >= 0.0001,
         {:ok, object_type} <- object_type(row.spectype) do
      {:ok, payload(target_id, object_type, row)}
    else
      false -> {:error, :not_found}
      {:error, _} = error -> error
      _ -> {:error, :upstream_unavailable}
    end
  end

  defp fetch_csv(target_id) do
    case Application.get_env(:starsmap_api, :desi_query_fetcher) do
      fetcher when is_function(fetcher, 1) -> fetcher.(target_id)
      _ -> fetch_data_lab(target_id)
    end
  end

  defp fetch_data_lab(target_id) do
    sql = """
    SELECT z.targetid,p.ra,p.dec,z.z,z.zwarn,z.spectype,z.zcat_primary,p.flux_r
    FROM desi_dr1.zpix AS z
    JOIN desi_dr1.photometry AS p ON z.targetid=p.targetid
    WHERE z.targetid=#{target_id} AND z.zcat_primary=true
    LIMIT 1
    """

    query =
      URI.encode_query(%{
        "sql" => String.trim(sql),
        "ofmt" => "csv",
        "out" => "",
        "async" => "false",
        "drop" => "false"
      })

    url = System.get_env("DESI_DATALAB_QUERY_URL", @query_url) <> "?" <> query
    headers = [{"x-dl-authtoken", @anonymous_token}, {"user-agent", "Skychart/1.0"}]

    case :hackney.get(url, headers, "", recv_timeout: 8_000, connect_timeout: 3_000) do
      {:ok, 200, _headers, body} when is_binary(body) ->
        {:ok, body}

      {:ok, 200, _headers, client} ->
        case :hackney.body(client) do
          {:ok, body} -> {:ok, body}
          _ -> {:error, :upstream_unavailable}
        end

      {:ok, 404, _headers, _client} ->
        {:error, :not_found}

      _ ->
        {:error, :upstream_unavailable}
    end
  end

  defp parse_csv(csv) when is_binary(csv) do
    case csv |> String.split(~r/\R/, trim: true) |> Enum.take(2) do
      [
        "targetid,ra,dec,z,zwarn,spectype,zcat_primary,flux_r",
        row
      ] ->
        case String.split(row, ",") do
          [target_id, ra, dec, redshift, zwarn, spectype, primary, flux_r] ->
            with {:ok, ra} <- finite_float(ra),
                 {:ok, dec} <- finite_float(dec),
                 {:ok, redshift} <- finite_float(redshift),
                 {zwarn, ""} <- Integer.parse(zwarn),
                 true <- ra >= 0.0 and ra < 360.0 and dec >= -90.0 and dec <= 90.0 do
              {:ok,
               %{
                 target_id: target_id,
                 ra: ra,
                 dec: dec,
                 redshift: redshift,
                 zwarn: zwarn,
                 spectype: String.trim(spectype),
                 primary: String.downcase(String.trim(primary)) in ["t", "true", "1"],
                 flux_r: optional_float(flux_r)
               }}
            else
              _ -> {:error, :upstream_unavailable}
            end

          _ ->
            {:error, :upstream_unavailable}
        end

      [_header] ->
        {:error, :not_found}

      _ ->
        {:error, :upstream_unavailable}
    end
  end

  defp payload(target_id, object_type, row) do
    distance_mpc = comoving_distance_mpc(row.redshift)
    distance_pc = distance_mpc * 1_000_000.0
    position = projected_position(row.ra, row.dec, distance_pc)

    %{
      key: "desi-dr1-#{target_id}",
      name: "DESI DR1 #{object_type} #{target_id}",
      object_type: object_type,
      catalog_group:
        if(object_type == "quasar", do: "desi_dr1_quasars", else: "desi_dr1_galaxies"),
      source_type: "desi_dr1_datalab",
      position_model: "catalog_redshift_comoving",
      color: if(object_type == "quasar", do: "#ffe293", else: "#a0cdff"),
      aliases: [],
      external_ids: %{desi_targetid: target_id},
      external_links: [
        %{
          provider: "DESI",
          label: "DESI DR1 catalog documentation",
          url: "https://data.desi.lbl.gov/doc/releases/dr1/"
        }
      ],
      source: %{
        catalog: "DESI DR1 zpix and photometry tables via NSF NOIRLab Astro Data Lab",
        source_id: target_id,
        url: "https://datalab.noirlab.edu/data/desi",
        license: "CC BY 4.0"
      },
      facts: %{
        redshift: row.redshift,
        zwarn: row.zwarn,
        spectype: row.spectype,
        zcat_primary: row.primary
      },
      astrometry: %{
        ra_deg: row.ra,
        dec_deg: row.dec,
        distance_pc: distance_pc,
        distance_ly: distance_pc * @light_years_per_parsec,
        apparent_magnitude: apparent_magnitude(row.flux_r)
      },
      position: position
    }
  end

  defp projected_position(ra_deg, dec_deg, distance_pc) do
    distance_au = distance_pc * @au_per_pc
    ra = radians(ra_deg)
    dec = radians(dec_deg)
    obliquity = radians(@obliquity_deg)
    equatorial_x = distance_au * :math.cos(dec) * :math.cos(ra)
    equatorial_y = distance_au * :math.cos(dec) * :math.sin(ra)
    equatorial_z = distance_au * :math.sin(dec)
    x_au = equatorial_x
    y_au = equatorial_y * :math.cos(obliquity) + equatorial_z * :math.sin(obliquity)
    z_au = -equatorial_y * :math.sin(obliquity) + equatorial_z * :math.cos(obliquity)

    %{
      x_au: x_au,
      y_au: y_au,
      z_au: z_au,
      x_km: x_au * 149_597_870.7,
      y_km: y_au * 149_597_870.7,
      z_km: z_au * 149_597_870.7
    }
  end

  # Composite Simpson integration is more accurate than the 0.00002-spaced
  # trapezoid grid used by the offline point-tile builder while reproducing the
  # same checked-in flat-LambdaCDM model.
  defp comoving_distance_mpc(redshift) do
    intervals = redshift |> Kernel./(0.002) |> Float.ceil() |> trunc() |> max(128) |> make_even()
    step = redshift / intervals

    weighted_sum =
      1..(intervals - 1)
      |> Enum.reduce(inverse_expansion(0.0) + inverse_expansion(redshift), fn index, sum ->
        weight = if rem(index, 2) == 0, do: 2.0, else: 4.0
        sum + weight * inverse_expansion(index * step)
      end)

    @c_km_s / @h0_km_s_mpc * step / 3.0 * weighted_sum
  end

  defp inverse_expansion(redshift) do
    1.0 / :math.sqrt(@omega_m * :math.pow(1.0 + redshift, 3) + @omega_lambda)
  end

  defp apparent_magnitude(flux) when is_number(flux) and flux > 0,
    do: 22.5 - 2.5 * (:math.log(flux) / :math.log(10.0))

  defp apparent_magnitude(_), do: nil

  defp object_type("GALAXY"), do: {:ok, "galaxy"}
  defp object_type("QSO"), do: {:ok, "quasar"}
  defp object_type(_), do: {:error, :not_found}

  defp finite_float(value) do
    case Float.parse(String.trim(value)) do
      {number, ""} when number == number -> {:ok, number}
      _ -> {:error, :invalid_float}
    end
  end

  defp optional_float(value) do
    case finite_float(value) do
      {:ok, number} -> number
      _ -> nil
    end
  end

  defp valid_target_id?(target_id), do: target_id =~ ~r/^\d{1,20}$/
  defp make_even(number) when rem(number, 2) == 0, do: number
  defp make_even(number), do: number + 1
  defp radians(degrees), do: degrees * :math.pi() / 180.0
end

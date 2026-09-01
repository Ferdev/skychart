defmodule StarsmapApi.Catalog.PublicObjects do
  @moduledoc """
  Resolves public object records, source links, sitemap entries, and on-demand
  Gaia records without exposing storage details to web controllers.
  """

  import Ecto.Query

  alias StarsmapApi.Catalog.CatalogSourceObject
  alias StarsmapApi.Catalog.DesiObject
  alias StarsmapApi.Catalog.GaiaObjectCache
  alias StarsmapApi.Catalog.PublicCache
  alias StarsmapApi.Repo

  @summary_timeout 120_000

  def get_by_key(key) when is_binary(key) do
    normalized = String.downcase(key)

    CatalogSourceObject
    |> Repo.get_by(key: normalized)
    |> case do
      nil -> dynamic_object(normalized)
      object -> {:ok, catalog_object_payload(object)}
    end
  end

  defp dynamic_object("desi-dr1-" <> target_id), do: DesiObject.lookup(target_id)
  defp dynamic_object(_key), do: {:error, :not_found}

  @public_cache_ttl_ms 300_000
  @bulk_only_groups ~w(gaia_500pc_stars gaia_10kpc_bright_stars desi_dr1_galaxies desi_dr1_quasars quaia_g20_quasars)

  def public_observer(key) when is_binary(key) and byte_size(key) <= 180 do
    normalized = String.downcase(key)

    case PublicCache.get({:observer, normalized}) do
      {:ok, result} ->
        result

      :error ->
        PublicCache.put(
          {:observer, normalized},
          load_public_observer(normalized),
          @public_cache_ttl_ms
        )
    end
  end

  def public_observer(_), do: {:error, :not_found}

  def public_object(key) when is_binary(key) and byte_size(key) <= 180 do
    normalized = String.downcase(key)

    case PublicCache.get({:object, normalized}) do
      {:ok, result} ->
        result

      :error ->
        PublicCache.put(
          {:object, normalized},
          load_public_object(normalized),
          @public_cache_ttl_ms
        )
    end
  end

  def public_object(_), do: {:error, :not_found}

  defp load_public_observer(key) do
    case public_catalog_record(key) do
      {:ok, object} -> {:ok, catalog_object_payload(object)}
      error -> error
    end
  end

  defp load_public_object(key) do
    case public_catalog_record(key) do
      {:ok, object} ->
        related =
          CatalogSourceObject
          |> where(
            [candidate],
            candidate.catalog_group == ^object.catalog_group and candidate.key != ^object.key
          )
          |> order_by([candidate],
            asc_nulls_last: candidate.apparent_magnitude,
            asc: candidate.name
          )
          |> limit(6)
          |> select([candidate], %{
            key: candidate.key,
            name: candidate.name,
            object_type: candidate.object_type
          })
          |> Repo.all()

        {:ok,
         Map.merge(catalog_object_payload(object), %{
           related: related,
           semantics: StarsmapApi.ScienceSemantics.for_object(object),
           updated_at: object.updated_at
         })}

      error ->
        error
    end
  end

  defp public_catalog_record(key) do
    case Repo.get_by(CatalogSourceObject, key: key) do
      nil -> {:error, :not_found}
      %{catalog_group: group} when group in @bulk_only_groups -> {:error, :not_found}
      object -> {:ok, object}
    end
  end

  def sitemap_catalogs do
    CatalogSourceObject
    |> where([o], o.catalog_group not in @bulk_only_groups)
    |> where(
      [o],
      not is_nil(o.distance_ly) or not is_nil(o.apparent_magnitude) or
        fragment("cardinality(?) > 1", o.aliases)
    )
    |> group_by([o], o.catalog_group)
    |> select([o], {o.catalog_group, count(o.id), max(o.updated_at)})
    |> Repo.all(timeout: @summary_timeout)
  end

  def sitemap_entries(group) when is_binary(group) do
    CatalogSourceObject
    |> where([o], o.catalog_group == ^group and o.catalog_group not in @bulk_only_groups)
    |> where(
      [o],
      not is_nil(o.distance_ly) or not is_nil(o.apparent_magnitude) or
        fragment("cardinality(?) > 1", o.aliases)
    )
    |> select([o], {o.key, o.updated_at})
    |> Repo.all(timeout: @summary_timeout)
  end

  def gaia_object(source_id) when is_binary(source_id) do
    with {parsed, ""} when parsed > 0 <- Integer.parse(source_id) do
      case Repo.get(GaiaObjectCache, parsed) do
        %GaiaObjectCache{payload: payload} -> {:ok, payload}
        nil -> fetch_and_cache_gaia_object(parsed)
      end
    else
      _ -> {:error, :invalid_source_id}
    end
  end

  defp fetch_and_cache_gaia_object(source_id) do
    query =
      "SELECT source_id,ra,dec,parallax,parallax_over_error,phot_g_mean_mag,bp_rp,pmra,pmdec " <>
        "FROM gaiadr3.gaia_source WHERE source_id=#{source_id}"

    base = System.get_env("GAIA_TAP_BASE_URL", "https://gea.esac.esa.int/tap-server/tap/sync")
    url = base <> "?REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=" <> URI.encode_www_form(query)

    case :hackney.get(url, [{"user-agent", "Skychart/1.0"}], "",
           recv_timeout: 5_000,
           connect_timeout: 3_000
         ) do
      {:ok, 200, _headers, client} ->
        with {:ok, body} <- :hackney.body(client),
             {:ok, decoded} <- Jason.decode(body),
             [row | _] <- decoded["data"] || [],
             {:ok, payload} <- gaia_payload(row) do
          now = DateTime.utc_now() |> DateTime.truncate(:second)

          Repo.insert_all(
            GaiaObjectCache,
            [%{source_id: source_id, payload: payload, inserted_at: now, updated_at: now}],
            on_conflict: {:replace, [:payload, :updated_at]},
            conflict_target: :source_id
          )

          {:ok, payload}
        else
          [] -> {:error, :not_found}
          _ -> {:error, :upstream_unavailable}
        end

      {:ok, 404, _headers, _client} ->
        {:error, :not_found}

      _ ->
        {:error, :upstream_unavailable}
    end
  end

  defp gaia_payload([source_id, ra, dec, parallax, parallax_error, magnitude, bp_rp, pmra, pmdec])
       when is_number(ra) and is_number(dec) and is_number(parallax) and parallax > 0 do
    distance_pc = 1_000.0 / parallax
    distance_ly = distance_pc * 3.26156
    distance_au = distance_pc * 206_264.80624709636
    ra_rad = ra * :math.pi() / 180.0
    dec_rad = dec * :math.pi() / 180.0
    obliquity = 23.43928 * :math.pi() / 180.0
    equatorial_x = distance_au * :math.cos(dec_rad) * :math.cos(ra_rad)
    equatorial_y = distance_au * :math.cos(dec_rad) * :math.sin(ra_rad)
    equatorial_z = distance_au * :math.sin(dec_rad)
    x_au = equatorial_x
    y_au = :math.cos(obliquity) * equatorial_y + :math.sin(obliquity) * equatorial_z
    z_au = -:math.sin(obliquity) * equatorial_y + :math.cos(obliquity) * equatorial_z

    {:ok,
     %{
       key: "gaia_dr3_#{source_id}",
       name: "Gaia DR3 #{source_id}",
       object_type: "star",
       catalog_group: "gaia_dr3_bulk",
       source_type: "gaia_dr3_tap",
       aliases: [],
       external_ids: %{gaia_dr3_source_id: to_string(source_id)},
       astrometry: %{
         ra_deg: ra,
         dec_deg: dec,
         distance_pc: distance_pc,
         distance_ly: distance_ly,
         apparent_magnitude: magnitude
       },
       position: %{x_au: x_au, y_au: y_au, z_au: z_au},
       facts: %{
         parallax_mas: parallax,
         parallax_over_error: parallax_error,
         bp_rp: bp_rp,
         pmra_mas_yr: pmra,
         pmdec_mas_yr: pmdec
       }
     }}
  end

  defp gaia_payload(_), do: {:error, :upstream_unavailable}

  def external_links_by_key(key) when is_binary(key) do
    CatalogSourceObject
    |> Repo.get_by(key: String.downcase(key))
    |> case do
      nil -> {:error, :not_found}
      object -> {:ok, external_links(object)}
    end
  end

  def catalog_object_payload(%CatalogSourceObject{} = object) do
    {distance_pc, distance_ly, position, facts} = public_spatial_fields(object)

    %{
      key: object.key,
      name: object.name,
      object_type: object.object_type,
      catalog_group: object.catalog_group,
      source_type: object.source_type,
      position_model: object.position_model,
      parent_key: object.parent_key,
      color: object.color,
      radius_km: object.radius_km,
      aliases: object.aliases || [],
      external_ids: object.external_ids || %{},
      external_links: external_links(object),
      source: object.source || %{},
      facts: facts,
      astrometry: %{
        ra_deg: object.ra_deg,
        dec_deg: object.dec_deg,
        distance_pc: distance_pc,
        distance_ly: distance_ly,
        apparent_magnitude: object.apparent_magnitude,
        absolute_magnitude: object.absolute_magnitude
      },
      position: position
    }
  end

  defp public_spatial_fields(%CatalogSourceObject{source_type: "openngc_ngc_ic_catalog"} = object) do
    facts = object.facts || %{}
    quality = facts["distance_quality"]

    valid? =
      (object.object_type == "galaxy" and quality == "hubble_flow_redshift_approximation") or
        (object.object_type != "galaxy" and quality == "parallax")

    if valid? do
      spatial_fields(object, facts)
    else
      {nil, nil, empty_position(), Map.put(facts, "distance_quality", "not_available")}
    end
  end

  defp public_spatial_fields(object), do: spatial_fields(object, object.facts || %{})

  defp spatial_fields(object, facts) do
    {object.distance_pc, object.distance_ly,
     %{
       x_au: object.x_au,
       y_au: object.y_au,
       z_au: object.z_au,
       x_km: object.x_km,
       y_km: object.y_km,
       z_km: object.z_km
     }, facts}
  end

  defp empty_position,
    do: %{x_au: nil, y_au: nil, z_au: nil, x_km: nil, y_km: nil, z_km: nil}

  defp external_links(%CatalogSourceObject{} = object) do
    identifiers = object.external_ids || %{}
    facts = object.facts || %{}
    name = object.name || object.key

    [
      simbad_link(name, object),
      ned_link(name, object),
      jpl_small_body_link(identifiers),
      gaia_link(identifiers, facts),
      nasa_exoplanet_link(identifiers, object),
      xray_catalog_link(object)
    ]
    |> Enum.reject(&is_nil/1)
  end

  defp xray_catalog_link(%{catalog_group: group, source: source})
       when group in ["erosita_dr2_xray", "erosita_dr2_extended"] do
    %{
      provider: "eROSITA-DE DR2",
      label: "eRASS:3 catalog page",
      url: source_url(source, "catalog_page_url", "https://erosita.mpe.mpg.de/dr2/")
    }
  end

  defp xray_catalog_link(%{catalog_group: "sdss_spiders_dr20", source: source}) do
    %{
      provider: "SDSS-V DR20",
      label: "SPIDERS DL1 value-added catalog",
      url:
        source_url(
          source,
          "vac_page_url",
          "https://www.sdss.org/dr20/data_access/value-added-catalogs/"
        )
    }
  end

  defp xray_catalog_link(_object), do: nil

  defp source_url(source, key, fallback) when is_map(source) do
    case Map.get(source, key) do
      value when is_binary(value) -> if(String.trim(value) == "", do: fallback, else: value)
      _ -> fallback
    end
  end

  defp source_url(_source, _key, fallback), do: fallback

  defp simbad_link(name, object) do
    cond do
      # SPIDERS DL1 rows carry survey-internal names that SIMBAD cannot resolve.
      object.catalog_group == "sdss_spiders_dr20" ->
        nil

      object.source_type == "simbad_tap" or
          object.object_type in ["galaxy", "quasar", "active_galaxy", "black_hole", "xray_source", "xray_extended"] ->
        %{
          provider: "SIMBAD",
          label: "SIMBAD object lookup",
          url: "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=#{URI.encode_www_form(name)}"
        }

      object.object_type in ["star", "star_cluster", "nebula"] ->
        %{
          provider: "SIMBAD",
          label: "SIMBAD object lookup",
          url: "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=#{URI.encode_www_form(name)}"
        }

      true ->
        nil
    end
  end

  defp ned_link(name, object) do
    if object.catalog_group != "sdss_spiders_dr20" and
         object.object_type in ["galaxy", "quasar", "active_galaxy", "black_hole"] do
      %{
        provider: "NED",
        label: "NASA/IPAC Extragalactic Database lookup",
        url: "https://ned.ipac.caltech.edu/byname?objname=#{URI.encode_www_form(name)}"
      }
    end
  end

  defp jpl_small_body_link(%{"jpl_spkid" => spkid}) when is_binary(spkid) do
    %{
      provider: "NASA/JPL SBDB",
      label: "Small-Body Database lookup",
      url: "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=#{URI.encode_www_form(spkid)}"
    }
  end

  defp jpl_small_body_link(_identifiers), do: nil

  defp gaia_link(%{"gaia_dr3_source_id" => source_id}, _facts) when is_binary(source_id) do
    %{
      provider: "ESA Gaia Archive",
      label: "Gaia DR3 source",
      url:
        "https://gea.esac.esa.int/archive/?ACTION=PUBLIC_DATALINK&ID=Gaia%20DR3%20#{URI.encode_www_form(source_id)}"
    }
  end

  defp gaia_link(_identifiers, %{"source_id" => source_id}) when is_binary(source_id) do
    gaia_link(%{"gaia_dr3_source_id" => source_id}, %{})
  end

  defp gaia_link(_identifiers, _facts), do: nil

  defp nasa_exoplanet_link(%{"nasa_exoplanet_archive_name" => planet_name}, _object)
       when is_binary(planet_name) do
    %{
      provider: "NASA Exoplanet Archive",
      label: "NASA Exoplanet Archive lookup",
      url:
        "https://exoplanetarchive.ipac.caltech.edu/overview/#{URI.encode_www_form(planet_name)}"
    }
  end

  defp nasa_exoplanet_link(_identifiers, %{source_type: "exoplanet_archive_system", name: name})
       when is_binary(name) do
    %{
      provider: "NASA Exoplanet Archive",
      label: "NASA Exoplanet Archive lookup",
      url: "https://exoplanetarchive.ipac.caltech.edu/overview/#{URI.encode_www_form(name)}"
    }
  end

  defp nasa_exoplanet_link(_identifiers, _object), do: nil
end

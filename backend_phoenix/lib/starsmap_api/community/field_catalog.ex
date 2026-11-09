defmodule StarsmapApi.Community.FieldCatalog do
  @moduledoc """
  Catalog records in one circle of the sky, in J2000 coordinates.

  The source tables have an index on right ascension and declination. A query in
  this module always has limits on both, so it does not scan the Gaia tables.
  """
  import Ecto.Query
  alias StarsmapApi.Catalog.CatalogSourceObject

  @r :math.pi() / 180
  # A small margin on the database bounds, so that a rounding error never drops a row at the edge.
  @slack_deg 1.0e-6
  @gaia_groups ["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"]
  @named_groups ["messier_deep_sky", "ngc_ic_deep_sky", "simbad_extragalactic"]

  def gaia_groups, do: @gaia_groups
  def named_groups, do: @named_groups

  def cone(ra, dec, radius, options \\ []) do
    groups = Keyword.get(options, :groups, @gaia_groups)
    limit = Keyword.get(options, :limit, 500)

    query =
      from o in CatalogSourceObject,
        where: o.catalog_group in ^groups,
        where: ^within(ra, dec, radius),
        order_by: [asc_nulls_last: o.apparent_magnitude, asc: o.key],
        limit: ^limit,
        select: %{
          key: o.key,
          name: o.name,
          group: o.catalog_group,
          object_type: o.object_type,
          ra: o.ra_deg,
          dec: o.dec_deg,
          magnitude: o.apparent_magnitude,
          distance_pc: o.distance_pc,
          distance_ly: o.distance_ly,
          facts: o.facts
        }

    query =
      case Keyword.get(options, :max_magnitude) do
        magnitude when is_number(magnitude) ->
          where(query, [o], o.apparent_magnitude <= ^(magnitude * 1.0))

        _ ->
          query
      end

    query
    |> StarsmapApi.Repo.all(timeout: 15_000)
    |> Enum.filter(&(separation(ra, dec, &1.ra, &1.dec) <= radius))
  end

  @doc """
  A filter for the rows of the first binding, by their `ra_deg` and `dec_deg` columns: the rows
  in the circle of `radius` degrees. The declination and right-ascension bounds can use the
  index. The spherical test then removes the corners of that box in the database, so that a row
  limit counts only rows in the circle. It is a little wider than the circle: an exact check with
  `separation/4` comes after it.
  """
  def within(ra, dec, radius) do
    ra = :math.fmod(:math.fmod(ra * 1.0, 360.0) + 360.0, 360.0)
    dec = dec * 1.0
    cos_radius = :math.cos(min(radius + @slack_deg, 180.0) * @r)

    dynamic(
      [o],
      o.dec_deg >= ^(dec - radius - @slack_deg) and o.dec_deg <= ^(dec + radius + @slack_deg) and
        ^right_ascension(ra, ra_half_width(dec, radius)) and
        fragment(
          "sin(radians(?)) * sin(radians(?)) + cos(radians(?)) * cos(radians(?)) * cos(radians(? - ?)) >= ?",
          ^dec,
          o.dec_deg,
          ^dec,
          o.dec_deg,
          o.ra_deg,
          ^ra,
          ^cos_radius
        )
    )
  end

  # The largest difference in right ascension inside the circle. When the circle contains a
  # pole, each right ascension is in it.
  defp ra_half_width(dec, radius) do
    if abs(dec) + radius >= 90 do
      180.0
    else
      ratio = :math.sin(radius * @r) / :math.cos(dec * @r)
      if ratio >= 1, do: 180.0, else: :math.asin(ratio) / @r + @slack_deg
    end
  end

  @doc "The angle between two directions, in degrees. It is exact at small angles."
  def separation(ra1, dec1, ra2, dec2) do
    a = :math.sin((dec2 - dec1) * @r / 2)
    b = :math.sin((ra2 - ra1) * @r / 2)

    2 *
      :math.asin(
        :math.sqrt(min(1.0, a * a + :math.cos(dec1 * @r) * :math.cos(dec2 * @r) * b * b))
      ) / @r
  end

  defp right_ascension(_ra, width) when width >= 180, do: dynamic(true)

  defp right_ascension(ra, width) do
    {first, last} = {ra - width, ra + width}

    cond do
      first < 0 ->
        dynamic([o], o.ra_deg >= ^(first + 360) or o.ra_deg <= ^last)

      last >= 360 ->
        dynamic([o], o.ra_deg >= ^first or o.ra_deg <= ^(last - 360))

      true ->
        dynamic([o], o.ra_deg >= ^first and o.ra_deg <= ^last)
    end
  end
end

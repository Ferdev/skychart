defmodule StarsmapApi.Community.Annotations do
  @moduledoc "J2000 named deep-sky context in a validated TAN photo; never measurements."
  import Ecto.Query
  alias StarsmapApi.CommunityRepo, as: Repo
  @r :math.pi() / 180

  def rebuild(photo) do
    Repo.delete_all(from s in "photo_subjects", where: s.photo_id == ^Ecto.UUID.dump!(photo.id))
    w = photo.wcs

    if w && w["frame"] == "ICRS" && w["epoch"] == "J2000" do
      radius = max(w["width"], w["height"]) * w["pixel_scale_arcsec"] / 3600
      # Two small, named catalogs. No scan of Gaia or the bulk galaxy catalogs.
      objects =
        StarsmapApi.Repo.all(
          from o in StarsmapApi.Catalog.CatalogSourceObject,
            where:
              o.catalog_group in ["messier_deep_sky", "ngc_ic_deep_sky"] and
                o.dec_deg >= ^(w["dec_deg"] - radius) and o.dec_deg <= ^(w["dec_deg"] + radius),
            order_by: [asc_nulls_last: o.apparent_magnitude, asc: o.key],
            limit: 1000,
            select: %{key: o.key, name: o.name, ra: o.ra_deg, dec: o.dec_deg}
        )

      entries =
        objects
        |> Enum.map(fn o -> {o, pixel(w, o.ra, o.dec)} end)
        |> Enum.filter(fn {_, p} -> not is_nil(p) end)
        |> Enum.take(50)

      Repo.insert_all(
        "photo_subjects",
        Enum.map(entries, fn {o, {x, y}} ->
          %{
            photo_id: Ecto.UUID.dump!(photo.id),
            key: o.key,
            name: o.name,
            x: x,
            y: y,
            role: "in_frame"
          }
        end)
      )
    end

    :ok
  end

  def list(id),
    do:
      Repo.all(
        from s in "photo_subjects",
          where: s.photo_id == ^Ecto.UUID.dump!(id),
          select: %{key: s.key, name: s.name, x: s.x, y: s.y, role: s.role}
      )

  def pixel(_, ra, dec) when not is_number(ra) or not is_number(dec), do: nil

  def pixel(w, ra, dec) do
    dec0 = w["dec_deg"] * @r
    delta = (ra - w["ra_deg"]) * @r
    dec = dec * @r

    denominator =
      :math.sin(dec) * :math.sin(dec0) + :math.cos(dec) * :math.cos(dec0) * :math.cos(delta)

    if denominator <= 0 do
      nil
    else
      east = :math.cos(dec) * :math.sin(delta) / denominator / @r

      north =
        (:math.sin(dec) * :math.cos(dec0) - :math.cos(dec) * :math.sin(dec0) * :math.cos(delta)) /
          denominator / @r

      scale = w["pixel_scale_arcsec"] / 3600
      rotation = w["rotation_deg"] * @r

      [a, b, c, d] =
        w["cd"] ||
          [
            scale * :math.cos(rotation),
            -scale * :math.sin(rotation),
            scale * :math.sin(rotation),
            scale * :math.cos(rotation)
          ]

      [cx, cy] = w["crpix"] || [(w["width"] + 1) / 2, (w["height"] + 1) / 2]
      determinant = a * d - b * c

      if abs(determinant) < 1.0e-20 do
        nil
      else
        x = ((d * east - b * north) / determinant + cx - 0.5) / w["width"]
        y = 1 - ((-c * east + a * north) / determinant + cy - 0.5) / w["height"]
        if x >= 0 and x <= 1 and y >= 0 and y <= 1, do: {x, y}, else: nil
      end
    end
  end
end

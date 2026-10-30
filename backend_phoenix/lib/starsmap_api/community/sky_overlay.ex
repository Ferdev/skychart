defmodule StarsmapApi.Community.SkyOverlay do
  @moduledoc """
  Photo footprints for one area of the sky. It returns only published photos with a
  solution of the plate solver. An author-supplied solution is not checked against the
  stars, so it does not go on the sky as an aligned image.
  """
  import Ecto.Query
  alias StarsmapApi.Community.{Photos, Storage}
  alias StarsmapApi.CommunityRepo, as: Repo

  @limit 200
  @candidates 2_000
  # `Astrometry.validate/1` refuses a field wider than 30 degrees: the half diagonal is below 22.
  @largest_photo_radius_deg 22.0
  @fields ~w(ra_deg dec_deg pixel_scale_arcsec rotation_deg width height cd crpix projection frame epoch status)
  @r :math.pi() / 180

  def limit, do: @limit

  @doc "Photos that overlap the circle of `radius` degrees around the J2000 position."
  def list(ra, dec, radius) do
    margin = radius + @largest_photo_radius_deg

    Repo.all(
      from [p, u] in Photos.published(),
        where:
          fragment("?->>'status' = 'solved'", p.wcs) and
            fragment(
              "(?->>'dec_deg')::float8 BETWEEN ? AND ?",
              p.wcs,
              ^(dec - margin),
              ^(dec + margin)
            ),
        order_by: [desc: p.published_at, desc: p.id],
        limit: @candidates,
        select: {p, u.name}
    )
    |> Enum.filter(fn {photo, _author} ->
      aligned?(photo.wcs) and overlaps?(photo.wcs, ra, dec, radius)
    end)
    |> Enum.take(@limit)
    |> Enum.map(&item/1)
  end

  defp aligned?(
         %{"projection" => "TAN", "frame" => "ICRS", "epoch" => "J2000", "status" => "solved"} = w
       ),
       do:
         Enum.all?(~w(ra_deg dec_deg pixel_scale_arcsec width height), &is_number(w[&1])) and
           length(w["cd"] || []) == 4 and length(w["crpix"] || []) == 2

  defp aligned?(_), do: false

  defp overlaps?(w, ra, dec, radius),
    do: separation(ra, dec, w["ra_deg"], w["dec_deg"]) <= radius + photo_radius(w)

  # The solution reference can be away from the image center, so the radius includes that distance.
  defp photo_radius(w) do
    [cx, cy] = w["crpix"]
    half_diagonal = :math.sqrt(w["width"] ** 2 + w["height"] ** 2) / 2
    offset = :math.sqrt((cx - w["width"] / 2) ** 2 + (cy - w["height"] / 2) ** 2)
    (half_diagonal + offset) * w["pixel_scale_arcsec"] / 3600
  end

  defp separation(ra1, dec1, ra2, dec2) do
    cosine =
      :math.sin(dec1 * @r) * :math.sin(dec2 * @r) +
        :math.cos(dec1 * @r) * :math.cos(dec2 * @r) * :math.cos((ra1 - ra2) * @r)

    :math.acos(cosine |> min(1.0) |> max(-1.0)) / @r
  end

  defp item({photo, author}) do
    %{
      id: photo.id,
      title: photo.title,
      author: author,
      licence: photo.licence,
      captured_at: photo.captured_at,
      wcs: Map.take(photo.wcs, @fields),
      thumbnail_url: Storage.media_url(photo.id, "320"),
      image_url: Storage.media_url(photo.id, "1600")
    }
  end
end

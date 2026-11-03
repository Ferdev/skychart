defmodule StarsmapApi.Community.SkyOverlay do
  @moduledoc """
  Photo footprints for one area of the sky. It returns only published photos with a
  solution of the plate solver. An author-supplied solution is not checked against the
  stars, so it does not go on the sky as an aligned image.
  """
  import Ecto.Query
  alias StarsmapApi.Community.{DeepFields, Photos, Storage}
  alias StarsmapApi.CommunityRepo, as: Repo

  # The position and the reach of an aligned solution of the plate solver, or no row. The reach
  # is the half diagonal plus the distance of the solution reference from the image center, in
  # degrees, as in `photo_radius/1`. No check keeps the reference inside the image, so the reach
  # has no fixed upper limit. Thus the full test is in SQL, and the limit counts only
  # photos that overlap the area. A value that is not a number gives NULL, and NULL removes the row.
  @solution """
  SELECT n.ra, n.dec,
    (sqrt(n.width ^ 2 + n.height ^ 2) / 2 + sqrt((n.cx - n.width / 2) ^ 2 + (n.cy - n.height / 2) ^ 2))
      * n.scale / 3600 AS reach
  FROM (SELECT ?::jsonb AS w) AS s
  CROSS JOIN LATERAL (SELECT
    CASE WHEN jsonb_typeof(s.w -> 'ra_deg') = 'number' THEN (s.w ->> 'ra_deg')::float8 END AS ra,
    CASE WHEN jsonb_typeof(s.w -> 'dec_deg') = 'number' THEN (s.w ->> 'dec_deg')::float8 END AS dec,
    CASE WHEN jsonb_typeof(s.w -> 'pixel_scale_arcsec') = 'number'
      THEN (s.w ->> 'pixel_scale_arcsec')::float8 END AS scale,
    CASE WHEN jsonb_typeof(s.w -> 'width') = 'number' THEN (s.w ->> 'width')::float8 END AS width,
    CASE WHEN jsonb_typeof(s.w -> 'height') = 'number' THEN (s.w ->> 'height')::float8 END AS height,
    CASE WHEN jsonb_typeof(s.w -> 'crpix') = 'array' AND jsonb_array_length(s.w -> 'crpix') = 2
      AND jsonb_typeof(s.w -> 'crpix' -> 0) = 'number' THEN (s.w -> 'crpix' ->> 0)::float8 END AS cx,
    CASE WHEN jsonb_typeof(s.w -> 'crpix') = 'array' AND jsonb_array_length(s.w -> 'crpix') = 2
      AND jsonb_typeof(s.w -> 'crpix' -> 1) = 'number' THEN (s.w -> 'crpix' ->> 1)::float8 END AS cy
  ) AS n
  WHERE s.w ->> 'projection' = 'TAN' AND s.w ->> 'frame' = 'ICRS' AND s.w ->> 'epoch' = 'J2000'
    AND s.w ->> 'status' = 'solved'
    AND CASE WHEN jsonb_typeof(s.w -> 'cd') = 'array' THEN jsonb_array_length(s.w -> 'cd') = 4 ELSE false END
  """
  @limit 200
  @fields ~w(ra_deg dec_deg pixel_scale_arcsec rotation_deg width height cd crpix projection frame epoch status)
  @r :math.pi() / 180

  def limit, do: @limit

  @doc "Photos that overlap the circle of `radius` degrees around the J2000 position."
  def list(ra, dec, radius) do
    Repo.all(
      from [p, u] in Photos.published(),
        inner_lateral_join: s in fragment(@solution, p.wcs),
        on: true,
        where:
          fragment(
            "acosd(least(1.0, greatest(-1.0, sind(?) * sind(?) + cosd(?) * cosd(?) * cosd(? - ?)))) <= ? + ?",
            type(^dec, :float),
            s.dec,
            type(^dec, :float),
            s.dec,
            type(^ra, :float),
            s.ra,
            type(^radius, :float),
            s.reach
          ),
        order_by: [desc: p.published_at, desc: p.id],
        limit: @limit,
        select: {p, u.name}
    )
    |> Enum.map(&item/1)
    |> then(&(deep_fields(ra, dec, radius) ++ &1))
  end

  # A stack is one photo on the sky, and it comes first, so that a dense area does not push it out.
  defp deep_fields(ra, dec, radius) do
    DeepFields.overlay_fields()
    |> Enum.flat_map(fn field ->
      item = DeepFields.overlay_item(field)

      if item && overlaps?(wcs_strings(item.wcs), ra, dec, radius), do: [item], else: []
    end)
  end

  defp wcs_strings(wcs), do: Map.new(wcs, fn {key, value} -> {to_string(key), value} end)

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

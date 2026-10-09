defmodule StarsmapApi.Community.Astrometry do
  @moduledoc "Validated tangent-plane WCS with an explicit observing frame and epoch."
  alias StarsmapApi.Community.{Photos, Photo}
  alias StarsmapApi.CommunityRepo, as: Repo
  @fields ~w(ra_deg dec_deg pixel_scale_arcsec rotation_deg width height)
  def validate(attrs) when is_map(attrs) do
    values = Enum.map(@fields, &attrs[&1])

    if Enum.all?(values, &(is_number(&1) and &1 == &1)) do
      [ra, dec, scale, rotation, width, height] = values

      cond do
        ra < 0 or ra >= 360 or dec < -90 or dec > 90 ->
          {:error, :invalid_wcs}

        scale <= 0 or scale > 120 or width < 1 or height < 1 or width != trunc(width) or
          height != trunc(height) or width * height > 120_000_000 ->
          {:error, :invalid_wcs}

        abs(rotation) > 360 or max(width, height) * scale > 30 * 3600 ->
          {:error, :invalid_wcs}

        true ->
          {:ok,
           Map.take(attrs, @fields)
           |> Map.merge(%{
             "projection" => "TAN",
             "epoch" => "J2000",
             "frame" => "ICRS",
             "source" => "author",
             "status" => "author_supplied"
           })}
      end
    else
      {:error, :invalid_wcs}
    end
  end

  def validate(_), do: {:error, :invalid_wcs}

  def attach(user, id, attrs) do
    with %Photo{} = photo <- Photos.owned(user, id),
         {:ok, wcs} <- validate(attrs),
         true <- photo.status not in ["uploading", "processing", "failed"] do
      StarsmapApi.Community.transaction(fn ->
        changed = Repo.update!(Ecto.Changeset.change(photo, wcs: wcs))
        StarsmapApi.Community.Annotations.rebuild(changed)

        if changed.status == "published",
          do: StarsmapApi.Community.Ranking.refresh(changed.subject_id)

        changed
      end)
    else
      _ -> {:error, :invalid_wcs}
    end
  end
end

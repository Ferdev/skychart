defmodule StarsmapApi.Community.DeepField do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "deep_fields" do
    field :slug, :string
    field :title, :string
    field :subject_id, Ecto.UUID
    field :declared_key, :string
    field :status, :string, default: "open"
    field :ra_deg, :float
    field :dec_deg, :float
    field :scale_arcsec, :float
    field :width, :integer
    field :height, :integer
    field :current_build_id, Ecto.UUID
    field :closed_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec)
  end
end

defmodule StarsmapApi.Community.DeepFieldBuild do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "deep_field_builds" do
    field :field_id, Ecto.UUID
    field :version, :integer
    field :status, :string
    field :stop, :string
    field :frame_ids, :map, default: %{}
    field :frames_used, :integer, default: 0
    field :frames_rejected, :integer, default: 0
    field :max_coverage, :integer, default: 0
    field :limiting_mag, :float
    field :best_limiting_mag, :float
    field :gain_mag, :float
    field :stars_recovered, :integer
    field :best_stars_recovered, :integer
    field :best_photo_id, Ecto.UUID
    timestamps(type: :utc_datetime_usec)
  end
end

defmodule StarsmapApi.Community.DeepFieldFrame do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "deep_field_frames" do
    field :field_id, Ecto.UUID
    field :photo_id, Ecto.UUID
    field :user_id, Ecto.UUID
    field :consent_at, :utc_datetime_usec
    field :withdrawn_at, :utc_datetime_usec
    field :weight, :float
    field :noise, :float
    field :sharpness_pixels, :float
    field :rejection_reason, :string
    timestamps(type: :utc_datetime_usec)
  end
end

defmodule StarsmapApi.Community.DeepFields do
  @moduledoc """
  Collective deep fields: a moderator opens one target, owners add their approved solved
  photos, and a rebuild stacks these frames into one image.

  An owner must opt in, for one photo or for all future photos. A withdrawal takes the frame
  out at the next rebuild. A photo that stops being public leaves the credits at once, and
  it starts a rebuild, so that the next image does not contain a removed photo.
  """
  import Ecto.Query

  alias StarsmapApi.Community.{
    Action,
    CoreObjects,
    DeepField,
    DeepFieldBuild,
    DeepFieldFrame,
    DeepFieldWorker,
    FieldCatalog,
    Photo,
    Photos,
    Storage,
    Subject,
    Subjects,
    User
  }

  alias StarsmapApi.CommunityRepo, as: Repo

  # A frame waits on the scratch disk during a build, and the build holds the serial queue.
  @max_frames 40
  @min_frames 2
  @grid_long_side 1600
  @grid_short_side 1200
  @max_field_degrees 5.0
  @candidates 10
  @files ["stack", "best", "depth", "thumb"]
  @star_limit 1500

  def files, do: @files
  def max_frames, do: @max_frames

  def file_key(%DeepField{id: id}, version, name),
    do: "masters/deep-fields/#{id}/#{version}/#{name}.webp"

  def media_url(%DeepField{slug: slug}, version, name),
    do: "/api/deep-fields/#{slug}/media/#{version}/#{name}"

  def current, do: Repo.one(from f in DeepField, where: f.status == "open")
  def by_slug(slug), do: Repo.get_by(DeepField, slug: slug)

  @doc "The subjects with the most solved photos. A moving body has no place on a fixed grid."
  def candidates do
    counts =
      Repo.all(
        from [p, _] in Photos.published(),
          where: fragment("?->>'status' = 'solved'", p.wcs),
          group_by: p.subject_id,
          order_by: [desc: count(p.id), asc: p.subject_id],
          limit: ^(@candidates * 3),
          select: {p.subject_id, count(p.id), min(p.declared_key)}
      )

    subjects =
      Repo.all(from s in Subject, where: s.id in ^Enum.map(counts, &elem(&1, 0)))
      |> Map.new(&{&1.id, &1})

    counts
    |> Enum.filter(fn {_, _, key} -> fixed?(key) end)
    |> Enum.take(@candidates)
    |> Enum.map(fn {id, count, key} ->
      %{key: key, name: subjects[id].name, solved_photos: count}
    end)
  end

  defp fixed?(key), do: match?({:error, _}, CoreObjects.get(key))

  @doc "A moderator opens a target. The grid comes from the solutions of its photos."
  def open(user, key) when is_binary(key) do
    with %Subject{} = subject <- Subjects.find(key) || {:error, :not_found},
         true <- fixed?(key) || {:error, :moving_target} do
      StarsmapApi.Community.transaction(fn ->
        if current(), do: Repo.rollback(:field_open)
        solutions = solutions(subject.id)
        if solutions == [], do: Repo.rollback(:no_solved_photos)
        field = insert_field(subject, key, solutions)

        Repo.insert!(%Action{user_id: user.id, action: "deep_field_open", reason: field.title})
        field
      end)
    end
  end

  def open(_, _), do: {:error, :invalid_request}

  defp insert_field(subject, key, solutions) do
    width_deg =
      solutions
      |> Enum.map(&(max(&1["width"], &1["height"]) * &1["pixel_scale_arcsec"] / 3600))
      |> median()
      |> min(@max_field_degrees)

    Repo.insert!(%DeepField{
      slug: unique_slug(subject.name, key),
      title: subject.name,
      subject_id: subject.id,
      declared_key: key,
      ra_deg: circular_median(Enum.map(solutions, & &1["ra_deg"])),
      dec_deg: median(Enum.map(solutions, & &1["dec_deg"])),
      scale_arcsec: width_deg * 3600 / @grid_long_side,
      width: @grid_long_side,
      height: @grid_short_side
    })
  end

  defp solutions(subject_id) do
    Repo.all(
      from [p, _] in Photos.published(),
        where: p.subject_id == ^subject_id and fragment("?->>'status' = 'solved'", p.wcs),
        select: p.wcs
    )
    |> Enum.filter(&aligned?/1)
  end

  defp median(values) do
    sorted = Enum.sort(values)
    Enum.at(sorted, div(length(sorted), 2)) * 1.0
  end

  # The field of a target near right ascension zero must not move to the opposite side of the sky.
  defp circular_median(values) do
    first = hd(values)
    wrapped = Enum.map(values, &(first + wrap(&1 - first)))
    (median(wrapped) + 360.0) |> :math.fmod(360.0)
  end

  defp wrap(delta) when delta > 180, do: delta - 360
  defp wrap(delta) when delta < -180, do: delta + 360
  defp wrap(delta), do: delta

  defp unique_slug(name, key) do
    base =
      name
      |> String.downcase()
      |> String.replace(~r/[^a-z0-9]+/u, "-")
      |> String.trim("-")
      |> String.slice(0, 60)
      |> String.trim("-")

    base = if base == "", do: String.replace(key, ~r/[^a-z0-9]+/, "-"), else: base

    Enum.find_value(Stream.iterate(1, &(&1 + 1)), fn index ->
      slug = if index == 1, do: base, else: "#{base}-#{index}"
      if by_slug(slug), do: nil, else: slug
    end)
  end

  def close(user, slug) do
    case by_slug(slug) do
      %DeepField{status: "open"} = field ->
        StarsmapApi.Community.transaction(fn ->
          closed =
            Repo.update!(
              Ecto.Changeset.change(field,
                status: "closed",
                closed_at: StarsmapApi.Community.now()
              )
            )

          Repo.insert!(%Action{user_id: user.id, action: "deep_field_close", reason: field.title})
          closed
        end)

      _ ->
        {:error, :not_found}
    end
  end

  def rebuild_now(slug) do
    case by_slug(slug) do
      %DeepField{status: "open"} = field -> enqueue(field)
      _ -> {:error, :not_found}
    end
  end

  # A job can wait while another one runs, so that a removal during a build is not lost.
  def enqueue(%DeepField{} = field) do
    Oban.insert(StarsmapApi.CommunityJobs, DeepFieldWorker.new(%{id: field.id}))
  end

  @doc "A photo of the target that its owner can add now, for the photo viewer and `My photos`."
  def eligible?(%DeepField{} = field, %Photo{} = photo),
    do: field.status == "open" and qualifies?(field, photo)

  # A closed field takes no new frame, but a rebuild can still take a removed frame out of it.
  defp qualifies?(field, photo) do
    photo.subject_id == field.subject_id and photo.status == "published" and
      aligned?(photo.wcs)
  end

  @doc "The open field that this photo can join. Only its owner sees the action."
  def open_for(%Photo{} = photo) do
    field = current()
    if field && eligible?(field, photo), do: %{slug: field.slug, title: field.title}, else: nil
  end

  defp aligned?(%{"status" => "solved", "projection" => "TAN", "cd" => [_, _, _, _]} = wcs),
    do:
      match?([_, _], wcs["crpix"]) and
        Enum.all?(~w(ra_deg dec_deg pixel_scale_arcsec width height), &is_number(wcs[&1]))

  defp aligned?(_), do: false

  @doc "The owner adds one photo, and can add all future photos of an open field with it."
  def add_frame(user, photo_id, future) when is_boolean(future) do
    field = current()

    case {field, Photos.owned(user, photo_id)} do
      {nil, _} ->
        {:error, :no_open_field}

      {_, nil} ->
        {:error, :not_found}

      {field, photo} ->
        if eligible?(field, photo) do
          now = StarsmapApi.Community.now()
          frame = upsert_frame(field, photo, now)
          if future, do: set_future(user, true)
          {:ok, frame_payload(field, frame)}
        else
          {:error, :not_eligible}
        end
    end
  end

  def add_frame(_, _, _), do: {:error, :invalid_request}

  defp upsert_frame(field, photo, consent_at) do
    Repo.insert!(
      %DeepFieldFrame{
        field_id: field.id,
        photo_id: photo.id,
        user_id: photo.user_id,
        consent_at: consent_at
      },
      on_conflict: [set: [consent_at: consent_at, withdrawn_at: nil, updated_at: consent_at]],
      conflict_target: [:field_id, :photo_id],
      returning: true
    )
  end

  @doc "The frame leaves at the next rebuild."
  def withdraw(user, photo_id) do
    with %Photo{} = photo <- Photos.owned(user, photo_id) || {:error, :not_found},
         %DeepFieldFrame{} = frame <-
           Repo.one(
             from f in DeepFieldFrame,
               where: f.photo_id == ^photo.id and is_nil(f.withdrawn_at),
               order_by: [desc: f.inserted_at],
               limit: 1
           ) || {:error, :not_found} do
      changed =
        Repo.update!(Ecto.Changeset.change(frame, withdrawn_at: StarsmapApi.Community.now()))

      {:ok, frame_payload(Repo.get!(DeepField, frame.field_id), changed)}
    end
  end

  def set_future(user, enabled) when is_boolean(enabled) do
    at = if enabled, do: StarsmapApi.Community.now(), else: nil
    changed = Repo.update!(Ecto.Changeset.change(user, deep_field_consent_at: at))
    {:ok, %{future: not is_nil(changed.deep_field_consent_at)}}
  end

  def set_future(_, _), do: {:error, :invalid_request}

  @doc "A photo of an owner with the standing consent joins the open field when it qualifies."
  def photo_ready(%Photo{} = photo) do
    with %DeepField{} = field <- current(),
         true <- eligible?(field, photo),
         %User{deep_field_consent_at: %DateTime{} = consent_at} <- Repo.get(User, photo.user_id),
         false <- frame_exists?(field, photo) do
      upsert_frame(field, photo, consent_at)
      :ok
    else
      _ -> :ok
    end
  end

  defp frame_exists?(field, photo),
    do:
      Repo.exists?(
        from f in DeepFieldFrame, where: f.field_id == ^field.id and f.photo_id == ^photo.id
      )

  @doc "A photo stopped being public. The field that shows it gets a new image soon."
  def photo_removed(photo_id) do
    Repo.all(
      from f in DeepField,
        join: b in DeepFieldBuild,
        on: b.id == f.current_build_id,
        join: frame in DeepFieldFrame,
        on: frame.field_id == f.id,
        where: frame.photo_id == ^photo_id,
        select: f
    )
    |> Enum.each(&enqueue/1)
  end

  @doc "The state of the frame of one photo for its owner."
  def frame_state(user, photo_id) do
    case Photos.owned(user, photo_id) do
      nil ->
        {:error, :not_found}

      photo ->
        field = current()

        {:ok,
         %{
           field: field && eligible?(field, photo) && %{slug: field.slug, title: field.title},
           frame: frame_for(photo.id),
           future: not is_nil(user.deep_field_consent_at)
         }}
    end
  end

  defp frame_for(photo_id) do
    case Repo.all(
           from f in DeepFieldFrame,
             join: d in DeepField,
             on: d.id == f.field_id,
             where: f.photo_id == ^photo_id,
             order_by: [desc: f.inserted_at],
             limit: 1,
             select: {d, f}
         ) do
      [{field, frame}] -> frame_payload(field, frame)
      [] -> nil
    end
  end

  defp frame_payload(field, frame),
    do: %{
      slug: field.slug,
      title: field.title,
      consent_at: frame.consent_at,
      withdrawn_at: frame.withdrawn_at,
      weight: frame.weight,
      rejection_reason: frame.rejection_reason
    }

  @doc "The frame and the open field of each photo of `My photos`, by photo id."
  def own_states(user, photos) do
    field = current()

    frames =
      Repo.all(
        from f in DeepFieldFrame,
          join: d in DeepField,
          on: d.id == f.field_id,
          where: f.user_id == ^user.id,
          order_by: [asc: f.inserted_at],
          select: {d, f}
      )
      |> Map.new(fn {d, f} -> {f.photo_id, frame_payload(d, f)} end)

    Map.new(photos, fn photo ->
      open = field && eligible?(field, photo)

      {photo.id,
       %{
         deep_field_open: if(open, do: %{slug: field.slug, title: field.title}, else: nil),
         deep_frame: frames[photo.id]
       }}
    end)
  end

  @doc "The row of the object inspector."
  def for_key(key) do
    with %Subject{id: subject} <- Subjects.find(key),
         %DeepField{} = field <-
           Repo.one(
             from f in DeepField,
               where: f.subject_id == ^subject and not is_nil(f.current_build_id),
               order_by: [desc: f.inserted_at],
               limit: 1
           ),
         %DeepFieldBuild{} = build <- Repo.get(DeepFieldBuild, field.current_build_id) do
      %{
        slug: field.slug,
        title: field.title,
        frames: build.frames_used,
        contributors: length(contributors(field, build)),
        limiting_mag: build.limiting_mag,
        thumbnail_url: media_url(field, build.version, "thumb")
      }
    else
      _ -> nil
    end
  end

  @doc "The current stack as one photo of the Sky overlay."
  def overlay_item(%DeepField{current_build_id: nil}), do: nil

  def overlay_item(%DeepField{} = field) do
    case Repo.get(DeepFieldBuild, field.current_build_id) do
      nil ->
        nil

      build ->
        %{
          id: "deep-field:#{field.slug}",
          deep_field: field.slug,
          title: field.title,
          author: "",
          licence: "",
          captured_at: build.inserted_at,
          wcs: grid_wcs(field),
          thumbnail_url: media_url(field, build.version, "thumb"),
          image_url: media_url(field, build.version, "stack")
        }
    end
  end

  def overlay_fields(), do: Repo.all(from f in DeepField, where: not is_nil(f.current_build_id))

  @doc "East is left and north is up, as on a chart of the sky."
  def grid_wcs(%DeepField{} = field) do
    scale = field.scale_arcsec / 3600

    %{
      ra_deg: field.ra_deg,
      dec_deg: field.dec_deg,
      pixel_scale_arcsec: field.scale_arcsec,
      rotation_deg: 0.0,
      width: field.width,
      height: field.height,
      cd: [-scale, 0.0, 0.0, scale],
      crpix: [(field.width + 1) / 2, (field.height + 1) / 2],
      projection: "TAN",
      frame: "ICRS",
      epoch: "J2000",
      status: "solved"
    }
  end

  @doc "The public payload of the deep field page."
  def public(slug) do
    case by_slug(slug) do
      nil ->
        {:error, :not_found}

      field ->
        build = field.current_build_id && Repo.get(DeepFieldBuild, field.current_build_id)
        {:ok, payload(field, build)}
    end
  end

  defp payload(field, build) do
    base = %{
      slug: field.slug,
      title: field.title,
      key: field.declared_key,
      status: field.status,
      opened_at: field.inserted_at,
      wcs: grid_wcs(field),
      build: nil,
      contributors: []
    }

    if build do
      Map.merge(base, %{
        build: %{
          version: build.version,
          built_at: build.inserted_at,
          frames: build.frames_used,
          max_coverage: build.max_coverage,
          limiting_mag: build.limiting_mag,
          best_limiting_mag: build.best_limiting_mag,
          gain_mag: build.gain_mag,
          stack_url: media_url(field, build.version, "stack"),
          best_url: media_url(field, build.version, "best"),
          depth_url: media_url(field, build.version, "depth")
        },
        contributors: contributors(field, build)
      })
    else
      base
    end
  end

  # The credit list reads current visibility. A hidden photo or a removed account leaves it at once.
  defp contributors(_field, build) do
    ids = build.frame_ids["ids"] || []

    Repo.all(
      from [p, u] in Photos.published(),
        where: p.id in ^ids,
        order_by: [asc: u.name, asc: p.id],
        select: %{
          id: p.id,
          title: p.title,
          licence: p.licence,
          name: u.name,
          handle: u.handle
        }
    )
    |> Enum.group_by(&{&1.handle, &1.name})
    |> Enum.map(fn {{handle, name}, photos} ->
      %{
        handle: handle,
        name: name,
        frames: length(photos),
        photos: Enum.map(photos, &Map.take(&1, [:id, :title, :licence]))
      }
    end)
    |> Enum.sort_by(&{-&1.frames, &1.name})
  end

  @doc "The view of a moderator: the target, the last builds, and the next candidates."
  def review do
    field = current()

    %{
      current:
        field &&
          %{
            slug: field.slug,
            title: field.title,
            frames: active_count(field),
            builds:
              Repo.all(
                from b in DeepFieldBuild,
                  where: b.field_id == ^field.id,
                  order_by: [desc: b.version],
                  limit: 5
              )
              |> Enum.map(
                &Map.take(&1, [
                  :version,
                  :status,
                  :stop,
                  :frames_used,
                  :frames_rejected,
                  :limiting_mag,
                  :best_limiting_mag,
                  :gain_mag,
                  :inserted_at
                ])
              )
          },
      candidates: candidates()
    }
  end

  defp active_count(field),
    do:
      Repo.aggregate(
        from(f in DeepFieldFrame, where: f.field_id == ^field.id and is_nil(f.withdrawn_at)),
        :count
      )

  def export(user),
    do:
      Repo.all(
        from f in DeepFieldFrame,
          join: d in DeepField,
          on: d.id == f.field_id,
          where: f.user_id == ^user.id,
          select: %{
            field: d.slug,
            photo_id: f.photo_id,
            consent_at: f.consent_at,
            withdrawn_at: f.withdrawn_at,
            weight: f.weight
          }
      )

  @doc "Account removal deletes the frames. The open fields get a new image without them."
  def delete_all(user) do
    ids = Repo.all(from f in DeepFieldFrame, where: f.user_id == ^user.id, select: f.photo_id)
    Enum.each(ids, &photo_removed/1)
    Repo.delete_all(from f in DeepFieldFrame, where: f.user_id == ^user.id)
  end

  @doc "The frames that the next build reads, oldest consent first."
  def frames_to_build(%DeepField{} = field) do
    Repo.all(
      from f in DeepFieldFrame,
        join: p in Photo,
        on: p.id == f.photo_id,
        join: u in User,
        on: u.id == p.user_id,
        where:
          f.field_id == ^field.id and is_nil(f.withdrawn_at) and p.status == "published" and
            not u.suspended,
        order_by: [asc: f.consent_at, asc: f.id],
        select: {f, p}
    )
    |> Enum.filter(fn {_, photo} -> qualifies?(field, photo) end)
  end

  @doc "The fields that the nightly job checks: the open field and each field with an image."
  def fields_to_check,
    do: Repo.all(from f in DeepField, where: f.status == "open" or not is_nil(f.current_build_id))

  @doc """
  True when the frames differ from the frames of the last attempt. A frame that a build refused
  is in that attempt, so the same refusal does not start a new build each night.
  """
  def changed?(%DeepField{} = field) do
    wanted = field |> frames_to_build() |> Enum.take(@max_frames) |> Enum.map(&elem(&1, 1).id)

    last =
      Repo.one(
        from b in DeepFieldBuild,
          where: b.field_id == ^field.id,
          order_by: [desc: b.version],
          limit: 1
      )

    case last do
      nil -> length(wanted) >= @min_frames
      build -> MapSet.new(build.frame_ids["attempted"] || []) != MapSet.new(wanted)
    end
  end

  def stars(%DeepField{} = field) do
    case Application.get_env(:starsmap_api, :deep_field_stars) do
      nil ->
        radius = :math.sqrt(field.width ** 2 + field.height ** 2) / 2 * field.scale_arcsec / 3600

        FieldCatalog.cone(field.ra_deg, field.dec_deg, radius,
          groups: FieldCatalog.gaia_groups(),
          limit: @star_limit
        )
        |> Enum.filter(&is_number(&1.magnitude))
        |> Enum.map(&Map.take(&1, [:key, :name, :ra, :dec, :magnitude]))

      stars ->
        stars
    end
  end

  def request(%DeepField{} = field, frames) do
    wcs = grid_wcs(field)

    %{
      grid: Map.take(wcs, [:ra_deg, :dec_deg, :width, :height, :cd, :crpix]),
      stars: stars(field),
      frames: frames
    }
  end

  @doc "Records one finished build. A published build replaces the image of the field."
  def record(%DeepField{} = field, used, result) do
    StarsmapApi.Community.transaction(fn ->
      version = next_version(field)
      published? = result["frames"] != [] and is_nil(result["stop"])
      kept = Enum.map(result["frames"] || [], & &1["id"])

      build =
        Repo.insert!(%DeepFieldBuild{
          field_id: field.id,
          version: version,
          status: if(published?, do: "published", else: "stopped"),
          stop: result["stop"],
          frame_ids: %{"ids" => kept, "attempted" => used},
          frames_used: length(kept),
          frames_rejected: length(result["rejected"] || []),
          max_coverage: result["max_coverage"] || 0,
          limiting_mag: result["limiting_mag"],
          best_limiting_mag: result["best_limiting_mag"],
          gain_mag: result["gain_mag"],
          stars_recovered: result["stars_recovered"],
          best_stars_recovered: result["best_stars_recovered"],
          best_photo_id: result["best_id"]
        })

      update_frames(field, used, result)

      cond do
        published? -> Repo.update!(Ecto.Changeset.change(field, current_build_id: build.id))
        shows_other_frames?(field, used) -> retire_image(field)
        true -> :ok
      end

      build
    end)
  end

  # With too few frames for a new stack, an image that holds a removed frame must not stay public.
  defp shows_other_frames?(field, used) do
    case field.current_build_id && Repo.get(DeepFieldBuild, field.current_build_id) do
      nil -> false
      build -> (build.frame_ids["ids"] || []) -- used != []
    end
  end

  defp retire_image(field),
    do: Repo.update!(Ecto.Changeset.change(field, current_build_id: nil))

  def next_version(%DeepField{} = field) do
    (Repo.aggregate(from(b in DeepFieldBuild, where: b.field_id == ^field.id), :max, :version) ||
       0) + 1
  end

  defp update_frames(field, used, result) do
    scores = Map.new(result["frames"] || [], &{&1["id"], &1})
    reasons = Map.new(result["rejected"] || [], &{&1["id"], &1["reason"]})

    Enum.each(used, fn photo_id ->
      score = scores[photo_id] || %{}

      Repo.update_all(
        from(f in DeepFieldFrame, where: f.field_id == ^field.id and f.photo_id == ^photo_id),
        set: [
          weight: score["weight"],
          noise: score["noise"],
          sharpness_pixels: score["sharpness_pixels"],
          rejection_reason: reasons[photo_id]
        ]
      )
    end)
  end

  @doc "Each image that is not the current image leaves the store. A takedown needs this."
  def remove_old_files(%DeepField{id: id} = field) do
    current = Repo.get!(DeepField, id).current_build_id

    Repo.all(
      from b in DeepFieldBuild,
        where: b.field_id == ^id and b.status == "published",
        select: {b.id, b.version}
    )
    |> Enum.reject(fn {build, _} -> build == current end)
    |> Enum.each(fn {_, old} ->
      Enum.each(@files, &Storage.adapter().delete(file_key(field, old, &1)))
    end)
  end
end

defmodule StarsmapApi.Community.DeepFieldWorker do
  @moduledoc """
  One rebuild, in the serial media queue. So it never runs next to another image job, and the
  worker keeps the memory limit of one decoder. A running job does not block a new one, so that a
  takedown during a build gets its own rebuild.
  """
  use Oban.Worker,
    queue: :media,
    max_attempts: 2,
    unique: [keys: [:id], period: 3600, states: [:available, :scheduled, :retryable]]

  alias StarsmapApi.Community.{DeepField, DeepFields, Storage}
  alias StarsmapApi.CommunityRepo, as: Repo

  @limit_seconds 600

  @impl true
  def timeout(_job), do: :timer.seconds(@limit_seconds + 120)

  @impl true
  def perform(%Oban.Job{args: %{"id" => id}}) do
    field = Repo.get(DeepField, id)

    if field do
      scratch = Path.join(Storage.root(), "deep-#{id}-#{System.unique_integer([:positive])}")
      File.mkdir_p!(scratch)

      try do
        run(field, scratch)
      after
        File.rm_rf(scratch)
      end
    else
      :ok
    end
  end

  defp run(field, scratch) do
    frames = field |> DeepFields.frames_to_build() |> Enum.take(DeepFields.max_frames())

    with {:ok, listed} <- download(frames, scratch),
         {:ok, result} <- stack(field, listed, scratch),
         :ok <- persist(field, result, DeepFields.next_version(field), scratch) do
      {:ok, _build} = DeepFields.record(field, Enum.map(listed, & &1.id), result)
      DeepFields.remove_old_files(field)
      :ok
    else
      {:error, reason} -> {:error, reason}
    end
  end

  # An image that has been removed from the store leaves one frame out, not the whole build.
  defp download(frames, scratch) do
    listed =
      Enum.flat_map(frames, fn {_, photo} ->
        path = Path.join(scratch, "#{photo.id}.webp")

        case Storage.adapter().get("masters/#{photo.id}/1600.webp", path) do
          :ok -> [%{id: photo.id, path: path, wcs: photo.wcs}]
          _ -> []
        end
      end)

    {:ok, listed}
  end

  defp stack(field, listed, scratch) do
    request = Path.join(scratch, "request.json")
    File.write!(request, Jason.encode!(DeepFields.request(field, listed)))

    case System.cmd("timeout", [
           to_string(@limit_seconds),
           StarsmapApi.Community.python(),
           StarsmapApi.Community.backend_script("community_deep_field.py"),
           request,
           Path.join(scratch, "output"),
           Path.join(scratch, "work")
         ]) do
      {json, 0} -> Jason.decode(json)
      {_, status} -> {:error, "The stack stopped with status #{status}"}
    end
  end

  defp persist(_field, %{"stop" => stop}, _version, _scratch) when is_binary(stop), do: :ok

  defp persist(field, _result, version, scratch) do
    Enum.reduce_while(DeepFields.files(), :ok, fn name, :ok ->
      case Storage.adapter().put(
             DeepFields.file_key(field, version, name),
             Path.join([scratch, "output", "#{name}.webp"]),
             false
           ) do
        :ok -> {:cont, :ok}
        error -> {:halt, error}
      end
    end)
  end
end

defmodule StarsmapApi.Community.DeepFieldNightly do
  @moduledoc "The nightly rebuild. A field with the same frames keeps its image and uses no CPU."
  use Oban.Worker, queue: :media, max_attempts: 3
  alias StarsmapApi.Community.DeepFields

  @impl true
  def perform(_job) do
    DeepFields.fields_to_check()
    |> Enum.filter(&DeepFields.changed?/1)
    |> Enum.each(fn field -> {:ok, _} = DeepFields.enqueue(field) end)

    :ok
  end
end

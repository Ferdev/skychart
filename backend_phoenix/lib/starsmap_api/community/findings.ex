defmodule StarsmapApi.Community.Finding do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "photo_findings" do
    field :photo_id, Ecto.UUID
    field :kind, :string
    field :designation, :string
    field :ra_deg, :float
    field :dec_deg, :float
    field :x, :float
    field :y, :float
    field :magnitude, :float
    field :recovered, :boolean, default: false
    field :near_key, :string
    field :near_name, :string
    field :state, :string
    field :second_photo_id, Ecto.UUID
    field :report, :string
    field :moderation_reason, :string
    timestamps(type: :utc_datetime_usec)
  end
end

defmodule StarsmapApi.Community.Findings do
  @moduledoc """
  What the sweep found in a photo. A finding stays private until its author approves it.
  A candidate needs a second frame from another time before it reaches a moderator, and a
  moderator before its author can approve it. The app prepares a report text only. A
  person must send that text: no code path in the app sends it to an outside service.
  """
  import Ecto.Query

  alias StarsmapApi.Community.{
    Action,
    Annotations,
    Finding,
    FieldCatalog,
    Photo,
    Photos,
    Storage,
    User
  }

  alias StarsmapApi.CommunityRepo, as: Repo

  @second_frame_arcsec 4.0
  @min_gap_seconds 3600
  @max_candidates_for_query 200
  @searched_lists [
    {"dr11", "Legacy Surveys DR11"},
    {"gaia", "Gaia DR3 slice of the atlas"},
    {"alerce", "ALeRCE ZTF objects"}
  ]

  def enqueue(%Photo{} = photo) do
    if sweepable?(photo) do
      Oban.insert(
        StarsmapApi.CommunityJobs,
        StarsmapApi.Community.SweepWorker.new(%{id: photo.id})
      )
    else
      :ok
    end
  end

  def sweepable?(%Photo{wcs: w} = photo) do
    photo.status in ["review", "published"] and is_map(w) and w["status"] == "solved" and
      not is_nil(photo.captured_at) and is_number(photo.site_lat) and is_number(photo.site_lon)
  end

  @doc "The site of a photo as the form sends it, rounded to one degree."
  def coarse_site(attrs) do
    with lat when is_number(lat) and lat >= -90 and lat <= 90 <- attrs["site_lat"],
         lon when is_number(lon) and lon >= -180 and lon <= 180 <- attrs["site_lon"] do
      %{site_lat: round(lat) * 1.0, site_lon: round(lon) * 1.0}
    else
      _ -> %{}
    end
  end

  @doc "Replaces the private findings of one sweep. An approved finding stays."
  def store(%Photo{} = photo, rows) do
    StarsmapApi.Community.transaction(fn ->
      Repo.delete_all(
        from f in Finding,
          where: f.photo_id == ^photo.id and f.state in ["proposed", "waiting_second"]
      )

      kept =
        Repo.all(from f in Finding, where: f.photo_id == ^photo.id)
        |> MapSet.new(
          &{&1.kind, &1.designation, round(&1.ra_deg * 3600), round(&1.dec_deg * 3600)}
        )

      rows
      |> Enum.reject(fn row ->
        MapSet.member?(
          kept,
          {row["kind"], row["designation"], round(row["ra"] * 3600), round(row["dec"] * 3600)}
        )
      end)
      |> Enum.map(&insert(photo, &1))
      |> Enum.filter(&(&1.kind == "candidate"))
      |> Enum.each(&match_second_frame(photo, &1))

      :ok
    end)
  end

  defp insert(photo, row) do
    Repo.insert!(%Finding{
      photo_id: photo.id,
      kind: row["kind"],
      designation: row["designation"],
      ra_deg: row["ra"] * 1.0,
      dec_deg: row["dec"] * 1.0,
      x: row["x"],
      y: row["y"],
      magnitude: row["magnitude"],
      recovered: row["recovered"] == true,
      near_key: row["near_key"],
      near_name: row["near_name"],
      state: if(row["kind"] == "candidate", do: "waiting_second", else: "proposed")
    })
  end

  @doc "A candidate at the same place in a frame from another time goes to moderators with this one."
  def match_second_frame(%Photo{} = photo, %Finding{} = finding) do
    box = @second_frame_arcsec / 3600

    Repo.all(
      from f in Finding,
        join: p in Photo,
        on: p.id == f.photo_id,
        where:
          f.kind == "candidate" and f.photo_id != ^photo.id and
            f.state in ["waiting_second", "review"],
        where: ^FieldCatalog.within(finding.ra_deg, finding.dec_deg, box),
        order_by: [asc: f.inserted_at, asc: f.id],
        limit: @max_candidates_for_query,
        select: {f, p.captured_at}
    )
    |> Enum.filter(fn {other, captured} ->
      FieldCatalog.separation(finding.ra_deg, finding.dec_deg, other.ra_deg, other.dec_deg) * 3600 <=
        @second_frame_arcsec and
        abs(DateTime.diff(captured, photo.captured_at)) >= @min_gap_seconds
    end)
    |> case do
      [] ->
        :ok

      [{other, _} | _] ->
        promote(other, photo.id)
        promote(finding, other.photo_id)
        :ok
    end
  end

  defp promote(finding, second) do
    Repo.update!(Ecto.Changeset.change(finding, state: "review", second_photo_id: second))
  end

  def pending_count,
    do:
      Repo.aggregate(
        from(f in Finding, where: f.kind == "candidate" and f.state == "review"),
        :count
      )

  @doc "All findings of a photo for its author or for a moderator. Others get the public list."
  def visible_to(user, id) do
    photo = Photos.get(id)

    cond do
      is_nil(photo) ->
        {:error, :not_found}

      user && (user.id == photo.user_id or user.role in ["admin", "moderator"]) ->
        {:ok,
         Repo.all(
           from f in Finding,
             where: f.photo_id == ^id and f.state not in ["dismissed", "rejected"],
             order_by: [asc: f.kind, asc: f.magnitude]
         )
         |> Enum.map(&private_view/1)}

      Photos.visible?(photo) ->
        {:ok, public_for_photo(id)}

      true ->
        {:error, :not_found}
    end
  end

  def public_for_photo(id) do
    Repo.all(from f in Finding, where: f.photo_id == ^id and f.state == "approved")
    |> Enum.map(&public_view/1)
  end

  defp public_view(f) do
    Map.take(f, [
      :id,
      :kind,
      :designation,
      :ra_deg,
      :dec_deg,
      :x,
      :y,
      :magnitude,
      :near_key,
      :near_name,
      :recovered
    ])
  end

  defp private_view(f) do
    f
    |> public_view()
    |> Map.merge(Map.take(f, [:state, :second_photo_id, :report, :moderation_reason]))
  end

  defp approved_with_photo do
    from f in Finding,
      join: p in Photo,
      on: p.id == f.photo_id,
      join: u in User,
      on: u.id == p.user_id,
      where: f.state == "approved" and p.status == "published" and not u.suspended,
      order_by: [desc: p.captured_at],
      limit: 40,
      select: {f, p, u}
  end

  defp listed({f, p, u}) do
    public_view(f)
    |> Map.merge(%{
      photo_id: p.id,
      photo_title: p.title,
      captured_at: p.captured_at,
      author: Map.take(u, [:handle, :name])
    })
  end

  def for_object(key),
    do:
      approved_with_photo() |> where([f], f.near_key == ^key) |> Repo.all() |> Enum.map(&listed/1)

  def for_author(user_id),
    do:
      approved_with_photo()
      |> where([_, p], p.user_id == ^user_id)
      |> Repo.all()
      |> Enum.map(&listed/1)

  @doc "The author shows or dismisses a finding. A candidate needs the moderator first."
  def set_public(user, id, show) when is_boolean(show) do
    finding = StarsmapApi.Community.uuid(id) && Repo.get(Finding, id)
    photo = finding && Photos.get(finding.photo_id)

    cond do
      is_nil(photo) or photo.user_id != user.id ->
        {:error, :not_found}

      finding.kind == "candidate" and finding.state not in ["reviewed", "approved"] ->
        {:error, :not_ready}

      finding.state in ["rejected"] ->
        {:error, :not_allowed}

      true ->
        state =
          cond do
            show -> "approved"
            finding.kind == "candidate" -> "reviewed"
            true -> "dismissed"
          end

        {:ok, private_view(Repo.update!(Ecto.Changeset.change(finding, state: state)))}
    end
  end

  def set_public(_, _, _), do: {:error, :invalid_request}

  def review_list do
    Repo.all(
      from f in Finding,
        join: p in Photo,
        on: p.id == f.photo_id,
        join: u in User,
        on: u.id == p.user_id,
        where: f.kind == "candidate" and f.state == "review",
        order_by: [asc: f.inserted_at],
        limit: 50,
        select: {f, p, u}
    )
    |> Enum.map(fn {f, p, u} ->
      second = f.second_photo_id && Photos.get(f.second_photo_id)
      place = second && second.wcs && Annotations.pixel(second.wcs, f.ra_deg, f.dec_deg)

      private_view(f)
      |> Map.merge(%{
        captured_at: p.captured_at,
        photo_id: p.id,
        photo_title: p.title,
        image_url: Storage.media_url(p.id, "1600"),
        wcs: p.wcs,
        author: Map.take(u, [:handle, :name]),
        second_frame:
          second &&
            %{
              id: second.id,
              title: second.title,
              captured_at: second.captured_at,
              image_url: Storage.media_url(second.id, "1600"),
              wcs: second.wcs,
              x: place && elem(place, 0),
              y: place && elem(place, 1)
            }
      })
    end)
  end

  def review(user, id, action, reason) do
    text = if action == "approve" and reason in [nil, ""], do: "Reviewed", else: reason

    cond do
      user.role not in ["admin", "moderator"] ->
        {:error, :not_allowed}

      action not in ["approve", "reject"] or not is_binary(text) or
          byte_size(text) not in 3..2000 ->
        {:error, :invalid_request}

      true ->
        StarsmapApi.Community.transaction(fn ->
          finding =
            (StarsmapApi.Community.uuid(id) && Repo.get(Finding, id)) || Repo.rollback(:not_found)

          if finding.kind != "candidate" or finding.state != "review",
            do: Repo.rollback(:not_ready)

          changes =
            if action == "approve",
              do: [state: "reviewed", report: report(finding)],
              else: [state: "rejected", moderation_reason: text]

          updated = Repo.update!(Ecto.Changeset.change(finding, changes))

          Repo.insert!(%Action{
            finding_id: updated.id,
            photo_id: updated.photo_id,
            user_id: user.id,
            action: "finding_#{action}",
            reason: text
          })

          updated
        end)
    end
  end

  @doc "Plain text for a person to read and to send by hand. It claims nothing."
  def report(%Finding{} = finding) do
    photo = Photos.get(finding.photo_id)
    author = Repo.get!(User, photo.user_id)
    second = finding.second_photo_id && Photos.get(finding.second_photo_id)

    [
      "Unconfirmed point source from an amateur image. A person must check this text before it goes to a service.",
      "RA (J2000, deg): #{:erlang.float_to_binary(finding.ra_deg, decimals: 5)}",
      "Dec (J2000, deg): #{:erlang.float_to_binary(finding.dec_deg, decimals: 5)}",
      "Time (UTC): #{DateTime.to_iso8601(photo.captured_at)}",
      "Magnitude estimate: #{finding.magnitude || "unknown"} (no standard band)",
      "Near: #{finding.near_name || finding.near_key || "unknown"}",
      "Second frame (UTC): #{second && DateTime.to_iso8601(second.captured_at)}",
      absence(photo),
      "Equipment: #{photo.equipment || "unknown"}",
      "Observer: #{author.name}"
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n")
  end

  # Only the lists that the sweep of this photo compared the point with. An older sweep has no
  # record of them, and its report then makes no claim of absence.
  defp absence(photo) do
    searched = List.wrap(get_in(photo.assets || %{}, ["sweep", "searched"]))

    case for({key, name} <- @searched_lists, key in searched, do: name) do
      [] -> nil
      names -> "Absent from: " <> Enum.join(names, ", ")
    end
  end

  def export(user),
    do:
      Repo.all(
        from f in Finding,
          join: p in Photo,
          on: p.id == f.photo_id,
          where: p.user_id == ^user.id,
          select: f
      )
      |> Enum.map(&private_view/1)

  def delete_all(user) do
    ids = from p in Photo, where: p.user_id == ^user.id, select: p.id
    Repo.delete_all(from f in Finding, where: f.photo_id in subquery(ids))
    :ok
  end
end

defmodule StarsmapApi.Community.SweepWorker do
  @moduledoc "One discovery sweep. It runs in the serial media queue, on the private master."
  use Oban.Worker, queue: :media, max_attempts: 3, unique: [keys: [:id], period: 3600]
  # The Gaia rows of one field. A field with more stars gives only the brightest ones.
  @gaia_limit 3000

  alias StarsmapApi.Community.{Annotations, FieldCatalog, Findings, Photos, SkySources, Storage}
  alias StarsmapApi.CommunityRepo, as: Repo

  @limit_seconds 150
  @max_survey_radius 1.5

  @impl Oban.Worker
  def timeout(_job), do: :timer.minutes(5)

  @impl true
  def perform(%Oban.Job{args: %{"id" => id}}) do
    photo = Photos.get(id)

    if photo && Findings.sweepable?(photo) do
      scratch = Path.join(Storage.root(), "sweep-#{id}-#{System.unique_integer([:positive])}")
      File.mkdir_p!(scratch)

      try do
        run(photo, scratch)
      after
        File.rm_rf(scratch)
      end
    else
      :ok
    end
  end

  defp run(photo, scratch) do
    w = photo.wcs
    radius = :math.sqrt(w["width"] ** 2 + w["height"] ** 2) / 2 * w["pixel_scale_arcsec"] / 3600
    image = Path.join(scratch, "master.png")
    request = Path.join(scratch, "request.json")
    File.write!(request, Jason.encode!(request(photo, radius)))

    with :ok <- Storage.adapter().get("masters/#{photo.id}/master.png", image),
         {json, 0} <-
           System.cmd("timeout", [
             to_string(@limit_seconds),
             StarsmapApi.Community.python(),
             StarsmapApi.Community.backend_script("community_sweep.py"),
             image,
             request,
             Path.join(scratch, "output")
           ]),
         {:ok, %{"findings" => rows, "stats" => stats}} <- Jason.decode(json),
         {:ok, :ok} <- Findings.store(Photos.get(photo.id), rows) do
      current = Photos.get(photo.id)

      Repo.update!(
        Ecto.Changeset.change(current, assets: Map.put(current.assets, "sweep", stats))
      )

      :ok
    else
      _ -> {:error, :sweep_failed}
    end
  end

  # A failed service gives nil, and the script then makes no candidate from it.
  defp request(photo, radius) do
    w = photo.wcs
    sources = SkySources.adapter()
    {ra, dec} = {w["ra_deg"], w["dec_deg"]}

    bodies =
      case sources.small_bodies(
             photo.captured_at,
             photo.site_lat,
             photo.site_lon,
             ra,
             dec,
             radius
           ) do
        {:ok, rows} ->
          Enum.flat_map(rows, fn row ->
            case Annotations.pixel(w, row.ra, row.dec) do
              {x, y} -> [Map.merge(row, %{x: x, y: y})]
              _ -> []
            end
          end)

        _ ->
          []
      end

    survey = if radius <= @max_survey_radius, do: value(sources.dr11(ra, dec, radius))

    gaia =
      FieldCatalog.cone(ra, dec, radius, limit: @gaia_limit)
      |> Enum.map(&Map.take(&1, [:ra, :dec]))

    %{
      wcs: w,
      bodies: bodies,
      dr11: survey,
      transients: value(sources.transients(ra, dec, radius)),
      gaia: gaia,
      # A full list means that the field has fewer stars than the limit: none was left out.
      gaia_complete: length(gaia) < @gaia_limit,
      galaxies:
        FieldCatalog.cone(ra, dec, radius, groups: FieldCatalog.named_groups(), limit: 500)
        |> Enum.filter(&(&1.object_type in ["galaxy", "active_galaxy"]))
        |> Enum.map(fn row ->
          %{
            key: row.key,
            name: row.name,
            ra: row.ra,
            dec: row.dec,
            size_arcmin: is_map(row.facts) && row.facts["major_axis_arcmin"]
          }
        end)
    }
  end

  defp value({:ok, rows}), do: rows
  defp value(_), do: nil
end

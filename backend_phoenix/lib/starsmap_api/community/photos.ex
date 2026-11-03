defmodule StarsmapApi.Community.Photos do
  @moduledoc "Photo ownership, quotas, publication, and public-safe payloads."
  import Ecto.Query
  alias StarsmapApi.Community.{Photo, User, Subjects, Storage, MediaWorker, Ranking}
  alias StarsmapApi.CommunityRepo, as: Repo
  @licences ["All rights reserved", "CC BY 4.0", "CC BY-SA 4.0", "CC0"]

  def create(user, attrs) do
    with {:ok, subject} <- Subjects.ensure(attrs["key"]),
         {:ok, size} <- size(attrs["size_bytes"]),
         true <- attrs["rights_confirmed"] == true and attrs["synthetic"] != true do
      StarsmapApi.Community.transaction(fn ->
        count =
          Repo.aggregate(
            from(p in Photo,
              where:
                p.user_id == ^user.id and
                  p.inserted_at > ^DateTime.add(StarsmapApi.Community.now(), -86400)
            ),
            :count
          )

        if count >= 20, do: Repo.rollback(:upload_quota)
        id = Ecto.UUID.generate()

        changeset =
          %Photo{
            id: id,
            user_id: user.id,
            subject_id: subject.id,
            declared_key: attrs["key"],
            source_key: "uploads/#{id}",
            size_bytes: size,
            status: "uploading"
          }
          |> Map.merge(StarsmapApi.Community.Findings.coarse_site(attrs))
          |> Ecto.Changeset.cast(attrs, [
            :title,
            :caption,
            :licence,
            :captured_at,
            :equipment,
            :processing,
            :composite,
            :depth_allowed
          ])
          |> Ecto.Changeset.validate_required([:title, :licence, :captured_at])
          |> Ecto.Changeset.validate_length(:title, min: 1, max: 160)
          |> Ecto.Changeset.validate_length(:caption, max: 4000)
          |> Ecto.Changeset.validate_length(:equipment, max: 500)
          |> Ecto.Changeset.validate_length(:processing, max: 1000)
          |> Ecto.Changeset.validate_inclusion(:licence, @licences)

        case Repo.insert(changeset) do
          {:ok, photo} -> photo
          {:error, _} -> Repo.rollback(:invalid_metadata)
        end
      end)
    else
      _ -> {:error, :invalid_metadata}
    end
  end

  # The storage check is a network request in production. It runs before the transaction, so a
  # slow storage service does not hold a database connection and the community lock. The
  # transaction reads the photo again: when a parallel call already moved it on, it does not
  # process it again.
  def complete(user, id) do
    case owned(user, id) do
      nil ->
        {:error, :not_found}

      %Photo{status: "uploading"} = photo ->
        case Storage.adapter().head(photo) do
          {:ok, etag} -> mark_processing(user, photo.id, etag)
          _ -> {:error, :upload_incomplete}
        end

      photo ->
        {:ok, photo}
    end
  end

  defp mark_processing(user, id, etag) do
    StarsmapApi.Community.transaction(fn ->
      photo =
        Repo.one(
          from p in Photo, where: p.id == ^id and p.user_id == ^user.id, lock: "FOR UPDATE"
        ) ||
          Repo.rollback(:not_found)

      if photo.status == "uploading" do
        photo =
          Repo.update!(
            Ecto.Changeset.change(photo,
              status: "processing",
              assets: Map.put(photo.assets, "source_etag", etag)
            )
          )

        {:ok, _} = Oban.insert(StarsmapApi.CommunityJobs, MediaWorker.new(%{id: photo.id}))
        photo
      else
        photo
      end
    end)
  end

  def get(id), do: if(StarsmapApi.Community.uuid(id), do: Repo.get(Photo, id), else: nil)

  def owned(user, id) do
    case get(id) do
      %Photo{user_id: uid} = photo when uid == user.id -> photo
      _ -> nil
    end
  end

  def published do
    from p in Photo,
      join: u in User,
      on: p.user_id == u.id,
      where: p.status == "published" and not u.suspended
  end

  def visible?(photo) do
    photo && photo.status == "published" && not Repo.get!(User, photo.user_id).suspended
  end

  def gallery(key, cursor \\ nil) do
    case Subjects.find(key) do
      nil ->
        []

      subject ->
        # The database orders the photos of the subject and returns one page only.
        page = Ranking.subject_page(subject.id, cursor, 24)
        photos = Repo.all(from p in Photo, where: p.id in ^page) |> Map.new(&{&1.id, &1})
        page |> Enum.map(&Map.fetch!(photos, &1)) |> public_many()
    end
  end

  def public(photo), do: photo |> List.wrap() |> public_many() |> hd()

  @doc """
  The public payloads of a list of photos, in the same order. The authors, subjects, votes and
  annotations of all the photos load in one query each, not in one query for each photo.
  """
  def public_many([]), do: []

  def public_many(photos) do
    ids = Enum.map(photos, & &1.id)
    user_ids = photos |> Enum.map(& &1.user_id) |> Enum.uniq()

    authors =
      Repo.all(from u in User, where: u.id in ^user_ids, select: {u.id, u.handle, u.name})
      |> Map.new(fn {id, handle, name} -> {id, %{handle: handle, name: name}} end)

    subjects = subject_names(photos)
    votes = Ranking.vote_counts(ids)
    annotations = StarsmapApi.Community.Annotations.list_many(ids)

    Enum.map(photos, &public_payload(&1, authors, subjects, votes, annotations))
  end

  defp public_payload(photo, authors, subjects, votes, annotations) do
    Map.take(photo, [
      :id,
      :declared_key,
      :title,
      :caption,
      :licence,
      :captured_at,
      :equipment,
      :processing,
      :composite,
      :published_at
    ])
    |> Map.merge(%{
      object_name: Map.get(subjects, photo.subject_id),
      # The author must exist, as with Repo.get!/2 before the batch load.
      author: Map.fetch!(authors, photo.user_id),
      votes: Map.get(votes, photo.id, 0),
      thumbnail_url: Storage.media_url(photo.id, "320"),
      image_url: Storage.media_url(photo.id, "1600"),
      wcs: photo.wcs,
      in_frame: Map.get(annotations, photo.id, [])
    })
  end

  defp subject_names(photos) do
    subject_ids = photos |> Enum.map(& &1.subject_id) |> Enum.reject(&is_nil/1) |> Enum.uniq()

    Repo.all(
      from s in StarsmapApi.Community.Subject,
        where: s.id in ^subject_ids,
        select: {s.id, s.name}
    )
    |> Map.new()
  end

  @doc "The photographer's own photos, with the private status and the last moderator text."
  def mine(user) do
    photos =
      Repo.all(
        from p in Photo, where: p.user_id == ^user.id, order_by: [desc: p.inserted_at], limit: 50
      )

    states = StarsmapApi.Community.DeepFields.own_states(user, photos)
    ids = Enum.map(photos, & &1.id)

    # The last moderator action of each photo, in one query.
    reasons =
      Repo.all(
        from a in StarsmapApi.Community.Action,
          where: a.photo_id in ^ids,
          distinct: a.photo_id,
          order_by: [desc: a.inserted_at],
          select: {a.photo_id, a.reason}
      )
      |> Map.new()

    subjects = subject_names(photos)

    votes =
      photos
      |> Enum.filter(&(&1.status == "published"))
      |> Enum.map(& &1.id)
      |> Ranking.vote_counts()

    Enum.map(photos, &(&1 |> own(reasons, subjects, votes) |> Map.merge(states[&1.id])))
  end

  defp own(p, reasons, subjects, votes) do
    Map.take(p, [
      :id,
      :title,
      :status,
      :inserted_at,
      :declared_key,
      :published_at,
      :depth_allowed
    ])
    |> Map.merge(%{
      object_name: Map.get(subjects, p.subject_id),
      # The owner can read the private derivative while the photo is not public.
      thumbnail_url: if(p.sha256, do: Storage.media_url(p.id, "320"), else: nil),
      votes: if(p.status == "published", do: Map.get(votes, p.id, 0), else: 0),
      moderation_reason: Map.get(reasons, p.id)
    })
  end

  @doc "Published photos, newest first."
  def recent(offset \\ 0, limit \\ 24) when is_integer(offset) and offset >= 0 do
    Repo.all(
      from [p, _] in published(),
        order_by: [desc: p.published_at, desc: p.id],
        offset: ^offset,
        limit: ^limit,
        select: p
    )
  end

  @doc "Published photos of one author, newest first. The database applies the limit."
  def by_author(id, limit \\ 100) when is_integer(limit) and limit > 0,
    do:
      Repo.all(
        from [p, _] in published(),
          where: p.user_id == ^id,
          order_by: [desc: p.published_at],
          limit: ^limit
      )

  defp size(value) when is_integer(value) and value > 0 and value <= 60_000_000, do: {:ok, value}
  defp size(_), do: {:error, :invalid_size}
end

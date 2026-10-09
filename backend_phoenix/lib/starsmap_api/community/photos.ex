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
          |> Ecto.Changeset.cast(attrs, [
            :title,
            :caption,
            :licence,
            :captured_at,
            :equipment,
            :processing,
            :composite
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

  def complete(user, id) do
    StarsmapApi.Community.transaction(fn ->
      photo = owned(user, id) || Repo.rollback(:not_found)

      if photo.status == "uploading" do
        case Storage.adapter().head(photo) do
          {:ok, etag} ->
            photo =
              Repo.update!(
                Ecto.Changeset.change(photo,
                  status: "processing",
                  assets: Map.put(photo.assets, "source_etag", etag)
                )
              )

            {:ok, _} = Oban.insert(StarsmapApi.CommunityJobs, MediaWorker.new(%{id: photo.id}))
            photo

          _ ->
            Repo.rollback(:upload_incomplete)
        end
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
        scores = Ranking.scores()

        candidates =
          Repo.all(
            from [p, _] in published(),
              where: p.subject_id == ^subject.id,
              select: {p.id, p.published_at}
          )

        ids =
          candidates
          |> Enum.sort_by(fn {id, at} ->
            {-Map.get(scores, id, %{score: 0.0}).score, DateTime.to_unix(at, :microsecond), id}
          end)
          |> Enum.map(&elem(&1, 0))

        start = if cursor, do: (Enum.find_index(ids, &(&1 == cursor)) || -1) + 1, else: 0
        page = Enum.slice(ids, start, 24)
        photos = Repo.all(from p in Photo, where: p.id in ^page) |> Map.new(&{&1.id, &1})
        Enum.map(page, &(photos |> Map.fetch!(&1) |> public()))
    end
  end

  def public(photo) do
    author = Repo.get!(User, photo.user_id)

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
      author: Map.take(author, [:handle, :name]),
      votes: Ranking.vote_count(photo.id),
      thumbnail_url: Storage.media_url(photo.id, "320"),
      image_url: Storage.media_url(photo.id, "1600"),
      wcs: photo.wcs,
      in_frame: StarsmapApi.Community.Annotations.list(photo.id)
    })
  end

  def mine(user),
    do:
      Repo.all(
        from p in Photo, where: p.user_id == ^user.id, order_by: [desc: p.inserted_at], limit: 50
      )
      |> Enum.map(fn p ->
        action =
          Repo.one(
            from a in StarsmapApi.Community.Action,
              where: a.photo_id == ^p.id,
              order_by: [desc: a.inserted_at],
              limit: 1
          )

        Map.take(p, [:id, :title, :status, :inserted_at])
        |> Map.put(:moderation_reason, if(action, do: action.reason, else: nil))
      end)

  def by_author(id),
    do:
      Repo.all(
        from [p, _] in published(),
          where: p.user_id == ^id,
          order_by: [desc: p.published_at],
          limit: 100
      )

  defp size(value) when is_integer(value) and value > 0 and value <= 60_000_000, do: {:ok, value}
  defp size(_), do: {:error, :invalid_size}
end

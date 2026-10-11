defmodule StarsmapApi.Community.Moderation do
  @moduledoc "Audited publication, takedown, and anonymous reports."
  import Ecto.Query
  alias StarsmapApi.Community.{Photo, Photos, Action, Report, Ranking, Storage, User}
  alias StarsmapApi.CommunityRepo, as: Repo

  @listed ["review", "published", "hidden", "rejected"]

  def queue, do: list("review", 0, 50)

  @doc "Photos of one status for moderators. The review queue shows the oldest photo first."
  def list(status, offset \\ 0, limit \\ 24)

  def list(status, offset, limit)
      when status in @listed and is_integer(offset) and offset >= 0 do
    order = if status == "review", do: [asc: :inserted_at], else: [desc: :updated_at]

    Repo.all(
      from p in Photo,
        where: p.status == ^status,
        order_by: ^order,
        offset: ^offset,
        limit: ^limit
    )
  end

  def list(_, _, _), do: []

  @doc "Number of photos for each status, and the number of open reports."
  def counts do
    photos =
      Repo.all(
        from p in Photo,
          where: p.status in @listed,
          group_by: p.status,
          select: {p.status, count()}
      )
      |> Map.new()

    @listed
    |> Map.new(&{&1, Map.get(photos, &1, 0)})
    |> Map.put(
      "reports",
      Repo.aggregate(from(r in Report, where: is_nil(r.resolved_at)), :count)
    )
  end

  @doc "Work that waits for a moderator: photos in review and open reports."
  def pending_count do
    counts = counts()
    counts["review"] + counts["reports"]
  end

  @doc "Private view of a photo for moderators: the public payload and the review signals."
  def detail(photo) do
    author = Repo.get!(User, photo.user_id)

    by_status =
      Repo.all(
        from p in Photo,
          where: p.user_id == ^author.id and p.status in @listed,
          group_by: p.status,
          select: {p.status, count()}
      )
      |> Map.new()

    # The same source bytes in a different photo is a review signal, not proof of a copy.
    duplicates =
      if photo.sha256,
        do:
          Repo.all(
            from p in Photo,
              join: u in User,
              on: u.id == p.user_id,
              where: p.sha256 == ^photo.sha256 and p.id != ^photo.id,
              order_by: [asc: p.inserted_at],
              limit: 5,
              select: %{id: p.id, title: p.title, status: p.status, handle: u.handle}
          ),
        else: []

    last =
      Repo.one(
        from a in Action,
          left_join: u in User,
          on: u.id == a.user_id,
          where: a.photo_id == ^photo.id,
          order_by: [desc: a.inserted_at],
          limit: 1,
          select: %{action: a.action, reason: a.reason, at: a.inserted_at, moderator: u.name}
      )

    Photos.public(photo)
    |> Map.merge(%{
      status: photo.status,
      submitted_at: photo.inserted_at,
      size_bytes: photo.size_bytes,
      width: photo.assets["width"],
      height: photo.assets["height"],
      author: %{
        handle: author.handle,
        name: author.name,
        joined_at: author.inserted_at,
        suspended: author.suspended,
        published: Map.get(by_status, "published", 0),
        rejected: Map.get(by_status, "rejected", 0) + Map.get(by_status, "hidden", 0)
      },
      duplicates: duplicates,
      reports:
        Repo.all(
          from r in Report,
            where: r.photo_id == ^photo.id and is_nil(r.resolved_at),
            order_by: [asc: r.inserted_at],
            select: %{reason: r.reason, at: r.inserted_at}
        ),
      last_action: last
    })
  end

  @doc "Recent audit records, newest first."
  def log(limit \\ 50) do
    Repo.all(
      from a in Action,
        left_join: u in User,
        on: u.id == a.user_id,
        left_join: p in Photo,
        on: p.id == a.photo_id,
        order_by: [desc: a.inserted_at],
        limit: ^limit,
        select: %{
          action: a.action,
          reason: a.reason,
          at: a.inserted_at,
          moderator: u.name,
          photo_id: p.id,
          photo_title: p.title
        }
    )
  end

  # Approval and restoration get a default audit text. Hiding and rejection need a reason,
  # because the photographer reads it.
  def review(user, id, action, reason)
      when action in ["approve", "restore"] and reason in [nil, ""],
      do: review(user, id, action, if(action == "approve", do: "Approved", else: "Restored"))

  def review(user, id, action, reason)
      when action in ["approve", "hide", "reject", "restore"] and is_binary(reason) do
    if user.role not in ["moderator", "admin"] or byte_size(reason) not in 3..2000 do
      {:error, :not_allowed}
    else
      StarsmapApi.Community.transaction(fn ->
        photo = Photos.get(id) || Repo.rollback(:not_found)
        if photo.status in ["uploading", "processing", "failed"], do: Repo.rollback(:not_ready)

        if action in ["approve", "restore"] and
             Repo.exists?(
               from a in Action,
                 where:
                   a.photo_id == ^photo.id and a.action in ["author_remove", "account_delete"]
             ),
           do: Repo.rollback(:not_allowed)

        status =
          if action in ["approve", "restore"],
            do: "published",
            else: if(action == "hide", do: "hidden", else: "rejected")

        # Media reads are publication-gated even if a former CDN URL is known.
        photo =
          Repo.update!(
            Ecto.Changeset.change(photo,
              status: status,
              published_at:
                if(status == "published",
                  do: photo.published_at || StarsmapApi.Community.now(),
                  else: photo.published_at
                )
            )
          )

        Repo.insert!(%Action{photo_id: photo.id, user_id: user.id, action: action, reason: reason})

        Ranking.refresh_author(photo.user_id)

        Repo.update_all(
          from(r in Report, where: r.photo_id == ^photo.id and is_nil(r.resolved_at)),
          set: [resolved_at: StarsmapApi.Community.now()]
        )

        {:ok, _} =
          Oban.insert(
            StarsmapApi.CommunityJobs,
            StarsmapApi.Community.PublishWorker.new(%{id: photo.id})
          )

        photo
      end)
    end
  end

  def review(_, _, _, _), do: {:error, :not_allowed}

  def remove(user, id) do
    StarsmapApi.Community.transaction(fn ->
      photo = Photos.owned(user, id) || Repo.rollback(:not_found)
      Repo.update!(Ecto.Changeset.change(photo, status: "hidden"))

      Repo.insert!(%Action{
        photo_id: id,
        user_id: user.id,
        action: "author_remove",
        reason: "Removed by the photographer"
      })

      Ranking.refresh_author(photo.user_id)

      {:ok, _} =
        Oban.insert(StarsmapApi.CommunityJobs, StarsmapApi.Community.PublishWorker.new(%{id: id}))

      :ok
    end)
  end

  def report(id, reason) when is_binary(reason) and byte_size(reason) in 3..2000 do
    if Photos.visible?(Photos.get(id)) do
      Repo.insert(%Report{photo_id: id, reason: reason})
    else
      {:error, :not_found}
    end
  end

  def report(_, _), do: {:error, :invalid_report}

  def reports do
    Repo.all(
      from r in Report, where: is_nil(r.resolved_at), order_by: [asc: r.inserted_at], limit: 50
    )
    |> Enum.map(fn r ->
      %{id: r.id, reason: r.reason, at: r.inserted_at, photo: detail(Photos.get(r.photo_id))}
    end)
  end

  def cancel_votes(actor, handle, reason) when is_binary(reason) do
    if actor.role not in ["admin", "moderator"] or byte_size(reason) not in 3..2000 do
      {:error, :not_allowed}
    else
      StarsmapApi.Community.transaction(fn ->
        user =
          Repo.get_by(StarsmapApi.Community.User, handle: handle) || Repo.rollback(:not_found)

        authors =
          Repo.all(
            from v in StarsmapApi.Community.Vote,
              join: p in Photo,
              on: p.id == v.photo_id,
              where: v.user_id == ^user.id,
              select: p.user_id
          )

        Repo.delete_all(from v in StarsmapApi.Community.Vote, where: v.user_id == ^user.id)

        Repo.insert!(%Action{
          user_id: actor.id,
          action: "cancel_votes",
          reason: "#{handle}: #{reason}"
        })

        authors |> Enum.uniq() |> Enum.each(&Ranking.refresh_author/1)
        :ok
      end)
    end
  end

  def cancel_votes(_, _, _), do: {:error, :not_allowed}

  def suspend(actor, handle, reason, suspended)
      when is_boolean(suspended) and is_binary(reason) do
    if actor.role not in ["admin", "moderator"] or byte_size(reason) not in 3..2000 do
      {:error, :not_allowed}
    else
      StarsmapApi.Community.transaction(fn ->
        user =
          Repo.get_by(StarsmapApi.Community.User, handle: handle) || Repo.rollback(:not_found)

        if user.role == "admin" or user.id == actor.id, do: Repo.rollback(:not_allowed)
        Repo.update!(Ecto.Changeset.change(user, suspended: suspended))

        if suspended,
          do: Repo.delete_all(from t in StarsmapApi.Community.Token, where: t.user_id == ^user.id)

        Repo.insert!(%Action{
          user_id: actor.id,
          action: "suspend_account",
          reason: "#{handle}: #{reason}"
        })

        subjects = Repo.all(from p in Photo, distinct: p.subject_id, select: p.subject_id)
        Enum.each(subjects, &Ranking.refresh/1)

        for photo <- Repo.all(from p in Photo, where: p.user_id == ^user.id) do
          {:ok, _} =
            Oban.insert(
              StarsmapApi.CommunityJobs,
              StarsmapApi.Community.PublishWorker.new(%{id: photo.id})
            )
        end

        :ok
      end)
    end
  end

  def suspend(_, _, _, _), do: {:error, :not_allowed}

  def publish_files(photo) do
    scratch =
      Path.join(Storage.root(), "publish-#{photo.id}-#{System.unique_integer([:positive])}")

    File.mkdir_p!(scratch)

    try do
      for size <- ["96", "320", "1600"], reduce: :ok do
        :ok ->
          public = Storage.public_key(photo, size)

          if Photos.visible?(photo) do
            path = Path.join(scratch, "#{size}.webp")

            with :ok <- Storage.adapter().get("masters/#{photo.id}/#{size}.webp", path),
                 :ok <- Storage.adapter().put(public, path, true),
                 do: :ok
          else
            normalize_delete(Storage.adapter().delete(public))
          end

        error ->
          error
      end
    after
      File.rm_rf(scratch)
    end
  end

  defp normalize_delete({:error, :enoent}), do: :ok
  defp normalize_delete(other), do: other
end

defmodule StarsmapApi.Community.Ranking do
  @moduledoc "Version-one positive-vote ranking, deterministic weights, and cover deltas."
  import Ecto.Query
  alias StarsmapApi.Community.{Photo, User, Vote, Photos, Subjects}
  alias StarsmapApi.CommunityRepo, as: Repo

  def vote(user, photo_id, present) do
    StarsmapApi.Community.transaction(fn ->
      photo = Photos.get(photo_id) || Repo.rollback(:not_found)

      if not Photos.visible?(photo) or photo.user_id == user.id,
        do: Repo.rollback(:vote_not_allowed)

      if DateTime.diff(StarsmapApi.Community.now(), user.inserted_at) < 86400,
        do: Repo.rollback(:account_too_new)

      if present do
        change =
          Ecto.Changeset.change(%Vote{user_id: user.id, photo_id: photo.id})
          |> Ecto.Changeset.unique_constraint([:user_id, :photo_id])

        case Repo.insert(change, on_conflict: :nothing, conflict_target: [:user_id, :photo_id]) do
          {:ok, _} -> :ok
          _ -> Repo.rollback(:vote_not_allowed)
        end
      else
        Repo.delete_all(from v in Vote, where: v.user_id == ^user.id and v.photo_id == ^photo.id)
      end

      # Removing a vote changes that voter's subsequent 1/k weights too.
      refresh_author(photo.user_id)
      %{votes: vote_count(photo.id)}
    end)
  end

  def refresh_author(user_id) do
    Repo.all(
      from p in Photo, where: p.user_id == ^user_id, distinct: p.subject_id, select: p.subject_id
    )
    |> Enum.each(&refresh/1)
  end

  def photographers do
    scores = scores()

    covers =
      Repo.all(from s in "subject_photo_stats", select: s.payload)
      |> Enum.reduce(%{}, fn p, result ->
        case get_in(p, ["cover", "author", "handle"]) do
          nil -> result
          handle -> Map.update(result, handle, 1, &(&1 + 1))
        end
      end)

    firsts =
      Repo.all(
        from s in StarsmapApi.Community.Subject,
          join: p in Photo,
          on: p.id == s.first_photo_id,
          join: u in User,
          on: u.id == p.user_id,
          where: not u.suspended and p.status == "published",
          select: u.handle
      )
      |> Enum.frequencies()

    rows =
      Repo.all(
        from [p, u] in Photos.published(), select: {p.id, u.id, u.handle, u.name, p.subject_id}
      )

    rows
    |> Enum.group_by(&elem(&1, 1))
    |> Enum.map(fn {_, photos} ->
      [{_, _, handle, name, _} | _] = photos

      values =
        photos
        |> Enum.map(fn {id, _, _, _, _} -> Map.get(scores, id, %{score: 0.0}).score end)
        |> Enum.sort(:desc)

      h = values |> Enum.with_index(1) |> Enum.count(fn {v, i} -> v >= i end)

      %{
        handle: handle,
        name: name,
        h_index: h,
        photos: length(photos),
        covers: Map.get(covers, handle, 0),
        first_photos: Map.get(firsts, handle, 0)
      }
    end)
    |> Enum.sort_by(&{-&1.h_index, -&1.covers, -&1.first_photos, &1.handle})
    |> Enum.take(50)
  end

  def voted?(user, id),
    do:
      StarsmapApi.Community.uuid(id) &&
        Repo.exists?(from v in Vote, where: v.photo_id == ^id and v.user_id == ^user.id)

  def vote_count(id),
    do:
      Repo.aggregate(
        from(v in Vote,
          join: u in User,
          on: u.id == v.user_id,
          where: v.photo_id == ^id and not u.suspended
        ),
        :count
      )

  def scores do
    rows =
      Repo.query!("""
        WITH weighted AS (
          SELECT v.photo_id, v.inserted_at,
          1.0 / row_number() OVER (PARTITION BY v.user_id,p.user_id ORDER BY v.inserted_at,v.id) AS weight
          FROM photo_votes v JOIN users u ON u.id=v.user_id JOIN photos p ON p.id=v.photo_id
          JOIN users a ON a.id=p.user_id
          WHERE NOT u.suspended AND NOT a.suspended AND p.status='published'
          AND u.inserted_at <= now() - interval '24 hours'
        )
        SELECT photo_id, sum(weight)::float,
        CASE WHEN count(*) >= 3 THEN sum(weight * power(2.0, -extract(epoch FROM (now()-inserted_at))/259200.0))::float ELSE 0 END
        FROM weighted GROUP BY photo_id
      """).rows

    Map.new(rows, fn [id, score, trend] ->
      {Ecto.UUID.load!(id), %{score: score, trend: trend}}
    end)
  end

  def ranked(period \\ "all") do
    scores = scores()
    field = if period == "trend", do: :trend, else: :score

    ids =
      scores
      |> Enum.sort_by(fn {id, values} -> {-values[field], id} end)
      |> Enum.take(24)
      |> Enum.map(&elem(&1, 0))

    photos =
      Repo.all(from [p, _] in Photos.published(), where: p.id in ^ids, select: p)
      |> Map.new(&{&1.id, &1})

    ranked = Enum.map(ids, &Map.get(photos, &1)) |> Enum.reject(&is_nil/1)
    # Fill the unvoted tail without excluding older highly ranked photos.
    tail =
      Repo.all(
        from [p, _] in Photos.published(),
          where: p.id not in ^ids,
          order_by: [asc: p.published_at, asc: p.id],
          limit: ^(24 - length(ranked)),
          select: p
      )

    ranked ++ tail
  end

  def refresh(subject_id) do
    candidates =
      Repo.all(
        from [p, _] in Photos.published(),
          where: p.subject_id == ^subject_id,
          order_by: [asc: p.published_at, asc: p.id],
          select: p
      )

    scores = scores()

    cover =
      candidates
      |> Enum.sort_by(fn p ->
        {-Map.get(scores, p.id, %{score: 0.0}).score,
         DateTime.to_unix(p.published_at, :microsecond), p.id}
      end)
      |> List.first()

    subject = Repo.get!(StarsmapApi.Community.Subject, subject_id)

    if is_nil(subject.first_photo_id) and candidates != [] do
      Repo.update!(Ecto.Changeset.change(subject, first_photo_id: hd(candidates).id))
    end

    newest =
      Enum.max_by(candidates, &DateTime.to_unix(&1.published_at, :microsecond), fn -> nil end)

    new_photo =
      if newest && DateTime.diff(StarsmapApi.Community.now(), newest.published_at) < 604_800,
        do:
          Photos.public(newest)
          |> Map.drop([:caption, :equipment, :processing, :votes, :in_frame]),
        else: nil

    payload = %{
      subject_id: subject_id,
      keys: Subjects.subject_keys(subject_id),
      name: subject.name,
      dominant_color: if(cover, do: cover.assets["dominant_color"], else: nil),
      count: length(candidates),
      cover:
        if(cover,
          do:
            Photos.public(cover)
            |> Map.drop([:caption, :equipment, :processing, :votes, :in_frame]),
          else: nil
        ),
      new_photo: new_photo,
      new_photo_until:
        if(new_photo,
          do: DateTime.add(newest.published_at, 604_800) |> DateTime.to_iso8601(),
          else: nil
        )
    }

    [[version]] = Repo.query!("SELECT nextval('community_version')").rows

    Repo.insert_all(
      "subject_photo_stats",
      [%{subject_id: Ecto.UUID.dump!(subject_id), version: version, payload: payload}],
      on_conflict: {:replace, [:version, :payload]},
      conflict_target: [:subject_id]
    )

    payload
  end

  def index(since) do
    rows =
      Repo.all(
        from s in "subject_photo_stats",
          where: s.version > ^since,
          order_by: [asc: s.version],
          limit: 500,
          select: {s.version, s.payload}
      )

    %{
      items: Enum.map(rows, &elem(&1, 1)),
      version: if(rows == [], do: since, else: rows |> List.last() |> elem(0)),
      more: length(rows) == 500
    }
  end
end

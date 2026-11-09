defmodule StarsmapApi.Community.Ranking do
  @moduledoc "Version-one positive-vote ranking, deterministic weights, and cover deltas."
  import Ecto.Query
  alias StarsmapApi.Community.{Photo, User, Vote, Photos, Subjects}
  alias StarsmapApi.CommunityRepo, as: Repo

  # Each vote has the weight 1/k, where k is its position in the votes of one voter for one author.
  # A filter on the author (p.user_id) keeps each window partition complete.
  @weighted_votes """
    SELECT v.photo_id, v.inserted_at,
    1.0 / row_number() OVER (PARTITION BY v.user_id,p.user_id ORDER BY v.inserted_at,v.id) AS weight
    FROM photo_votes v JOIN users u ON u.id=v.user_id JOIN photos p ON p.id=v.photo_id
    JOIN users a ON a.id=p.user_id
    WHERE NOT u.suspended AND NOT a.suspended AND p.status='published'
    AND u.first_sign_in_at <= now() - interval '24 hours'
  """

  def vote(user, photo_id, present) do
    StarsmapApi.Community.transaction(fn ->
      photo = Photos.get(photo_id) || Repo.rollback(:not_found)

      if not Photos.visible?(photo) or photo.user_id == user.id,
        do: Repo.rollback(:vote_not_allowed)

      if too_new?(user), do: Repo.rollback(:account_too_new)

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

  # The age starts at the first verified sign-in. An unverified row does not get older.
  defp too_new?(%User{first_sign_in_at: nil}), do: true

  defp too_new?(%User{first_sign_in_at: at}),
    do: DateTime.diff(StarsmapApi.Community.now(), at) < 86400

  def refresh_author(user_id) do
    scores = scores()

    Repo.all(
      from p in Photo, where: p.user_id == ^user_id, distinct: p.subject_id, select: p.subject_id
    )
    |> Enum.each(&refresh(&1, scores))
  end

  def photographers,
    do: photographer_rows("ORDER BY rank LIMIT 50", []) |> Enum.map(&Map.delete(&1, :rank))

  @doc "Public statistics of one photographer, with the position in the listing."
  def photographer(handle) when is_binary(handle) do
    case photographer_rows("WHERE handle = $1", [handle]) do
      [row] -> row
      [] -> nil
    end
  end

  def photographer(_), do: nil

  # The database ranks all photographers and returns only the rows of `tail`. The h-index of a
  # photographer is the number of positions i where the i-th best photo score is at least i.
  # The order is h-index, covers and first photos (highest first), then the handle in byte order.
  defp photographer_rows(tail, params) do
    Repo.query!(
      """
      WITH weighted AS (
        #{@weighted_votes}
      ),
      scored AS (SELECT photo_id, sum(weight)::float AS score FROM weighted GROUP BY photo_id),
      published AS (
        SELECT p.id, p.user_id, p.subject_id, coalesce(s.score, 0.0) AS score
        FROM photos p JOIN users u ON u.id = p.user_id
        LEFT JOIN scored s ON s.photo_id = p.id
        WHERE p.status = 'published' AND NOT u.suspended
      ),
      positions AS (
        SELECT user_id, score, row_number() OVER (PARTITION BY user_id ORDER BY score DESC) AS i
        FROM published
      ),
      h AS (SELECT user_id, count(*) FILTER (WHERE score >= i) AS h_index FROM positions GROUP BY user_id),
      authors AS (
        SELECT user_id, count(*) AS photos, count(DISTINCT subject_id) AS objects
        FROM published GROUP BY user_id
      ),
      covers AS (
        SELECT payload -> 'cover' -> 'author' ->> 'handle' AS handle, count(*) AS covers
        FROM subject_photo_stats
        WHERE payload -> 'cover' -> 'author' ->> 'handle' IS NOT NULL
        GROUP BY 1
      ),
      firsts AS (
        SELECT u.handle, count(*) AS first_photos
        FROM subjects s JOIN photos p ON p.id = s.first_photo_id JOIN users u ON u.id = p.user_id
        WHERE NOT u.suspended AND p.status = 'published'
        GROUP BY u.handle
      ),
      votes AS (
        SELECT p.user_id, count(*) AS votes
        FROM photo_votes v JOIN users u ON u.id = v.user_id JOIN photos p ON p.id = v.photo_id
        WHERE NOT u.suspended AND p.status = 'published'
        GROUP BY p.user_id
      ),
      ranked AS (
        SELECT u.handle, u.name, h.h_index, a.photos, a.objects,
          coalesce(v.votes, 0) AS votes, coalesce(c.covers, 0) AS covers,
          coalesce(f.first_photos, 0) AS first_photos,
          row_number() OVER (
            ORDER BY h.h_index DESC, coalesce(c.covers, 0) DESC,
              coalesce(f.first_photos, 0) DESC, u.handle COLLATE "C"
          ) AS rank
        FROM authors a JOIN users u ON u.id = a.user_id JOIN h ON h.user_id = a.user_id
        LEFT JOIN votes v ON v.user_id = a.user_id
        LEFT JOIN covers c ON c.handle = u.handle
        LEFT JOIN firsts f ON f.handle = u.handle
      )
      SELECT handle, name, h_index, photos, objects, votes, covers, first_photos, rank
      FROM ranked
      #{tail}
      """,
      params
    ).rows
    |> Enum.map(fn [handle, name, h, photos, objects, votes, covers, firsts, rank] ->
      %{
        handle: handle,
        name: name,
        h_index: h,
        photos: photos,
        objects: objects,
        votes: votes,
        covers: covers,
        first_photos: firsts,
        rank: rank
      }
    end)
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

  @doc "The vote counts of a list of photos in one query. A photo with no vote is not in the map."
  def vote_counts([]), do: %{}

  def vote_counts(ids),
    do:
      Repo.all(
        from v in Vote,
          join: u in User,
          on: u.id == v.user_id,
          where: v.photo_id in ^ids and not u.suspended,
          group_by: v.photo_id,
          select: {v.photo_id, count()}
      )
      |> Map.new()

  @doc """
  One page of the published photos of a subject: the highest score first, then the oldest
  publication, then the id. The page starts after the photo `cursor`; an unknown cursor gives the
  first page. The database sorts and limits the rows.
  """
  def subject_page(subject_id, cursor, limit) do
    cursor =
      case Ecto.UUID.dump(cursor || "") do
        {:ok, id} -> id
        :error -> nil
      end

    Repo.query!(
      """
      WITH weighted AS (
        #{@weighted_votes}
        AND p.user_id IN (SELECT user_id FROM photos WHERE subject_id = $1)
      ),
      scored AS (SELECT photo_id, sum(weight)::float AS score FROM weighted GROUP BY photo_id),
      ranked AS (
        SELECT p.id, coalesce(s.score, 0.0) AS score, p.published_at
        FROM photos p JOIN users u ON u.id = p.user_id
        LEFT JOIN scored s ON s.photo_id = p.id
        WHERE p.subject_id = $1 AND p.status = 'published' AND NOT u.suspended
      ),
      after AS (SELECT -score AS score, published_at, id FROM ranked WHERE id = $2)
      SELECT r.id FROM ranked r
      WHERE NOT EXISTS (SELECT 1 FROM after)
        OR (-r.score, r.published_at, r.id) > (SELECT score, published_at, id FROM after)
      ORDER BY r.score DESC, r.published_at ASC, r.id ASC
      LIMIT $3
      """,
      [Ecto.UUID.dump!(subject_id), cursor, limit]
    ).rows
    |> Enum.map(fn [id] -> Ecto.UUID.load!(id) end)
  end

  def scores do
    rows =
      Repo.query!("""
        WITH weighted AS (
          #{@weighted_votes}
        )
        SELECT photo_id, sum(weight)::float,
        CASE WHEN count(*) >= 3 THEN sum(weight * power(2.0, -extract(epoch FROM (now()-inserted_at))/259200.0))::float ELSE 0 END
        FROM weighted GROUP BY photo_id
      """).rows

    Map.new(rows, fn [id, score, trend] ->
      {Ecto.UUID.load!(id), %{score: score, trend: trend}}
    end)
  end

  def ranked(period \\ "all")

  # Newest first is a plain listing: it does not use votes.
  def ranked("new"), do: Photos.recent()

  def ranked(period) do
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

  def refresh(subject_id), do: refresh(subject_id, scores())

  def refresh(subject_id, scores) do
    candidates =
      Repo.all(
        from [p, _] in Photos.published(),
          where: p.subject_id == ^subject_id,
          order_by: [asc: p.published_at, asc: p.id],
          select: p
      )

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

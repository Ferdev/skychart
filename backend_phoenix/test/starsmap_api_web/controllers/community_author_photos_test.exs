defmodule StarsmapApiWeb.CommunityAuthorPhotosTest do
  @moduledoc "The photo lists of an author: the database limits the rows and the output is the same."
  use StarsmapApiWeb.ConnCase, async: false
  alias StarsmapApi.Community.{Photo, Photos, Subjects, User}
  alias StarsmapApi.CommunityRepo, as: Repo

  setup do
    StarsmapApiWeb.Plugs.RateLimit.reset()

    user =
      Repo.insert!(%User{email: "prolific@example.com", handle: "prolific", name: "Prolific"})

    {:ok, subject} = Subjects.ensure("moon")
    {:ok, user: user, subject: subject}
  end

  test "an author with a few photos has the same list, newest first", %{
    conn: conn,
    user: user,
    subject: subject
  } do
    photos = for i <- 1..3, do: photo(user, subject, i)

    assert %{"photos" => listed} =
             conn |> get("/api/community/photographers/prolific") |> json_response(200)

    assert Enum.map(listed, & &1["id"]) == photos |> Enum.reverse() |> Enum.map(& &1.id)

    # The same payload as one public/1 call for each photo.
    expected =
      photos
      |> Enum.reverse()
      |> Enum.map(&(&1.id |> Photos.get() |> Photos.public()))
      |> Jason.encode!()
      |> Jason.decode!()

    assert listed == expected

    html = conn |> get("/u/prolific") |> html_response(200)

    for photo <- photos do
      assert html =~
               ~s(<a href="/photos/#{photo.id}"><img loading="lazy" src="/api/community/media/#{photo.id}/320" alt="">#{photo.title}</a>)
    end
  end

  test "a prolific author gets 48 photos in the endpoint and 24 on the page", %{
    conn: conn,
    user: user,
    subject: subject
  } do
    photos = for i <- 1..60, do: photo(user, subject, i)
    newest = photos |> Enum.reverse() |> Enum.map(& &1.id)

    {response, queries} =
      queries(fn ->
        conn |> get("/api/community/photographers/prolific") |> json_response(200)
      end)

    assert Enum.map(response["photos"], & &1["id"]) == Enum.take(newest, 48)
    assert Enum.any?(queries, &(&1 =~ ~s("user_id" = $1) and &1 =~ "LIMIT"))

    html = conn |> get("/u/prolific") |> html_response(200)
    cards = Regex.scan(~r{<a href="/photos/([0-9a-f-]+)">}, html) |> Enum.map(&Enum.at(&1, 1))
    assert cards == Enum.take(newest, 24)
  end

  defp photo(user, subject, minutes) do
    Repo.insert!(%Photo{
      user_id: user.id,
      subject_id: subject.id,
      declared_key: "moon",
      title: "Photo #{minutes}",
      caption: "",
      licence: "CC BY 4.0",
      captured_at: ~U[2026-10-01 00:00:00.000000Z],
      status: "published",
      source_key: "uploads/#{Ecto.UUID.generate()}",
      size_bytes: 100,
      published_at: DateTime.add(~U[2026-10-01 00:00:00.000000Z], minutes * 60)
    })
  end

  defp queries(action) do
    handler = "community-author-queries-#{System.unique_integer([:positive])}"
    pid = self()

    :telemetry.attach(
      handler,
      [:starsmap_api, :community_repo, :query],
      fn _, _, metadata, _ -> send(pid, {:community_query, metadata.query}) end,
      nil
    )

    try do
      result = action.()
      {result, received([])}
    after
      :telemetry.detach(handler)
    end
  end

  defp received(queries) do
    receive do
      {:community_query, query} -> received([query | queries])
    after
      0 -> Enum.reverse(queries)
    end
  end
end

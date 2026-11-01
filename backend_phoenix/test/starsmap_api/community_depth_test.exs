defmodule StarsmapApi.CommunityDepthTest do
  use ExUnit.Case, async: false

  alias StarsmapApi.Community.{Depth, Photo, PhotoDepthLayer, Privacy, Subjects, User}
  alias StarsmapApi.CommunityRepo, as: Repo

  @solved %{
    "status" => "solved",
    "ra_deg" => 150.0,
    "dec_deg" => 2.0,
    "pixel_scale_arcsec" => 2.0,
    "rotation_deg" => 0.0,
    "width" => 800,
    "height" => 600
  }

  setup do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo)
    Ecto.Adapters.SQL.Sandbox.mode(Repo, {:shared, self()})
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(StarsmapApi.Repo)
    Ecto.Adapters.SQL.Sandbox.mode(StarsmapApi.Repo, {:shared, self()})
    author = Repo.insert!(%User{email: "a@example.com", handle: "author", name: "Author"})
    other = Repo.insert!(%User{email: "b@example.com", handle: "other", name: "Other"})
    {:ok, subject} = Subjects.ensure("moon")
    {:ok, author: author, other: other, subject: subject}
  end

  defp photo(author, subject, changes \\ []) do
    Repo.insert!(
      struct!(
        %Photo{
          user_id: author.id,
          subject_id: subject.id,
          declared_key: "moon",
          title: "Field",
          captured_at: StarsmapApi.Community.now(),
          licence: "CC BY 4.0",
          source_key: "uploads/x",
          size_bytes: 1,
          status: "published",
          depth_allowed: true,
          wcs: @solved,
          published_at: StarsmapApi.Community.now()
        },
        changes
      )
    )
  end

  defp result(count \\ 3),
    do: %{
      "width" => 800,
      "height" => 600,
      "cell" => 48,
      "detected" => 40,
      "sources" =>
        for i <- 1..count do
          %{
            "key" => "r#{i}",
            "name" => "R#{i}",
            "x" => 0.5,
            "y" => 0.5,
            "cell" => [i, 0],
            "distance_ly" => i * 100.0,
            "distance_method" => "parallax"
          }
        end
    }

  test "only an allowed, published, solved, narrow photo is eligible", %{author: a, subject: s} do
    assert Depth.eligible?(photo(a, s))
    refute Depth.eligible?(photo(a, s, depth_allowed: false))
    refute Depth.eligible?(photo(a, s, status: "review"))
    refute Depth.eligible?(photo(a, s, wcs: nil))
    refute Depth.eligible?(photo(a, s, wcs: %{@solved | "status" => "author_supplied"}))
    refute Depth.eligible?(photo(a, s, wcs: %{@solved | "pixel_scale_arcsec" => 40.0}))
  end

  test "the public payload has the credit and no layers without permission", %{
    author: a,
    subject: s
  } do
    p = photo(a, s)
    assert :ok = Depth.store(p, result())
    assert Depth.ready?(p)
    assert {:ok, payload} = Depth.public(p.id)
    assert payload.credit.name == "Author"
    assert payload.plane_distance_ly == 200.0
    assert length(payload.sources) == 3

    Repo.update!(Ecto.Changeset.change(p, depth_allowed: false))
    assert {:error, :not_found} = Depth.public(p.id)
  end

  test "a hidden photo has no public layers", %{author: a, subject: s} do
    p = photo(a, s)
    :ok = Depth.store(p, result())
    Repo.update!(Ecto.Changeset.change(p, status: "hidden"))
    assert {:error, :not_found} = Depth.public(p.id)
  end

  test "too few matches give no layers", %{author: a, subject: s} do
    p = photo(a, s)
    assert :not_enough = Depth.store(p, result(2))
    refute Depth.ready?(p)
  end

  test "only the owner changes the permission, and a withdrawal deletes the layers", %{
    author: a,
    other: other,
    subject: s
  } do
    p = photo(a, s)
    :ok = Depth.store(p, result())
    assert {:error, :not_found} = Depth.set_allowed(other, p.id, false)
    assert {:ok, %{depth_allowed: false}} = Depth.set_allowed(a, p.id, false)
    refute Repo.get(PhotoDepthLayer, p.id)
  end

  test "account removal deletes the layers", %{author: a, subject: s} do
    p = photo(a, s)
    :ok = Depth.store(p, result())
    assert {:ok, :ok} = Privacy.erase(a)
    refute Repo.get(PhotoDepthLayer, p.id)
    refute Repo.get!(Photo, p.id).depth_allowed
  end
end

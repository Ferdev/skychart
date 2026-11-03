defmodule StarsmapApi.CommunityDeepFieldsTest do
  use ExUnit.Case, async: false
  use Oban.Testing, repo: StarsmapApi.CommunityRepo

  import Ecto.Query

  alias StarsmapApi.Community.{
    DeepField,
    DeepFieldBuild,
    DeepFieldFrame,
    DeepFieldNightly,
    DeepFieldWorker,
    DeepFields,
    Moderation,
    Photo,
    Privacy,
    SkyOverlay,
    Storage,
    Subjects,
    User
  }

  alias StarsmapApi.CommunityRepo, as: Repo

  @solved %{
    "status" => "solved",
    "projection" => "TAN",
    "frame" => "ICRS",
    "epoch" => "J2000",
    "ra_deg" => 150.0,
    "dec_deg" => 2.0,
    "pixel_scale_arcsec" => 4.0,
    "rotation_deg" => 0.0,
    "width" => 900,
    "height" => 600,
    "cd" => [-0.0011, 0.0, 0.0, 0.0011],
    "crpix" => [450.5, 300.5]
  }

  setup do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo)
    Ecto.Adapters.SQL.Sandbox.mode(Repo, {:shared, self()})
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(StarsmapApi.Repo)
    Ecto.Adapters.SQL.Sandbox.mode(StarsmapApi.Repo, {:shared, self()})
    File.rm_rf!(Storage.root())
    File.mkdir_p!(Storage.root())

    moderator =
      Repo.insert!(%User{email: "m@example.com", handle: "mod", name: "Mod", role: "moderator"})

    ada = Repo.insert!(%User{email: "a@example.com", handle: "ada", name: "Ada"})
    bea = Repo.insert!(%User{email: "b@example.com", handle: "bea", name: "Bea"})
    subject = subject("ngc-224")
    {:ok, moderator: moderator, ada: ada, bea: bea, subject: subject}
  end

  defp subject(key) do
    case Subjects.find(key) do
      nil ->
        {:ok, subject} =
          StarsmapApi.Community.transaction(fn ->
            subject =
              Repo.insert!(%StarsmapApi.Community.Subject{
                name: "Andromeda",
                object_type: "galaxy"
              })

            Repo.insert_all("subject_keys", [
              %{key: key, subject_id: Ecto.UUID.dump!(subject.id)}
            ])

            subject
          end)

        subject

      subject ->
        subject
    end
  end

  defp photo(author, subject, changes \\ []) do
    Repo.insert!(
      struct!(
        %Photo{
          user_id: author.id,
          subject_id: subject.id,
          declared_key: "ngc-224",
          title: "Frame by #{author.name}",
          captured_at: StarsmapApi.Community.now(),
          licence: "CC BY 4.0",
          source_key: "uploads/#{System.unique_integer([:positive])}",
          size_bytes: 1,
          status: "published",
          wcs: @solved,
          published_at: StarsmapApi.Community.now()
        },
        changes
      )
    )
  end

  defp open_field(context) do
    photo(context.ada, context.subject)
    {:ok, field} = DeepFields.open(context.moderator, "ngc-224")
    field
  end

  defp result(photos, changes \\ %{}) do
    Map.merge(
      %{
        "frames" => Enum.map(photos, &%{"id" => &1.id, "weight" => 1 / length(photos)}),
        "rejected" => [],
        "best_id" => hd(photos).id,
        "max_coverage" => length(photos),
        "limiting_mag" => 18.0,
        "best_limiting_mag" => 17.0,
        "gain_mag" => 1.0
      },
      changes
    )
  end

  test "candidates hold fixed targets with solved photos, and a moving body stays out", context do
    {:ok, moon} = Subjects.ensure("moon")
    photo(context.ada, context.subject)
    photo(context.bea, context.subject)
    photo(context.ada, moon, declared_key: "moon")
    photo(context.ada, context.subject, wcs: Map.put(@solved, "status", "supplied"))

    assert [%{key: "ngc-224", solved_photos: 2, name: "Andromeda"}] = DeepFields.candidates()
    assert {:error, :moving_target} = DeepFields.open(context.moderator, "moon")
  end

  test "only one field is open, and the grid comes from the photos", context do
    field = open_field(context)
    assert field.slug == "andromeda"
    assert field.ra_deg == 150.0
    assert field.width == 1600
    assert_in_delta field.scale_arcsec * 1600 / 3600, 1.0, 1.0e-9

    assert {:error, :field_open} = DeepFields.open(context.moderator, "ngc-224")

    assert Repo.exists?(
             from a in StarsmapApi.Community.Action, where: a.action == "deep_field_open"
           )

    assert {:ok, _} = DeepFields.close(context.moderator, field.slug)
    assert {:ok, again} = DeepFields.open(context.moderator, "ngc-224")
    assert again.slug == "andromeda-2"
  end

  test "a field needs a solved photo of the subject", context do
    assert {:error, :no_solved_photos} = DeepFields.open(context.moderator, "ngc-224")
    assert {:error, :not_found} = DeepFields.open(context.moderator, "ngc-999999")
  end

  test "an owner adds only an approved solved photo of the target", context do
    field = open_field(context)
    good = photo(context.ada, context.subject)
    waiting = photo(context.ada, context.subject, status: "review")
    unsolved = photo(context.ada, context.subject, wcs: nil)
    other = photo(context.bea, context.subject)

    assert {:ok, %{slug: slug}} = DeepFields.add_frame(context.ada, good.id, false)
    assert slug == field.slug
    assert {:error, :not_eligible} = DeepFields.add_frame(context.ada, waiting.id, false)
    assert {:error, :not_eligible} = DeepFields.add_frame(context.ada, unsolved.id, false)
    assert {:error, :not_found} = DeepFields.add_frame(context.ada, other.id, false)
    assert {:error, :invalid_request} = DeepFields.add_frame(context.ada, good.id, "yes")
  end

  test "a withdrawn frame leaves the next build, and a new consent brings it back", context do
    field = open_field(context)
    frame_photo = photo(context.ada, context.subject)
    {:ok, _} = DeepFields.add_frame(context.ada, frame_photo.id, false)
    assert [{_, %Photo{}}] = DeepFields.frames_to_build(field)

    assert {:ok, %{withdrawn_at: %DateTime{}}} =
             DeepFields.withdraw(context.ada, frame_photo.id)

    assert DeepFields.frames_to_build(field) == []
    {:ok, _} = DeepFields.add_frame(context.ada, frame_photo.id, false)
    assert [_] = DeepFields.frames_to_build(field)
  end

  test "the standing consent adds a later photo at approval, and only then", context do
    field = open_field(context)
    consenting = Repo.get!(User, context.ada.id)
    {:ok, %{future: true}} = DeepFields.set_future(consenting, true)
    consenting = Repo.get!(User, context.ada.id)

    later = photo(consenting, context.subject, status: "review")
    {:ok, _} = Moderation.review(context.moderator, later.id, "approve", nil)

    assert %DeepFieldFrame{consent_at: at} =
             Repo.get_by(DeepFieldFrame, field_id: field.id, photo_id: later.id)

    assert at == consenting.deep_field_consent_at

    {:ok, %{future: false}} = DeepFields.set_future(consenting, false)
    other = photo(Repo.get!(User, context.ada.id), context.subject, status: "review")
    {:ok, _} = Moderation.review(context.moderator, other.id, "approve", nil)
    refute Repo.get_by(DeepFieldFrame, field_id: field.id, photo_id: other.id)
  end

  test "a withdrawn frame stays out when the photo is approved again", context do
    field = open_field(context)
    {:ok, _} = DeepFields.set_future(Repo.get!(User, context.ada.id), true)
    item = photo(Repo.get!(User, context.ada.id), context.subject)
    {:ok, _} = DeepFields.add_frame(context.ada, item.id, false)
    {:ok, _} = DeepFields.withdraw(context.ada, item.id)

    DeepFields.photo_ready(item)
    assert DeepFields.frames_to_build(field) == []
  end

  test "a build publishes an image with credits and scores for the owner", context do
    field = open_field(context)
    first = photo(context.ada, context.subject)
    second = photo(context.bea, context.subject)
    {:ok, _} = DeepFields.add_frame(context.ada, first.id, false)
    {:ok, _} = DeepFields.add_frame(context.bea, second.id, false)

    {:ok, build} = DeepFields.record(field, [first.id, second.id], result([first, second]))
    assert build.version == 1
    assert build.status == "published"

    {:ok, payload} = DeepFields.public(field.slug)
    assert payload.build.frames == 2
    assert payload.build.gain_mag == 1.0
    assert Enum.map(payload.contributors, & &1.handle) |> Enum.sort() == ["ada", "bea"]
    assert payload.build.stack_url == "/api/deep-fields/andromeda/media/1/stack"

    assert {:ok, %{frame: %{weight: 0.5}}} = DeepFields.frame_state(context.ada, first.id)
    assert %{frames: 2, contributors: 2} = DeepFields.for_key("ngc-224")
  end

  test "a hidden photo leaves the credits at once and starts a rebuild", context do
    field = open_field(context)
    first = photo(context.ada, context.subject)
    second = photo(context.bea, context.subject)
    {:ok, _} = DeepFields.add_frame(context.ada, first.id, false)
    {:ok, _} = DeepFields.add_frame(context.bea, second.id, false)
    {:ok, _} = DeepFields.record(field, [first.id, second.id], result([first, second]))

    {:ok, _} = Moderation.review(context.moderator, second.id, "hide", "Copyright claim")

    {:ok, payload} = DeepFields.public(field.slug)
    assert Enum.map(payload.contributors, & &1.handle) == ["ada"]
    assert_enqueued(worker: DeepFieldWorker, args: %{id: field.id})
  end

  test "a stopped build retires an image that holds a removed frame", context do
    field = open_field(context)
    first = photo(context.ada, context.subject)
    second = photo(context.bea, context.subject)
    {:ok, _} = DeepFields.add_frame(context.ada, first.id, false)
    {:ok, _} = DeepFields.add_frame(context.bea, second.id, false)
    {:ok, _} = DeepFields.record(field, [first.id, second.id], result([first, second]))

    field = Repo.get!(DeepField, field.id)

    {:ok, stopped} =
      DeepFields.record(field, [first.id], %{
        "frames" => [],
        "rejected" => [],
        "stop" => "too_few_frames"
      })

    assert stopped.status == "stopped"
    assert Repo.get!(DeepField, field.id).current_build_id == nil
  end

  test "a stopped build keeps the image when its frames are all still in", context do
    field = open_field(context)
    first = photo(context.ada, context.subject)
    second = photo(context.bea, context.subject)
    {:ok, _} = DeepFields.add_frame(context.ada, first.id, false)
    {:ok, _} = DeepFields.add_frame(context.bea, second.id, false)
    {:ok, build} = DeepFields.record(field, [first.id, second.id], result([first, second]))
    field = Repo.get!(DeepField, field.id)

    {:ok, _} =
      DeepFields.record(field, [first.id, second.id], %{
        "frames" => [],
        "rejected" => [%{"id" => first.id, "reason" => "too_few_stars"}],
        "stop" => "too_few_frames"
      })

    assert Repo.get!(DeepField, field.id).current_build_id == build.id

    assert {:ok, %{frame: %{rejection_reason: "too_few_stars"}}} =
             DeepFields.frame_state(context.ada, first.id)
  end

  test "account removal deletes the frames and starts a rebuild", context do
    field = open_field(context)
    first = photo(context.ada, context.subject)
    second = photo(context.bea, context.subject)
    {:ok, _} = DeepFields.add_frame(context.ada, first.id, false)
    {:ok, _} = DeepFields.add_frame(context.bea, second.id, false)
    {:ok, _} = DeepFields.record(field, [first.id, second.id], result([first, second]))

    assert [%{field: "andromeda"}] = Privacy.export(context.ada).deep_field_frames

    {:ok, :ok} = Privacy.erase(context.ada)

    refute Repo.get_by(DeepFieldFrame, photo_id: first.id)
    {:ok, payload} = DeepFields.public(field.slug)
    assert Enum.map(payload.contributors, & &1.handle) == ["bea"]
    assert_enqueued(worker: DeepFieldWorker, args: %{id: field.id})
  end

  test "the nightly job rebuilds only when the frames changed", context do
    field = open_field(context)
    first = photo(context.ada, context.subject)
    second = photo(context.bea, context.subject)
    {:ok, _} = DeepFields.add_frame(context.ada, first.id, false)

    assert :ok = perform_job(DeepFieldNightly, %{})
    refute_enqueued(worker: DeepFieldWorker)

    {:ok, _} = DeepFields.add_frame(context.bea, second.id, false)
    assert :ok = perform_job(DeepFieldNightly, %{})
    assert_enqueued(worker: DeepFieldWorker, args: %{id: field.id})

    Repo.delete_all(Oban.Job)
    {:ok, _} = DeepFields.record(field, [first.id, second.id], result([first, second]))
    assert :ok = perform_job(DeepFieldNightly, %{})
    refute_enqueued(worker: DeepFieldWorker)

    {:ok, _} = DeepFields.withdraw(context.bea, second.id)
    assert :ok = perform_job(DeepFieldNightly, %{})
    assert_enqueued(worker: DeepFieldWorker, args: %{id: field.id})
  end

  test "a frame that a build refused does not start a new build each night", context do
    field = open_field(context)
    first = photo(context.ada, context.subject)
    second = photo(context.bea, context.subject)
    third = photo(context.bea, context.subject)

    for {user, item} <- [{context.ada, first}, {context.bea, second}, {context.bea, third}] do
      {:ok, _} = DeepFields.add_frame(user, item.id, false)
    end

    refused = %{"id" => third.id, "reason" => "too_few_stars"}

    {:ok, _} =
      DeepFields.record(
        field,
        [first.id, second.id, third.id],
        result([first, second], %{"rejected" => [refused]})
      )

    assert :ok = perform_job(DeepFieldNightly, %{})
    refute_enqueued(worker: DeepFieldWorker)
  end

  test "a closed field also loses a removed photo", context do
    field = open_field(context)
    first = photo(context.ada, context.subject)
    second = photo(context.bea, context.subject)
    {:ok, _} = DeepFields.add_frame(context.ada, first.id, false)
    {:ok, _} = DeepFields.add_frame(context.bea, second.id, false)
    {:ok, _} = DeepFields.record(field, [first.id, second.id], result([first, second]))
    {:ok, closed} = DeepFields.close(context.moderator, field.slug)

    {:ok, _} = Moderation.review(context.moderator, second.id, "hide", "Copyright claim")

    assert_enqueued(worker: DeepFieldWorker, args: %{id: field.id})
    assert [{_, %Photo{id: id}}] = DeepFields.frames_to_build(closed)
    assert id == first.id
  end

  test "a closed field keeps its image and takes no new frame", context do
    field = open_field(context)
    {:ok, _} = DeepFields.close(context.moderator, field.slug)
    item = photo(context.ada, context.subject)
    assert {:error, :no_open_field} = DeepFields.add_frame(context.ada, item.id, false)
  end

  test "the sky overlay shows the stack as one photo", context do
    field = open_field(context)
    first = photo(context.ada, context.subject)
    second = photo(context.bea, context.subject)
    {:ok, _} = DeepFields.record(field, [first.id, second.id], result([first, second]))

    [stack | _] = SkyOverlay.list(150.0, 2.0, 10.0)
    assert stack.deep_field == field.slug
    assert stack.wcs.projection == "TAN"
    assert stack.image_url =~ "/media/1/stack"
    refute Enum.any?(SkyOverlay.list(300.0, -60.0, 10.0), &Map.has_key?(&1, :deep_field))
  end

  test "only the frames of published photos of active accounts reach a build", context do
    field = open_field(context)
    first = photo(context.ada, context.subject)
    {:ok, _} = DeepFields.add_frame(context.ada, first.id, false)
    assert [_] = DeepFields.frames_to_build(field)

    Repo.update!(Ecto.Changeset.change(context.ada, suspended: true))
    assert DeepFields.frames_to_build(field) == []
  end

  test "the worker runs the real stacker and stores a versioned image", context do
    field = open_field(context)
    stars = stars_on(field)

    photos =
      for {author, index} <- Enum.with_index(List.duplicate(context.ada, 3) ++ [context.bea]) do
        item = photo(author, context.subject, wcs: frame_solution(index))
        store_frame(item, stars, index)
        {:ok, _} = DeepFields.add_frame(author, item.id, false)
        item
      end

    write_stars(stars)
    assert :ok = perform_job(DeepFieldWorker, %{id: field.id})

    build = Repo.one!(from b in DeepFieldBuild, where: b.field_id == ^field.id)
    assert build.status == "published"
    assert build.frames_used == length(photos)
    assert build.gain_mag > 0

    for name <- DeepFields.files() do
      assert File.regular?(Storage.local_path(DeepFields.file_key(field, 1, name)))
    end
  end

  defp stars_on(field) do
    :rand.seed(:exsss, {1, 2, 3})

    for row <- 0..6, column <- 0..8 do
      x = 90 + column * 90 + :rand.uniform(9)
      y = 60 + row * 80 + :rand.uniform(9)
      scale = 4.0 / 3600

      %{
        x: x,
        y: y,
        ra: field.ra_deg - (x - 450) * scale / :math.cos(field.dec_deg * :math.pi() / 180),
        dec: field.dec_deg - (y - 300) * scale,
        magnitude: 4.5 + :rand.uniform() * 4,
        key: "star-#{row}-#{column}",
        name: "Star"
      }
    end
  end

  # The worker asks the catalog for stars. This test field has no catalog rows, so the
  # script sees the stars through a stub of the catalog read.
  defp write_stars(stars) do
    Application.put_env(:starsmap_api, :deep_field_stars, stars)
    on_exit(fn -> Application.delete_env(:starsmap_api, :deep_field_stars) end)
  end

  defp frame_solution(index) do
    scale = 4.0 / 3600

    @solved
    |> Map.merge(%{"ra_deg" => 150.0 + index * 0.002, "dec_deg" => 2.0 + index * 0.001})
    |> Map.merge(%{"cd" => [-scale, 0.0, 0.0, scale]})
  end

  defp store_frame(item, stars, index) do
    script = Path.join(System.tmp_dir!(), "deep-frame-#{index}.py")
    data = Path.join(System.tmp_dir!(), "deep-frame-#{index}.json")
    target = Storage.local_path("masters/#{item.id}/1600.webp")
    File.mkdir_p!(Path.dirname(target))
    File.write!(data, Jason.encode!(%{stars: stars, wcs: item.wcs, seed: index, path: target}))
    File.write!(script, frame_script())

    {_, 0} = System.cmd(StarsmapApi.Community.python(), [script, data])
  end

  defp frame_script do
    root = Path.dirname(StarsmapApi.Community.backend_script("x"))

    """
    import json, sys
    from pathlib import Path
    import numpy as np
    sys.path.insert(0, #{inspect(Path.dirname(root))})
    from backend.community_depth import sky_to_pixel, write_webp
    data = json.loads(Path(sys.argv[1]).read_text())
    rng = np.random.default_rng(data["seed"])
    linear = np.zeros((600, 900))
    ys, xs = np.mgrid[0:600, 0:900]
    for star in data["stars"]:
        x, y = sky_to_pixel(data["wcs"], star["ra"], star["dec"])
        linear += 10 ** (-0.4 * star["magnitude"]) * np.exp(-((xs + 0.5 - x) ** 2 + (ys + 0.5 - y) ** 2) / 4.5)
    linear += rng.normal(0, 0.00002, linear.shape)
    gray = np.clip(np.sign(linear) * np.abs(linear) ** 0.5 * 900 + 30, 0, 255)
    pixels = np.repeat(np.rint(gray)[:, :, None], 3, axis=2).astype(np.uint8)
    write_webp(pixels, Path(data["path"]), "[lossless]")
    """
  end
end

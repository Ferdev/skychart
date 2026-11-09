defmodule StarsmapApi.CommunityTransitsTest do
  use ExUnit.Case, async: false
  import Ecto.Query

  alias StarsmapApi.Community.{
    Action,
    Privacy,
    Moderation,
    TransitMeasurement,
    TransitObservation,
    Transits,
    User
  }

  alias StarsmapApi.CommunityRepo, as: Repo

  defmodule StubFit do
    @behaviour StarsmapApi.Community.TransitFit
    def fit(key, _points) do
      if pid = Application.get_env(:starsmap_api, :community_test_fit_pid),
        do: send(pid, {:transit_fit, key})

      accepted = key != "exoplanet-flat-b"

      {:ok,
       %{
         "accepted" => accepted,
         "reasons" => if(accepted, do: [], else: ["no_depth"]),
         "epoch" => 3000,
         "mid_time_bjd_tdb" => 2_460_881.0,
         "mid_time_utc" => "2026-12-05T08:00:00Z",
         "uncertainty_minutes" => 0.6,
         "o_minus_c_minutes" => 1.2,
         "predicted_uncertainty_minutes" => 2.0,
         "depth_ppt" => 15.1,
         "duration_minutes" => 180.0,
         "method_version" => "trapezoid-1",
         "reduced_chi_square" => 1.1,
         "red_noise_factor" => 1.2,
         "baseline_rms_ppt" => 2.1,
         "model" => %{"minutes" => [0], "flux" => [1]},
         "ephemeris" => %{
           "reference_time_bjd" => 2_457_607.5,
           "reference_time_err_days" => 3.2e-5,
           "period_days" => 1.09,
           "period_err_days" => 2.0e-8
         }
       }}
    end
  end

  setup do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo)
    Ecto.Adapters.SQL.Sandbox.mode(Repo, {:shared, self()})
    Application.put_env(:starsmap_api, :community_transit_fit, StubFit)
    Application.put_env(:starsmap_api, :community_test_fit_pid, self())

    on_exit(fn ->
      Application.delete_env(:starsmap_api, :community_transit_fit)
      Application.delete_env(:starsmap_api, :community_test_fit_pid)
    end)

    author = user("observer", "member")
    moderator = user("reviewer", "moderator")
    {:ok, author: author, moderator: moderator}
  end

  defp user(handle, role),
    do:
      Repo.insert!(%User{
        email: "#{handle}@example.com",
        handle: handle,
        name: handle,
        role: role
      })

  defp params(key \\ "exoplanet-wasp-12-b") do
    %{
      "key" => key,
      "host_key" => "exosys-wasp-12",
      "name" => "WASP-12 b",
      "status" => "confirmed",
      "night" => "2026-12-05",
      "instrument" => "Seestar S50",
      "frame_count" => 30,
      "frames_dropped" => 0,
      "pipeline_version" => "browser-1",
      "comparison" => %{"count" => 4, "check_rms_ppt" => 3.1},
      "points" => for(i <- 1..30, do: [2_461_014.8 + i / 1440, 1.0, 0.002])
    }
  end

  test "a submitted timing waits for a moderator and is not public", %{author: author} do
    assert {:ok, observation} = Transits.submit(author, params())
    assert observation.review_state == "review"
    assert Repo.get!(TransitMeasurement, observation.id).points["points"] |> length() == 30
    assert %{timings: [], planets: []} = Transits.public_list("exosys-wasp-12")
    assert Moderation.counts()["transits"] == 1
    assert Moderation.pending_count() == 1
  end

  test "a light curve that the fit does not accept is not stored", %{author: author} do
    assert {:error, :transit_rejected} = Transits.submit(author, params("exoplanet-flat-b"))
    assert Repo.aggregate(TransitObservation, :count) == 0
  end

  test "the same transit from the same observer is one record", %{author: author} do
    assert {:ok, _} = Transits.submit(author, params())
    assert {:error, :transit_duplicate} = Transits.submit(author, params())
  end

  test "an account can send ten timings a day", %{author: author} do
    for epoch <- 1..9 do
      Repo.insert!(%TransitObservation{
        user_id: author.id,
        object_key: "k",
        host_key: "h",
        object_name: "n",
        target_status: "confirmed",
        epoch: epoch,
        night: ~D[2026-12-05],
        mid_time_bjd: 1.0,
        mid_time_utc: StarsmapApi.Community.now(),
        uncertainty_minutes: 1.0,
        o_minus_c_minutes: 0.0,
        predicted_uncertainty_minutes: 1.0,
        depth_ppt: 10.0,
        duration_minutes: 100.0,
        frame_count: 30,
        instrument: "x",
        method_version: "m"
      })
    end

    # The tenth timing of the day runs the fit and is stored.
    assert {:ok, _} = Transits.submit(author, params())
    assert_received {:transit_fit, _}

    # The eleventh is refused before the fit service runs.
    assert {:error, :transit_quota} = Transits.submit(author, params())
    refute_received {:transit_fit, _}
  end

  test "invalid measurements are refused before the fit", %{author: author} do
    assert {:error, :invalid_transit} = Transits.submit(author, %{params() | "points" => []})

    assert {:error, :invalid_transit} =
             Transits.submit(author, %{params() | "points" => List.duplicate(["a", 1, 1], 30)})

    assert {:error, :invalid_transit} = Transits.submit(author, %{params() | "instrument" => ""})
    assert {:error, :invalid_transit} = Transits.submit(author, %{params() | "frame_count" => 3})
  end

  test "only a moderator approves, and each decision has an audit record", %{
    author: author,
    moderator: moderator
  } do
    {:ok, observation} = Transits.submit(author, params())
    assert {:error, :not_allowed} = Transits.review(author, observation.id, "approve", "")
    assert {:ok, approved} = Transits.review(moderator, observation.id, "approve", "")
    assert approved.review_state == "approved"

    assert Repo.one(from a in Action, where: a.transit_id == ^observation.id).action ==
             "transit_approve"

    assert %{timings: [timing], planets: [planet]} = Transits.public_list("exosys-wasp-12")
    assert timing.observer == %{handle: "observer", name: "observer"}
    assert timing.target_status == "confirmed"
    assert planet.count == 1
    assert planet.community_uncertainty_minutes < planet.archive_uncertainty_minutes
    assert [_] = Transits.public_list("exoplanet-wasp-12-b").timings

    assert {:error, :invalid_request} = Transits.review(moderator, observation.id, "reject", "x")

    assert {:ok, rejected} =
             Transits.review(moderator, observation.id, "reject", "Clouds at egress")

    assert rejected.moderation_reason == "Clouds at egress"
    assert %{timings: []} = Transits.public_list("exosys-wasp-12")
  end

  test "the summary adds timings to the archive prior" do
    base = %TransitObservation{
      user_id: Ecto.UUID.generate(),
      epoch: 3000,
      uncertainty_minutes: 0.5,
      o_minus_c_minutes: 1.0,
      predicted_uncertainty_minutes: 2.0,
      checks: %{
        "ephemeris" => %{"reference_time_err_days" => 1.0e-3, "period_err_days" => 4.0e-7}
      }
    }

    one = Transits.summary([base])
    two = Transits.summary([base, %{base | epoch: 3100, o_minus_c_minutes: 1.4}])
    assert one.mean_o_minus_c_minutes == 1.0
    assert one.community_uncertainty_minutes < 0.5 + 0.01
    assert two.community_uncertainty_minutes < one.community_uncertainty_minutes
    assert two.count == 2
    assert two.epoch == 3100
  end

  test "the fit of a planet uses each approved timing, and the list shows the newest", %{
    author: author
  } do
    now = StarsmapApi.Community.now()

    rows =
      for epoch <- 1..205 do
        %{
          id: Ecto.UUID.generate(),
          user_id: author.id,
          object_key: "exoplanet-wasp-12-b",
          host_key: "exosys-wasp-12",
          object_name: "WASP-12 b",
          target_status: "confirmed",
          epoch: epoch,
          night: ~D[2026-12-05],
          mid_time_bjd: 1.0 * epoch,
          mid_time_utc: DateTime.add(now, epoch * 60),
          uncertainty_minutes: 1.0,
          o_minus_c_minutes: if(epoch <= 5, do: 50.0, else: 0.0),
          predicted_uncertainty_minutes: 2.0,
          depth_ppt: 10.0,
          duration_minutes: 100.0,
          frame_count: 30,
          instrument: "x",
          method_version: "m",
          review_state: "approved",
          checks: %{
            "ephemeris" => %{"reference_time_err_days" => 1.0e-3, "period_err_days" => 4.0e-7}
          },
          inserted_at: now,
          updated_at: now
        }
      end

    Repo.insert_all(TransitObservation, rows)
    assert %{timings: timings, planets: [planet]} = Transits.public_list("exosys-wasp-12")
    assert length(timings) == 200
    assert planet.count == 205
    # The five oldest timings are only in the fit: they move its mean.
    assert planet.mean_o_minus_c_minutes > 0
  end

  test "a suspended observer leaves the public record", %{author: author, moderator: moderator} do
    {:ok, observation} = Transits.submit(author, params())
    {:ok, _} = Transits.review(moderator, observation.id, "approve", "")
    Repo.update!(Ecto.Changeset.change(author, suspended: true))
    assert %{timings: []} = Transits.public_list("exosys-wasp-12")
  end

  test "export holds the timings and erasure removes them with the measurements", %{
    author: author
  } do
    {:ok, observation} = Transits.submit(author, params())
    assert [%{id: id}] = Privacy.export(author).transit_timings
    assert id == observation.id
    assert {:ok, :ok} = Privacy.erase(author)
    assert Repo.aggregate(TransitObservation, :count) == 0
    assert Repo.aggregate(TransitMeasurement, :count) == 0
  end

  test "a frame for the solver needs the solver and a PNG", %{author: author} do
    assert {:error, reason} =
             Transits.queue_frame(author, %{"image_base64" => Base.encode64("not a png")})

    assert reason in [:solver_unavailable, :invalid_transit]
  end
end

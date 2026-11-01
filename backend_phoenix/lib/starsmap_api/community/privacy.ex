defmodule StarsmapApi.Community.Privacy do
  @moduledoc "Private account exports and immediate, audited account removal."
  import Ecto.Query

  alias StarsmapApi.Community.{
    DeepFields,
    Findings,
    Photo,
    Vote,
    Token,
    Action,
    Moderation,
    Ranking,
    Tours,
    Transits
  }

  alias StarsmapApi.CommunityRepo, as: Repo

  def export(user) do
    %{
      user: Map.take(user, [:name, :handle, :email, :inserted_at]),
      photos:
        Repo.all(from p in Photo, where: p.user_id == ^user.id)
        |> Enum.map(
          &Map.take(&1, [
            :id,
            :declared_key,
            :title,
            :caption,
            :licence,
            :captured_at,
            :equipment,
            :processing,
            :status,
            :depth_allowed,
            :site_lat,
            :site_lon
          ])
        ),
      votes: Repo.all(from v in Vote, where: v.user_id == ^user.id, select: v.photo_id),
      tours: Tours.export(user),
      transit_timings: Transits.export(user),
      findings: Findings.export(user),
      deep_field_frames: DeepFields.export(user)
    }
  end

  def erase(user) do
    StarsmapApi.Community.transaction(fn ->
      photos = Repo.all(from p in Photo, where: p.user_id == ^user.id)

      voted_authors =
        Repo.all(
          from v in Vote,
            join: p in Photo,
            on: p.id == v.photo_id,
            where: v.user_id == ^user.id,
            select: p.user_id
        )

      Repo.delete_all(from v in Vote, where: v.user_id == ^user.id)
      Repo.delete_all(from t in Token, where: t.user_id == ^user.id)
      Tours.delete_all(user)
      Transits.delete_all(user)
      Findings.delete_all(user)
      DeepFields.delete_all(user)

      Enum.each(photos, fn p ->
        Repo.update!(
          Ecto.Changeset.change(p,
            status: "hidden",
            depth_allowed: false,
            site_lat: nil,
            site_lon: nil
          )
        )

        Repo.delete_all(
          from l in StarsmapApi.Community.PhotoDepthLayer, where: l.photo_id == ^p.id
        )

        Repo.insert!(%Action{
          photo_id: p.id,
          user_id: user.id,
          action: "account_delete",
          reason: "Photographer removed their account"
        })

        {:ok, _} =
          Oban.insert(
            StarsmapApi.CommunityJobs,
            StarsmapApi.Community.PurgeWorker.new(%{id: p.id})
          )
      end)

      Moderation.forget_handle(user)

      Repo.update!(
        Ecto.Changeset.change(user,
          suspended: true,
          email: "deleted-#{user.id}@invalid.local",
          name: "Deleted photographer",
          handle: "deleted-#{user.id}"
        )
      )

      (Enum.map(photos, & &1.user_id) ++ voted_authors)
      |> Enum.uniq()
      |> Enum.each(&Ranking.refresh_author/1)

      :ok
    end)
  end

  def scrub(event) do
    request = Map.get(event, :request) || %{}
    url = Map.get(request, :url) || Map.get(request, "url") || ""

    if String.contains?(url, [
         "/community/",
         "/api/photos/",
         "/api/flights",
         "/api/observe",
         "/api/catalog/match"
       ]) do
      %{event | request: %{}, extra: %{}, user: %{}, breadcrumbs: []}
    else
      event
    end
  end
end

defmodule StarsmapApi.Community.Privacy do
  @moduledoc "Private account exports and immediate, audited account removal."
  import Ecto.Query
  alias StarsmapApi.Community.{Photo, Vote, Token, Action, Ranking}
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
            :status
          ])
        ),
      votes: Repo.all(from v in Vote, where: v.user_id == ^user.id, select: v.photo_id)
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

      Enum.each(photos, fn p ->
        Repo.update!(Ecto.Changeset.change(p, status: "hidden"))

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

    if String.contains?(url, ["/community/", "/api/photos/"]) do
      %{event | request: %{}, extra: %{}, user: %{}, breadcrumbs: []}
    else
      event
    end
  end
end

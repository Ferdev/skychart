defmodule StarsmapApi.CommunityRepo.Migrations.AllowAccountAudits do
  use Ecto.Migration

  def change do
    alter table(:moderation_actions) do
      modify :photo_id, :uuid, null: true, from: {:uuid, null: false}
    end
  end
end

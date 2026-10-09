defmodule StarsmapApi.CommunityRepo.Migrations.AddRankingSnapshots do
  use Ecto.Migration

  def change do
    alter table(:subjects) do
      add :first_photo_id, references(:photos, type: :uuid)
    end

    create table(:ranking_snapshots, primary_key: false) do
      add :period, :text, primary_key: true
      add :version, :integer, null: false, default: 1
      add :generated_at, :utc_datetime_usec, null: false
      add :payload, :map, null: false
    end
  end
end

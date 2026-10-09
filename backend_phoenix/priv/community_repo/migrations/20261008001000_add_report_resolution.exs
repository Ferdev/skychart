defmodule StarsmapApi.CommunityRepo.Migrations.AddReportResolution do
  use Ecto.Migration

  def change do
    alter table(:photo_reports) do
      add :resolved_at, :utc_datetime_usec
    end

    create index(:photo_reports, [:resolved_at, :inserted_at])
    create index(:photos, [:status, :published_at])
    create index(:subject_keys, [:subject_id])
    create index(:photos, [:sha256])
  end
end

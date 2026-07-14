defmodule StarsmapApi.Repo.Migrations.CreateSkyEvents do
  use Ecto.Migration

  def change do
    create table(:sky_events) do
      add :source, :string, null: false
      add :source_id, :string, null: false
      add :kind, :string, null: false
      add :title, :string, null: false
      add :summary, :string, null: false
      add :starts_at, :utc_datetime_usec, null: false
      add :ends_at, :utc_datetime_usec
      add :catalog_key, :string
      add :source_url, :string, null: false
      add :facts, :map, null: false, default: %{}
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:sky_events, [:source, :source_id])
    create index(:sky_events, [:starts_at])
  end
end

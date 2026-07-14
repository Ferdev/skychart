defmodule StarsmapApi.Repo.Migrations.CreateAnalyticsEvents do
  use Ecto.Migration

  def change do
    create table(:analytics_events) do
      add :event_name, :string, null: false
      add :path, :string, null: false
      add :anonymous_id, :string, null: false
      add :referrer_host, :string
      add :properties, :map, null: false, default: %{}
      timestamps(updated_at: false, type: :utc_datetime_usec)
    end

    create index(:analytics_events, [:inserted_at])
    create index(:analytics_events, [:event_name, :inserted_at])
  end
end

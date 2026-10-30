defmodule StarsmapApi.CommunityRepo.Migrations.CreateTours do
  use Ecto.Migration

  def change do
    create table(:tours, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :user_id, references(:users, type: :uuid, on_delete: :delete_all), null: false
      add :token, :text, null: false
      add :title, :text, null: false
      add :description, :text, default: "", null: false
      add :steps, {:array, :map}, default: [], null: false
      add :status, :text, default: "shared", null: false
      add :moderation_reason, :text
      add :reviewed_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:tours, [:token])
    create index(:tours, [:user_id, :updated_at])
    create constraint(:tours, :tour_status, check: "status IN ('shared','held','hidden')")

    create table(:tour_reports, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :tour_id, references(:tours, type: :uuid, on_delete: :delete_all), null: false
      add :reason, :text, null: false
      add :resolved_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create index(:tour_reports, [:tour_id])
    create index(:tour_reports, [:resolved_at, :inserted_at])

    # The audit record stays after a tour is deleted, so this column has no foreign key.
    alter table(:moderation_actions) do
      add :tour_id, :uuid
    end
  end
end

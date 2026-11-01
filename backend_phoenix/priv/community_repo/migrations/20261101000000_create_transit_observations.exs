defmodule StarsmapApi.CommunityRepo.Migrations.CreateTransitObservations do
  use Ecto.Migration

  def change do
    create table(:transit_observations, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :user_id, references(:users, type: :uuid, on_delete: :delete_all), null: false
      add :object_key, :text, null: false
      add :host_key, :text, null: false
      add :object_name, :text, null: false
      add :target_status, :text, null: false
      add :epoch, :bigint, null: false
      add :night, :date, null: false
      add :mid_time_bjd, :float, null: false
      add :mid_time_utc, :utc_datetime_usec, null: false
      add :uncertainty_minutes, :float, null: false
      add :o_minus_c_minutes, :float, null: false
      add :predicted_uncertainty_minutes, :float, null: false
      add :depth_ppt, :float, null: false
      add :duration_minutes, :float, null: false
      add :frame_count, :integer, null: false
      add :instrument, :text, null: false
      add :method_version, :text, null: false
      add :checks, :map, default: %{}, null: false
      add :review_state, :text, default: "review", null: false
      add :moderation_reason, :text
      add :reviewed_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:transit_observations, [:user_id, :object_key, :epoch])
    create index(:transit_observations, [:host_key, :review_state])
    create index(:transit_observations, [:object_key, :review_state])
    create index(:transit_observations, [:review_state, :inserted_at])

    create constraint(:transit_observations, :transit_review_state,
             check: "review_state IN ('review','approved','rejected','hidden')"
           )

    create table(:transit_measurements, primary_key: false) do
      add :observation_id,
          references(:transit_observations, type: :uuid, on_delete: :delete_all),
          primary_key: true

      add :points, :map, null: false
      timestamps(type: :utc_datetime_usec)
    end

    # One frame with no sky coordinates waits here for the plate solver. It is not a photo.
    create table(:transit_frame_solves, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :user_id, references(:users, type: :uuid, on_delete: :delete_all), null: false
      add :status, :text, default: "queued", null: false
      add :wcs, :map
      timestamps(type: :utc_datetime_usec)
    end

    create index(:transit_frame_solves, [:user_id, :inserted_at])

    alter table(:moderation_actions) do
      add :transit_id, :uuid
    end
  end
end

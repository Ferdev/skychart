defmodule StarsmapApi.CommunityRepo.Migrations.CreateDeepFields do
  use Ecto.Migration

  def change do
    # An owner can opt in for all future photos. The default is off, also for older accounts.
    alter table(:users) do
      add :deep_field_consent_at, :utc_datetime_usec
    end

    create table(:deep_fields, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :slug, :text, null: false
      add :title, :text, null: false
      add :subject_id, references(:subjects, type: :uuid, on_delete: :restrict), null: false
      add :declared_key, :text, null: false
      add :status, :text, null: false, default: "open"
      add :ra_deg, :float, null: false
      add :dec_deg, :float, null: false
      add :scale_arcsec, :float, null: false
      add :width, :integer, null: false
      add :height, :integer, null: false
      add :current_build_id, :uuid
      add :closed_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:deep_fields, [:slug])

    # The first version has one target at a time. The database keeps this rule.
    create unique_index(:deep_fields, [:status],
             where: "status = 'open'",
             name: :deep_fields_one_open
           )

    create table(:deep_field_builds, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :field_id, references(:deep_fields, type: :uuid, on_delete: :delete_all), null: false
      add :version, :integer, null: false
      add :status, :text, null: false
      add :stop, :text
      add :frame_ids, :map, null: false, default: %{}
      add :frames_used, :integer, null: false, default: 0
      add :frames_rejected, :integer, null: false, default: 0
      add :max_coverage, :integer, null: false, default: 0
      add :limiting_mag, :float
      add :best_limiting_mag, :float
      add :gain_mag, :float
      add :stars_recovered, :integer
      add :best_stars_recovered, :integer
      add :best_photo_id, :uuid
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:deep_field_builds, [:field_id, :version])

    create table(:deep_field_frames, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :field_id, references(:deep_fields, type: :uuid, on_delete: :delete_all), null: false
      add :photo_id, references(:photos, type: :uuid, on_delete: :delete_all), null: false
      add :user_id, references(:users, type: :uuid, on_delete: :delete_all), null: false
      add :consent_at, :utc_datetime_usec, null: false
      add :withdrawn_at, :utc_datetime_usec
      add :weight, :float
      add :noise, :float
      add :sharpness_pixels, :float
      add :rejection_reason, :text
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:deep_field_frames, [:field_id, :photo_id])
    create index(:deep_field_frames, [:photo_id])
    create index(:deep_field_frames, [:user_id])
  end
end

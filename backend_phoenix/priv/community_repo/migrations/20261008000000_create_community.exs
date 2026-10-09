defmodule StarsmapApi.CommunityRepo.Migrations.CreateCommunity do
  use Ecto.Migration

  def change do
    create table(:users, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :email, :text, null: false
      add :handle, :text, null: false
      add :name, :text, null: false
      add :role, :text, default: "member", null: false
      add :suspended, :boolean, default: false, null: false
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:users, [:email])
    create unique_index(:users, [:handle])

    create table(:user_tokens, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :user_id, references(:users, type: :uuid, on_delete: :delete_all), null: false
      add :token_hash, :binary, null: false
      add :context, :text, null: false
      add :attempts, :integer, default: 0, null: false
      add :expires_at, :utc_datetime_usec, null: false
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:user_tokens, [:token_hash, :context])
    create index(:user_tokens, [:user_id, :context])

    create table(:subjects, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :name, :text, null: false
      add :object_type, :text, null: false
      timestamps(type: :utc_datetime_usec)
    end

    create table(:subject_keys, primary_key: false) do
      add :key, :text, primary_key: true
      add :subject_id, references(:subjects, type: :uuid, on_delete: :delete_all), null: false
    end

    create table(:photos, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :user_id, references(:users, type: :uuid), null: false
      add :subject_id, references(:subjects, type: :uuid), null: false
      add :declared_key, :text, null: false
      add :title, :text, null: false
      add :caption, :text, default: "", null: false
      add :licence, :text, null: false
      add :captured_at, :utc_datetime_usec, null: false
      add :equipment, :text, default: "", null: false
      add :processing, :text, default: "", null: false
      add :composite, :boolean, default: false, null: false
      add :status, :text, default: "uploading", null: false
      add :source_key, :text, null: false
      add :size_bytes, :bigint, null: false
      add :sha256, :text
      add :assets, :map, default: %{}, null: false
      add :wcs, :map
      add :published_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create index(:photos, [:subject_id, :status])
    create index(:photos, [:user_id, :inserted_at])

    create constraint(:photos, :photo_status,
             check:
               "status IN ('uploading','processing','review','published','hidden','rejected','failed')"
           )

    create constraint(:photos, :photo_size, check: "size_bytes > 0 AND size_bytes <= 60000000")

    create table(:photo_votes, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :user_id, references(:users, type: :uuid, on_delete: :delete_all), null: false
      add :photo_id, references(:photos, type: :uuid, on_delete: :delete_all), null: false
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:photo_votes, [:user_id, :photo_id])

    create table(:photo_reports, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :photo_id, references(:photos, type: :uuid, on_delete: :delete_all), null: false
      add :reason, :text, null: false
      timestamps(type: :utc_datetime_usec)
    end

    create table(:moderation_actions, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :photo_id, references(:photos, type: :uuid), null: false
      add :user_id, references(:users, type: :uuid), null: false
      add :action, :text, null: false
      add :reason, :text, null: false
      timestamps(type: :utc_datetime_usec)
    end

    execute "CREATE SEQUENCE community_version", "DROP SEQUENCE community_version"

    create table(:subject_photo_stats, primary_key: false) do
      add :subject_id, references(:subjects, type: :uuid), primary_key: true
      add :version, :bigint, null: false
      add :payload, :map, null: false
    end

    create unique_index(:subject_photo_stats, [:version])
    Oban.Migration.up(version: 12)
  end
end

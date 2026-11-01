defmodule StarsmapApi.CommunityRepo.Migrations.CreatePhotoFindings do
  use Ecto.Migration

  def change do
    # An optional coarse site, rounded to one degree. It is not in a public payload.
    alter table(:photos) do
      add :site_lat, :float
      add :site_lon, :float
    end

    create table(:photo_findings, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :photo_id, references(:photos, type: :uuid, on_delete: :delete_all), null: false
      add :kind, :text, null: false
      add :designation, :text
      add :ra_deg, :float, null: false
      add :dec_deg, :float, null: false
      add :x, :float
      add :y, :float
      add :magnitude, :float
      add :recovered, :boolean, default: false, null: false
      add :near_key, :text
      add :near_name, :text
      add :state, :text, null: false
      add :second_photo_id, :uuid
      add :report, :text
      add :moderation_reason, :text
      timestamps(type: :utc_datetime_usec)
    end

    create index(:photo_findings, [:photo_id])
    create index(:photo_findings, [:kind, :state, :inserted_at])
    create index(:photo_findings, [:near_key, :state])
    create index(:photo_findings, [:ra_deg, :dec_deg])

    create constraint(:photo_findings, :finding_kind,
             check: "kind IN ('known_body','known_transient','candidate')"
           )

    create constraint(:photo_findings, :finding_state,
             check:
               "state IN ('proposed','approved','dismissed','waiting_second','review','reviewed','rejected')"
           )

    alter table(:moderation_actions) do
      add :finding_id, :uuid
    end
  end
end

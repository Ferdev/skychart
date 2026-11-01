defmodule StarsmapApi.CommunityRepo.Migrations.CreatePhotoDepthLayers do
  use Ecto.Migration

  def change do
    # A photographer must allow this use. An older photo stays out until its author allows it.
    alter table(:photos) do
      add :depth_allowed, :boolean, default: false, null: false
    end

    create table(:photo_depth_layers, primary_key: false) do
      add :photo_id, references(:photos, type: :uuid, on_delete: :delete_all), primary_key: true
      add :plane_distance_ly, :float, null: false
      add :width, :integer, null: false
      add :height, :integer, null: false
      add :cell, :integer, null: false
      add :detected, :integer, null: false
      add :sources, :map, null: false
      timestamps(type: :utc_datetime_usec)
    end
  end
end

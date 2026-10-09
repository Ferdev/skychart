defmodule StarsmapApi.CommunityRepo.Migrations.AddPhotoAnnotations do
  use Ecto.Migration

  def change do
    create table(:photo_subjects, primary_key: false) do
      add :photo_id, references(:photos, type: :uuid, on_delete: :delete_all), null: false
      add :key, :text, null: false
      add :name, :text, null: false
      add :x, :float, null: false
      add :y, :float, null: false
      add :role, :text, null: false, default: "in_frame"
    end

    create unique_index(:photo_subjects, [:photo_id, :key])
  end
end

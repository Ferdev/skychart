defmodule StarsmapApi.Repo.Migrations.CreateCatalogObjects do
  use Ecto.Migration

  def up do
    execute "CREATE EXTENSION IF NOT EXISTS pg_trgm"

    create table(:catalog_objects, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :key, :text, null: false
      add :name, :text, null: false
      add :object_type, :text, null: false
      add :catalog_group, :text, null: false
      add :source_type, :text, null: false
      add :position_model, :text, null: false
      add :parent_key, :text
      add :color, :text
      add :radius_km, :float
      add :ra_deg, :float
      add :dec_deg, :float
      add :distance_pc, :float
      add :distance_ly, :float
      add :x_au, :float
      add :y_au, :float
      add :z_au, :float
      add :x_km, :float
      add :y_km, :float
      add :z_km, :float
      add :apparent_magnitude, :float
      add :absolute_magnitude, :float
      add :search_text, :text, null: false, default: ""
      add :aliases, {:array, :text}, null: false, default: []
      add :external_ids, :map, null: false, default: %{}
      add :facts, :map, null: false, default: %{}
      add :source, :map, null: false, default: %{}

      timestamps(type: :utc_datetime)
    end

    create unique_index(:catalog_objects, [:key])
    create index(:catalog_objects, [:catalog_group])
    create index(:catalog_objects, [:object_type])
    create index(:catalog_objects, [:source_type])
    create index(:catalog_objects, [:parent_key])
    create index(:catalog_objects, [:apparent_magnitude])
    create index(:catalog_objects, [:x_au, :y_au])

    execute(
      "CREATE INDEX catalog_objects_search_text_trgm_idx ON catalog_objects USING gin (search_text gin_trgm_ops)",
      "DROP INDEX IF EXISTS catalog_objects_search_text_trgm_idx"
    )
  end

  def down do
    execute "DROP INDEX IF EXISTS catalog_objects_search_text_trgm_idx"
    drop table(:catalog_objects)
  end
end

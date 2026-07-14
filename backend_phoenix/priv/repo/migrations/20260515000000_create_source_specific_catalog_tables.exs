defmodule StarsmapApi.Repo.Migrations.CreateSourceSpecificCatalogTables do
  use Ecto.Migration

  @source_tables [
    :catalog_gaia_stars,
    :catalog_stellar_stars,
    :catalog_small_bodies,
    :catalog_deep_sky_objects,
    :catalog_exoplanet_objects,
    :catalog_simbad_objects
  ]

  def up do
    Enum.each(@source_tables, &create_source_table/1)
    create_source_union_view()
  end

  def down do
    execute "DROP VIEW IF EXISTS catalog_source_objects"

    Enum.each(Enum.reverse(@source_tables), fn name ->
      drop table(name)
    end)
  end

  defp create_source_table(name) do
    create table(name, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :key, :text, null: false
      add :name, :text, null: false
      add :position_model, :text, null: false
      add :parent_key, :text
      add :color, :text
      add :radius_km, :float
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
      add :source_type, :text, null: false
      add :catalog_group, :text, null: false
      add :object_type, :text, null: false
      add :catalog_object_key, :text, null: false
      add :source_identifier, :text
      add :source_epoch, :float
      add :position_epoch, :float
      add :ra_deg, :float
      add :dec_deg, :float
      add :pmra_mas_yr, :float
      add :pmdec_mas_yr, :float
      add :radial_velocity_km_s, :float
      add :source_payload, :map, null: false, default: %{}
      add :projected_payload, :map, null: false, default: %{}

      timestamps(type: :utc_datetime)
    end

    create unique_index(name, [:key])
    create index(name, [:catalog_object_key])
    create index(name, [:source_type])
    create index(name, [:catalog_group])
    create index(name, [:object_type])
    create index(name, [:parent_key])
    create index(name, [:apparent_magnitude])
    create index(name, [:x_au, :y_au])
    create index(name, [:source_identifier])
    create index(name, [:ra_deg, :dec_deg])

    execute(
      "CREATE INDEX #{name}_search_text_trgm_idx ON #{name} USING gin (search_text gin_trgm_ops)",
      "DROP INDEX IF EXISTS #{name}_search_text_trgm_idx"
    )
  end

  defp create_source_union_view do
    union_sql =
      @source_tables
      |> Enum.map(&source_table_select_sql/1)
      |> Enum.join("\nUNION ALL\n")

    execute "CREATE VIEW catalog_source_objects AS #{union_sql}"
  end

  defp source_table_select_sql(name) do
    """
    SELECT
      id,
      key,
      name,
      object_type,
      catalog_group,
      source_type,
      position_model,
      parent_key,
      color,
      radius_km,
      ra_deg,
      dec_deg,
      distance_pc,
      distance_ly,
      x_au,
      y_au,
      z_au,
      x_km,
      y_km,
      z_km,
      apparent_magnitude,
      absolute_magnitude,
      search_text,
      aliases,
      external_ids,
      facts,
      source,
      source_identifier,
      source_epoch,
      position_epoch,
      pmra_mas_yr,
      pmdec_mas_yr,
      radial_velocity_km_s,
      source_payload,
      projected_payload,
      inserted_at,
      updated_at
    FROM #{name}
    """
  end
end

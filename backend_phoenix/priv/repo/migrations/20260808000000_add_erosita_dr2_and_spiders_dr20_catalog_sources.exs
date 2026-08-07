defmodule StarsmapApi.Repo.Migrations.AddErositaDr2AndSpidersDr20CatalogSources do
  use Ecto.Migration

  @source_tables [
    :catalog_gaia_stars,
    :catalog_stellar_stars,
    :catalog_small_bodies,
    :catalog_deep_sky_objects,
    :catalog_exoplanet_objects,
    :catalog_simbad_objects,
    :catalog_bass_dr2_objects,
    :catalog_erosita_dr2_objects,
    :catalog_sdss_spiders_dr20_objects
  ]

  def up do
    execute "CREATE TABLE catalog_erosita_dr2_objects (LIKE catalog_simbad_objects INCLUDING ALL)"
    execute "CREATE TABLE catalog_sdss_spiders_dr20_objects (LIKE catalog_simbad_objects INCLUDING ALL)"
    replace_source_union_view(@source_tables)
  end

  def down do
    replace_source_union_view(
      Enum.reject(
        @source_tables,
        &(&1 in [:catalog_erosita_dr2_objects, :catalog_sdss_spiders_dr20_objects])
      )
    )

    execute "DROP TABLE catalog_erosita_dr2_objects"
    execute "DROP TABLE catalog_sdss_spiders_dr20_objects"
  end

  defp replace_source_union_view(tables) do
    union_sql =
      tables
      |> Enum.map(&source_table_select_sql/1)
      |> Enum.join("\nUNION ALL\n")

    execute "CREATE OR REPLACE VIEW catalog_source_objects AS #{union_sql}"
  end

  defp source_table_select_sql(name) do
    """
    SELECT
      id, key, name, object_type, catalog_group, source_type, position_model,
      parent_key, color, radius_km, ra_deg, dec_deg, distance_pc, distance_ly,
      x_au, y_au, z_au, x_km, y_km, z_km, apparent_magnitude,
      absolute_magnitude, search_text, aliases, external_ids, facts, source,
      source_identifier, source_epoch, position_epoch, pmra_mas_yr,
      pmdec_mas_yr, radial_velocity_km_s, source_payload, projected_payload,
      inserted_at, updated_at
    FROM #{name}
    """
  end
end

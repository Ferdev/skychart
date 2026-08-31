defmodule StarsmapApi.Repo.Migrations.AddRelatedObjectIndexes do
  use Ecto.Migration

  @disable_ddl_transaction true
  @disable_migration_lock true

  @source_tables ~w(
    catalog_gaia_stars
    catalog_stellar_stars
    catalog_small_bodies
    catalog_deep_sky_objects
    catalog_exoplanet_objects
    catalog_simbad_objects
    catalog_bass_dr2_objects
    catalog_erosita_dr2_objects
    catalog_sdss_spiders_dr20_objects
  )a

  def up do
    Enum.each(@source_tables, fn table ->
      execute """
      CREATE INDEX CONCURRENTLY IF NOT EXISTS #{index_name(table)}
      ON #{table} (
        catalog_group,
        apparent_magnitude ASC NULLS LAST,
        name ASC
      )
      INCLUDE (key, object_type)
      """
    end)
  end

  def down do
    Enum.each(@source_tables, fn table ->
      execute "DROP INDEX CONCURRENTLY IF EXISTS #{index_name(table)}"
    end)
  end

  defp index_name(table), do: "#{table}_related_objects_idx"
end

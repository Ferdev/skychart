defmodule StarsmapApi.Repo.Migrations.AddCatalogPointSampleCoverIndex do
  use Ecto.Migration

  @disable_ddl_transaction true
  @disable_migration_lock true

  def up do
    execute """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS catalog_objects_point_sample_cover_idx
    ON catalog_objects (
      catalog_group,
      (mod(hashtext(key)::bigint + 2147483648, 1024)),
      x_au,
      y_au
    )
    INCLUDE (key)
    WHERE catalog_group IN ('gaia_local_stars', 'gaia_500pc_stars', 'gaia_10kpc_bright_stars')
      AND x_au IS NOT NULL
      AND y_au IS NOT NULL
    """

    execute "DROP INDEX CONCURRENTLY IF EXISTS catalog_objects_point_sample_idx"
  end

  def down do
    execute """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS catalog_objects_point_sample_idx
    ON catalog_objects (
      catalog_group,
      (mod(hashtext(key)::bigint + 2147483648, 1024)),
      x_au,
      y_au
    )
    WHERE catalog_group IN ('gaia_local_stars', 'gaia_500pc_stars', 'gaia_10kpc_bright_stars')
      AND x_au IS NOT NULL
      AND y_au IS NOT NULL
    """

    execute "DROP INDEX CONCURRENTLY IF EXISTS catalog_objects_point_sample_cover_idx"
  end
end

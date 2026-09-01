defmodule StarsmapApi.Catalog.RelatedObjectsIndexTest do
  use StarsmapApi.DataCase, async: true

  alias StarsmapApi.Repo

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
  )

  test "every catalog branch has a covering related-object index with matching null order" do
    rows =
      Repo.query!("""
      SELECT
        table_name.relname,
        index_relation.relname,
        pg_get_indexdef(index_relation.oid),
        catalog_index.indnkeyatts,
        catalog_index.indnatts,
        catalog_index.indoption::text
      FROM pg_index AS catalog_index
      JOIN pg_class AS index_relation ON index_relation.oid = catalog_index.indexrelid
      JOIN pg_class AS table_name ON table_name.oid = catalog_index.indrelid
      WHERE index_relation.relname LIKE 'catalog_%_related_objects_idx'
      ORDER BY table_name.relname
      """).rows

    assert Enum.map(rows, &hd/1) |> Enum.sort() == Enum.sort(@source_tables)

    Enum.each(rows, fn [table, index, definition, key_columns, all_columns, options] ->
      assert index == "#{table}_related_objects_idx"
      assert definition =~ "(catalog_group, apparent_magnitude, name) INCLUDE (key, object_type)"
      assert key_columns == 3
      assert all_columns == 5

      # PostgreSQL's zero btree option bits mean ASC NULLS LAST, matching
      # Ecto's asc_nulls_last ordering for apparent_magnitude.
      assert options == "0 0 0"
    end)
  end
end

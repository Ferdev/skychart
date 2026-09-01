# Crawler-safety validation

Validated on 2026-08-31 against PostgreSQL 16 in the task environment. The application test
database contained the repository's 94,514-object catalog snapshot plus 200,000 representative
eROSITA rows (180,000 in `erosita_dr2_xray`) and 100,000 representative SDSS SPIDERS rows.
Generated survey rows included repeated magnitudes and `NULL` magnitudes so the plan and ordering
matched the production query's `ASC NULLS LAST` behavior.

## Related-object query

Before this change, `PublicObjects.load_public_object/1` loaded complete
`CatalogSourceObject` rows and reduced them to three response fields in Elixir. The resulting SQL
was equivalent to:

```sql
SELECT *
FROM catalog_source_objects
WHERE catalog_group = $1 AND key <> $2
ORDER BY apparent_magnitude ASC NULLS LAST, name ASC
LIMIT 6;
```

It now projects only `key`, `name`, and `object_type`. Every source table has a covering btree on
`(catalog_group, apparent_magnitude ASC NULLS LAST, name ASC) INCLUDE (key, object_type)`.

| Representative group | Rows in matching branch | Before | After |
| --- | ---: | ---: | ---: |
| `jpl_small_bodies` | 17,633 | 298.971 ms | 0.308 ms |
| `gaia_local_stars` | 33,170 | 83.781 ms | 0.389 ms |
| `erosita_dr2_xray` | 180,000 | 496.447 ms | 0.422 ms |
| `sdss_spiders_dr20` | 100,000 | 480.551 ms | 0.387 ms |

Times are local `EXPLAIN (ANALYZE, BUFFERS)` execution times and are not production benchmarks.
The important plan difference is stable across all four groups:

- Before: `Incremental Sort -> Merge Append -> Index Scan` on each branch's magnitude-only index.
  Unrelated branches were filtered after scanning; for example, the JPL plan removed all 33,170
  Gaia rows, 13,418 deep-sky rows, 10,939 exoplanet rows, and 9,838 SIMBAD rows.
- After: `Limit -> Merge Append -> Index Only Scan` on every
  `*_related_objects_idx`, with `catalog_group` as the `Index Cond`, no explicit sort, and zero heap
  fetches in the measured plans. Only six rows were read from the matching branch.

This directly addresses the production plan that traversed roughly 1.98 million eROSITA rows and
263,000 SDSS rows for unrelated groups before reaching the 15-second query timeout.

## Migration safety

Migration `20260831000000_add_related_object_indexes` follows the project's existing online-index
pattern: it disables the DDL transaction and migration lock, uses `CREATE INDEX CONCURRENTLY IF NOT
EXISTS`, and drops indexes concurrently on rollback. Applying all nine indexes to the populated
394,514-row local corpus completed in 2.8 seconds without a table-blocking index build.

No response cache was added because the selective covering plans complete far below the existing
timeout. Crawler user agents are not classified or blocked, and the public object and sitemap
routes are unchanged.

\set ON_ERROR_STOP on
-- Refuse a serving database even when an operator selects the wrong connection.
DO $$ BEGIN
  IF current_database() NOT LIKE 'skychart_storage_investigation_%' THEN
    RAISE EXCEPTION 'use an isolated skychart_storage_investigation_* scratch database';
  END IF;
END $$;
SET statement_timeout='120s';
SET lock_timeout='1s';
SET work_mem='8MB';
SET temp_file_limit='65536';
SET max_parallel_workers_per_gather=0;
CREATE TABLE prototype(record_key text PRIMARY KEY, provider text NOT NULL,catalog text NOT NULL,release text NOT NULL,source_id text NOT NULL,record jsonb NOT NULL);
CREATE UNIQUE INDEX prototype_namespace ON prototype(provider,catalog,release,source_id);
-- Run from the investigation directory containing prototype.tsv.
\copy prototype FROM 'prototype.tsv' WITH (FORMAT csv, DELIMITER E'\t');
ANALYZE prototype;
SELECT json_build_object('rows',(SELECT count(*) FROM prototype),'heap_bytes',pg_relation_size('prototype'),'heap_toast_fsm_vm_bytes',pg_table_size('prototype'),'indexes_bytes',pg_indexes_size('prototype'),'total_bytes',pg_total_relation_size('prototype'),'database_bytes',pg_database_size(current_database()));
SELECT json_build_object('avg_tuple_bytes',avg(pg_column_size(p)),'avg_jsonb_bytes',avg(pg_column_size(record)),'avg_record_key_bytes',avg(pg_column_size(record_key)),'avg_provider_bytes',avg(pg_column_size(provider)),'avg_catalog_bytes',avg(pg_column_size(catalog)),'avg_release_bytes',avg(pg_column_size(release)),'avg_source_id_bytes',avg(pg_column_size(source_id))) FROM prototype p;
SELECT json_build_object('index',indexrelid::regclass::text,'bytes',pg_relation_size(indexrelid),'definition',pg_get_indexdef(indexrelid)) FROM pg_index WHERE indrelid='prototype'::regclass;
CREATE TABLE legacy_probe (LIKE prototype INCLUDING ALL);
INSERT INTO legacy_probe SELECT record_key,provider,catalog,release,source_id,record->'measurements' FROM prototype;
SELECT json_build_object('scope','original snapshot JSON in provenance columns, analogous to earlier probe','rows',(SELECT count(*) FROM legacy_probe),'heap_bytes',pg_relation_size('legacy_probe'),'indexes_bytes',pg_indexes_size('legacy_probe'),'total_bytes',pg_total_relation_size('legacy_probe'));
CREATE TABLE lean_payload AS SELECT source_id,record->'measurements' AS record FROM prototype;
CREATE UNIQUE INDEX lean_payload_id ON lean_payload(source_id);
SELECT json_build_object('scope','same original measurements, namespace once per table, ID index only','rows',(SELECT count(*) FROM lean_payload),'heap_bytes',pg_relation_size('lean_payload'),'indexes_bytes',pg_indexes_size('lean_payload'),'total_bytes',pg_total_relation_size('lean_payload'));
SELECT json_build_object('isolated_database_bytes',pg_database_size(current_database()));

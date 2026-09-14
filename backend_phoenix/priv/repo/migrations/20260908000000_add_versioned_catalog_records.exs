defmodule StarsmapApi.Repo.Migrations.AddVersionedCatalogRecords do
  use Ecto.Migration

  def up do
    # An additive provenance store. Existing public keys and the source union
    # retain their meaning; this is not a replacement billion-row index.
    create table(:catalog_record_versions, primary_key: false) do
      add :record_key, :text, primary_key: true
      add :provider, :text, null: false
      add :catalog, :text, null: false
      add :release, :text, null: false
      add :source_id, :text, null: false
      add :record, :map, null: false
    end

    create unique_index(:catalog_record_versions, [:provider, :catalog, :release, :source_id],
             name: :catalog_record_namespace_index
           )

    create table(:catalog_identification_evidence, primary_key: false) do
      add :evidence_key, :text, primary_key: true

      add :record_key, references(:catalog_record_versions, column: :record_key, type: :text),
        null: false

      add :public_key, :text, null: false
      add :status, :text, null: false
      add :method, :text, null: false
      add :provenance, :map, null: false

      add :supersedes,
          references(:catalog_identification_evidence, column: :evidence_key, type: :text)
    end

    create index(:catalog_identification_evidence, [:public_key, :record_key])

    create unique_index(:catalog_identification_evidence, [:supersedes],
             where: "supersedes IS NOT NULL"
           )

    create constraint(:catalog_identification_evidence, :identification_status,
             check: "status IN ('candidate', 'confirmed', 'retracted')"
           )

    execute """
    CREATE FUNCTION reject_catalog_history_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'catalog history is immutable; append a new release or evidence event';
    END;
    $$ LANGUAGE plpgsql
    """

    for table <- [:catalog_record_versions, :catalog_identification_evidence] do
      execute """
      CREATE TRIGGER immutable_catalog_history BEFORE UPDATE OR DELETE ON #{table}
      FOR EACH ROW EXECUTE FUNCTION reject_catalog_history_mutation()
      """
    end
  end

  def down do
    drop table(:catalog_identification_evidence)
    drop table(:catalog_record_versions)
    execute "DROP FUNCTION reject_catalog_history_mutation()"
  end
end

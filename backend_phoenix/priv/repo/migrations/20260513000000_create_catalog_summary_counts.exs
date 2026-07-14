defmodule StarsmapApi.Repo.Migrations.CreateCatalogSummaryCounts do
  use Ecto.Migration

  def change do
    create table(:catalog_summary_counts, primary_key: false) do
      add :bucket, :text, null: false
      add :name, :text, null: false
      add :count, :bigint, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:catalog_summary_counts, [:bucket, :name])
  end
end

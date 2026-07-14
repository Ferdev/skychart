defmodule StarsmapApi.Repo.Migrations.AddCatalogDensityIndex do
  use Ecto.Migration

  def change do
    create index(:catalog_objects, [:catalog_group, :x_au, :y_au])
  end
end

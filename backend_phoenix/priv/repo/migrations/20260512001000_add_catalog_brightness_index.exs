defmodule StarsmapApi.Repo.Migrations.AddCatalogBrightnessIndex do
  use Ecto.Migration

  def change do
    create index(:catalog_objects, [:catalog_group, :apparent_magnitude],
             name: :catalog_objects_group_mag_idx
           )
  end
end

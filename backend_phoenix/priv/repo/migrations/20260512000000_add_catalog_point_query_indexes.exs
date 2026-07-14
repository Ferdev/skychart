defmodule StarsmapApi.Repo.Migrations.AddCatalogPointQueryIndexes do
  use Ecto.Migration

  def change do
    create index(:catalog_objects, [:catalog_group, :object_type, :x_au, :y_au],
             name: :catalog_objects_group_type_xy_idx
           )

    create index(:catalog_objects, [:catalog_group, :x_au, :y_au, :apparent_magnitude],
             name: :catalog_objects_group_xy_mag_idx
           )
  end
end

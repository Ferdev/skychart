defmodule StarsmapApi.Repo.Migrations.CreateGaiaObjectCache do
  use Ecto.Migration

  def change do
    create table(:gaia_object_cache, primary_key: false) do
      add :source_id, :bigint, primary_key: true
      add :payload, :map, null: false
      timestamps(type: :utc_datetime)
    end
  end
end

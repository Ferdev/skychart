defmodule StarsmapApi.Catalog.GaiaObjectCache do
  use Ecto.Schema

  @primary_key {:source_id, :integer, autogenerate: false}
  schema "gaia_object_cache" do
    field :payload, :map
    timestamps(type: :utc_datetime)
  end
end

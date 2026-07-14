defmodule StarsmapApi.Catalog.CatalogSourceObject do
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: false}
  @foreign_key_type :binary_id

  schema "catalog_source_objects" do
    field :key, :string
    field :name, :string
    field :object_type, :string
    field :catalog_group, :string
    field :source_type, :string
    field :position_model, :string
    field :parent_key, :string
    field :color, :string
    field :radius_km, :float
    field :ra_deg, :float
    field :dec_deg, :float
    field :distance_pc, :float
    field :distance_ly, :float
    field :x_au, :float
    field :y_au, :float
    field :z_au, :float
    field :x_km, :float
    field :y_km, :float
    field :z_km, :float
    field :apparent_magnitude, :float
    field :absolute_magnitude, :float
    field :search_text, :string, default: ""
    field :aliases, {:array, :string}, default: []
    field :external_ids, :map, default: %{}
    field :facts, :map, default: %{}
    field :source, :map, default: %{}
    field :source_identifier, :string
    field :source_epoch, :float
    field :position_epoch, :float
    field :pmra_mas_yr, :float
    field :pmdec_mas_yr, :float
    field :radial_velocity_km_s, :float
    field :source_payload, :map, default: %{}
    field :projected_payload, :map, default: %{}

    timestamps(type: :utc_datetime)
  end
end

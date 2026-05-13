defmodule StarsmapApi.Catalog.CatalogObject do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "catalog_objects" do
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

    timestamps(type: :utc_datetime)
  end

  @required_fields [
    :key,
    :name,
    :object_type,
    :catalog_group,
    :source_type,
    :position_model,
    :search_text
  ]

  @optional_fields [
    :parent_key,
    :color,
    :radius_km,
    :ra_deg,
    :dec_deg,
    :distance_pc,
    :distance_ly,
    :x_au,
    :y_au,
    :z_au,
    :x_km,
    :y_km,
    :z_km,
    :apparent_magnitude,
    :absolute_magnitude,
    :aliases,
    :external_ids,
    :facts,
    :source
  ]

  def changeset(catalog_object, attrs) do
    catalog_object
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_number(:radius_km, greater_than_or_equal_to: 0)
    |> unique_constraint(:key)
  end
end

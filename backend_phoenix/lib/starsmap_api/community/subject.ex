defmodule StarsmapApi.Community.Subject do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "subjects" do
    field :name, :string
    field :object_type, :string
    field :snapshot, :map, default: %{}
    field :first_photo_id, Ecto.UUID
    timestamps(type: :utc_datetime_usec)
  end
end

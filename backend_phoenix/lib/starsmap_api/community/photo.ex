defmodule StarsmapApi.Community.Photo do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "photos" do
    field :declared_key, :string
    field :title, :string
    field :caption, :string
    field :licence, :string
    field :equipment, :string
    field :processing, :string
    field :status, :string
    field :source_key, :string
    field :sha256, :string
    field :user_id, Ecto.UUID
    field :subject_id, Ecto.UUID
    field :size_bytes, :integer
    field :composite, :boolean, default: false
    field :assets, :map, default: %{}
    field :wcs, :map
    field :captured_at, :utc_datetime_usec
    field :published_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec)
  end
end

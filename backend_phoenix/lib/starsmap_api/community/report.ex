defmodule StarsmapApi.Community.Report do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "photo_reports" do
    field :photo_id, Ecto.UUID
    field :reason, :string
    field :resolved_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec)
  end
end

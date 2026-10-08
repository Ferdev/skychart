defmodule StarsmapApi.Community.Vote do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "photo_votes" do
    field :user_id, Ecto.UUID
    field :photo_id, Ecto.UUID
    timestamps(type: :utc_datetime_usec)
  end
end

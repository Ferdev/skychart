defmodule StarsmapApi.Community.Action do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "moderation_actions" do
    field :photo_id, Ecto.UUID
    field :user_id, Ecto.UUID
    field :action, :string
    field :reason, :string
    timestamps(type: :utc_datetime_usec)
  end
end

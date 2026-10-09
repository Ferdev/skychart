defmodule StarsmapApi.Community.Token do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "user_tokens" do
    field :user_id, Ecto.UUID
    field :token_hash, :binary
    field :context, :string
    field :attempts, :integer, default: 0
    field :expires_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec)
  end
end

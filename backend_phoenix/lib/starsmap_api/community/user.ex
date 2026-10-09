defmodule StarsmapApi.Community.User do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "users" do
    field :email, :string
    field :handle, :string
    field :name, :string
    field :role, :string, default: "member"
    field :suspended, :boolean, default: false
    timestamps(type: :utc_datetime_usec)
  end
end

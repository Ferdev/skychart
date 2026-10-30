defmodule StarsmapApi.Community.Tour do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "tours" do
    field :user_id, Ecto.UUID
    field :token, :string
    field :title, :string
    field :description, :string, default: ""
    field :steps, {:array, :map}, default: []
    field :status, :string, default: "shared"
    field :moderation_reason, :string
    field :reviewed_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec)
  end
end

defmodule StarsmapApi.Community.TourReport do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "tour_reports" do
    field :tour_id, Ecto.UUID
    field :reason, :string
    field :resolved_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec)
  end
end

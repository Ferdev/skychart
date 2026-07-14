defmodule StarsmapApi.Analytics.Event do
  use Ecto.Schema
  import Ecto.Changeset

  schema "analytics_events" do
    field :event_name, :string
    field :path, :string
    field :anonymous_id, :string
    field :referrer_host, :string
    field :properties, :map, default: %{}
    timestamps(updated_at: false, type: :utc_datetime_usec)
  end

  def changeset(event, attrs) do
    event
    |> cast(attrs, [:event_name, :path, :anonymous_id, :referrer_host, :properties])
    |> validate_required([:event_name, :path, :anonymous_id])
    |> validate_length(:event_name, max: 40)
    |> validate_length(:path, max: 160)
    |> validate_length(:anonymous_id, is: 64)
    |> validate_length(:referrer_host, max: 120)
  end
end

defmodule StarsmapApi.Community.TransitObservation do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "transit_observations" do
    field :user_id, Ecto.UUID
    field :object_key, :string
    field :host_key, :string
    field :object_name, :string
    field :target_status, :string
    field :epoch, :integer
    field :night, :date
    field :mid_time_bjd, :float
    field :mid_time_utc, :utc_datetime_usec
    field :uncertainty_minutes, :float
    field :o_minus_c_minutes, :float
    field :predicted_uncertainty_minutes, :float
    field :depth_ppt, :float
    field :duration_minutes, :float
    field :frame_count, :integer
    field :instrument, :string
    field :method_version, :string
    field :checks, :map, default: %{}
    field :review_state, :string, default: "review"
    field :moderation_reason, :string
    field :reviewed_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec)
  end
end

defmodule StarsmapApi.Community.TransitMeasurement do
  use Ecto.Schema
  @primary_key {:observation_id, Ecto.UUID, autogenerate: false}
  schema "transit_measurements" do
    field :points, :map
    timestamps(type: :utc_datetime_usec)
  end
end

defmodule StarsmapApi.Community.TransitFrameSolve do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "transit_frame_solves" do
    field :user_id, Ecto.UUID
    field :status, :string, default: "queued"
    field :wcs, :map
    timestamps(type: :utc_datetime_usec)
  end
end

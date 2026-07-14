defmodule StarsmapApi.SkyEvents.SkyEvent do
  use Ecto.Schema
  import Ecto.Changeset

  schema "sky_events" do
    field :source, :string
    field :source_id, :string
    field :kind, :string
    field :title, :string
    field :summary, :string
    field :starts_at, :utc_datetime_usec
    field :ends_at, :utc_datetime_usec
    field :catalog_key, :string
    field :source_url, :string
    field :facts, :map, default: %{}
    timestamps(type: :utc_datetime_usec)
  end

  def changeset(event, attrs),
    do:
      event
      |> cast(attrs, [
        :source,
        :source_id,
        :kind,
        :title,
        :summary,
        :starts_at,
        :ends_at,
        :catalog_key,
        :source_url,
        :facts
      ])
      |> validate_required([
        :source,
        :source_id,
        :kind,
        :title,
        :summary,
        :starts_at,
        :source_url
      ])
      |> validate_inclusion(:source, ["jpl_cneos", "nasa_exoplanet_archive"])
      |> validate_length(:source_id, max: 160)
      |> validate_length(:title, max: 180)
      |> validate_length(:summary, max: 500)
      |> validate_length(:source_url, max: 500)
      |> unique_constraint([:source, :source_id])
end

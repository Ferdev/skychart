defmodule StarsmapApi.Community.CoreObjects do
  @moduledoc "Public identity for dynamic bodies; coordinates are never fabricated."
  @data Path.expand("../../../priv/community/identity.json", __DIR__)
  @external_resource @data
  @objects Jason.decode!(File.read!(@data))["core"]
  def get(key) do
    case Enum.find(@objects, &(&1["key"] == key)) do
      nil ->
        {:error, :not_found}

      item ->
        {:ok,
         %{
           key: key,
           name: item["name"],
           object_type: item["object_type"],
           catalog_group: item["catalog_group"],
           source_type: "JPL ephemeris",
           source_url: "https://ssd.jpl.nasa.gov/horizons/",
           parent_key: item["parent_key"],
           radius_km: item["radius_km"],
           color: item["color"],
           related: [],
           identifiers: %{},
           aliases: [],
           updated_at: nil,
           position_model: "ephemeris",
           astrometry: %{ra_deg: nil, dec_deg: nil, distance_ly: nil, apparent_magnitude: nil},
           external_links: [
             %{provider: "JPL", label: "JPL Horizons", url: "https://ssd.jpl.nasa.gov/horizons/"}
           ],
           facts: %{},
           semantics: %{
             reference_frame:
               "Heliocentric ecliptic; positions are calculated at the selected epoch",
             distance_kind: :not_supplied,
             uncertainty: :not_supplied,
             catalog_epoch: :not_supplied,
             position_epoch: "Selected atlas epoch",
             selection_caveat: "Dynamic body: no static coordinates are supplied",
             cosmology: :not_supplied
           }
         }}
    end
  end
end

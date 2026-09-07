defmodule StarsmapApi.Spacecraft do
  @moduledoc "Reviewed mission identities; positions are resolved at the requested epoch."
  @external_resource Path.expand("../../priv/spacecraft.json", __DIR__)
  @manifest @external_resource |> File.read!() |> Jason.decode!()
  @objects Enum.map(@manifest["spacecraft"], fn mission ->
             %{
               key: mission["key"],
               name: mission["name"],
               object_type: "spacecraft",
               catalog_group: "spacecraft",
               source_type: "spacecraft",
               position_model: "jpl_spacecraft_vectors",
               parent_key: "sun",
               radius_km: nil,
               color: "#77d9d0",
               position: nil,
               astrometry: %{
                 ra_deg: nil,
                 dec_deg: nil,
                 distance_ly: nil,
                 distance_pc: nil,
                 apparent_magnitude: nil
               },
               aliases: mission["aliases"],
               facts: mission,
               external_ids: %{horizons_id: mission["horizons_id"]},
               external_links: [
                 %{
                   provider: "NASA/JPL",
                   label: "Trajectory and coverage",
                   url: mission["source_url"]
                 }
               ],
               source: %{label: "NASA/JPL Horizons", url: mission["source_url"]}
             }
           end)
  @by_key Map.new(@objects, &{&1.key, &1})

  def get(key) do
    case Map.get(@by_key, String.downcase(key)) do
      nil -> {:error, :not_found}
      object -> {:ok, object}
    end
  end

  def search(query, groups, types) do
    if (groups == [] or "spacecraft" in groups) and (types == [] or "spacecraft" in types) do
      tokens = query |> normalize() |> String.split()

      Enum.filter(@objects, fn object ->
        text = normalize(Enum.join([object.name, object.key, "spacecraft" | object.aliases], " "))
        Enum.all?(tokens, &String.contains?(text, &1))
      end)
    else
      []
    end
  end

  defp normalize(value),
    do: value |> String.downcase() |> String.replace(~r/[^\p{L}\p{N}]+/u, " ")
end

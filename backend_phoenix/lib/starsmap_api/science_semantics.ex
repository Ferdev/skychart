defmodule StarsmapApi.ScienceSemantics do
  @moduledoc "Canonical scientific position and distance semantics shared with the atlas frontend."
  @external_resource Path.expand("../../priv/science_semantics.json", __DIR__)
  @registry @external_resource |> File.read!() |> Jason.decode!()

  def registry, do: @registry

  def for_position_model(model) when is_binary(model),
    do: get_in(registry(), ["position_models", model])

  def for_position_model(_), do: nil

  def for_object(object) do
    model = for_position_model(object.position_model) || %{}
    facts = object.facts || %{}
    uncertainty = model["uncertainty_fields"] || []

    %{
      distance_kind: supplied(model["distance_kind"]),
      uncertainty:
        uncertainty |> Enum.map(&fact_value(facts, &1)) |> Enum.reject(&is_nil/1) |> supplied(),
      catalog_epoch: supplied(model["catalog_epoch"]),
      position_epoch: supplied(model["position_epoch"]),
      reference_frame: supplied(model["coordinate_frame"]),
      selection_caveat: supplied(model["selection_caveat"]),
      cosmology: supplied(model["cosmology"])
    }
  end

  defp fact_value(facts, "facts." <> key), do: Map.get(facts, key)
  defp fact_value(_facts, _), do: nil
  defp supplied(nil), do: :not_supplied
  defp supplied([]), do: :not_supplied
  defp supplied(value), do: value
end

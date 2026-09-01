defmodule StarsmapApiWeb.JsonLd do
  @moduledoc "Safe JSON serialization for values embedded in HTML script elements."

  def encode!(value) do
    value
    |> Jason.encode!()
    |> String.replace("<", "\\u003c")
    |> String.replace(">", "\\u003e")
    |> String.replace("&", "\\u0026")
    |> String.replace("\u2028", "\\u2028")
    |> String.replace("\u2029", "\\u2029")
  end
end

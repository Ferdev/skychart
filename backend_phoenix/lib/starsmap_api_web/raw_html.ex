defmodule StarsmapApiWeb.RawHTML do
  @moduledoc """
  Format encoder for `html` (see config/config.exs).

  `StarsmapApiWeb.ErrorHTML` returns a complete document whose text is already escaped by
  `StarsmapApiWeb.StaticPage`, so the document goes out with no change.
  """
  def encode_to_iodata!(document) when is_binary(document), do: document
end

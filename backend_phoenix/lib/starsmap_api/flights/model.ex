defmodule StarsmapApi.Flights.Model do
  @moduledoc "The model behind answer flights. The adapter is one HTTP call with no state."

  @callback messages(map()) :: {:ok, map()} | {:error, term()}

  def messages(request), do: adapter().messages(request)

  defp adapter,
    do: Application.get_env(:starsmap_api, :answer_flight_adapter, __MODULE__.Anthropic)

  @doc "US dollars for one response, from its token usage. A later response adds its own cost."
  def cost(model, usage) do
    {input, output, cache_read} = price(model)
    per_million = 1_000_000

    ((usage["input_tokens"] || 0) * input +
       (usage["cache_creation_input_tokens"] || 0) * input * 1.25 +
       (usage["cache_read_input_tokens"] || 0) * cache_read +
       (usage["output_tokens"] || 0) * output) / per_million
  end

  # An unknown model id gets the highest price that the cap can meet, so that the cap stays safe.
  defp price("claude-opus-5-5"), do: {4.0, 20.0, 0.20}
  defp price("claude-sonnet-5-5"), do: {2.0, 10.0, 0.20}
  defp price("claude-haiku-5-5"), do: {0.10, 0.50, 0.01}
  defp price(_), do: {10.0, 50.0, 1.0}

  defmodule Anthropic do
    @moduledoc "The Messages API over HTTP. There is no official Elixir SDK."
    @behaviour StarsmapApi.Flights.Model

    @url "https://api.anthropic.com/v1/messages"
    @version "2026-10-21"
    @fallback_beta "server-side-fallback-2026-07-01"
    @fallback_models ~w(claude-opus-5-5 claude-sonnet-5-5)
    @timeout 90_000

    @impl true
    def messages(request) do
      key = Application.get_env(:starsmap_api, :answer_flight_api_key)

      with true <- is_binary(key) and key != "",
           {:ok, status, _headers, body} <-
             http_client().request(
               :post,
               @url,
               headers(key, request.model),
               Jason.encode!(body(request)),
               [:with_body, {:connect_timeout, 5000}, {:recv_timeout, @timeout}]
             ) do
        decode(status, body)
      else
        false -> {:error, :no_key}
        {:error, reason} -> {:error, reason}
        other -> {:error, other}
      end
    end

    defp headers(key, model) do
      base = [
        {"x-api-key", key},
        {"anthropic-version", @version},
        {"content-type", "application/json"}
      ]

      if model in @fallback_models, do: [{"anthropic-beta", @fallback_beta} | base], else: base
    end

    defp body(request) do
      base =
        request
        |> Map.take([:model, :max_tokens, :system, :tools, :messages])
        |> Map.merge(%{
          output_config: %{effort: "medium"},
          cache_control: %{type: "ephemeral"}
        })

      if request.model in @fallback_models, do: Map.put(base, :fallbacks, "default"), else: base
    end

    defp decode(200, body) when is_binary(body), do: Jason.decode(body)
    defp decode(status, _) when status in [429, 500, 502, 503, 504, 529], do: {:error, :busy}
    defp decode(status, _), do: {:error, {:status, status}}

    defp http_client,
      do: Application.get_env(:starsmap_api, :answer_flight_http_client, :hackney)
  end
end

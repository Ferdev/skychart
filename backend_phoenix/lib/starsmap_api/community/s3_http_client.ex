defmodule StarsmapApi.Community.Storage.S3.HttpClient do
  @moduledoc """
  ExAws HTTP client for hackney 4.

  hackney 4 always returns the response body, ignores `:with_body`, and answers a HEAD
  request with `{:ok, status, headers}`. The adapter bundled with ExAws only matches the
  4-tuple, so every `head_object` call crashes with a `CaseClauseError`.
  Honours `config :ex_aws, :hackney_opts` like the bundled adapter.
  """
  @behaviour ExAws.Request.HttpClient

  @default_opts [recv_timeout: 30_000]

  @impl true
  def request(method, url, body \\ "", headers \\ [], http_opts \\ []) do
    opts = http_opts ++ Application.get_env(:ex_aws, :hackney_opts, @default_opts)

    case :hackney.request(method, url, headers, body, opts) do
      {:ok, status, headers, body} when is_binary(body) ->
        {:ok, %{status_code: status, headers: headers, body: body}}

      {:ok, status, headers} ->
        {:ok, %{status_code: status, headers: headers, body: ""}}

      {:error, reason} ->
        {:error, %{reason: reason}}
    end
  end
end

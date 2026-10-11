defmodule StarsmapApiWeb.Plugs.McpBody do
  @moduledoc """
  Reads the bounded raw body of an MCP message before the general parsers. The MCP
  controller can then answer malformed JSON and oversized bodies with a JSON-RPC error.
  """

  @behaviour Plug
  @max_bytes 65_536

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(%Plug.Conn{method: "POST", path_info: ["mcp"]} = conn, _opts) do
    case Plug.Conn.read_body(conn, length: @max_bytes, read_length: @max_bytes) do
      {:ok, body, conn} -> keep(conn, {:ok, body})
      {:more, _partial, conn} -> keep(conn, {:error, :too_large})
      {:error, _reason} -> keep(conn, {:error, :unreadable})
    end
  end

  def call(conn, _opts), do: conn

  # Fetched body parameters make `Plug.Parsers` leave the body alone.
  defp keep(conn, body),
    do: Plug.Conn.put_private(%{conn | body_params: %{}}, :mcp_body, body)
end

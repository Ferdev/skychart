defmodule StarsmapApiWeb.McpController do
  @moduledoc """
  Streamable HTTP transport of the public MCP server: one JSON-RPC message per POST
  and one JSON response. The server opens no event streams and keeps no sessions.
  """

  use StarsmapApiWeb, :controller

  alias StarsmapApi.Mcp

  plug :validate_origin

  def message(conn, _params) do
    with :ok <- json_content_type(conn),
         :ok <- accepts_json(conn),
         {:ok, message} <- decoded_body(conn) do
      {status, response} = Mcp.handle(message, mirrored_headers(conn))
      record_call(conn, message, status, response)
      respond(conn, status, response)
    else
      {status, response} -> respond(conn, status, response)
    end
  end

  defp record_call(conn, message, status, response) do
    if status == 200 and is_map(message) and is_map(response) and
         not Map.has_key?(response, :error) and not Map.has_key?(response, "error") and
         get_in(response, [:result, :isError]) != true and
         get_req_header(conn, "x-atlas-measurement") != ["owner-test"] do
      method = message["method"]
      tool = get_in(message, ["params", "name"])

      if method == "initialize" or
           (method == "tools/call" and tool in StarsmapApi.Mcp.Tools.names()) do
        StarsmapApi.Analytics.record(
          %{
            "name" => "mcp_request",
            "path" => "/mcp",
            "properties" => %{
              "method" => method,
              "tool" => tool || "initialize",
              "source" => "mcp"
            }
          },
          StarsmapApiWeb.ClientIp.resolve(conn)
        )
      end
    end
  rescue
    _ -> :ok
  end

  # A server without event streams and sessions answers GET and DELETE with 405.
  def method_not_allowed(conn, _params) do
    conn
    |> put_resp_header("allow", "POST")
    |> respond(405, Mcp.invalid_request("The MCP endpoint accepts only POST."))
  end

  # A browser sends `Origin`. The endpoint serves only its own origin to browsers,
  # which stops DNS rebinding and cross-site use; other MCP clients send no `Origin`.
  defp validate_origin(conn, _opts) do
    case get_req_header(conn, "origin") do
      [] ->
        conn

      [origin] ->
        if String.downcase(origin) == String.downcase(StarsmapApiWeb.Endpoint.url()),
          do: conn,
          else: forbidden(conn)

      _ ->
        forbidden(conn)
    end
  end

  defp forbidden(conn),
    do: conn |> respond(403, Mcp.invalid_request("Origin not allowed.")) |> halt()

  defp json_content_type(conn) do
    case get_req_header(conn, "content-type") do
      [value] ->
        case Plug.Conn.Utils.media_type(value) do
          {:ok, "application", "json", _params} -> :ok
          _ -> unsupported_media_type()
        end

      _ ->
        unsupported_media_type()
    end
  end

  defp unsupported_media_type,
    do: {415, Mcp.invalid_request("Content-Type must be application/json.")}

  defp accepts_json(conn) do
    accepted =
      conn
      |> get_req_header("accept")
      |> Enum.flat_map(&Plug.Conn.Utils.list/1)
      |> Enum.map(
        &(&1
          |> String.split(";", parts: 2)
          |> hd()
          |> String.trim()
          |> String.downcase())
      )

    if accepted == [] or
         Enum.any?(accepted, &(&1 in ["application/json", "application/*", "*/*"])),
       do: :ok,
       else: {406, Mcp.invalid_request("Accept must include application/json.")}
  end

  defp decoded_body(conn) do
    case conn.private[:mcp_body] do
      {:ok, body} ->
        case Jason.decode(body) do
          {:ok, message} -> {:ok, message}
          {:error, _reason} -> {400, Mcp.parse_error()}
        end

      {:error, :too_large} ->
        {413, Mcp.invalid_request("The request body is too large.")}

      _ ->
        {400, Mcp.invalid_request("The request body could not be read.")}
    end
  end

  defp mirrored_headers(conn) do
    %{
      protocol_version: first_header(conn, "mcp-protocol-version"),
      method: first_header(conn, "mcp-method"),
      name: first_header(conn, "mcp-name")
    }
  end

  defp first_header(conn, name) do
    case get_req_header(conn, name) do
      [value | _] -> String.trim(value)
      [] -> nil
    end
  end

  defp respond(conn, status, nil), do: send_resp(conn, status, "")

  defp respond(conn, status, response) do
    conn
    |> put_resp_header("cache-control", "no-store")
    |> put_status(status)
    |> json(response)
  end
end

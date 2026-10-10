defmodule StarsmapApi.Mcp do
  @moduledoc """
  Model Context Protocol message handling for the public read-only tools.

  The server keeps no state between requests. It serves the per-request-metadata
  protocol (revision 2026-07-28) and, for clients that open with `initialize`, the
  handshake-based revisions through 2025-11-25. `handle/2` takes one decoded
  JSON-RPC message with the mirrored HTTP headers, and returns the HTTP status with
  the JSON-RPC response, or `nil` when the response has no body.
  """

  require Logger

  alias StarsmapApi.Mcp.Tools

  @modern_versions ["2026-07-28"]
  @legacy_versions ["2025-11-25", "2025-06-18", "2025-03-26"]
  # A client older than the `MCP-Protocol-Version` header sends no header.
  @headerless_version "2025-03-26"

  @version_key "io.modelcontextprotocol/protocolVersion"
  @capabilities_key "io.modelcontextprotocol/clientCapabilities"
  @server_info_key "io.modelcontextprotocol/serverInfo"

  @parse_error -32_700
  @invalid_request -32_600
  @method_not_found -32_601
  @invalid_params -32_602
  @header_mismatch -32_020
  @unsupported_protocol_version -32_022

  @list_ttl_ms 3_600_000

  @instructions "Cosmic Atlas (SkyChart) is a public celestial atlas that puts Solar System bodies, spacecraft, stars, exoplanet systems, and galaxies in one heliocentric ecliptic coordinate space. Start with search_sky_objects and pass a returned key, exactly as given, to the other tools. Give users the returned object and view links verbatim; do not build SkyChart addresses by hand. The tools are read-only and bounded. They serve atlas orientation, source discovery, and shareable visualization. For measurements, uncertainty, bulk data, and observing plans, cite the upstream source that each record links to."

  def supported_versions, do: @modern_versions ++ @legacy_versions
  def parse_error, do: error(nil, @parse_error, "Parse error: the body is not valid JSON.")
  def invalid_request(message), do: error(nil, @invalid_request, message)

  def handle(messages, _headers) when is_list(messages),
    do:
      {400,
       invalid_request("Batch requests are not supported; send one JSON-RPC message per POST.")}

  def handle(%{"jsonrpc" => "2.0", "method" => method} = message, headers)
      when is_binary(method) do
    case {Map.fetch(message, "id"), Map.get(message, "params", %{})} do
      # A notification gets no JSON-RPC response.
      {:error, _params} ->
        {202, nil}

      {{:ok, id}, params} when (is_binary(id) or is_integer(id)) and is_map(params) ->
        request(id, method, params, headers)

      {{:ok, id}, _params} when is_binary(id) or is_integer(id) ->
        {400, error(id, @invalid_params, "params must be an object.")}

      {{:ok, _id}, _params} ->
        {400, invalid_request("The request id must be a string or an integer.")}
    end
  end

  # A response from a legacy client to a server request. The server sends no requests.
  def handle(%{"jsonrpc" => "2.0", "id" => _} = message, _headers)
      when is_map_key(message, "result") or is_map_key(message, "error"),
      do: {202, nil}

  def handle(_message, _headers),
    do: {400, invalid_request("The body must be one JSON-RPC 2.0 request or notification.")}

  defp request(id, method, params, headers) do
    meta = meta(params)

    cond do
      method == "initialize" and not is_map_key(meta, @version_key) ->
        {200, result(id, initialize(params))}

      is_map_key(meta, @version_key) or headers.protocol_version in @modern_versions ->
        modern(id, method, params, meta, headers)

      is_nil(headers.protocol_version) ->
        legacy(id, method, params, @headerless_version)

      headers.protocol_version in @legacy_versions ->
        legacy(id, method, params, headers.protocol_version)

      true ->
        {400, unsupported_version(id, headers.protocol_version)}
    end
  end

  # Revision 2026-07-28: each request carries its version and capabilities, and the
  # mirrored headers must agree with the body.
  defp modern(id, method, params, meta, headers) do
    version = meta[@version_key]

    with :ok <- required_header(id, headers.protocol_version, "MCP-Protocol-Version"),
         :ok <- request_version(id, version),
         :ok <- matching_header(id, headers.protocol_version, version, "MCP-Protocol-Version"),
         :ok <- supported_version(id, version),
         :ok <- client_capabilities(id, meta),
         :ok <- required_header(id, headers.method, "Mcp-Method"),
         :ok <- matching_header(id, headers.method, method, "Mcp-Method"),
         :ok <- name_header(id, method, params, headers.name) do
      case method do
        "server/discover" ->
          {200, modern_result(id, cacheable(discover()))}

        "tools/list" ->
          with_first_page(id, params, fn ->
            {200, modern_result(id, cacheable(%{tools: Tools.list()}))}
          end)

        "tools/call" ->
          with_tool_result(id, params, version, &{200, modern_result(id, &1)})

        _ ->
          {404, method_not_found(id, method)}
      end
    end
  end

  # Revisions through 2025-11-25. The handshake negotiates only the version, so a
  # request without the handshake state has the same answer.
  defp legacy(id, method, params, version) do
    case method do
      "ping" ->
        {200, result(id, %{})}

      "tools/list" ->
        with_first_page(id, params, fn -> {200, result(id, %{tools: Tools.list()})} end)

      "tools/call" ->
        with_tool_result(id, params, version, &{200, result(id, &1)})

      _ ->
        {200, method_not_found(id, method)}
    end
  end

  defp initialize(params) do
    requested = params["protocolVersion"]

    %{
      protocolVersion:
        if(requested in @legacy_versions, do: requested, else: hd(@legacy_versions)),
      capabilities: capabilities(),
      serverInfo: server_info(),
      instructions: @instructions
    }
  end

  defp discover do
    %{
      supportedVersions: supported_versions(),
      capabilities: capabilities(),
      instructions: @instructions
    }
  end

  defp capabilities, do: %{tools: %{}}

  defp server_info do
    %{
      name: "skychart",
      title: "Cosmic Atlas / SkyChart",
      version: to_string(Application.spec(:starsmap_api, :vsn)),
      websiteUrl: StarsmapApiWeb.Endpoint.url() <> "/agents"
    }
  end

  # The tool list has one page, so each cursor is unknown.
  defp with_first_page(id, params, respond) do
    if is_nil(params["cursor"]),
      do: respond.(),
      else: {200, error(id, @invalid_params, "Invalid cursor.")}
  end

  defp with_tool_result(id, params, version, respond) do
    name = params["name"]
    arguments = Map.get(params, "arguments") || %{}

    cond do
      not is_binary(name) ->
        {200, error(id, @invalid_params, "tools/call requires the tool name.")}

      not is_map(arguments) ->
        {200, error(id, @invalid_params, "Tool arguments must be an object.")}

      true ->
        case call_tool(name, arguments) do
          :unknown_tool ->
            {200, error(id, @invalid_params, "Unknown tool: #{String.slice(name, 0, 80)}")}

          {:ok, payload} ->
            respond.(tool_result(payload, Jason.encode!(payload), false, version))

          {:error, %{code: code, message: message} = tool_error} ->
            respond.(tool_result(%{error: tool_error}, "#{code}: #{message}", true, version))
        end
    end
  end

  defp call_tool(name, arguments) do
    Tools.call(name, arguments)
  rescue
    exception ->
      Logger.error(
        "MCP tool #{String.slice(name, 0, 80)} failed: " <>
          Exception.format(:error, exception, __STACKTRACE__)
      )

      {:error,
       %{
         code: "temporarily_unavailable",
         message: "The tool could not complete this request; retry later.",
         parameter: nil
       }}
  end

  # Revision 2025-03-26 has no structured tool content.
  defp tool_result(_payload, text, error?, "2025-03-26"),
    do: %{content: [%{type: "text", text: text}], isError: error?}

  defp tool_result(payload, text, error?, _version),
    do: %{content: [%{type: "text", text: text}], structuredContent: payload, isError: error?}

  defp cacheable(result), do: Map.merge(result, %{ttlMs: @list_ttl_ms, cacheScope: "public"})

  defp modern_result(id, result) do
    result(
      id,
      Map.merge(result, %{resultType: "complete", _meta: %{@server_info_key => server_info()}})
    )
  end

  defp meta(%{"_meta" => meta}) when is_map(meta), do: meta
  defp meta(_params), do: %{}

  defp required_header(_id, value, _name) when is_binary(value), do: :ok

  defp required_header(id, _value, name),
    do: {400, error(id, @header_mismatch, "Header mismatch: the #{name} header is required.")}

  defp request_version(_id, version) when is_binary(version), do: :ok

  defp request_version(id, _version),
    do: {400, error(id, @invalid_params, "params._meta must include #{@version_key} as text.")}

  defp matching_header(_id, value, value, _name), do: :ok

  defp matching_header(id, _header, _body, name),
    do:
      {400,
       error(
         id,
         @header_mismatch,
         "Header mismatch: the #{name} header does not match the request body."
       )}

  defp supported_version(_id, version) when version in @modern_versions, do: :ok
  defp supported_version(id, version), do: {400, unsupported_version(id, version)}

  defp client_capabilities(id, meta) do
    if is_map(meta[@capabilities_key]),
      do: :ok,
      else:
        {400,
         error(
           id,
           @invalid_params,
           "params._meta must include #{@capabilities_key} as an object."
         )}
  end

  defp name_header(id, "tools/call", params, header) do
    with :ok <- required_header(id, header, "Mcp-Name") do
      case decode_header(header) do
        {:ok, name} ->
          matching_header(id, name, params["name"], "Mcp-Name")

        :error ->
          {400, error(id, @header_mismatch, "Header mismatch: the Mcp-Name header is malformed.")}
      end
    end
  end

  defp name_header(_id, _method, _params, _header), do: :ok

  # A value that is not plain ASCII arrives as `=?base64?<value>?=`.
  defp decode_header("=?base64?" <> rest) do
    if String.ends_with?(rest, "?="),
      do: rest |> String.slice(0..-3//1) |> Base.decode64(),
      else: {:ok, "=?base64?" <> rest}
  end

  defp decode_header(value), do: {:ok, value}

  defp method_not_found(id, method),
    do: error(id, @method_not_found, "Method not found: #{String.slice(method, 0, 80)}")

  defp unsupported_version(id, requested) do
    error(id, @unsupported_protocol_version, "Unsupported protocol version", %{
      supported: supported_versions(),
      requested: requested
    })
  end

  defp result(id, result), do: %{jsonrpc: "2.0", id: id, result: result}

  defp error(id, code, message, data \\ nil) do
    error = %{code: code, message: message}
    error = if is_nil(data), do: error, else: Map.put(error, :data, data)
    response = %{jsonrpc: "2.0", error: error}
    if is_nil(id), do: response, else: Map.put(response, :id, id)
  end
end

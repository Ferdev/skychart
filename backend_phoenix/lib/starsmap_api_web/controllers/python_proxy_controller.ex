defmodule StarsmapApiWeb.PythonProxyController do
  use StarsmapApiWeb, :controller
  require Logger

  @default_python_backend_url "http://127.0.0.1:8765"
  @default_request_timeout 90_000
  @minimum_request_timeout 5_000
  @maximum_request_timeout 180_000

  def ephemeris(conn, _params), do: proxy(conn, "/api/ephemeris")
  def orbits(conn, _params), do: proxy(conn, "/api/orbits")
  def trails(conn, _params), do: proxy(conn, "/api/trails")
  def observe(conn, _params), do: proxy(conn, "/api/observe")

  defp proxy(conn, path) do
    url = target_url(conn, path)
    request_id = request_id(conn)

    with {:ok, status, headers, body} <- request(url, request_id) do
      content_type = response_content_type(headers)

      if status >= 500 do
        Logger.warning(
          "Python backend returned server error path=#{path} status=#{status} request_id=#{request_id}"
        )

        conn
        |> put_status(status)
        |> json(%{error: "python_backend_error", request_id: request_id})
      else
        conn
        |> put_resp_content_type(content_type)
        |> send_resp(status, body)
      end
    else
      {:error, reason} ->
        Logger.warning(
          "Python backend request failed path=#{path} reason=#{inspect(reason)} request_id=#{request_id}"
        )

        conn
        |> put_status(:bad_gateway)
        |> json(%{error: "python_backend_unavailable", request_id: request_id})
    end
  end

  defp request(url, request_id) do
    uri = URI.parse(url)

    with :ok <- validate_uri(uri),
         {:ok, socket} <-
           :gen_tcp.connect(
             String.to_charlist(uri.host),
             uri.port || 80,
             [:binary, active: false, packet: :raw],
             request_timeout()
           ) do
      try do
        with :ok <- :gen_tcp.send(socket, request_bytes(uri, request_id)),
             {:ok, response} <- recv_all(socket, <<>>) do
          parse_response(response)
        end
      after
        :gen_tcp.close(socket)
      end
    end
  end

  defp validate_uri(%URI{scheme: "http", host: host}) when is_binary(host), do: :ok
  defp validate_uri(uri), do: {:error, {:unsupported_proxy_target, URI.to_string(uri)}}

  defp request_bytes(uri, request_id) do
    path =
      case uri.path do
        nil -> "/"
        "" -> "/"
        value -> value
      end

    target =
      case uri.query do
        nil -> path
        "" -> path
        query -> path <> "?" <> query
      end

    host =
      case uri.port do
        nil -> uri.host
        80 -> uri.host
        port -> "#{uri.host}:#{port}"
      end

    [
      "GET ",
      target,
      " HTTP/1.1\r\n",
      "Host: ",
      host,
      "\r\n",
      "Accept: application/json\r\n",
      "X-Request-ID: ",
      request_id,
      "\r\n",
      "Connection: close\r\n\r\n"
    ]
  end

  defp recv_all(socket, acc) do
    case :gen_tcp.recv(socket, 0, request_timeout()) do
      {:ok, chunk} -> recv_all(socket, acc <> chunk)
      {:error, :closed} -> {:ok, acc}
      {:error, reason} -> {:error, reason}
    end
  end

  defp parse_response(response) do
    case :binary.split(response, "\r\n\r\n") do
      [head, body] -> parse_head(head, body)
      _parts -> {:error, :invalid_http_response}
    end
  end

  defp parse_head(head, body) do
    [status_line | header_lines] = String.split(head, "\r\n")

    with [_, status_text | _] <- String.split(status_line, " ", parts: 3),
         {status, ""} <- Integer.parse(status_text) do
      {:ok, status, parse_headers(header_lines), body}
    else
      _error -> {:error, {:invalid_http_status, status_line}}
    end
  end

  defp parse_headers(header_lines) do
    Enum.flat_map(header_lines, fn line ->
      case String.split(line, ":", parts: 2) do
        [key, value] -> [{String.trim(key), String.trim(value)}]
        _parts -> []
      end
    end)
  end

  defp target_url(conn, path) do
    base_url =
      (System.get_env("PYTHON_BACKEND_URL") ||
         Application.get_env(:starsmap_api, :python_backend_url, @default_python_backend_url))
      |> String.trim_trailing("/")

    query =
      case conn.query_string do
        "" -> ""
        query_string -> "?" <> query_string
      end

    base_url <> path <> query
  end

  defp response_content_type(headers) do
    headers
    |> Enum.find_value(fn
      {key, value} when is_binary(key) and is_binary(value) ->
        if String.downcase(key) == "content-type", do: media_type(value)

      {key, value} when is_list(key) and is_list(value) ->
        if String.downcase(to_string(key)) == "content-type", do: media_type(to_string(value))

      _header ->
        nil
    end)
    |> Kernel.||("application/json")
  end

  defp media_type(content_type) do
    content_type
    |> String.split(";", parts: 2)
    |> hd()
    |> String.trim()
  end

  defp request_id(conn) do
    conn
    |> get_resp_header("x-request-id")
    |> List.first("unknown")
    |> String.replace(~r/[^A-Za-z0-9_.-]/, "")
    |> String.slice(0, 128)
  end

  @doc false
  def request_timeout do
    case Integer.parse(System.get_env("PYTHON_PROXY_TIMEOUT_MS") || "") do
      {value, ""} ->
        min(max(value, @minimum_request_timeout), @maximum_request_timeout)

      _ ->
        Application.get_env(:starsmap_api, :python_proxy_timeout_ms, @default_request_timeout)
        |> min(@maximum_request_timeout)
        |> max(@minimum_request_timeout)
    end
  end
end

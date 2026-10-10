defmodule StarsmapApi.CommunityS3HttpClientTest do
  use ExUnit.Case, async: false

  alias StarsmapApi.Community.Storage.S3.HttpClient

  test "HEAD gets hackney's 3-tuple answer as a response with an empty body" do
    {listener, port} = listen()
    on_exit(fn -> :gen_tcp.close(listener) end)
    server = respond_once(listener, "HEAD", 200, "")

    assert {:ok, %{status_code: 200, headers: headers, body: ""}} =
             HttpClient.request(:head, "http://127.0.0.1:#{port}/bucket/key", "", [], [])

    assert Task.await(server) =~ "HEAD /bucket/key"
    assert {"content-length", "5"} in headers
    assert {"etag", "\"abc\""} in headers
  end

  test "GET gets hackney's 4-tuple answer with the body as a binary" do
    {listener, port} = listen()
    on_exit(fn -> :gen_tcp.close(listener) end)
    server = respond_once(listener, "GET", 200, "hello")

    assert {:ok, %{status_code: 200, headers: headers, body: "hello"}} =
             HttpClient.request(:get, "http://127.0.0.1:#{port}/bucket/key", "", [], [])

    assert Task.await(server) =~ "GET /bucket/key"
    assert {"etag", "\"abc\""} in headers
  end

  test "PUT sends the body and returns the response" do
    {listener, port} = listen()
    on_exit(fn -> :gen_tcp.close(listener) end)
    server = respond_once(listener, "PUT", 200, "")

    assert {:ok, %{status_code: 200, body: ""}} =
             HttpClient.request(:put, "http://127.0.0.1:#{port}/bucket/key", "hello", [], [])

    assert Task.await(server) =~ "hello"
  end

  test "connection failures are returned as errors with a reason" do
    {listener, port} = listen()
    :gen_tcp.close(listener)

    assert {:error, %{reason: _}} =
             HttpClient.request(:head, "http://127.0.0.1:#{port}/bucket/key", "", [], [])
  end

  test "ExAws head_object works through the client" do
    {listener, port} = listen()
    on_exit(fn -> :gen_tcp.close(listener) end)
    server = respond_once(listener, "HEAD", 200, "")

    assert {:ok, %{status_code: 200, headers: headers}} =
             ExAws.S3.head_object("bucket", "key") |> ExAws.request(config(port))

    assert {"etag", "\"abc\""} in headers
    Task.await(server)
  end

  test "ExAws head_object on a missing key returns an error" do
    {listener, port} = listen()
    on_exit(fn -> :gen_tcp.close(listener) end)
    server = respond_once(listener, "HEAD", 404, "")

    assert {:error, {:http_error, 404, _}} =
             ExAws.S3.head_object("bucket", "missing") |> ExAws.request(config(port))

    Task.await(server)
  end

  defp config(port) do
    [
      http_client: HttpClient,
      access_key_id: "test",
      secret_access_key: "test",
      region: "fsn1",
      scheme: "http://",
      host: "127.0.0.1",
      port: port,
      retries: [max_attempts: 1]
    ]
  end

  defp listen do
    {:ok, listener} =
      :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true, ip: {127, 0, 0, 1}])

    {:ok, {_address, port}} = :inet.sockname(listener)
    {listener, port}
  end

  # Answers like an S3 server: a HEAD response has headers but no body.
  defp respond_once(listener, method, status, body) do
    Task.async(fn ->
      {:ok, socket} = :gen_tcp.accept(listener)
      request = recv_request(socket, "")
      length = if method == "HEAD", do: 5, else: byte_size(body)
      sent_body = if method == "HEAD", do: "", else: body

      :ok =
        :gen_tcp.send(socket, [
          "HTTP/1.1 #{status} Test\r\n",
          "etag: \"abc\"\r\n",
          "content-length: #{length}\r\n",
          "connection: close\r\n\r\n",
          sent_body
        ])

      :gen_tcp.close(socket)
      request
    end)
  end

  defp recv_request(socket, acc) do
    {:ok, data} = :gen_tcp.recv(socket, 0, 5_000)
    acc = acc <> data

    case String.split(acc, "\r\n\r\n", parts: 2) do
      [head, rest] ->
        expected =
          case Regex.run(~r/content-length: (\d+)/i, head) do
            [_, n] -> String.to_integer(n)
            _ -> 0
          end

        if byte_size(rest) < expected, do: recv_request(socket, acc), else: acc

      _ ->
        recv_request(socket, acc)
    end
  end
end

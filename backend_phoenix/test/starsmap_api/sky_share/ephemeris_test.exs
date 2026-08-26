defmodule StarsmapApi.SkyShare.EphemerisTest do
  use ExUnit.Case, async: false

  alias StarsmapApi.SkyShare.Ephemeris

  setup do
    previous_url = System.get_env("PYTHON_BACKEND_URL")

    on_exit(fn ->
      if previous_url,
        do: System.put_env("PYTHON_BACKEND_URL", previous_url),
        else: System.delete_env("PYTHON_BACKEND_URL")
    end)

    :ok
  end

  test "decodes the synchronous response body returned by Hackney" do
    {listener, port} = listen()
    on_exit(fn -> :gen_tcp.close(listener) end)
    System.put_env("PYTHON_BACKEND_URL", "http://127.0.0.1:#{port}")

    response_body =
      Jason.encode!(%{
        "timestamp_utc" => "2026-08-26T21:05:00Z",
        "bodies" => [%{"key" => "earth"}]
      })

    server = respond_once(listener, 200, response_body)

    assert {:ok, %{"bodies" => [%{"key" => "earth"}]}} =
             Ephemeris.Http.snapshot(~U[2026-08-26 21:05:00.000Z], [])

    request = Task.await(server)
    assert request =~ "GET /api/ephemeris?"
    assert request =~ "timestamp=2026-08-26T21%3A05%3A00.000Z"
  end

  test "returns upstream statuses without attempting to stream the response body" do
    {listener, port} = listen()
    on_exit(fn -> :gen_tcp.close(listener) end)
    System.put_env("PYTHON_BACKEND_URL", "http://127.0.0.1:#{port}")
    server = respond_once(listener, 503, "temporarily unavailable")

    assert {:error, {:ephemeris_status, 503}} =
             Ephemeris.Http.snapshot(~U[2026-08-26 21:05:00.000Z], [])

    Task.await(server)
  end

  defp listen do
    {:ok, listener} =
      :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true, ip: {127, 0, 0, 1}])

    {:ok, {_address, port}} = :inet.sockname(listener)
    {listener, port}
  end

  defp respond_once(listener, status, body) do
    Task.async(fn ->
      {:ok, socket} = :gen_tcp.accept(listener)
      {:ok, request} = :gen_tcp.recv(socket, 0, 5_000)

      :ok =
        :gen_tcp.send(socket, [
          "HTTP/1.1 #{status} Test\r\n",
          "content-type: application/json\r\n",
          "content-length: #{byte_size(body)}\r\n",
          "connection: close\r\n\r\n",
          body
        ])

      :gen_tcp.close(socket)
      request
    end)
  end
end

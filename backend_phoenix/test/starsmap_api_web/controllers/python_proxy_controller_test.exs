defmodule StarsmapApiWeb.PythonProxyControllerTest do
  use StarsmapApiWeb.ConnCase, async: false
  alias StarsmapApiWeb.PythonProxyController

  setup do
    original_url = System.get_env("PYTHON_BACKEND_URL")
    original_timeout = System.get_env("PYTHON_PROXY_TIMEOUT_MS")

    on_exit(fn ->
      restore("PYTHON_BACKEND_URL", original_url)
      restore("PYTHON_PROXY_TIMEOUT_MS", original_timeout)
    end)
  end

  test "uses a bounded configurable cold-start timeout" do
    System.delete_env("PYTHON_PROXY_TIMEOUT_MS")
    assert PythonProxyController.request_timeout() == 90_000
    System.put_env("PYTHON_PROXY_TIMEOUT_MS", "1000")
    assert PythonProxyController.request_timeout() == 5_000
    System.put_env("PYTHON_PROXY_TIMEOUT_MS", "999999")
    assert PythonProxyController.request_timeout() == 180_000
  end

  test "does not expose internal proxy target or failure details", %{conn: conn} do
    System.put_env("PYTHON_BACKEND_URL", "http://127.0.0.1:1")
    payload = conn |> get(~p"/api/ephemeris") |> json_response(502)
    assert payload["error"] == "python_backend_unavailable"
    assert is_binary(payload["request_id"])
    refute inspect(payload) =~ "127.0.0.1"
  end

  test "replaces an upstream 5xx body and forwards the correlation ID", %{conn: conn} do
    {:ok, listener} = :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true])
    {:ok, port} = :inet.port(listener)

    server =
      Task.async(fn ->
        {:ok, socket} = :gen_tcp.accept(listener)
        {:ok, request} = :gen_tcp.recv(socket, 0, 2_000)

        :ok =
          :gen_tcp.send(
            socket,
            "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"error\":\"/secret/path leaked\"}"
          )

        :gen_tcp.close(socket)
        :gen_tcp.close(listener)
        request
      end)

    System.put_env("PYTHON_BACKEND_URL", "http://127.0.0.1:#{port}")
    response = get(conn, ~p"/api/ephemeris")
    payload = json_response(response, 500)
    request = Task.await(server)

    assert payload["error"] == "python_backend_error"
    assert payload["request_id"] == get_resp_header(response, "x-request-id") |> List.first()
    refute inspect(payload) =~ "secret"
    assert request =~ "X-Request-ID: #{payload["request_id"]}"
  end

  test "a night plan sends the site in the body and in no address or log line", %{conn: conn} do
    {:ok, listener} = :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true])
    {:ok, port} = :inet.port(listener)

    server =
      Task.async(fn ->
        {:ok, socket} = :gen_tcp.accept(listener)
        {:ok, request} = :gen_tcp.recv(socket, 0, 2_000)

        :ok =
          :gen_tcp.send(
            socket,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"targets\":[]}"
          )

        :gen_tcp.close(socket)
        :gen_tcp.close(listener)
        request
      end)

    System.put_env("PYTHON_BACKEND_URL", "http://127.0.0.1:#{port}")

    log =
      ExUnit.CaptureLog.capture_log([level: :debug], fn ->
        response =
          conn
          |> put_req_header("content-type", "application/json")
          |> post(~p"/api/observe/plan", %{
            latitude_deg: 52.5172,
            longitude_deg: 13.4021,
            date: "2026-10-30",
            ignored: "dropped"
          })

        assert json_response(response, 200) == %{"targets" => []}
      end)

    request = Task.await(server)
    assert request =~ "POST /api/observe/plan HTTP/1.1"
    refute request =~ "52.5172 HTTP"
    assert [_head, body] = String.split(request, "\r\n\r\n", parts: 2)

    assert Jason.decode!(body) == %{
             "latitude_deg" => 52.5172,
             "longitude_deg" => 13.4021,
             "date" => "2026-10-30"
           }

    refute log =~ "52.5172"
    refute log =~ "13.4021"
  end

  test "a night plan has a rate limit of its own", %{conn: conn} do
    System.put_env("PYTHON_BACKEND_URL", "http://127.0.0.1:1")
    StarsmapApiWeb.Plugs.RateLimit.reset()
    original = System.get_env("RATE_LIMIT_CAPACITY_OVERRIDE")
    System.put_env("RATE_LIMIT_CAPACITY_OVERRIDE", "1")
    on_exit(fn -> restore("RATE_LIMIT_CAPACITY_OVERRIDE", original) end)

    post_plan = fn ->
      conn
      |> put_req_header("content-type", "application/json")
      |> post(~p"/api/observe/plan", %{})
    end

    assert post_plan.().status == 502
    assert post_plan.().status == 429
    StarsmapApiWeb.Plugs.RateLimit.reset()
  end

  defp restore(key, nil), do: System.delete_env(key)
  defp restore(key, value), do: System.put_env(key, value)
end

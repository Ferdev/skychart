defmodule StarsmapApiWeb.HealthControllerTest do
  use StarsmapApiWeb.ConnCase, async: false

  alias StarsmapApiWeb.Plugs.RateLimit

  setup do
    original_capacity = System.get_env("RATE_LIMIT_CAPACITY_OVERRIDE")
    System.put_env("RATE_LIMIT_CAPACITY_OVERRIDE", "1")
    RateLimit.reset()

    on_exit(fn ->
      if original_capacity,
        do: System.put_env("RATE_LIMIT_CAPACITY_OVERRIDE", original_capacity),
        else: System.delete_env("RATE_LIMIT_CAPACITY_OVERRIDE")

      RateLimit.reset()
    end)

    :ok
  end

  test "health remains live after a public API bucket is exhausted" do
    client_ip = {198, 51, 100, 40}

    first = %{build_conn() | remote_ip: client_ip} |> get("/api/catalog/nearest")
    assert json_response(first, 400)["error"] == "missing_param"

    limited = %{build_conn() | remote_ip: client_ip} |> get("/api/catalog/nearest")
    assert response(limited, 429) == "Too many requests"

    health = %{build_conn() | remote_ip: client_ip} |> get("/api/health")
    assert %{"ok" => true, "service" => "starsmap_api"} = json_response(health, 200)
  end
end

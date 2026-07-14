defmodule StarsmapApiWeb.RateLimitTest do
  use ExUnit.Case, async: false
  import Plug.Conn
  import Plug.Test
  alias StarsmapApiWeb.Plugs.RateLimit

  setup do
    original = Application.get_env(:starsmap_api, :trusted_proxy_cidrs)

    Application.put_env(:starsmap_api, :trusted_proxy_cidrs, [
      "127.0.0.0/8",
      "::1/128",
      "172.18.0.0/16"
    ])

    on_exit(fn ->
      if original,
        do: Application.put_env(:starsmap_api, :trusted_proxy_cidrs, original),
        else: Application.delete_env(:starsmap_api, :trusted_proxy_cidrs)
    end)

    :ok
  end

  test "rate limit uses endpoint remote IP and returns 429" do
    RateLimit.reset()

    first =
      %{conn(:get, "/") | remote_ip: {127, 0, 0, 9}}
      |> RateLimit.call(capacity: 1, refill_per_second: 0)

    refute first.halted

    second =
      %{conn(:get, "/") | remote_ip: {127, 0, 0, 9}}
      |> RateLimit.call(capacity: 1, refill_per_second: 0)

    assert second.status == 429
    assert second.halted
  end

  test "parallel requests atomically consume the configured budget" do
    RateLimit.reset()

    results =
      1..300
      |> Task.async_stream(
        fn _ ->
          %{conn(:get, "/") | remote_ip: {127, 0, 0, 10}}
          |> RateLimit.call(capacity: 180, refill_per_second: 3)
        end,
        max_concurrency: 30,
        ordered: false
      )
      |> Enum.map(fn {:ok, result} -> result end)

    assert Enum.count(results, &(&1.status == 429)) == 120
    assert Enum.count(results, &(not &1.halted)) == 180
  end

  test "trusted proxy separates forwarded clients and ignores spoofed prefixes" do
    RateLimit.reset()

    first =
      %{conn(:get, "/") | remote_ip: {172, 18, 0, 2}}
      |> put_req_header("x-forwarded-for", "203.0.113.99, 198.51.100.10")
      |> RateLimit.call(capacity: 1, refill_per_second: 0)

    second =
      %{conn(:get, "/") | remote_ip: {172, 18, 0, 2}}
      |> put_req_header("x-forwarded-for", "203.0.113.99, 198.51.100.11")
      |> RateLimit.call(capacity: 1, refill_per_second: 0)

    spoofed_retry =
      %{conn(:get, "/") | remote_ip: {172, 18, 0, 2}}
      |> put_req_header("x-forwarded-for", "203.0.113.100, 198.51.100.10")
      |> RateLimit.call(capacity: 1, refill_per_second: 0)

    refute first.halted
    refute second.halted
    assert spoofed_retry.status == 429
  end

  test "untrusted peer cannot spoof its identity with forwarded headers" do
    RateLimit.reset()

    first =
      %{conn(:get, "/") | remote_ip: {198, 51, 100, 20}}
      |> put_req_header("x-forwarded-for", "203.0.113.1")
      |> RateLimit.call(capacity: 1, refill_per_second: 0)

    second =
      %{conn(:get, "/") | remote_ip: {198, 51, 100, 20}}
      |> put_req_header("x-forwarded-for", "203.0.113.2")
      |> RateLimit.call(capacity: 1, refill_per_second: 0)

    refute first.halted
    assert second.status == 429
  end
end

defmodule StarsmapApiWeb.RateLimitTest do
  use ExUnit.Case, async: false
  import Plug.Conn
  import Plug.Test
  alias StarsmapApiWeb.ClientIp
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

  test "IPv4-mapped IPv6 Kamal peer uses independent forwarded client buckets" do
    RateLimit.reset()
    mapped_kamal_peer = {0, 0, 0, 0, 0, 65_535, 44_050, 2}

    client_one =
      %{conn(:get, "/") | remote_ip: mapped_kamal_peer}
      |> put_req_header("x-forwarded-for", "198.51.100.10")

    client_two =
      %{conn(:get, "/") | remote_ip: mapped_kamal_peer}
      |> put_req_header("x-forwarded-for", "198.51.100.11")

    assert ClientIp.resolve(client_one) == {198, 51, 100, 10}
    refute RateLimit.call(client_one, capacity: 1, refill_per_second: 0).halted
    assert RateLimit.call(client_one, capacity: 1, refill_per_second: 0).status == 429
    refute RateLimit.call(client_two, capacity: 1, refill_per_second: 0).halted
  end

  test "forwarded chain stops at the first untrusted hop" do
    RateLimit.reset()
    mapped_kamal_peer = {0, 0, 0, 0, 0, 65_535, 44_050, 2}

    first =
      %{conn(:get, "/") | remote_ip: mapped_kamal_peer}
      |> put_req_header(
        "x-forwarded-for",
        "203.0.113.1, 198.51.100.20, 172.18.0.3"
      )

    spoofed_retry =
      %{conn(:get, "/") | remote_ip: mapped_kamal_peer}
      |> put_req_header(
        "x-forwarded-for",
        "203.0.113.2, 198.51.100.20, 172.18.0.3"
      )

    assert ClientIp.resolve(first) == {198, 51, 100, 20}
    refute RateLimit.call(first, capacity: 1, refill_per_second: 0).halted
    assert RateLimit.call(spoofed_retry, capacity: 1, refill_per_second: 0).status == 429
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

  test "IPv4-mapped untrusted peer cannot spoof its identity" do
    RateLimit.reset()
    mapped_untrusted_peer = {0, 0, 0, 0, 0, 65_535, 50_739, 25_620}

    first =
      %{conn(:get, "/") | remote_ip: mapped_untrusted_peer}
      |> put_req_header("x-forwarded-for", "203.0.113.1")
      |> RateLimit.call(capacity: 1, refill_per_second: 0)

    second =
      %{conn(:get, "/") | remote_ip: mapped_untrusted_peer}
      |> put_req_header("x-forwarded-for", "203.0.113.2")
      |> RateLimit.call(capacity: 1, refill_per_second: 0)

    refute first.halted
    assert second.status == 429
  end
end

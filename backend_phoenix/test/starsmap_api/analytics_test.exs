defmodule StarsmapApi.AnalyticsTest do
  use StarsmapApi.DataCase
  alias StarsmapApi.{Analytics, Analytics.Event, Repo}
  alias StarsmapApiWeb.ClientIp
  import Plug.Conn
  import Plug.Test

  test "records minimized data without retaining IP" do
    params = %{
      "name" => "search",
      "path" => "/?secret=query",
      "referrer" => "https://Example.org/private?q=x",
      "properties" => %{"query_length" => "4"}
    }

    assert {:ok, event} = Analytics.record(params, {192, 0, 2, 1}, ~U[2026-07-14 12:00:00Z])

    assert event.path == "/" and event.referrer_host == "example.org" and
             byte_size(event.anonymous_id) == 64

    refute inspect(event) =~ "192.0.2.1"
  end

  test "rotates IDs daily" do
    params = %{"name" => "page_view", "path" => "/", "properties" => %{}}
    assert {:ok, first} = Analytics.record(params, {192, 0, 2, 1}, ~U[2026-07-14 23:59:00Z])
    assert {:ok, second} = Analytics.record(params, {192, 0, 2, 1}, ~U[2026-07-15 00:01:00Z])
    refute first.anonymous_id == second.anonymous_id
  end

  test "rejects unknown and unbounded data" do
    assert {:error, :invalid_event} =
             Analytics.record(%{"name" => "arbitrary", "path" => "/"}, {127, 0, 0, 1})

    assert {:error, :invalid_event} =
             Analytics.record(
               %{"name" => "search", "path" => "/", "properties" => %{"email" => "x@y.test"}},
               {127, 0, 0, 1}
             )
  end

  test "accepts but does not persist events when analytics is disabled" do
    previous = Application.get_env(:starsmap_api, :analytics_enabled)
    Application.put_env(:starsmap_api, :analytics_enabled, false)

    on_exit(fn ->
      if is_nil(previous),
        do: Application.delete_env(:starsmap_api, :analytics_enabled),
        else: Application.put_env(:starsmap_api, :analytics_enabled, previous)
    end)

    before_count = Repo.aggregate(Event, :count)

    assert {:ok, :disabled} =
             Analytics.record(%{"name" => "page_view", "path" => "/"}, {127, 0, 0, 1})

    assert Repo.aggregate(Event, :count) == before_count
  end

  test "analytics identity uses the proxy-resolved client without accepting spoofed public headers" do
    trusted =
      %{conn(:post, "/api/events") | remote_ip: {127, 0, 0, 2}}
      |> put_req_header("x-forwarded-for", "203.0.113.7, 198.51.100.8")

    untrusted =
      %{conn(:post, "/api/events") | remote_ip: {198, 51, 100, 9}}
      |> put_req_header("x-forwarded-for", "203.0.113.7")

    assert ClientIp.resolve(trusted) == {198, 51, 100, 8}
    assert ClientIp.resolve(untrusted) == {198, 51, 100, 9}
  end
end

defmodule StarsmapApiWeb.Plugs.CommunityAccess do
  @moduledoc "Community gate, exact-origin writes, scoped limits and optional session access."
  import Plug.Conn
  alias StarsmapApi.Community.Accounts
  def init(options), do: options

  def call(conn, options) do
    if not StarsmapApi.Community.enabled?() do
      conn |> send_resp(503, "Community photos are not enabled") |> halt()
    else
      conn = fetch_cookies(conn)

      cookie =
        if Application.get_env(:starsmap_api, :community_cookie_secure, true),
          do: "__Host-cosmic-community",
          else: "cosmic-community"

      secret = conn.cookies[cookie]

      user =
        if Keyword.get(options, :session, false), do: Accounts.authenticate(secret), else: nil

      conn = conn |> assign(:community_user, user) |> assign(:community_secret, secret)

      cond do
        conn.method in ["POST", "PUT", "PATCH", "DELETE"] and
            get_req_header(conn, "origin") != [
              Application.get_env(:starsmap_api, :community_origin)
            ] ->
          reject(conn, 403, "origin_rejected")

        conn.method in ["POST", "PATCH", "DELETE"] and not json?(conn) ->
          reject(conn, 415, "json_required")

        Keyword.get(options, :required, false) and is_nil(user) ->
          reject(conn, 401, "sign_in_required")

        Keyword.get(options, :required, false) and conn.method != "GET" and
            not valid_csrf?(conn, secret) ->
          reject(conn, 403, "csrf_rejected")

        true ->
          conn =
            put_resp_header(conn, "cache-control", if(user, do: "no-store", else: "no-cache"))

          options = [capacity: 30, refill_per_second: 0.5, scope: {:community, conn.method}]
          options = if user, do: Keyword.put(options, :identity, user.id), else: options
          StarsmapApiWeb.Plugs.RateLimit.call(conn, options)
      end
    end
  end

  def cookie,
    do:
      if(Application.get_env(:starsmap_api, :community_cookie_secure, true),
        do: "__Host-cosmic-community",
        else: "cosmic-community"
      )

  defp json?(conn),
    do:
      Enum.any?(
        get_req_header(conn, "content-type"),
        &String.starts_with?(&1, "application/json")
      )

  defp valid_csrf?(conn, secret) do
    case get_req_header(conn, "x-community-csrf") do
      [token] when is_binary(secret) -> Plug.Crypto.secure_compare(token, Accounts.csrf(secret))
      _ -> false
    end
  end

  defp reject(conn, status, error),
    do:
      conn
      |> put_resp_content_type("application/json")
      |> send_resp(status, Jason.encode!(%{error: error}))
      |> halt()
end

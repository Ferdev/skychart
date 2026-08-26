defmodule StarsmapApiWeb.SkyShareController do
  use StarsmapApiWeb, :controller

  alias StarsmapApi.SkyShare.{CardRenderer, CardService, Context, Copy, State}

  @max_query_bytes 1_500
  @card_cache_control "public, max-age=86400, stale-while-revalidate=604800"

  def show(conn, %{"key" => key} = params) do
    with :ok <- query_guard(conn),
         {:ok, state} <- State.parse(key, params),
         {:ok, observer, _scene_bodies} <- Context.resolve(state.observer_key, state.epoch_utc) do
      title = Copy.title(state.locale, observer.name) <> " — Cosmic Atlas"
      description = Copy.description(state.locale, observer.name)
      canonical = absolute(State.canonical_path(state))
      exact_url = absolute(State.permalink_path(state))
      image = absolute(State.card_path(state))
      alt = Copy.image_alt(state.locale, observer.name)

      noindex =
        if conn.query_string == "",
          do: "",
          else: ~s(<meta name="robots" content="noindex,follow">)

      document =
        StarsmapApiWeb.ServerShell.render!(
          title: title,
          metadata: %{
            title: title,
            description: description,
            canonical: canonical,
            og_url: exact_url,
            image: image,
            image_type: "image/png",
            image_width: CardRenderer.width(),
            image_height: CardRenderer.height(),
            image_alt: alt
          },
          head: noindex
        )

      conn
      |> put_resp_content_type("text/html")
      |> put_resp_header("content-language", state.locale)
      |> send_resp(200, document)
    else
      {:error, :query_too_long} ->
        error_page(
          conn,
          414,
          "Sky link too long",
          "This Sky link exceeds the supported state size."
        )

      {:error, :observer_not_found} ->
        error_page(
          conn,
          404,
          "Sky observer not found",
          "This observer is unavailable or is not a public catalog object."
        )

      {:error, :invalid_observer_position} ->
        error_page(
          conn,
          422,
          "Sky position unavailable",
          "This observer does not have valid three-dimensional catalog coordinates."
        )

      {:error, :ephemeris_unavailable} ->
        error_page(
          conn,
          503,
          "Sky ephemeris unavailable",
          "The requested observer position is temporarily unavailable at this UTC epoch."
        )

      {:error, _reason} ->
        error_page(
          conn,
          400,
          "Invalid Sky link",
          "The camera, UTC epoch, or layer settings in this Sky link are malformed."
        )
    end
  end

  def card(conn, %{"key" => key} = params) do
    with :ok <- query_guard(conn),
         {:ok, state} <- State.parse(key, params),
         {:ok, observer, scene_bodies} <- Context.resolve(state.observer_key, state.epoch_utc) do
      etag = CardService.etag(state, observer)

      if etag in get_req_header(conn, "if-none-match") do
        conn
        |> card_headers(etag, "validated")
        |> send_resp(304, "")
      else
        {:ok, png, ^etag, cache_status} = CardService.render(state, observer, scene_bodies)

        conn
        |> card_headers(etag, Atom.to_string(cache_status))
        |> put_resp_content_type("image/png")
        |> send_resp(200, png)
      end
    else
      {:error, :query_too_long} ->
        send_resp(conn, 414, "Sky card query too long")

      {:error, :observer_not_found} ->
        send_resp(conn, 404, "Sky observer not found")

      {:error, :invalid_observer_position} ->
        send_resp(conn, 422, "Sky observer position unavailable")

      {:error, :ephemeris_unavailable} ->
        send_resp(conn, 503, "Sky observer ephemeris unavailable")

      {:error, _reason} ->
        send_resp(conn, 400, "Invalid Sky card state")
    end
  end

  defp card_headers(conn, etag, cache_status) do
    conn
    |> put_resp_header("cache-control", @card_cache_control)
    |> put_resp_header("etag", etag)
    |> put_resp_header("x-content-type-options", "nosniff")
    |> put_resp_header("x-sky-card-cache", cache_status)
    |> put_resp_header("vary", "accept-encoding")
  end

  defp query_length(conn) do
    if byte_size(conn.query_string) <= @max_query_bytes, do: :ok, else: {:error, :query_too_long}
  end

  defp query_guard(conn) do
    with :ok <- query_length(conn), :ok <- unique_state_params(conn.query_string), do: :ok
  end

  defp unique_state_params(""), do: :ok

  defp unique_state_params(query) do
    known = MapSet.new(~w(v t sc sl sf r lang))

    duplicate? =
      query
      |> String.split("&", trim: true)
      |> Enum.map(fn pair ->
        pair |> String.split("=", parts: 2) |> hd() |> URI.decode_www_form()
      end)
      |> Enum.filter(&MapSet.member?(known, &1))
      |> Enum.frequencies()
      |> Enum.any?(fn {_name, count} -> count > 1 end)

    if duplicate?, do: {:error, :duplicate_state}, else: :ok
  rescue
    _ -> {:error, :invalid_state}
  end

  defp error_page(conn, status, title, message) do
    document =
      StarsmapApiWeb.ServerShell.render!(
        title: title <> " — Cosmic Atlas",
        metadata: %{
          title: title <> " — Cosmic Atlas",
          description: message,
          canonical: absolute("/sky"),
          og_url: absolute("/sky")
        },
        head: ~s(<meta name="robots" content="noindex,nofollow">),
        body:
          "<article class=\"sky-route-error\"><p>Cosmic Atlas / Sky</p><h1>#{h(title)}</h1><p>#{h(message)}</p><a href=\"/\">Return to the atlas</a></article>"
      )

    conn |> put_resp_content_type("text/html") |> send_resp(status, document)
  end

  defp absolute(path), do: StarsmapApiWeb.Endpoint.url() <> path
  defp h(value), do: value |> Plug.HTML.html_escape_to_iodata() |> IO.iodata_to_binary()
end

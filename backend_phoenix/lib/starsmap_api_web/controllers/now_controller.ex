defmodule StarsmapApiWeb.NowController do
  use StarsmapApiWeb, :controller
  alias StarsmapApi.SkyEvents
  alias StarsmapApi.SkyEvents.Calendar

  def index(conn, _) do
    refreshed_at = SkyEvents.last_refreshed_at()

    json(conn, %{
      refreshed_at: refreshed_at,
      stale: stale?(refreshed_at),
      events: Enum.map(SkyEvents.list_upcoming(), &serialize/1)
    })
  end

  def feed(conn, _) do
    updated = SkyEvents.last_refreshed_at() || DateTime.from_unix!(0)
    entries = SkyEvents.list_upcoming() |> Enum.map_join("", &entry/1)

    xml =
      ~s(<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>https://skychart.org/feed.xml</id><title>Cosmic Atlas — Happening now</title><updated>#{DateTime.to_iso8601(updated)}</updated><link rel="self" href="https://skychart.org/feed.xml"/>#{entries}</feed>)

    conn |> put_resp_content_type("application/atom+xml") |> send_resp(200, xml)
  end

  # Calendar services poll a subscription, so a client with a current copy gets an empty 304.
  def calendar(conn, params) do
    case Calendar.parse_kinds(params["types"]) do
      {:ok, kinds} ->
        body = kinds |> SkyEvents.list_for_calendar() |> Calendar.render()

        etag =
          ~s("#{:crypto.hash(:sha256, body) |> binary_part(0, 16) |> Base.encode16(case: :lower)}")

        conn =
          conn
          |> put_resp_header("etag", etag)
          |> put_resp_header(
            "cache-control",
            "public, max-age=3600, stale-while-revalidate=86400"
          )

        if etag in get_req_header(conn, "if-none-match") do
          send_resp(conn, 304, "")
        else
          conn
          |> put_resp_content_type("text/calendar")
          |> put_resp_header(
            "content-disposition",
            ~s(inline; filename="cosmic-atlas-sky-events.ics")
          )
          |> send_resp(200, body)
        end

      :error ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "invalid_types", accepted: Calendar.kinds()})
    end
  end

  defp serialize(e),
    do: %{
      id: e.source <> ":" <> e.source_id,
      kind: e.kind,
      title: e.title,
      summary: e.summary,
      starts_at: e.starts_at,
      catalog_key: e.catalog_key,
      url: event_url(e)
    }

  defp event_url(%{catalog_key: k}) when is_binary(k), do: "/o/" <> URI.encode_www_form(k)
  defp event_url(e), do: e.source_url
  defp stale?(nil), do: true
  defp stale?(dt), do: DateTime.diff(DateTime.utc_now(), dt, :hour) > 36

  defp entry(e),
    do:
      "<entry><id>urn:skychart:#{x(e.source)}:#{x(e.source_id)}</id><title>#{x(e.title)}</title><updated>#{DateTime.to_iso8601(e.updated_at)}</updated><link href=\"#{x(SkyEvents.public_url(e))}\"/><summary>#{x(e.summary)}</summary></entry>"

  defp x(v),
    do:
      v
      |> to_string()
      |> String.replace("&", "&amp;")
      |> String.replace("<", "&lt;")
      |> String.replace(">", "&gt;")
      |> String.replace("\"", "&quot;")
      |> String.replace("'", "&apos;")
end

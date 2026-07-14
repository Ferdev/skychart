defmodule StarsmapApiWeb.TourPageController do
  use StarsmapApiWeb, :controller
  @tours ~w(earth-to-observable-universe near-the-sun)
  def index(conn, _) do
    tours = Enum.map(@tours, &load!/1)

    body =
      "<article class=\"tour-index\"><h1>Guided tours</h1><p>Measured journeys through the physical atlas.</p><ol>" <>
        Enum.map_join(tours, "", fn t ->
          "<li><a href=\"/tours/#{h(t["slug"])}\"><strong>#{h(t["title"])}</strong></a><p>#{h(t["description"])}</p></li>"
        end) <> "</ol></article>"

    html(
      conn,
      render_shell("Guided tours", "Narrated journeys through Cosmic Atlas.", "/tours", body)
    )
  end

  def show(conn, %{"slug" => slug}) when slug in @tours do
    tour = load!(slug)

    steps =
      tour["steps"]
      |> Enum.with_index()
      |> Enum.map_join("", fn {s, i} ->
        "<li><a href=\"/?tour=#{h(slug)}&amp;step=#{i}\"><strong>#{h(s["title"])}</strong></a><p>#{h(s["body"])}</p></li>"
      end)

    body =
      "<article class=\"tour-page\"><p><a href=\"/tours\">All guided tours</a></p><h1>#{h(tour["title"])}</h1><p>#{h(tour["description"])}</p><a href=\"/?tour=#{h(slug)}&amp;step=0\">Start this tour</a><ol>#{steps}</ol></article>"

    html(conn, render_shell(tour["title"], tour["description"], "/tours/#{slug}", body))
  end

  def show(conn, _),
    do:
      conn
      |> put_status(:not_found)
      |> html("<!doctype html><html><body><main><h1>Tour not found</h1></main></body></html>")

  defp load!(slug),
    do:
      Application.app_dir(:starsmap_api, "priv/static/tours/#{slug}.json")
      |> File.read!()
      |> Jason.decode!()

  defp render_shell(title, description, path, body) do
    canonical = StarsmapApiWeb.Endpoint.url() <> path

    StarsmapApiWeb.ServerShell.render!(
      title: "#{title} — Cosmic Atlas",
      metadata: %{
        title: "#{title} — Cosmic Atlas",
        description: description,
        canonical: canonical
      },
      body: body
    )
  end

  defp h(v), do: v |> to_string() |> Plug.HTML.html_escape_to_iodata() |> IO.iodata_to_binary()
end

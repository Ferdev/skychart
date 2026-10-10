defmodule StarsmapApiWeb.TourPageController do
  use StarsmapApiWeb, :controller
  alias StarsmapApiWeb.StaticPage
  @tours ~w(earth-to-observable-universe near-the-sun)
  # The tour pages are standalone static pages. A link opens the tour in the atlas.
  def index(conn, _) do
    tours = Enum.map(@tours, &load!/1)

    items =
      Enum.map_join(tours, "", fn t ->
        "<li><a href=\"/tours/#{h(t["slug"])}\"><strong>#{h(t["title"])}</strong></a><p>#{h(t["description"])}</p></li>"
      end)

    body =
      "<nav aria-label=\"Site\">#{StaticPage.back_link()}<a href=\"/about\">About and data sources</a></nav>" <>
        "<article class=\"tour-index\"><p class=\"eyebrow\">Cosmic Atlas</p><h1>Guided tours</h1><p class=\"lede\">Measured journeys through the physical atlas.</p><ol class=\"steps\">#{items}</ol></article>"

    html(conn, page("Guided tours", "Narrated journeys through Cosmic Atlas.", "/tours", body))
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
      "<nav aria-label=\"Site\">#{StaticPage.back_link()}<a href=\"/tours\">All guided tours</a></nav>" <>
        "<article class=\"tour-page\"><p class=\"eyebrow\">Guided tour</p><h1>#{h(tour["title"])}</h1><p class=\"lede\">#{h(tour["description"])}</p>" <>
        "<p><a class=\"action\" href=\"/?tour=#{h(slug)}&amp;step=0\">Start this tour in the atlas</a></p><ol class=\"steps\">#{steps}</ol></article>"

    html(conn, page(tour["title"], tour["description"], "/tours/#{slug}", body))
  end

  def show(conn, _),
    do:
      conn
      |> put_status(:not_found)
      |> html(StaticPage.not_found("Tour not found", "This guided tour does not exist."))

  defp load!(slug),
    do:
      Application.app_dir(:starsmap_api, "priv/static/tours/#{slug}.json")
      |> File.read!()
      |> Jason.decode!()

  defp page(title, description, path, body) do
    StaticPage.document(
      title: "#{title} — Cosmic Atlas",
      description: description,
      canonical: StarsmapApiWeb.Endpoint.url() <> path,
      body: body
    )
  end

  defp h(v), do: v |> to_string() |> Plug.HTML.html_escape_to_iodata() |> IO.iodata_to_binary()
end

defmodule StarsmapApiWeb.FlightController do
  use StarsmapApiWeb, :controller

  alias StarsmapApi.Flights
  alias StarsmapApiWeb.StaticPage

  def create(conn, params) do
    case Flights.request(params["question"], params["locale"]) do
      {:ok, flight} ->
        conn |> put_status(:accepted) |> json(Flights.public(flight))

      {:error, :daily_limit} ->
        error(conn, :too_many_requests, :flights_daily_limit)

      {:error, :flights_unavailable} ->
        error(conn, :service_unavailable, :flights_unavailable)

      {:error, _} ->
        error(conn, :unprocessable_entity, :question_rejected)
    end
  end

  def show(conn, %{"slug" => slug}) do
    case Flights.get(slug) do
      nil -> error(conn, :not_found, :not_found)
      flight -> json(conn, Flights.public(flight))
    end
  end

  # The address is public and stable. A page with text from the public stays out of search.
  def page(conn, %{"slug" => slug}) do
    case slug |> Flights.get() |> then(&(&1 && Flights.public(&1))) do
      %{status: "published"} = flight ->
        steps =
          Enum.with_index(flight.steps)
          |> Enum.map_join("", fn {step, index} ->
            "<li><a href=\"/?tour=#{h(flight.slug)}&amp;step=#{index}\"><strong>#{h(step.title)}</strong></a><p>#{h(step.body)}</p>#{sources(step.sources)}</li>"
          end)

        body =
          "<nav aria-label=\"Site\">#{StaticPage.back_link()}<a href=\"/tours\">All guided tours</a></nav>" <>
            "<article class=\"tour-page\"><p class=\"eyebrow\">Answer flight</p><h1>#{h(flight.title)}</h1><p class=\"lede\">#{h(flight.question)}</p>" <>
            "<p><a class=\"action\" href=\"/?tour=#{h(flight.slug)}&amp;step=0\">Start this flight in the atlas</a></p><ol class=\"steps\">#{steps}</ol></article>"

        conn
        |> put_resp_header("x-robots-tag", "noindex")
        |> html(
          StaticPage.document(
            title: "#{flight.title} — Cosmic Atlas",
            description: flight.question,
            canonical: StarsmapApiWeb.Endpoint.url() <> "/flights/#{slug}",
            body: body
          )
        )

      _ ->
        conn
        |> put_status(:not_found)
        |> html(StaticPage.not_found("Flight not found", "This flight does not exist."))
    end
  end

  defp sources(nil), do: ""

  defp sources(list) do
    items =
      Enum.map_join(list, "", fn source ->
        "<li><a href=\"#{h(source["url"])}\">#{h(source["name"])}</a> #{h(source["catalog"] || "")}</li>"
      end)

    "<ul aria-label=\"Sources\">#{items}</ul>"
  end

  defp h(value),
    do: value |> to_string() |> Plug.HTML.html_escape_to_iodata() |> IO.iodata_to_binary()

  defp error(conn, status, reason), do: conn |> put_status(status) |> json(%{error: reason})
end

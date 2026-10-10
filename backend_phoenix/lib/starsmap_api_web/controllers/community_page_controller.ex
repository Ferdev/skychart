defmodule StarsmapApiWeb.CommunityPageController do
  use StarsmapApiWeb, :controller
  alias StarsmapApi.Community.{Photos, User}
  alias StarsmapApi.CommunityRepo, as: Repo

  def photo(conn, %{"id" => id}) do
    photo = Photos.get(id)

    if Photos.visible?(photo) do
      data = Photos.public(photo)

      graph = %{
        "@context" => "https://schema.org",
        "@type" => "ImageObject",
        "name" => data.title,
        "contentUrl" => data.image_url,
        "creditText" => data.author.name,
        "license" => data.licence,
        "creator" => %{"@type" => "Person", "name" => data.author.name},
        "dateCreated" => DateTime.to_iso8601(data.captured_at)
      }

      body =
        "<article class=\"object-page\"><a href=\"/\">Cosmic Atlas</a><h1>#{h(data.title)}</h1><figure><img src=\"#{h(data.image_url)}\" alt=\"#{h(data.title)}\"><figcaption>#{h(data.author.name)} · #{h(data.licence)} · #{DateTime.to_date(data.captured_at)}</figcaption></figure><p>#{h(data.caption)}</p><a href=\"/o/#{URI.encode(data.declared_key, &URI.char_unreserved?/1)}\">Explore this object and its photos</a></article>"

      html(
        conn,
        StarsmapApiWeb.ServerShell.render!(
          title: "#{data.title} — Cosmic Atlas",
          head:
            "<script type=\"application/ld+json\">#{StarsmapApiWeb.JsonLd.encode!(graph)}</script>",
          body: body
        )
      )
    else
      conn
      |> put_status(:not_found)
      |> html(
        StarsmapApiWeb.StaticPage.not_found(
          "Photo not found",
          "This photo is not public or does not exist."
        )
      )
    end
  end

  def profile(conn, %{"handle" => handle}) do
    case Repo.get_by(User, handle: handle, suspended: false) do
      nil ->
        conn
        |> put_status(:not_found)
        |> html(
          StarsmapApiWeb.StaticPage.not_found(
            "Photographer not found",
            "This photographer page does not exist."
          )
        )

      user ->
        cards =
          Photos.by_author(user.id)
          |> Enum.take(24)
          |> Enum.map_join("", &card/1)

        html(
          conn,
          StarsmapApiWeb.ServerShell.render!(
            title: "#{user.name} — Cosmic Atlas",
            body:
              "<article class=\"object-page\"><h1>#{h(user.name)}</h1><div class=\"community-photo-grid\">#{cards}</div></article>"
          )
        )
    end
  end

  def object_gallery(key) do
    if StarsmapApi.Community.enabled?() do
      cards =
        Photos.gallery(key)
        |> Enum.map_join("", fn p ->
          "<a href=\"/photos/#{p.id}\"><img loading=\"lazy\" src=\"#{h(p.thumbnail_url)}\" alt=\"#{h(p.title)}\">#{h(p.author.name)} · #{h(p.licence)} · #{DateTime.to_date(p.captured_at)}</a>"
        end)

      "<section><h2>Community photos</h2><div class=\"community-photo-grid\">#{cards}</div></section>"
    else
      ""
    end
  end

  defp card(photo) do
    p = Photos.public(photo)

    "<a href=\"/photos/#{p.id}\"><img src=\"#{h(p.thumbnail_url)}\" alt=\"#{h(p.title)}\">#{h(p.title)}</a>"
  end

  defp h(value),
    do: value |> to_string() |> Plug.HTML.html_escape_to_iodata() |> IO.iodata_to_binary()
end

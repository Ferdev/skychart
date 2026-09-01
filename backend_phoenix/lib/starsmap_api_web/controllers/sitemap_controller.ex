defmodule StarsmapApiWeb.SitemapController do
  use StarsmapApiWeb, :controller
  alias StarsmapApi.Catalog.PublicCache
  alias StarsmapApi.Catalog.PublicObjects
  @ttl :timer.hours(24)
  @pages ["/", "/about", "/agents", "/methodology", "/tours"]
  @pages_lastmod ~D[2026-08-31]
  def index(conn, _), do: xml(conn, cached(:index, &index_xml/0))

  def catalog(conn, %{"catalog" => filename}) do
    group = String.replace_suffix(filename, ".xml", "")

    if valid_group?(filename, group) do
      xml(conn, cached({:catalog, group}, fn -> catalog_xml(group) end))
    else
      send_resp(conn, 404, "Not found")
    end
  end

  defp cached(key, fun) do
    case PublicCache.get({:sitemap, key}) do
      {:ok, body} -> body
      :error -> PublicCache.put({:sitemap, key}, fun.(), @ttl)
    end
  end

  defp index_xml do
    base = StarsmapApiWeb.Endpoint.url()

    catalog_entries =
      Enum.map_join(PublicObjects.sitemap_catalogs(), "", fn {group, _, lastmod} ->
        "<sitemap><loc>#{x(base <> "/sitemaps/#{group}.xml")}</loc><lastmod>#{date(lastmod)}</lastmod></sitemap>"
      end)

    pages =
      "<sitemap><loc>#{x(base <> "/sitemaps/pages.xml")}</loc><lastmod>#{Date.to_iso8601(@pages_lastmod)}</lastmod></sitemap>"

    ~s(<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">#{pages}#{catalog_entries}</sitemapindex>)
  end

  defp catalog_xml("pages") do
    base = StarsmapApiWeb.Endpoint.url()

    entries =
      Enum.map_join(@pages, "", fn path ->
        "<url><loc>#{x(base <> path)}</loc><lastmod>#{Date.to_iso8601(@pages_lastmod)}</lastmod></url>"
      end)

    ~s(<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">#{entries}</urlset>)
  end

  defp catalog_xml(group) do
    base = StarsmapApiWeb.Endpoint.url()

    entries =
      Enum.map_join(PublicObjects.sitemap_entries(group), "", fn {key, lastmod} ->
        "<url><loc>#{x(base <> "/o/" <> URI.encode_www_form(key))}</loc><lastmod>#{date(lastmod)}</lastmod></url>"
      end)

    ~s(<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">#{entries}</urlset>)
  end

  defp xml(conn, body),
    do: conn |> put_resp_content_type("application/xml") |> send_resp(200, body)

  defp valid_group?(filename, group) do
    filename == group <> ".xml" and Regex.match?(~r/\A[a-z0-9_-]{1,80}\z/, group) and
      (group == "pages" or
         Enum.any?(PublicObjects.sitemap_catalogs(), fn {name, _, _} -> name == group end))
  end

  defp date(nil), do: "1970-01-01"
  defp date(%DateTime{} = v), do: v |> DateTime.to_date() |> Date.to_iso8601()
  defp date(%NaiveDateTime{} = v), do: v |> NaiveDateTime.to_date() |> Date.to_iso8601()
  defp x(v), do: v |> Plug.HTML.html_escape_to_iodata() |> IO.iodata_to_binary()
end

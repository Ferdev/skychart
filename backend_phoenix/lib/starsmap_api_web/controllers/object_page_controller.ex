defmodule StarsmapApiWeb.ObjectPageController do
  use StarsmapApiWeb, :controller
  alias StarsmapApi.Catalog.PublicObjects

  @image_types ~w(star planet moon dwarf_planet asteroid comet galaxy quasar star_cluster nebula active_galaxy black_hole pulsar unknown)
  def show(conn, %{"key" => key}) do
    case PublicObjects.public_object(key) do
      {:ok, object} -> conn |> put_resp_content_type("text/html") |> send_resp(200, page(object))
      {:error, :not_found} -> conn |> put_status(:not_found) |> html(not_found())
    end
  end

  def type_image(conn, %{"type" => type}) when type in @image_types do
    label = type |> String.replace("_", " ") |> String.upcase()

    svg =
      ~s(<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#080a09"/><circle cx="600" cy="270" r="112" fill="#d8a23f"/><text x="600" y="480" text-anchor="middle" fill="#f3eedf" font-family="sans-serif" font-size="42">COSMIC ATLAS · #{label}</text></svg>)

    conn
    |> put_resp_content_type("image/svg+xml")
    |> put_resp_header("cache-control", "public, max-age=31536000, immutable")
    |> send_resp(200, svg)
  end

  def type_image(conn, _), do: send_resp(conn, 404, "Not found")

  defp page(object) do
    canonical = url(~p"/o/#{object.key}")

    description =
      "Inspect #{object.name}, its measured position, distance, catalog source, and provenance in Cosmic Atlas."

    image = StarsmapApiWeb.Endpoint.url() <> media_url(object)

    json_ld =
      safe_json(%{
        "@context" => "https://schema.org",
        "@type" => "Thing",
        "name" => object.name,
        "url" => canonical,
        "description" => description,
        "sameAs" => Enum.map(object.external_links, & &1.url)
      })

    StarsmapApiWeb.ServerShell.render!(
      title: "#{object.name} — Cosmic Atlas",
      metadata: %{
        title: "#{object.name} — Cosmic Atlas",
        description: description,
        canonical: canonical,
        image: image
      },
      head:
        ~s(<script type="application/ld+json">#{json_ld}</script><script>window.__ATLAS_BOOT__=#{safe_json(%{objectKey: object.key})}</script>),
      body: object_html(object)
    )
  end

  defp object_html(o) do
    aliases =
      if o.aliases == [], do: unknown(), else: o.aliases |> Enum.map(&h/1) |> Enum.join(", ")

    related =
      if o.related == [],
        do: unknown(),
        else:
          Enum.map_join(o.related, "", fn r ->
            "<li><a href=\"/o/#{u(r.key)}\">#{h(r.name)}</a></li>"
          end)

    links =
      if o.external_links == [],
        do: unknown(),
        else:
          Enum.map_join(o.external_links, "", fn l ->
            "<li><a rel=\"noopener noreferrer\" href=\"#{h(l.url)}\">#{h(l.provider || l.label)}</a></li>"
          end)

    """
    <article class="object-page" data-object-key="#{h(o.key)}"><header><p>Cosmic Atlas object record</p><h1>#{h(o.name)}</h1><p>#{aliases}</p></header>#{media(o)}
    <dl><dt>Object type</dt><dd>#{value(o.object_type)}</dd><dt>Constellation</dt><dd>#{value(Map.get(o.facts || %{}, "constellation"))}</dd>
    <dt>Right ascension</dt><dd>#{value(o.astrometry.ra_deg, "°")}</dd><dt>Declination</dt><dd>#{value(o.astrometry.dec_deg, "°")}</dd>
    <dt>Reference frame</dt><dd>#{semantic(o.semantics.reference_frame)}</dd><dt>Distance</dt><dd>#{distance(o.astrometry.distance_ly)}</dd>
    <dt>Distance kind</dt><dd>#{semantic(o.semantics.distance_kind)}</dd><dt>Uncertainty</dt><dd>#{semantic(o.semantics.uncertainty)}</dd>
    <dt>Apparent magnitude</dt><dd>#{value(o.astrometry.apparent_magnitude)}</dd><dt>Catalog source</dt><dd>#{value(o.source_type)}</dd>
    <dt>Catalog epoch</dt><dd>#{semantic(o.semantics.catalog_epoch)}</dd><dt>Position epoch</dt><dd>#{semantic(o.semantics.position_epoch)}</dd>
    <dt>Selection caveat</dt><dd>#{semantic(o.semantics.selection_caveat)}</dd><dt>Cosmology</dt><dd>#{semantic(o.semantics.cosmology)}</dd></dl>
    <section><h2>Provenance</h2><ul>#{links}</ul></section><section><h2>Related objects</h2><ul>#{related}</ul></section></article>
    """
  end

  defp media_url(o) do
    type = if o.object_type in @image_types, do: o.object_type, else: "unknown"
    "/object-types/#{u(type)}"
  end

  defp media(o) do
    requested = Map.get(o.facts || %{}, "image_url")

    source =
      if is_binary(requested) and
           (String.starts_with?(requested, "https://") or String.starts_with?(requested, "/")),
         do: requested,
         else: media_url(o)

    credit =
      Map.get(o.facts || %{}, "image_credit") || "Type illustration; curated media not supplied"

    "<figure><img src=\"#{h(source)}\" alt=\"#{h(o.name)}\"><figcaption>#{h(credit)}</figcaption></figure>"
  end

  defp distance(nil), do: unknown()
  defp distance(ly) when ly <= 0.02, do: "#{h(ly)} ly (#{h(ly * 63_241.077)} AU)"
  defp distance(ly), do: "#{h(ly)} ly"
  defp semantic(:not_supplied), do: unknown()
  defp semantic(value), do: value(value)
  defp value(value, suffix \\ "")
  defp value(nil, _), do: unknown()

  defp value(value, suffix) when is_map(value) or is_list(value),
    do: h(Jason.encode!(value)) <> suffix

  defp value(value, suffix), do: h(to_string(value)) <> suffix
  defp unknown, do: "Not supplied by the source catalog"

  defp h(value),
    do: value |> to_string() |> Plug.HTML.html_escape_to_iodata() |> IO.iodata_to_binary()

  defp u(value), do: URI.encode_www_form(to_string(value))

  defp safe_json(value),
    do:
      value
      |> Jason.encode!()
      |> String.replace("<", "\\u003c")
      |> String.replace(">", "\\u003e")
      |> String.replace("&", "\\u0026")

  defp not_found,
    do:
      "<!doctype html><html><head><title>Object not found — Cosmic Atlas</title></head><body><main><h1>Object not found</h1></main></body></html>"
end

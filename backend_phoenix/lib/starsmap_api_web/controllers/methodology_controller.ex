defmodule StarsmapApiWeb.MethodologyController do
  use StarsmapApiWeb, :controller
  alias StarsmapApiWeb.{MethodologyContent, StaticPage}

  def show(conn, _params) do
    sections = Enum.map_join(MethodologyContent.sections(), &render_section/1)

    html(
      conn,
      StaticPage.document(
        title: "Methodology · Cosmic Atlas",
        description:
          "How Cosmic Atlas projects, samples, and describes astronomical catalog data.",
        canonical: "https://skychart.org/methodology",
        body:
          ~s(<nav aria-label="Site">#{StaticPage.back_link()}<a href="/about">About and data sources</a></nav>) <>
            ~s(<h1>How Cosmic Atlas represents the sky</h1><p class="lead">This page separates measured, inferred, projected, sampled, and unavailable information. Source catalogs remain authoritative for quantitative analysis.</p>) <>
            sections
      )
    )
  end

  defp render_section(section) do
    links =
      Enum.map_join(section.sources, fn {label, url} ->
        ~s(<li><a href="#{escape(url)}">#{escape(label)}</a></li>)
      end)

    ~s(<section class="section"><h2>#{escape(section.title)}</h2><p>#{escape(section.plain)}</p><div class="technical"><strong>Technical detail</strong><p>#{escape(section.technical)}</p></div><h3>Sources</h3><ul class="sources">#{links}</ul></section>)
  end

  defp escape(value) do
    value
    |> String.replace("&", "&amp;")
    |> String.replace("\"", "&quot;")
    |> String.replace("<", "&lt;")
    |> String.replace(">", "&gt;")
  end
end

defmodule StarsmapApiWeb.MethodologyController do
  use StarsmapApiWeb, :controller
  alias StarsmapApiWeb.MethodologyContent

  def show(conn, _params) do
    sections = Enum.map_join(MethodologyContent.sections(), &render_section/1)

    html(conn, """
    <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Methodology · Cosmic Atlas</title><meta name="description" content="How Cosmic Atlas projects, samples, and describes astronomical catalog data.">
    <link rel="canonical" href="https://skychart.org/methodology">
    <style>body{margin:0;background:#080a09;color:#f3eedf;font:16px/1.6 system-ui,sans-serif}main{max-width:820px;margin:auto;padding:48px 24px 80px}a{color:#82cbb3}h1,h2{line-height:1.15}.lead{font-size:1.18rem;max-width:65ch}.section{border-top:1px solid #514c40;padding:28px 0}.technical{background:#151714;border-left:3px solid #d8a23f;padding:14px 18px}.sources{padding-left:20px}.back{display:inline-block;margin-bottom:24px}</style></head>
    <body><main><a class="back" href="/">← Return to the atlas</a><h1>How Cosmic Atlas represents the sky</h1><p class="lead">This page separates measured, inferred, projected, sampled, and unavailable information. Source catalogs remain authoritative for quantitative analysis.</p>#{sections}</main></body></html>
    """)
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

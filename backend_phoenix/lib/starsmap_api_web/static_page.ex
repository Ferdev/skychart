defmodule StarsmapApiWeb.StaticPage do
  @moduledoc """
  One page template for the static pages of the site: About, Guide for AI agents, Methodology,
  the guided tour pages, the community policy pages, and the not-found pages.

  All pages have one layout, one sans-serif font stack, one column width, and one text for the
  link that goes back to the atlas. A page has no script unless the caller gives one in `:head`.
  """

  @back_text "Back to the atlas"
  @font "system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,sans-serif"

  def back_link_text, do: @back_text

  @doc "The link that goes back to the atlas."
  def back_link, do: ~s(<a class="back" href="/">← #{@back_text}</a>)

  @doc """
  Builds a complete HTML document.

  Options: `:title`, `:description`, and `:canonical` are plain text. `:head` and `:body` are
  trusted markup. `:robots` is the content of the robots meta tag, for a page that must not be indexed.
  """
  def document(options) when is_list(options) do
    title = Keyword.fetch!(options, :title)
    description = Keyword.get(options, :description)
    canonical = Keyword.get(options, :canonical)
    robots = Keyword.get(options, :robots)

    """
    <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>#{escape(title)}</title>#{meta_description(description)}#{canonical_link(canonical)}#{robots_meta(robots)}
    <meta property="og:type" content="website"><meta property="og:title" content="#{escape(title)}">#{open_graph(description, canonical)}
    <link rel="icon" href="/favicon.svg">#{Keyword.get(options, :head, "")}<style>#{css()}</style></head><body><main>#{Keyword.fetch!(options, :body)}</main></body></html>
    """
  end

  @doc "The page for an address that has no content. The caller sets the status 404."
  def not_found(heading \\ "Page not found", message \\ "This address has no page.") do
    document(
      title: "#{heading} — Cosmic Atlas",
      robots: "noindex",
      body: """
      <nav aria-label="Site">#{back_link()}<a href="/tours">Guided tours</a><a href="/about">About and data sources</a></nav>
      <p class="eyebrow">Error 404</p><h1>#{escape(heading)}</h1><p class="lede">#{escape(message)}</p>
      <p><a class="action" href="/">Open the atlas</a></p>
      """
    )
  end

  def escape(value),
    do: value |> to_string() |> Plug.HTML.html_escape_to_iodata() |> IO.iodata_to_binary()

  defp meta_description(nil), do: ""

  defp meta_description(description),
    do: ~s(<meta name="description" content="#{escape(description)}">)

  defp canonical_link(nil), do: ""
  defp canonical_link(canonical), do: ~s(<link rel="canonical" href="#{escape(canonical)}">)

  defp robots_meta(nil), do: ""
  defp robots_meta(robots), do: ~s(<meta name="robots" content="#{escape(robots)}">)

  defp open_graph(description, canonical) do
    [
      description && ~s(<meta property="og:description" content="#{escape(description)}">),
      canonical && ~s(<meta property="og:url" content="#{escape(canonical)}">)
    ]
    |> Enum.filter(& &1)
    |> Enum.join()
  end

  @doc "The one style sheet of the static pages."
  def css do
    ":root{color-scheme:dark;background:#080a09;color:#e9eee8;font:16px/1.65 #{@font}}*{box-sizing:border-box}body{margin:0;background:#080a09}" <>
      "main{max-width:860px;margin:auto;padding:3rem 1.5rem 6rem}nav{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;margin-bottom:3rem}" <>
      "a{color:#8fd3bd;text-underline-offset:2px}a:visited{color:#b7b0e0}a:focus-visible{outline:2px solid #efc468;outline-offset:2px}" <>
      ".back{font-weight:700}code{overflow-wrap:anywhere;color:#efc468}.eyebrow{margin:0;color:#82a593;text-transform:uppercase;letter-spacing:.14em;font-size:.75rem;font-weight:700}" <>
      "h1{font:700 clamp(2.1rem,6vw,3.4rem)/1.05 #{@font};margin:.4rem 0 2rem}h2{margin-top:3rem;font:700 1.6rem/1.2 #{@font}}h3{font:700 1.15rem/1.25 #{@font}}" <>
      ".lede,.lead{font-size:1.15rem;color:#dbe4de;max-width:65ch}.ledger{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1px;background:#39443e}" <>
      ".ledger section{background:#101512;padding:1.4rem}.ledger h3{margin-top:0}.caveat{color:#aeb9b2;font-size:.92rem}p,li{color:#c8d0cb}li+li{margin-top:.65rem}" <>
      ".section{border-top:1px solid #39443e;padding:1.75rem 0}.technical{background:#101512;border-left:3px solid #d8a23f;padding:.9rem 1.1rem}.sources{padding-left:1.25rem}" <>
      ".steps{padding-left:1.25rem}.steps li{padding-left:.25rem}.steps p{margin:.2rem 0 0}" <>
      ".action{display:inline-block;padding:.6rem 1rem;border-radius:6px;background:#efc468;color:#17130c;font-weight:700;text-decoration:none}.action:visited{color:#17130c}"
  end
end

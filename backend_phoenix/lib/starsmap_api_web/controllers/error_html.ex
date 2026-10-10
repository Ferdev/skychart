defmodule StarsmapApiWeb.ErrorHTML do
  @moduledoc """
  The endpoint uses this module for errors of HTML requests (see config/config.exs).
  A browser gets a page in the style of the static pages, with a link to the atlas.
  API requests get JSON from `StarsmapApiWeb.ErrorJSON`.
  """
  alias StarsmapApiWeb.StaticPage

  def render("404.html", _assigns), do: StaticPage.not_found()

  def render(template, _assigns) do
    message = Phoenix.Controller.status_message_from_template(template)

    StaticPage.document(
      title: "#{message} — Cosmic Atlas",
      robots: "noindex",
      body: """
      <nav aria-label="Site">#{StaticPage.back_link()}</nav>
      <p class="eyebrow">Error</p><h1>#{StaticPage.escape(message)}</h1>
      <p class="lede">The atlas could not show this page. Try again in a moment.</p>
      """
    )
  end
end

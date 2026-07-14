defmodule StarsmapApiWeb.ServerShell do
  @moduledoc "Canonical server-side document builder for the Vite atlas shell."

  @metadata_keys [
    {"name", "description"},
    {"property", "og:type"},
    {"property", "og:title"},
    {"property", "og:description"},
    {"property", "og:url"},
    {"property", "og:image"},
    {"name", "twitter:card"},
    {"name", "twitter:title"},
    {"name", "twitter:description"},
    {"name", "twitter:image"}
  ]

  def render(options \\ []) when is_list(options) do
    with {:ok, document} <- load_document() do
      {:ok, build_document(document, options)}
    end
  end

  def render!(options \\ []) do
    case render(options) do
      {:ok, document} -> document
      {:error, :not_built} -> build_document(fallback_document(), options)
    end
  end

  defp build_document(document, options) do
    document
    |> replace_title(Keyword.get(options, :title))
    |> replace_metadata(Keyword.get(options, :metadata))
    |> inject_head(Keyword.get(options, :head, ""))
    |> inject_body(Keyword.get(options, :body, ""))
    |> inject_mode(Keyword.get(options, :mode, :atlas))
  end

  defp load_document do
    path = Application.app_dir(:starsmap_api, "priv/static/index.html")
    if File.regular?(path), do: File.read(path), else: {:error, :not_built}
  end

  defp replace_title(document, nil), do: document

  defp replace_title(document, title) do
    String.replace(
      document,
      ~r/<title>.*?<\/title>/s,
      "<title>#{escape(title)}</title>",
      global: false
    )
  end

  defp replace_metadata(document, nil), do: document

  defp replace_metadata(document, metadata) when is_map(metadata) do
    document
    |> strip_metadata()
    |> inject_head(metadata_tags(metadata))
  end

  defp strip_metadata(document) do
    document =
      String.replace(
        document,
        ~r/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>\s*/s,
        "",
        global: true
      )

    Enum.reduce(@metadata_keys, document, fn {attribute, key}, html ->
      String.replace(
        html,
        ~r/<meta\b(?=[^>]*\b#{attribute}=["']#{Regex.escape(key)}["'])[^>]*>\s*/s,
        "",
        global: true
      )
    end)
  end

  defp metadata_tags(metadata) do
    title = Map.fetch!(metadata, :title)
    description = Map.fetch!(metadata, :description)
    canonical = Map.fetch!(metadata, :canonical)
    image = Map.get(metadata, :image)

    [
      ~s(<link rel="canonical" href="#{escape(canonical)}">),
      ~s(<meta name="description" content="#{escape(description)}">),
      ~s(<meta property="og:type" content="#{escape(Map.get(metadata, :type, "website"))}">),
      ~s(<meta property="og:title" content="#{escape(title)}">),
      ~s(<meta property="og:description" content="#{escape(description)}">),
      ~s(<meta property="og:url" content="#{escape(canonical)}">),
      optional_meta("property", "og:image", image),
      optional_meta("name", "twitter:card", image && "summary_large_image"),
      optional_meta("name", "twitter:title", image && title),
      optional_meta("name", "twitter:description", image && description),
      optional_meta("name", "twitter:image", image)
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n")
  end

  defp optional_meta(_attribute, _key, nil), do: nil

  defp optional_meta(attribute, key, content),
    do: ~s(<meta #{attribute}="#{key}" content="#{escape(content)}">)

  defp inject_head(document, ""), do: document

  defp inject_head(document, content) do
    inject_before(document, "</head>", "#{content}\n")
  end

  defp inject_body(document, ""), do: document

  defp inject_body(document, content) do
    Regex.replace(
      ~r/<main id="app"[^>]*>/,
      document,
      fn opening_tag -> opening_tag <> content end,
      global: false
    )
  end

  defp inject_mode(document, :atlas), do: document

  defp inject_mode(document, :embed) do
    inject_head(document, ~s(<meta name="cosmic-atlas-boot-mode" content="embed">))
  end

  defp inject_before(document, marker, content) do
    if String.contains?(document, marker),
      do: String.replace(document, marker, content <> marker, global: false),
      else: content <> document
  end

  defp escape(value),
    do: value |> to_string() |> Plug.HTML.html_escape_to_iodata() |> IO.iodata_to_binary()

  defp fallback_document,
    do:
      "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Cosmic Atlas</title></head><body><main id=\"app\"></main></body></html>"
end

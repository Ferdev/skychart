defmodule StarsmapApiWeb.AssetResolver do
  @manifest "priv/static/.vite/manifest.json"
  def entry(name \\ "index.html") do
    with {:ok, body} <- File.read(Application.app_dir(:starsmap_api, @manifest)),
         {:ok, manifest} <- Jason.decode(body),
         %{"file" => file} = entry <- Map.get(manifest, name) do
      %{script: "/" <> file, css: Enum.map(entry["css"] || [], &("/" <> &1))}
    else
      _ -> %{script: "/src/main.ts", css: []}
    end
  end
end

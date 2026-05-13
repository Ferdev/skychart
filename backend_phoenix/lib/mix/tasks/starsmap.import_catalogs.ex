defmodule Mix.Tasks.Starsmap.ImportCatalogs do
  @moduledoc "Imports generated Starsmap catalog snapshots into Postgres."
  @shortdoc "Imports generated Starsmap catalog snapshots"

  use Mix.Task

  @impl Mix.Task
  def run(args) do
    Mix.Task.run("app.start")

    root_path =
      case args do
        [path | _rest] -> Path.expand(path)
        [] -> Path.expand("..", File.cwd!())
      end

    result = StarsmapApi.Catalog.Importer.import!(root_path)

    Mix.shell().info("Imported #{result.imported_count}/#{result.source_count} catalog objects")

    result.groups
    |> Enum.sort()
    |> Enum.each(fn {group, count} ->
      Mix.shell().info("  #{group}: #{count}")
    end)
  end
end

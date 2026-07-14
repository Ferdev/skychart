defmodule Mix.Tasks.Starsmap.ImportCatalogs do
  @moduledoc "Imports generated Starsmap catalog snapshots into Postgres."
  @shortdoc "Imports generated Starsmap catalog snapshots"

  use Mix.Task

  @impl Mix.Task
  def run(args) do
    Mix.Task.run("app.start")

    {opts, positional, _invalid} =
      OptionParser.parse(args,
        strict: [report: :string],
        aliases: [r: :report]
      )

    root_path =
      case positional do
        [path | _rest] -> Path.expand(path)
        [] -> Path.expand("..", File.cwd!())
      end

    report_path = report_path(opts[:report] || System.get_env("CATALOG_IMPORT_REPORT_PATH"))
    result = StarsmapApi.Catalog.Importer.import!(root_path, report_path: report_path)

    Mix.shell().info("Imported #{result.imported_count}/#{result.source_count} catalog objects")

    result.groups
    |> Enum.sort()
    |> Enum.each(fn {group, count} ->
      Mix.shell().info("  #{group}: #{count}")
    end)

    if report_path do
      Mix.shell().info("Wrote catalog import report: #{report_path}")
    end
  end

  defp report_path(nil), do: nil

  defp report_path(path) do
    path = String.trim(path)
    if path == "", do: nil, else: path
  end
end

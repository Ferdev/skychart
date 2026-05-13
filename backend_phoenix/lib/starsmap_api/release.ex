defmodule StarsmapApi.Release do
  @moduledoc false

  @app :starsmap_api

  def migrate do
    load_app()

    for repo <- repos() do
      {:ok, _fun_return, _apps} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end
  end

  def import_catalogs(args \\ []) do
    load_app()

    {:ok, _started} = Application.ensure_all_started(@app)

    root_path =
      case args do
        [path | _rest] -> Path.expand(path)
        [] -> Path.expand("..", File.cwd!())
      end

    result = StarsmapApi.Catalog.Importer.import!(root_path)

    IO.puts("Imported #{result.imported_count}/#{result.source_count} catalog objects")

    result.groups
    |> Enum.sort()
    |> Enum.each(fn {group, count} -> IO.puts("  #{group}: #{count}") end)
  end

  defp repos do
    Application.fetch_env!(@app, :ecto_repos)
  end

  defp load_app do
    Application.load(@app)
  end
end

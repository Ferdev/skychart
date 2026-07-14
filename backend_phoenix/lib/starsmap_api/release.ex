defmodule StarsmapApi.Release do
  @moduledoc false

  @app :starsmap_api

  def migrate do
    load_app()

    for repo <- repos() do
      {:ok, _fun_return, _apps} =
        Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end
  end

  def import_catalogs(args \\ []) do
    load_app()

    root_path =
      case args do
        [path | _rest] -> Path.expand(path)
        [] -> Path.expand("..", File.cwd!())
      end

    result =
      with_repo(fn ->
        StarsmapApi.Catalog.Importer.import!(root_path,
          report_path: report_path(System.get_env("CATALOG_IMPORT_REPORT_PATH"))
        )
      end)

    IO.puts("Imported #{result.imported_count}/#{result.source_count} catalog objects")

    result.groups
    |> Enum.sort()
    |> Enum.each(fn {group, count} -> IO.puts("  #{group}: #{count}") end)

    if report_path = report_path(System.get_env("CATALOG_IMPORT_REPORT_PATH")) do
      IO.puts("Wrote catalog import report: #{report_path}")
    end
  end

  def refresh_catalog_summary_counts do
    load_app()

    with_repo(fn ->
      :ok = StarsmapApi.Catalog.refresh_summary_counts!()
    end)

    IO.puts("Refreshed catalog summary counts")
  end

  defp with_repo(fun) do
    [repo | _rest] = repos()
    {:ok, result, _apps} = Ecto.Migrator.with_repo(repo, fn _repo -> fun.() end)
    result
  end

  defp repos do
    Application.fetch_env!(@app, :ecto_repos)
  end

  defp load_app do
    Application.load(@app)
  end

  defp report_path(nil), do: nil

  defp report_path(path) do
    path = String.trim(path)
    if path == "", do: nil, else: path
  end
end

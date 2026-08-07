defmodule StarsmapApi.Catalog.Search do
  @moduledoc "Ranked catalog search with a bounded interactive-query path."

  import Ecto.Query

  require Logger

  alias StarsmapApi.Catalog.CatalogSourceObject
  alias StarsmapApi.Catalog.PublicObjects
  alias StarsmapApi.Repo

  @default_limit 80
  @max_limit 500
  @search_timeout 5_000
  @fallback_search_timeout 15_000

  def search(params) do
    limit = bounded_integer(params["limit"], @default_limit, 1, @max_limit)
    offset = bounded_integer(params["offset"], 0, 0, 10_000_000)
    query_text = string_param(params["q"])
    groups = csv_param(params["groups"])
    types = csv_param(params["types"])

    if short_interactive_query?(query_text) do
      %{
        query: query_text,
        groups: groups,
        types: types,
        offset: offset,
        limit: limit,
        total: 0,
        has_more: false,
        objects: []
      }
    else
      search_source_objects(query_text, groups, types, offset, limit)
    end
  end

  defp search_source_objects(query_text, groups, types, offset, limit) do
    base_query =
      CatalogSourceObject
      |> maybe_filter_groups(groups)
      |> maybe_filter_types(types)
      |> maybe_filter_query(query_text)

    # Ranked ordering computes two ILIKE fragments per candidate row. Queries
    # that match nearly a whole survey-scale table (for example "3erass")
    # cannot finish that work inside the interactive timeout, so a timeout
    # falls back to the cheaper magnitude/name ordering instead of a 500.
    objects =
      try do
        base_query
        |> order_for_search(query_text)
        |> limit(^(limit + 1))
        |> offset(^offset)
        |> Repo.all(timeout: search_timeout())
      rescue
        e in [DBConnection.ConnectionError, DBConnection.OwnershipError] ->
          Logger.warning(
            "ranked catalog search timed out, retrying with magnitude ordering: #{Exception.message(e)}"
          )

          base_query
          |> order_for_search("")
          |> limit(^(limit + 1))
          |> offset(^offset)
          |> Repo.all(timeout: @fallback_search_timeout)
      end

    has_more = length(objects) > limit
    visible_objects = Enum.take(objects, limit)

    %{
      query: query_text,
      groups: groups,
      types: types,
      offset: offset,
      limit: limit,
      total: offset + length(visible_objects) + if(has_more, do: 1, else: 0),
      has_more: has_more,
      objects: Enum.map(visible_objects, &PublicObjects.catalog_object_payload/1)
    }
  end

  defp short_interactive_query?(""), do: false
  defp short_interactive_query?(query_text), do: String.length(query_text) < 3

  defp search_timeout,
    do: Application.get_env(:starsmap_api, :catalog_search_timeout_ms, @search_timeout)

  defp maybe_filter_groups(query, []), do: query

  defp maybe_filter_groups(query, groups) do
    where(query, [object], object.catalog_group in ^groups)
  end

  defp maybe_filter_types(query, []), do: query

  defp maybe_filter_types(query, types) do
    where(query, [object], object.object_type in ^types)
  end

  defp maybe_filter_query(query, ""), do: query

  defp maybe_filter_query(query, query_text) do
    like = "%#{escape_like(query_text)}%"

    where(query, [object], ilike(object.search_text, ^like))
  end

  defp order_for_search(query, "") do
    order_by(query, [object],
      asc_nulls_last: object.apparent_magnitude,
      desc_nulls_last: object.radius_km,
      asc: object.name
    )
  end

  defp order_for_search(query, query_text) do
    prefix = "#{escape_like(query_text)}%"

    order_by(
      query,
      [object],
      desc: fragment("? ILIKE ?", object.name, ^prefix),
      desc: fragment("? ILIKE ?", object.key, ^prefix),
      asc_nulls_last: object.apparent_magnitude,
      desc_nulls_last: object.radius_km,
      asc: object.name
    )
  end

  defp bounded_integer(value, default, minimum, maximum) when is_binary(value) do
    case Integer.parse(value) do
      {number, ""} -> min(max(number, minimum), maximum)
      _ -> default
    end
  end

  defp bounded_integer(_value, default, _minimum, _maximum), do: default

  defp csv_param(nil), do: []

  defp csv_param(value) when is_binary(value) do
    value
    |> String.split(",", trim: true)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp string_param(nil), do: ""
  defp string_param(value) when is_binary(value), do: String.trim(value)

  defp escape_like(value) do
    value
    |> String.trim()
    |> String.replace("\\", "\\\\")
    |> String.replace("%", "\\%")
    |> String.replace("_", "\\_")
  end
end

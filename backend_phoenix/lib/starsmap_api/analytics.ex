defmodule StarsmapApi.Analytics do
  alias StarsmapApi.Analytics.Event
  alias StarsmapApi.Repo

  @event_names ~w(page_view search object compare share embed_loaded image_export tour_started tour_completed methodology citation_copied filter data_export cross_tool)
  @property_keys ~w(query_length object_type source filter format tour tool method resolution_tier)
  def event_names, do: @event_names
  def record(params, remote_ip, now \\ DateTime.utc_now())

  def record(params, remote_ip, now) when is_map(params) do
    if Application.get_env(:starsmap_api, :analytics_enabled, true) do
      with true <- Map.keys(params) |> Enum.all?(&(&1 in ~w(name path referrer properties))),
           name when name in @event_names <- params["name"],
           {:ok, path} <- minimize_path(params["path"]),
           {:ok, referrer_host} <- minimize_referrer(params["referrer"]),
           {:ok, properties} <- validate_properties(params["properties"] || %{}) do
        %Event{}
        |> Event.changeset(%{
          event_name: name,
          path: path,
          anonymous_id: anonymous_id(remote_ip, now),
          referrer_host: referrer_host,
          properties: properties
        })
        |> Repo.insert()
      else
        _ -> {:error, :invalid_event}
      end
    else
      {:ok, :disabled}
    end
  end

  def record(_, _, _), do: {:error, :invalid_event}

  defp minimize_path(path) when is_binary(path) and byte_size(path) <= 300 do
    clean = URI.parse(path).path || "/"
    if String.starts_with?(clean, "/") and byte_size(clean) <= 160, do: {:ok, clean}, else: :error
  end

  defp minimize_path(_), do: :error
  defp minimize_referrer(nil), do: {:ok, nil}

  defp minimize_referrer(value) when is_binary(value) and byte_size(value) <= 300 do
    host = URI.parse(value).host || value

    if Regex.match?(~r/^[a-zA-Z0-9.-]{1,120}$/, host),
      do: {:ok, String.downcase(host)},
      else: :error
  end

  defp minimize_referrer(_), do: :error

  defp validate_properties(properties) when is_map(properties) and map_size(properties) <= 6 do
    if Enum.all?(properties, fn {key, value} ->
         key in @property_keys and is_binary(value) and byte_size(value) <= 80
       end),
       do: {:ok, properties},
       else: :error
  end

  defp validate_properties(_), do: :error

  defp anonymous_id(remote_ip, now) do
    salt =
      Application.get_env(:starsmap_api, :analytics_hash_salt, "development-only-analytics-salt")

    payload =
      Date.to_iso8601(DateTime.to_date(now)) <>
        ":" <> to_string(:inet.ntoa(remote_ip || {0, 0, 0, 0}))

    :crypto.mac(:hmac, :sha256, salt, payload) |> Base.encode16(case: :lower)
  end
end

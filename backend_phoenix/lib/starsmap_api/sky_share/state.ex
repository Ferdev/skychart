defmodule StarsmapApi.SkyShare.State do
  @moduledoc "Validated, canonical state contract for public Sky permalinks and cards."

  @version 1
  @version_string Integer.to_string(@version)
  @renderer_version 1
  @object_types ~w(star planet moon dwarf_planet asteroid comet small_body galaxy quasar active_galaxy black_hole pulsar nebula star_cluster xray_source xray_extended asterism milky_way_patch unknown)
  @locales ~w(en es fr de pt-BR it zh-Hans ja ko)

  defstruct observer_key: nil,
            epoch_utc: nil,
            yaw_deg: 0.0,
            pitch_deg: 0.0,
            fov_deg: 72.0,
            constellations: true,
            hidden_object_types: [],
            catalog_release: nil,
            locale: "en"

  def version, do: @version
  def renderer_version, do: @renderer_version
  def object_types, do: @object_types
  def locales, do: @locales

  def parse(observer_key, params, now \\ DateTime.utc_now())

  def parse(observer_key, params, now) when is_map(params) do
    with {:ok, key} <- observer_key(observer_key),
         :ok <- version(params["v"]),
         {:ok, epoch} <- epoch(params["t"], now),
         {:ok, {yaw, pitch, fov}} <- camera(params["sc"]),
         {:ok, constellations} <- constellations(params["sl"]),
         {:ok, hidden} <- hidden_types(params["sf"]),
         {:ok, release} <- catalog_release(params["r"]) do
      {:ok,
       %__MODULE__{
         observer_key: key,
         epoch_utc: epoch,
         yaw_deg: yaw,
         pitch_deg: pitch,
         fov_deg: fov,
         constellations: constellations,
         hidden_object_types: hidden,
         catalog_release: release,
         locale: locale(params["lang"])
       }}
    end
  end

  def parse(_, _, _), do: {:error, :invalid_state}

  def permalink_path(%__MODULE__{} = state),
    do: "/sky/#{URI.encode_www_form(state.observer_key)}?#{query(state)}"

  def card_path(%__MODULE__{} = state),
    do: "/sky/#{URI.encode_www_form(state.observer_key)}/card.png?#{query(state)}"

  def canonical_path(%__MODULE__{} = state),
    do: "/sky/#{URI.encode_www_form(state.observer_key)}"

  def query(%__MODULE__{} = state) do
    [
      {"v", Integer.to_string(@version)},
      {"t", DateTime.to_iso8601(state.epoch_utc)},
      {"sc", Enum.map_join([state.yaw_deg, state.pitch_deg, state.fov_deg], ",", &number/1)},
      if(state.constellations, do: nil, else: {"sl", "0"}),
      if(state.hidden_object_types == [],
        do: nil,
        else: {"sf", Enum.join(state.hidden_object_types, ",")}
      ),
      if(state.catalog_release, do: {"r", state.catalog_release}, else: nil),
      {"lang", state.locale}
    ]
    |> Enum.reject(&is_nil/1)
    |> URI.encode_query(:rfc3986)
  end

  def cache_contract(%__MODULE__{} = state) do
    %{
      state: query(state),
      observer_key: state.observer_key,
      renderer_version: @renderer_version
    }
  end

  defp observer_key(value) when is_binary(value) do
    normalized = value |> String.trim() |> String.downcase()

    if Regex.match?(~r/^[a-z0-9][a-z0-9:._-]{0,179}$/, normalized),
      do: {:ok, normalized},
      else: {:error, :invalid_observer}
  end

  defp observer_key(_), do: {:error, :invalid_observer}

  defp version(nil), do: :ok
  defp version(@version_string), do: :ok
  defp version(_), do: {:error, :unsupported_version}

  defp epoch(nil, %DateTime{} = now), do: {:ok, canonical_epoch(now)}
  defp epoch("now", _now), do: {:error, :live_time_not_shareable}

  defp epoch(value, _now) when is_binary(value) and byte_size(value) <= 64 do
    case DateTime.from_iso8601(value) do
      {:ok, parsed, _offset} ->
        {:ok, parsed |> DateTime.shift_zone!("Etc/UTC") |> canonical_epoch()}

      _ ->
        {:error, :invalid_epoch}
    end
  end

  defp epoch(_, _), do: {:error, :invalid_epoch}

  defp camera(nil), do: {:ok, {0.0, 0.0, 72.0}}

  defp camera(value) when is_binary(value) and byte_size(value) <= 80 do
    with [raw_yaw, raw_pitch, raw_fov] <- String.split(value, ","),
         {:ok, yaw} <- finite_float(raw_yaw),
         {:ok, pitch} <- finite_float(raw_pitch),
         {:ok, fov} <- finite_float(raw_fov),
         true <- pitch >= -89.5 and pitch <= 89.5,
         true <- fov >= 20.0 and fov <= 110.0 do
      {:ok,
       {yaw |> normalize_degrees() |> quantize() |> normalize_degrees(), quantize(pitch),
        quantize(fov)}}
    else
      _ -> {:error, :invalid_camera}
    end
  end

  defp camera(_), do: {:error, :invalid_camera}

  defp constellations(nil), do: {:ok, true}
  defp constellations("1"), do: {:ok, true}
  defp constellations("0"), do: {:ok, false}
  defp constellations(_), do: {:error, :invalid_layers}

  defp hidden_types(nil), do: {:ok, []}
  defp hidden_types(""), do: {:ok, []}

  defp hidden_types(value) when is_binary(value) and byte_size(value) <= 512 do
    types = value |> String.split(",") |> Enum.map(&String.downcase(String.trim(&1)))

    if length(types) <= length(@object_types) and Enum.all?(types, &(&1 in @object_types)),
      do: {:ok, types |> Enum.uniq() |> Enum.sort()},
      else: {:error, :invalid_filters}
  end

  defp hidden_types(_), do: {:error, :invalid_filters}

  defp catalog_release(nil), do: {:ok, nil}
  defp catalog_release(""), do: {:ok, nil}

  defp catalog_release(value) when is_binary(value) and byte_size(value) <= 80 do
    if Regex.match?(~r/^[A-Za-z0-9._-]{1,80}$/, value),
      do: {:ok, value},
      else: {:error, :invalid_catalog_release}
  end

  defp catalog_release(_), do: {:error, :invalid_catalog_release}

  defp locale(value) when is_binary(value) do
    Enum.find(@locales, "en", &(String.downcase(&1) == String.downcase(String.trim(value))))
  end

  defp locale(_), do: "en"

  defp finite_float(value) do
    case Float.parse(String.trim(value)) do
      {parsed, ""} when parsed == parsed and abs(parsed) < 1.0e300 -> {:ok, parsed}
      _ -> {:error, :invalid_float}
    end
  end

  defp normalize_degrees(value) do
    normalized = value - Float.floor(value / 360.0) * 360.0
    if normalized >= 360.0, do: 0.0, else: normalized
  end

  defp quantize(value) do
    rounded = Float.round(value, 1)
    if rounded == -0.0, do: 0.0, else: rounded
  end

  defp canonical_epoch(%DateTime{microsecond: {microseconds, _precision}} = value) do
    %{value | microsecond: {div(microseconds, 1_000) * 1_000, 3}}
  end

  defp number(value) do
    if value == trunc(value),
      do: Integer.to_string(trunc(value)),
      else: :erlang.float_to_binary(value, decimals: 1)
  end
end

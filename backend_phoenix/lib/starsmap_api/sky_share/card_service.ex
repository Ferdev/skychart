defmodule StarsmapApi.SkyShare.CardService do
  @moduledoc false

  alias StarsmapApi.SkyShare.{CardCache, CardRenderer, Scene, State}

  @cache_ttl_ms :timer.hours(6)

  def etag(%State{} = state, observer) do
    payload = %{
      contract: State.cache_contract(state),
      observer: %{
        key: observer.key,
        name: observer.name,
        object_type: observer.object_type,
        position: observer.position,
        distance_from_earth_km: observer.distance_from_earth_km
      }
    }

    digest = :crypto.hash(:sha256, Jason.encode!(payload)) |> Base.url_encode64(padding: false)
    ~s("#{digest}")
  end

  def render(%State{} = state, observer, ephemeris_bodies) do
    etag = etag(state, observer)
    key = {:sky_share_card, etag}

    case CardCache.get(key) do
      {:ok, png} ->
        {:ok, png, etag, :hit}

      :error ->
        points = Scene.build(state, observer, ephemeris_bodies)
        png = safe_render(state, observer, points)
        CardCache.put(key, png, @cache_ttl_ms)
        {:ok, png, etag, :miss}
    end
  end

  defp safe_render(state, observer, points) do
    CardRenderer.render(state, observer, points, fallback: points == [])
  rescue
    _ -> CardRenderer.render(state, observer, [], fallback: true)
  end
end

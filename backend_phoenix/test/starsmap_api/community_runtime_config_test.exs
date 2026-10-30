defmodule StarsmapApi.CommunityRuntimeConfigTest do
  use ExUnit.Case, async: false

  @runtime Path.expand("../../config/runtime.exs", __DIR__)
  @settings %{
    "COMMUNITY_ENABLED" => "true",
    "COMMUNITY_DATABASE_URL" => "postgresql://localhost/community_runtime_config",
    "COMMUNITY_SECRET" => String.duplicate("s", 32)
  }

  setup do
    names = ["COMMUNITY_POOL_SIZE" | Map.keys(@settings)]
    saved = Map.new(names, &{&1, System.get_env(&1)})
    System.put_env(@settings)
    System.delete_env("COMMUNITY_POOL_SIZE")

    on_exit(fn ->
      Enum.each(saved, fn
        {name, nil} -> System.delete_env(name)
        {name, value} -> System.put_env(name, value)
      end)
    end)
  end

  defp pool_size do
    config = Config.Reader.read!(@runtime, env: :dev)
    config[:starsmap_api][StarsmapApi.CommunityRepo][:pool_size]
  end

  test "the community pool size is 3 when COMMUNITY_POOL_SIZE is not set" do
    assert pool_size() == 3
  end

  test "COMMUNITY_POOL_SIZE sets the community pool size" do
    System.put_env("COMMUNITY_POOL_SIZE", "5")
    assert pool_size() == 5
  end
end

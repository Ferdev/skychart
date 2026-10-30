defmodule StarsmapApi.CommunityRuntimeConfigTest do
  # Reads config/runtime.exs as a release does at boot. It changes the OS environment.
  use ExUnit.Case, async: false

  @runtime Path.expand("../../config/runtime.exs", __DIR__)

  @settings %{
    "DATABASE_URL" => "ecto://user:pass@catalog/catalog",
    "SECRET_KEY_BASE" => String.duplicate("k", 64),
    "ANALYTICS_HASH_SALT" => "salt",
    "PHX_HOST" => "atlas.example.com",
    "COMMUNITY_ENABLED" => "true",
    "COMMUNITY_DATABASE_URL" => "ecto://user:pass@community/community",
    "COMMUNITY_SECRET" => String.duplicate("s", 32),
    "COMMUNITY_ORIGIN" => "https://origin.example.com",
    "COMMUNITY_STORAGE" => "s3",
    "COMMUNITY_S3_BUCKET" => "bucket",
    "COMMUNITY_S3_ACCESS_KEY_ID" => "key",
    "COMMUNITY_S3_SECRET_ACCESS_KEY" => "secret",
    "COMMUNITY_S3_ENDPOINT" => "https://s3.example.com",
    "COMMUNITY_S3_REGION" => "eu-west-1",
    "COMMUNITY_MAIL_URL" => "https://mail.example.com",
    "COMMUNITY_MAIL_TOKEN" => "token",
    "COMMUNITY_MAIL_FROM" => "atlas@example.com",
    "COMMUNITY_MEDIA_URL" => "https://media.example.com",
    "COMMUNITY_BACKUP_URI" => "s3://backups",
    "COMMUNITY_PGSOCKET_DIR" => "/run/postgresql",
    "COMMUNITY_MEDIA_ROOT" => "/var/lib/community",
    "COMMUNITY_WORKER" => "true"
  }

  @required ~w(
    COMMUNITY_DATABASE_URL COMMUNITY_SECRET COMMUNITY_S3_BUCKET COMMUNITY_S3_ACCESS_KEY_ID
    COMMUNITY_S3_SECRET_ACCESS_KEY COMMUNITY_MAIL_URL COMMUNITY_MAIL_TOKEN COMMUNITY_MAIL_FROM
    COMMUNITY_MEDIA_URL
  )

  setup do
    names = ["COMMUNITY_POOL_SIZE" | Map.keys(@settings)]
    previous = Map.new(names, &{&1, System.get_env(&1)})
    System.put_env(@settings)
    System.delete_env("COMMUNITY_POOL_SIZE")

    on_exit(fn ->
      Enum.each(previous, fn
        {name, nil} -> System.delete_env(name)
        {name, value} -> System.put_env(name, value)
      end)
    end)
  end

  defp read(env \\ :prod), do: Config.Reader.read!(@runtime, env: env)

  test "complete production settings are accepted" do
    config = read()

    assert config[:starsmap_api][:community_mail_token] == "token"
    assert config[:ex_aws][:region] == "eu-west-1"
    assert config[:ex_aws][:s3][:host] == "s3.example.com"
    assert {"0 2 * * *", StarsmapApi.Community.BackupWorker} in cron(config)
  end

  for name <- @required, value <- ["", "   "] do
    test "#{name} set to #{inspect(value)} stops the boot with its name" do
      System.put_env(unquote(name), unquote(value))

      assert_raise RuntimeError, ~r/#{unquote(name)} is missing or blank/, fn -> read() end
    end
  end

  for name <- @required do
    test "#{name} not set stops the boot with its name" do
      System.delete_env(unquote(name))

      assert_raise RuntimeError, ~r/#{unquote(name)} is missing or blank/, fn -> read() end
    end
  end

  test "the community pool size is 3 when COMMUNITY_POOL_SIZE is not set" do
    assert read()[:starsmap_api][StarsmapApi.CommunityRepo][:pool_size] == 3
  end

  test "COMMUNITY_POOL_SIZE sets the community pool size" do
    System.put_env("COMMUNITY_POOL_SIZE", "5")

    assert read()[:starsmap_api][StarsmapApi.CommunityRepo][:pool_size] == 5
  end

  test "a blank optional setting is treated as not set" do
    for name <-
          ~w(COMMUNITY_S3_ENDPOINT COMMUNITY_S3_REGION COMMUNITY_ORIGIN COMMUNITY_POOL_SIZE) ++
            ~w(COMMUNITY_BACKUP_URI COMMUNITY_PGSOCKET_DIR COMMUNITY_MEDIA_ROOT),
        do: System.put_env(name, " ")

    config = read()

    refute Keyword.has_key?(config[:ex_aws], :s3)
    assert config[:ex_aws][:region] == "us-east-1"
    assert config[:starsmap_api][:community_origin] == "https://atlas.example.com"
    assert config[:starsmap_api][:community_media_root] == "/tmp/cosmic-atlas-community"
    refute Keyword.has_key?(config[:starsmap_api][StarsmapApi.CommunityRepo], :socket_dir)
    assert config[:starsmap_api][StarsmapApi.CommunityRepo][:pool_size] == 3

    refute {"0 2 * * *", StarsmapApi.Community.BackupWorker} in cron(config)
  end

  test "outside production a blank mail setting is nil, not an empty value" do
    System.put_env("COMMUNITY_MAIL_TOKEN", "")
    System.put_env("COMMUNITY_MEDIA_URL", "")

    config = read(:dev)

    assert config[:starsmap_api][:community_mail_token] == nil
    assert config[:starsmap_api][:community_media_url] == "/api/community/media"
  end

  defp cron(config) do
    config[:starsmap_api][StarsmapApi.CommunityJobs][:plugins]
    |> Keyword.fetch!(Oban.Plugins.Cron)
    |> Keyword.fetch!(:crontab)
  end
end

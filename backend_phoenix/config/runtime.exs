import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# ## Using releases
#
# If you use `mix release`, you need to explicitly enable the server
# by passing the PHX_SERVER=true when you start it:
#
#     PHX_SERVER=true bin/starsmap_api start
#
# Alternatively, you can use `mix phx.gen.release` to generate a `bin/server`
# script that automatically sets the env var above.
if System.get_env("PHX_SERVER") do
  config :starsmap_api, StarsmapApiWeb.Endpoint, server: true
end

config :starsmap_api,
  python_backend_url: System.get_env("PYTHON_BACKEND_URL") || "http://127.0.0.1:8765",
  trusted_proxy_cidrs:
    (System.get_env("TRUSTED_PROXY_CIDRS") || "127.0.0.0/8,::1/128")
    |> String.split(",", trim: true)
    |> Enum.map(&String.trim/1),
  analytics_hash_salt: System.get_env("ANALYTICS_HASH_SALT") || "development-only-analytics-salt",
  analytics_enabled: System.get_env("ANALYTICS_ENABLED", "true") not in ~w(false 0),
  sky_events_refresh_enabled:
    config_env() != :test and
      System.get_env("SKY_EVENTS_REFRESH_ENABLED", "true") not in ~w(false 0)

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
      For example: ecto://USER:PASS@HOST/DATABASE
      """

  maybe_ipv6 = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []

  config :starsmap_api, StarsmapApi.Repo,
    # ssl: true,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    # For machines with several cores, consider starting multiple pools of `pool_size`
    # pool_count: 4,
    socket_options: maybe_ipv6

  # The secret key base is used to sign/encrypt cookies and other secrets.
  # A default value is used in config/dev.exs and config/test.exs but you
  # want to use a different value for prod and you most likely don't want
  # to check this value into version control, so we use an environment
  # variable instead.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"
  port = String.to_integer(System.get_env("PORT") || "4000")

  config :starsmap_api, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  sentry_dsn = System.get_env("SENTRY_DSN")
  sentry_dsn = if is_binary(sentry_dsn) and sentry_dsn != "", do: sentry_dsn, else: nil

  config :sentry,
    dsn: sentry_dsn,
    enable_source_code_context: true,
    root_source_code_paths: [File.cwd!()]

  if System.get_env("ANALYTICS_HASH_SALT") in [nil, ""],
    do: raise("ANALYTICS_HASH_SALT must be configured in production")

  config :starsmap_api, StarsmapApiWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [
      # Enable IPv6 and bind on all interfaces.
      # Set it to  {0, 0, 0, 0, 0, 0, 0, 1} for local network only access.
      # See the documentation on https://hexdocs.pm/bandit/Bandit.html#t:options/0
      # for details about using IPv6 vs IPv4 and loopback vs public addresses.
      ip: {0, 0, 0, 0, 0, 0, 0, 0},
      port: port
    ],
    secret_key_base: secret_key_base

  # ## SSL Support
  #
  # To get SSL working, you will need to add the `https` key
  # to your endpoint configuration:
  #
  #     config :starsmap_api, StarsmapApiWeb.Endpoint,
  #       https: [
  #         ...,
  #         port: 443,
  #         cipher_suite: :strong,
  #         keyfile: System.get_env("SOME_APP_SSL_KEY_PATH"),
  #         certfile: System.get_env("SOME_APP_SSL_CERT_PATH")
  #       ]
  #
  # The `cipher_suite` is set to `:strong` to support only the
  # latest and more secure SSL ciphers. This means old browsers
  # and clients may not be supported. You can set it to
  # `:compatible` for wider support.
  #
  # `:keyfile` and `:certfile` expect an absolute path to the key
  # and cert in disk or a relative path inside priv, for example
  # "priv/ssl/server.key". For all supported SSL configuration
  # options, see https://hexdocs.pm/plug/Plug.SSL.html#configure/1
  #
  # We also recommend setting `force_ssl` in your config/prod.exs,
  # ensuring no data is ever sent via http, always redirecting to https:
  #
  #     config :starsmap_api, StarsmapApiWeb.Endpoint,
  #       force_ssl: [hsts: true]
  #
  # Check `Plug.SSL` for all available options in `force_ssl`.
end

if config_env() != :test do
  community_enabled = System.get_env("COMMUNITY_ENABLED") == "true"
  config :starsmap_api, :community_enabled, community_enabled

  if community_enabled do
    database = System.fetch_env!("COMMUNITY_DATABASE_URL")

    catalog_uri = URI.parse(System.get_env("DATABASE_URL") || "")
    community_uri = URI.parse(database)

    if database == System.get_env("DATABASE_URL") or
         (community_uri.path == catalog_uri.path and community_uri.host == catalog_uri.host and
            (community_uri.port || 5432) == (catalog_uri.port || 5432)),
       do: raise("Community data requires a separate database")

    repo_options = [url: database, pool_size: 3]

    repo_options =
      if socket = System.get_env("COMMUNITY_PGSOCKET_DIR"),
        do: Keyword.put(repo_options, :socket_dir, socket),
        else: repo_options

    config :starsmap_api, StarsmapApi.CommunityRepo, repo_options
    origin = System.get_env("COMMUNITY_ORIGIN") || "https://#{System.get_env("PHX_HOST")}"
    uri = URI.parse(origin)

    if uri.scheme not in ["http", "https"] or is_nil(uri.host) or uri.path not in [nil, ""] or
         not is_nil(uri.query),
       do: raise("COMMUNITY_ORIGIN must be an exact origin without a path")

    if config_env() == :prod and uri.scheme != "https",
      do: raise("Production community requires an HTTPS origin")

    secret = System.fetch_env!("COMMUNITY_SECRET")
    if byte_size(secret) < 32, do: raise("COMMUNITY_SECRET requires at least 32 bytes")

    config :starsmap_api,
      community_origin: origin,
      community_cookie_secure: config_env() == :prod,
      community_secret: secret,
      community_media_root:
        System.get_env("COMMUNITY_MEDIA_ROOT") || "/tmp/cosmic-atlas-community",
      community_media_url: System.get_env("COMMUNITY_MEDIA_URL") || "/api/community/media",
      community_storage:
        if(System.get_env("COMMUNITY_STORAGE") == "s3",
          do: StarsmapApi.Community.Storage.S3,
          else: StarsmapApi.Community.Storage.Local
        ),
      community_s3_bucket: System.get_env("COMMUNITY_S3_BUCKET"),
      community_mailer: StarsmapApi.Community.Mailer.Webhook,
      community_mail_url: System.get_env("COMMUNITY_MAIL_URL"),
      community_mail_token: System.get_env("COMMUNITY_MAIL_TOKEN"),
      community_mail_from: System.get_env("COMMUNITY_MAIL_FROM")

    if config_env() == :prod and System.get_env("COMMUNITY_STORAGE") != "s3",
      do: raise("Production community media requires S3 storage")

    if System.get_env("COMMUNITY_STORAGE") == "s3" do
      for name <-
            ~w(COMMUNITY_S3_BUCKET COMMUNITY_S3_ACCESS_KEY_ID COMMUNITY_S3_SECRET_ACCESS_KEY),
          do: System.fetch_env!(name)
    end

    if config_env() == :prod do
      for name <-
            ~w(COMMUNITY_MAIL_URL COMMUNITY_MAIL_TOKEN COMMUNITY_MAIL_FROM COMMUNITY_MEDIA_URL),
          do: System.fetch_env!(name)

      if System.fetch_env!("COMMUNITY_MAIL_FROM") == "",
        do: raise("COMMUNITY_MAIL_FROM must not be empty")

      for name <- ~w(COMMUNITY_MAIL_URL COMMUNITY_MEDIA_URL) do
        if URI.parse(System.fetch_env!(name)).scheme != "https",
          do: raise("#{name} requires HTTPS")
      end
    end

    config :ex_aws,
      access_key_id: System.get_env("COMMUNITY_S3_ACCESS_KEY_ID"),
      secret_access_key: System.get_env("COMMUNITY_S3_SECRET_ACCESS_KEY"),
      region: System.get_env("COMMUNITY_S3_REGION") || "us-east-1"

    if endpoint = System.get_env("COMMUNITY_S3_ENDPOINT") do
      uri = URI.parse(endpoint)
      if uri.scheme not in ["https", "http"] or is_nil(uri.host), do: raise("Invalid S3 endpoint")

      if config_env() == :prod and uri.scheme != "https",
        do: raise("Production S3 endpoint requires HTTPS")

      config :ex_aws, :s3, scheme: uri.scheme <> "://", host: uri.host, port: uri.port
    end

    worker = System.get_env("COMMUNITY_WORKER") == "true"

    cron = [
      {"0 3 * * *", StarsmapApi.Community.MaintenanceWorker},
      {"*/10 * * * *", StarsmapApi.Community.RankingWorker}
    ]

    cron =
      if System.get_env("COMMUNITY_BACKUP_URI") not in [nil, ""],
        do: [{"0 2 * * *", StarsmapApi.Community.BackupWorker} | cron],
        else: cron

    config :starsmap_api, StarsmapApi.CommunityJobs,
      queues: if(worker, do: [media: 1, publish: 1], else: false),
      plugins:
        if(worker,
          do: [
            {Oban.Plugins.Pruner, max_age: 604_800},
            {Oban.Plugins.Cron, crontab: cron}
          ],
          else: false
        )

    if worker, do: config(:starsmap_api, StarsmapApiWeb.Endpoint, server: false)
    if worker, do: config(:starsmap_api, :sky_events_refresh_enabled, false)
  end
end

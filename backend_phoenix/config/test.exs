import Config

test_database =
  "starsmap_api_test#{System.get_env("MIX_TEST_PARTITION")}"

database_connection =
  if database_url = System.get_env("TEST_DATABASE_URL") || System.get_env("DATABASE_URL") do
    [url: database_url]
  else
    socket_dir = System.get_env("PGSOCKET_DIR") || "/var/run/postgresql"

    host_or_socket =
      if System.get_env("PGHOST") do
        [hostname: System.fetch_env!("PGHOST")]
      else
        [socket_dir: socket_dir]
      end

    [
      username: System.get_env("PGUSER") || "postgres",
      password: System.get_env("PGPASSWORD") || "",
      database: System.get_env("PGDATABASE") || test_database
    ] ++ host_or_socket
  end

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :starsmap_api,
       StarsmapApi.Repo,
       Keyword.merge(database_connection,
         pool: Ecto.Adapters.SQL.Sandbox,
         pool_size: System.schedulers_online() * 2
       )

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :starsmap_api, StarsmapApiWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "GA4FZCV0GzK8pDkd64DWO1aAnbAcWdCQUCNu4w6jXG72vTWxLRZ7ZMEcDRsQoQ53",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

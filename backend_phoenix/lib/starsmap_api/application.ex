defmodule StarsmapApi.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    :logger.add_handler(:sentry_handler, Sentry.LoggerHandler, %{
      config: %{capture_log_messages: true, level: :error}
    })

    children = [
      StarsmapApiWeb.Telemetry,
      StarsmapApi.Repo,
      {DNSCluster, query: Application.get_env(:starsmap_api, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: StarsmapApi.PubSub},
      # Start a worker by calling: StarsmapApi.Worker.start_link(arg)
      # {StarsmapApi.Worker, arg},
      # Start to serve requests, typically the last entry
      StarsmapApiWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: StarsmapApi.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    StarsmapApiWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end

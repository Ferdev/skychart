defmodule StarsmapApi.RuntimeQueuesTest do
  @moduledoc """
  The queue of answer flights runs in the web server: the release with PHX_SERVER=true, and
  `mix phx.server` in development. An `eval` command and the worker container do not run it.
  """
  use ExUnit.Case, async: false

  @community [
    {"COMMUNITY_ENABLED", "true"},
    {"COMMUNITY_DATABASE_URL", "ecto://user:pass@localhost/community"},
    {"COMMUNITY_SECRET", String.duplicate("s", 64)},
    {"COMMUNITY_WORKER", nil}
  ]
  @production [
    {"DATABASE_URL", "ecto://user:pass@localhost/atlas"},
    {"SECRET_KEY_BASE", String.duplicate("k", 64)},
    {"PHX_HOST", "example.com"},
    {"ANALYTICS_HASH_SALT", String.duplicate("a", 40)},
    {"COMMUNITY_MEDIA_URL", "https://media.example.com"},
    {"COMMUNITY_STORAGE", "s3"},
    {"COMMUNITY_S3_BUCKET", "bucket"},
    {"COMMUNITY_S3_ENDPOINT", "https://s3.example.com"},
    {"COMMUNITY_S3_REGION", "eu"},
    {"COMMUNITY_S3_ACCESS_KEY_ID", "key"},
    {"COMMUNITY_S3_SECRET_ACCESS_KEY", "secret"},
    {"COMMUNITY_MAIL_FROM", "atlas@example.com"},
    {"COMMUNITY_MAIL_TOKEN", "token"},
    {"COMMUNITY_MAIL_URL", "https://mail.example.com"},
    {"COMMUNITY_ORIGIN", "https://example.com"},
    {"COMMUNITY_ADMIN_EMAILS", "admin@example.com"}
  ]

  defp queues(env, variables) do
    saved = Map.new(variables, fn {name, _} -> {name, System.get_env(name)} end)
    Enum.each(variables, fn {name, value} -> set(name, value) end)

    try do
      Config.Reader.read!(Path.expand("../../config/runtime.exs", __DIR__), env: env)
      |> get_in([:starsmap_api, StarsmapApi.CommunityJobs, :queues])
    after
      Enum.each(saved, fn {name, value} -> set(name, value) end)
    end
  end

  defp set(name, nil), do: System.delete_env(name)
  defp set(name, value), do: System.put_env(name, value)

  test "development runs the flights queue with no PHX_SERVER" do
    assert queues(:dev, @community ++ [{"PHX_SERVER", nil}]) == [flights: 1]
  end

  test "production reads PHX_SERVER as a boolean" do
    production = @community ++ @production
    assert queues(:prod, production ++ [{"PHX_SERVER", "true"}]) == [flights: 1]
    assert queues(:prod, production ++ [{"PHX_SERVER", "false"}]) == false
    assert queues(:prod, production ++ [{"PHX_SERVER", nil}]) == false

    assert queues(:prod, production ++ [{"PHX_SERVER", "true"}, {"COMMUNITY_WORKER", "true"}]) ==
             [media: 1, publish: 1, mail: 1]
  end
end

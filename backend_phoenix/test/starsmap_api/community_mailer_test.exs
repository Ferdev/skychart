defmodule StarsmapApi.Community.MailerWebhookTest do
  use ExUnit.Case, async: false

  alias StarsmapApi.Community.Mailer.Webhook

  @keys [:community_mail_url, :community_mail_token, :community_mail_from]

  setup do
    previous = for key <- @keys, do: {key, Application.fetch_env(:starsmap_api, key)}

    on_exit(fn ->
      for {key, result} <- previous do
        case result do
          {:ok, value} -> Application.put_env(:starsmap_api, key, value)
          :error -> Application.delete_env(:starsmap_api, key)
        end
      end
    end)

    Application.put_env(:starsmap_api, :community_mail_url, "https://mail.invalid/emails")
    Application.put_env(:starsmap_api, :community_mail_token, "test-token")
    Application.put_env(:starsmap_api, :community_mail_from, "Cosmic Atlas <login@example.org>")
    :ok
  end

  # The adapter checks its settings before opening any connection, so the
  # unavailable cases below never reach the network.
  test "returns mail_unavailable when no sender is configured" do
    Application.delete_env(:starsmap_api, :community_mail_from)
    assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")
  end

  test "returns mail_unavailable when the sender is empty or not a string" do
    Application.put_env(:starsmap_api, :community_mail_from, "")
    assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")

    Application.put_env(:starsmap_api, :community_mail_from, nil)
    assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")
  end

  test "returns mail_unavailable when the url is not https" do
    Application.put_env(:starsmap_api, :community_mail_url, "http://mail.invalid/emails")
    assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")
  end

  test "returns mail_unavailable when the url or token is missing" do
    Application.delete_env(:starsmap_api, :community_mail_url)
    assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")

    Application.put_env(:starsmap_api, :community_mail_url, "https://mail.invalid/emails")
    Application.delete_env(:starsmap_api, :community_mail_token)
    assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")
  end
end

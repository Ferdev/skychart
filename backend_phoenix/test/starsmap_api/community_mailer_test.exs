defmodule StarsmapApi.Community.MailerWebhookTest do
  use ExUnit.Case, async: false

  alias StarsmapApi.Community.Mailer.Webhook

  defmodule FakeHttpClient do
    def request(method, url, headers, body, options) do
      send(self(), {:mail_request, method, url, headers, body, options})
      Process.get(:mail_response, {:ok, 200, [], ""})
    end
  end

  @keys [
    :community_mail_url,
    :community_mail_token,
    :community_mail_from,
    :community_mail_http_client
  ]

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
    Application.put_env(:starsmap_api, :community_mail_http_client, FakeHttpClient)
    :ok
  end

  test "posts a sign-in code to the webhook" do
    assert :ok = Webhook.deliver("reader@example.com", "123456")

    assert_received {:mail_request, :post, "https://mail.invalid/emails", headers, body, options}
    assert {"authorization", "Bearer test-token"} in headers
    assert {"content-type", "application/json"} in headers

    assert Jason.decode!(body) == %{
             "from" => "Cosmic Atlas <login@example.org>",
             "to" => "reader@example.com",
             "subject" => "Cosmic Atlas sign-in code",
             "text" => "Your code is 123456. It expires in 10 minutes."
           }

    assert {:connect_timeout, 5000} in options
    assert {:recv_timeout, 5000} in options
  end

  test "posts a notice with its own subject and text" do
    assert :ok = Webhook.notify("owner@example.com", "Cosmic Atlas: new user", "Text")

    assert_received {:mail_request, :post, "https://mail.invalid/emails", _, body, _}

    assert Jason.decode!(body) == %{
             "from" => "Cosmic Atlas <login@example.org>",
             "to" => "owner@example.com",
             "subject" => "Cosmic Atlas: new user",
             "text" => "Text"
           }
  end

  for status <- [200, 202, 204, 299] do
    test "returns ok for a #{status} response" do
      Process.put(:mail_response, {:ok, unquote(status), [], ""})
      assert :ok = Webhook.deliver("reader@example.com", "123456")
    end
  end

  for status <- [199, 300, 302, 400, 401, 422, 429, 500, 503] do
    test "returns mail_unavailable for a #{status} response" do
      Process.put(:mail_response, {:ok, unquote(status), [], "refused"})
      assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")
    end
  end

  for reason <- [:econnrefused, :timeout, :closed] do
    test "returns mail_unavailable for a #{reason} transport error" do
      Process.put(:mail_response, {:error, unquote(reason)})
      assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")
      assert_received {:mail_request, :post, _, _, _, _}
    end
  end

  test "a notice reports a rejected delivery as mail_unavailable" do
    Process.put(:mail_response, {:ok, 503, [], "busy"})

    assert {:error, :mail_unavailable} =
             Webhook.notify("owner@example.com", "Cosmic Atlas: new user", "Text")
  end

  # The adapter checks its settings before opening any connection, so the
  # unavailable cases below never reach the network.
  test "returns mail_unavailable when no sender is configured" do
    Application.delete_env(:starsmap_api, :community_mail_from)
    assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")
    refute_received {:mail_request, _, _, _, _, _}
  end

  test "returns mail_unavailable when the sender is empty or not a string" do
    Application.put_env(:starsmap_api, :community_mail_from, "")
    assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")

    Application.put_env(:starsmap_api, :community_mail_from, nil)
    assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")
    refute_received {:mail_request, _, _, _, _, _}
  end

  test "returns mail_unavailable when the url is not https" do
    Application.put_env(:starsmap_api, :community_mail_url, "http://mail.invalid/emails")
    assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")
    refute_received {:mail_request, _, _, _, _, _}
  end

  test "returns mail_unavailable when the url or token is missing" do
    Application.delete_env(:starsmap_api, :community_mail_url)
    assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")

    Application.put_env(:starsmap_api, :community_mail_url, "https://mail.invalid/emails")
    Application.delete_env(:starsmap_api, :community_mail_token)
    assert {:error, :mail_unavailable} = Webhook.deliver("reader@example.com", "123456")
    refute_received {:mail_request, _, _, _, _, _}
  end

  test "a notice uses the same settings checks as a sign-in code" do
    Application.delete_env(:starsmap_api, :community_mail_from)

    assert {:error, :mail_unavailable} =
             Webhook.notify("owner@example.com", "Cosmic Atlas: new user", "Text")

    refute_received {:mail_request, _, _, _, _, _}
  end
end

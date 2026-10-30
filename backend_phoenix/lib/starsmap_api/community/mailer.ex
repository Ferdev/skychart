defmodule StarsmapApi.Community.Mailer.Webhook do
  @moduledoc "Private mail delivery adapter. Credentials and codes are never logged."
  def deliver(email, code),
    do:
      notify(
        email,
        "Cosmic Atlas sign-in code",
        "Your code is #{code}. It expires in 10 minutes."
      )

  def notify(email, subject, text) do
    with url when is_binary(url) <- Application.get_env(:starsmap_api, :community_mail_url),
         true <- String.starts_with?(url, "https://"),
         token when is_binary(token) <- Application.get_env(:starsmap_api, :community_mail_token),
         from when is_binary(from) and from != "" <-
           Application.get_env(:starsmap_api, :community_mail_from),
         {:ok, status, _, _} when status in 200..299 <-
           http_client().request(
             :post,
             url,
             [{"authorization", "Bearer " <> token}, {"content-type", "application/json"}],
             Jason.encode!(%{
               from: from,
               to: email,
               subject: subject,
               text: text
             }),
             [:with_body, {:connect_timeout, 5000}, {:recv_timeout, 5000}]
           ) do
      :ok
    else
      _ -> {:error, :mail_unavailable}
    end
  end

  defp http_client, do: Application.get_env(:starsmap_api, :community_mail_http_client, :hackney)
end

defmodule StarsmapApi.Community.Mailer.Test do
  @moduledoc false
  def deliver(email, code) do
    if pid = Application.get_env(:starsmap_api, :community_test_mail_pid),
      do: send(pid, {:community_code, email, code})

    :ok
  end

  def notify(email, subject, text) do
    if pid = Application.get_env(:starsmap_api, :community_test_mail_pid),
      do: send(pid, {:community_notice, email, subject, text})

    :ok
  end
end

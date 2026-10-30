defmodule StarsmapApi.Community.AdminNotifier do
  @moduledoc """
  Mail notices to the administrators (COMMUNITY_ADMIN_EMAILS) about new users and
  photos that wait for review. The notice never contains the email address of a user.
  """
  use Oban.Worker, queue: :mail, max_attempts: 5
  alias StarsmapApi.Community.{Photo, Subject, User}
  alias StarsmapApi.CommunityRepo, as: Repo

  @field_limit 200

  @doc "Queue one mail for each administrator. Call it in the transaction that records the event."
  def enqueue(event, id) when event in ["new_user", "photo_review"] do
    for to <- recipients() do
      {:ok, _} = Oban.insert(StarsmapApi.CommunityJobs, new(%{event: event, id: id, to: to}))
    end

    :ok
  end

  @impl true
  def perform(%Oban.Job{args: %{"event" => event, "id" => id, "to" => to}}) do
    # An address that the operator removed from the list gets no more mail.
    with true <- to in recipients(),
         {subject, text} <- message(event, id) do
      Application.fetch_env!(:starsmap_api, :community_mailer).notify(to, subject, text)
    else
      _ -> :ok
    end
  end

  defp recipients, do: Application.get_env(:starsmap_api, :community_admin_emails, [])

  defp message("new_user", id) do
    case Repo.get(User, id) do
      %User{suspended: false} = user ->
        {"Cosmic Atlas: new user",
         """
         A new user signed in for the first time.

         Handle: #{field(user.handle)}
         Name: #{field(user.name)}
         Time: #{time(user.first_sign_in_at)}

         #{origin()}
         """}

      _ ->
        nil
    end
  end

  defp message("photo_review", id) do
    with %Photo{status: "review"} = photo <- Repo.get(Photo, id),
         %User{suspended: false} = author <- Repo.get(User, photo.user_id) do
      subject = Repo.get(Subject, photo.subject_id)

      {"Cosmic Atlas: photo waiting for review",
       """
       A photo waits for review.

       Title: #{field(photo.title)}
       Object: #{field((subject && subject.name) || photo.declared_key)}
       Photographer: #{field(author.handle)} (#{field(author.name)})
       Time: #{time(photo.updated_at)}

       Sign in and select Review: #{origin()}
       """}
    else
      _ -> nil
    end
  end

  # A value from a user stays on its line, so it cannot look like text of the notice.
  defp field(value) do
    value
    |> to_string()
    |> String.replace(~r/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/u, " ")
    |> String.trim()
    |> String.slice(0, @field_limit)
  end

  defp time(%DateTime{} = at), do: Calendar.strftime(at, "%Y-%m-%d %H:%M UTC")
  defp time(_), do: "unknown"

  defp origin, do: Application.get_env(:starsmap_api, :community_origin, "")
end

defmodule StarsmapApi.Community.Accounts do
  @moduledoc "Atomic email-code verification and revocable opaque sessions."
  import Ecto.Query
  alias StarsmapApi.Community.{User, Token}
  alias StarsmapApi.CommunityRepo, as: Repo

  def request_code(email) when is_binary(email) do
    email = email |> String.trim() |> String.downcase()

    domains =
      Application.get_env(
        :starsmap_api,
        :community_blocked_email_domains,
        ~w(mailinator.com guerrillamail.com 10minutemail.com)
      )

    if byte_size(email) > 254 or not Regex.match?(~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/, email) or
         List.last(String.split(email, "@")) in domains do
      {:error, :invalid_email}
    else
      code =
        :crypto.strong_rand_bytes(4)
        |> :binary.decode_unsigned()
        |> rem(1_000_000)
        |> Integer.to_string()
        |> String.pad_leading(6, "0")

      result =
        StarsmapApi.Community.transaction(fn ->
          user =
            Repo.get_by(User, email: email) ||
              Repo.insert!(%User{
                email: email,
                handle: "astro-" <> Base.encode16(:crypto.strong_rand_bytes(8), case: :lower),
                name: "Photographer"
              })

          recent =
            Repo.one(
              from t in Token,
                where: t.user_id == ^user.id and t.context == "code",
                order_by: [desc: t.inserted_at],
                limit: 1
            )

          if user.suspended or
               (recent && DateTime.diff(StarsmapApi.Community.now(), recent.inserted_at) < 60),
             do: Repo.rollback(:rate_limited)

          today = DateTime.add(StarsmapApi.Community.now(), -86400)

          requests =
            Repo.aggregate(
              from(t in Token,
                where: t.user_id == ^user.id and t.context == "code" and t.inserted_at > ^today
              ),
              :count
            )

          if requests >= 10, do: Repo.rollback(:rate_limited)

          Repo.update_all(from(t in Token, where: t.user_id == ^user.id and t.context == "code"),
            set: [expires_at: StarsmapApi.Community.now()]
          )

          id = Ecto.UUID.generate()

          Repo.insert!(%Token{
            id: id,
            user_id: user.id,
            context: "code",
            token_hash: hash(email <> ":" <> id <> ":" <> code),
            expires_at: DateTime.add(StarsmapApi.Community.now(), 600)
          })

          :ok
        end)

      case result do
        {:ok, :ok} -> mailer().deliver(email, code)
        _ -> {:error, :rate_limited}
      end
    end
  end

  def request_code(_), do: {:error, :invalid_email}

  def verify(email, code) when is_binary(email) and is_binary(code) do
    email = String.downcase(String.trim(email))

    result =
      StarsmapApi.Community.transaction(fn ->
        user = Repo.get_by(User, email: email)

        token =
          user &&
            Repo.one(
              from t in Token,
                where: t.user_id == ^user.id and t.context == "code",
                order_by: [desc: t.inserted_at],
                limit: 1,
                lock: "FOR UPDATE"
            )

        cond do
          is_nil(token) or user.suspended ->
            {:error, :invalid_code}

          token.attempts >= 5 or
              DateTime.compare(token.expires_at, StarsmapApi.Community.now()) != :gt ->
            {:error, :invalid_code}

          not Plug.Crypto.secure_compare(
            token.token_hash,
            hash(email <> ":" <> token.id <> ":" <> code)
          ) ->
            Repo.update!(Ecto.Changeset.change(token, attempts: token.attempts + 1))
            {:error, :invalid_code}

          true ->
            # Keep consumed codes until cleanup so successful logins do not reset
            # the daily request limit. Expiry also makes replay fail.
            Repo.update!(Ecto.Changeset.change(token, expires_at: StarsmapApi.Community.now()))
            secret = Base.url_encode64(:crypto.strong_rand_bytes(32), padding: false)

            Repo.insert!(%Token{
              user_id: user.id,
              context: "session",
              token_hash: hash(secret),
              expires_at: DateTime.add(StarsmapApi.Community.now(), 2_592_000)
            })

            {:ok, secret, user}
        end
      end)

    case result do
      {:ok, inner} -> inner
      _ -> {:error, :invalid_code}
    end
  end

  def verify(_, _), do: {:error, :invalid_code}

  def authenticate(secret) when is_binary(secret) and byte_size(secret) <= 100 do
    Repo.one(
      from t in Token,
        join: u in User,
        on: u.id == t.user_id,
        where:
          t.token_hash == ^hash(secret) and t.context == "session" and
            t.expires_at > ^StarsmapApi.Community.now() and not u.suspended,
        select: u
    )
  end

  def authenticate(_), do: nil

  def logout(secret),
    do:
      Repo.delete_all(
        from t in Token, where: t.token_hash == ^hash(secret) and t.context == "session"
      )

  def csrf(secret), do: Base.url_encode64(hash("csrf:" <> secret), padding: false)

  def hash(value),
    do:
      :crypto.mac(:hmac, :sha256, Application.fetch_env!(:starsmap_api, :community_secret), value)

  def public(user), do: Map.take(user, [:id, :handle, :name, :role])

  def update_profile(user, attrs) do
    user
    |> Ecto.Changeset.cast(attrs, [:name, :handle])
    |> Ecto.Changeset.validate_required([:name, :handle])
    |> Ecto.Changeset.validate_length(:name, min: 1, max: 80)
    |> Ecto.Changeset.validate_format(:handle, ~r/^[a-z][a-z0-9-]{2,39}$/)
    |> Ecto.Changeset.unique_constraint(:handle)
    |> Repo.update()
  end

  defp mailer, do: Application.fetch_env!(:starsmap_api, :community_mailer)
end

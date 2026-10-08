defmodule StarsmapApiWeb.CommunityController do
  use StarsmapApiWeb, :controller
  alias StarsmapApi.Community.{Accounts, Photos, Ranking, Moderation, Storage}

  def config(conn, _),
    do:
      json(conn, %{
        enabled: StarsmapApi.Community.enabled?(),
        max_bytes: 60_000_000,
        max_pixels: 120_000_000,
        formats: ["image/jpeg", "image/png", "image/tiff"]
      })

  def code(conn, params) do
    case Accounts.request_code(params["email"]) do
      :ok -> json(conn, %{sent: true})
      {:error, :mail_unavailable} -> error(conn, :service_unavailable, :mail_unavailable)
      _ -> json(conn, %{sent: true})
    end
  end

  def verify(conn, params) do
    case Accounts.verify(params["email"], params["code"]) do
      {:ok, token, user} ->
        conn
        |> put_resp_cookie(cookie(), token, cookie_opts())
        |> json(%{user: Accounts.public(user), csrf: Accounts.csrf(token)})

      _ ->
        error(conn, :unauthorized, :invalid_code)
    end
  end

  def me(conn, _) do
    conn = put_resp_header(conn, "cache-control", "no-store")

    if conn.assigns.community_user,
      do:
        json(conn, %{
          user: Accounts.public(conn.assigns.community_user),
          csrf: Accounts.csrf(conn.assigns.community_secret),
          photos: Photos.mine(conn.assigns.community_user)
        }),
      else: json(conn, %{user: nil, csrf: "", photos: []})
  end

  def logout(conn, _) do
    Accounts.logout(conn.assigns.community_secret)
    conn |> delete_resp_cookie(cookie(), cookie_opts()) |> json(%{ok: true})
  end

  def solve(conn, %{"id" => id}),
    do:
      respond(
        conn,
        StarsmapApi.Community.SolverWorker.enqueue(conn.assigns.community_user, id),
        fn _ -> %{queued: true} end
      )

  def wcs(conn, %{"id" => id} = params),
    do:
      respond(
        conn,
        StarsmapApi.Community.Astrometry.attach(conn.assigns.community_user, id, params["wcs"]),
        &Map.take(&1, [:id, :wcs])
      )

  def export(conn, _),
    do: json(conn, StarsmapApi.Community.Privacy.export(conn.assigns.community_user))

  def erase(conn, _) do
    case StarsmapApi.Community.Privacy.erase(conn.assigns.community_user) do
      {:ok, :ok} -> conn |> delete_resp_cookie(cookie(), cookie_opts()) |> json(%{ok: true})
      _ -> error(conn, :unprocessable_entity, :removal_failed)
    end
  end

  def profile(conn, params) do
    respond(
      conn,
      Accounts.update_profile(conn.assigns.community_user, params),
      &Accounts.public/1
    )
  end

  def index(conn, params) do
    version =
      case Integer.parse(params["since"] || "0") do
        {v, ""} when v >= 0 and v <= 9_223_372_036_854_775_807 -> v
        _ -> 0
      end

    payload = Ranking.index(version)
    etag = ~s("community-#{payload.version}")

    if get_req_header(conn, "if-none-match") == [etag] and not payload.more,
      do: send_resp(conn, 304, ""),
      else: conn |> put_resp_header("etag", etag) |> json(payload)
  end

  def gallery(conn, %{"key" => key} = params),
    do: json(conn, %{photos: Photos.gallery(key, params["cursor"])})

  def show(conn, %{"id" => id}) do
    photo = Photos.get(id)

    if Photos.visible?(photo),
      do: json(conn, Photos.public(photo)),
      else: error(conn, :not_found, :not_found)
  end

  def intent(conn, params) do
    case Photos.create(conn.assigns.community_user, params) do
      {:ok, photo} ->
        case Storage.adapter().intent(photo) do
          {:ok, upload} -> json(conn, %{photo_id: photo.id, upload: upload})
          _ -> error(conn, :service_unavailable, :storage_unavailable)
        end

      {:error, reason} ->
        error(conn, :unprocessable_entity, reason)
    end
  end

  def complete(conn, %{"id" => id}),
    do:
      respond(
        conn,
        Photos.complete(conn.assigns.community_user, id),
        &Map.take(&1, [:id, :status])
      )

  def vote(conn, %{"id" => id}),
    do: respond(conn, Ranking.vote(conn.assigns.community_user, id, conn.method == "POST"), & &1)

  def vote_state(conn, %{"id" => id}),
    do: json(conn, %{present: Ranking.voted?(conn.assigns.community_user, id) == true})

  def coverage(conn, _), do: json(conn, %{objects: StarsmapApi.Community.Operations.coverage()})
  def photographers(conn, _), do: json(conn, %{photographers: Ranking.photographers()})

  def cancel_votes(conn, %{"handle" => handle} = p),
    do:
      respond(
        conn,
        Moderation.cancel_votes(conn.assigns.community_user, handle, p["reason"]),
        fn _ -> %{ok: true} end
      )

  def remove(conn, %{"id" => id}),
    do: respond(conn, Moderation.remove(conn.assigns.community_user, id), fn _ -> %{ok: true} end)

  def report(conn, %{"id" => id} = p),
    do: respond(conn, Moderation.report(id, p["reason"]), fn _ -> %{ok: true} end)

  def rankings(conn, params),
    do:
      json(conn, %{
        photos: Ranking.ranked(params["period"]) |> Enum.take(24) |> Enum.map(&Photos.public/1)
      })

  def review_queue(conn, _) do
    if moderator?(conn),
      do:
        json(conn, %{
          reports: Moderation.reports(),
          photos:
            Enum.map(Moderation.queue(), &Map.merge(Photos.public(&1), %{status: &1.status}))
        }),
      else: error(conn, :forbidden, :not_allowed)
  end

  def suspend(conn, %{"handle" => handle} = p),
    do:
      respond(
        conn,
        Moderation.suspend(conn.assigns.community_user, handle, p["reason"], p["suspended"]),
        fn _ -> %{ok: true} end
      )

  def review(conn, %{"id" => id} = p),
    do:
      respond(
        conn,
        Moderation.review(conn.assigns.community_user, id, p["action"], p["reason"]),
        &Map.take(&1, [:id, :status])
      )

  def media(conn, %{"id" => id, "size" => size}) when size in ["96", "320", "1600"] do
    photo = Photos.get(id)

    private? =
      photo && conn.assigns.community_user &&
        (moderator?(conn) || (photo && photo.user_id == conn.assigns.community_user.id))

    if Photos.visible?(photo) || private? do
      key = "masters/#{photo.id}/#{size}.webp"

      conn =
        conn
        |> put_resp_header("cache-control", "no-store")
        |> put_resp_content_type("image/webp")
        |> put_resp_header("x-content-type-options", "nosniff")

      if Storage.adapter() == Storage.Local do
        path = Storage.local_path(key)

        if File.regular?(path),
          do: send_file(conn, 200, path),
          else: error(conn, :not_found, :not_found)
      else
        public_url = Application.get_env(:starsmap_api, :community_media_url)

        if Photos.visible?(photo) and is_binary(public_url) and
             String.starts_with?(public_url, "https://") do
          redirect(conn,
            external:
              String.trim_trailing(public_url, "/") <> "/" <> Storage.public_key(photo, size)
          )
        else
          # Private review images pass through the server, never the public CDN.
          case ExAws.S3.get_object(
                 Application.fetch_env!(:starsmap_api, :community_s3_bucket),
                 key
               )
               |> ExAws.request() do
            {:ok, %{body: bytes}} -> send_resp(conn, 200, bytes)
            _ -> error(conn, :not_found, :not_found)
          end
        end
      end
    else
      error(conn, :not_found, :not_found)
    end
  end

  def media(conn, _), do: error(conn, :not_found, :not_found)

  def upload(conn, %{"id" => id, "token" => token}) do
    with {:ok, %{id: ^id, size: size}} <-
           Phoenix.Token.verify(StarsmapApiWeb.Endpoint, "community-upload", token, max_age: 900),
         photo when not is_nil(photo) <- Photos.get(id),
         true <- photo.status == "uploading" and Storage.adapter() == Storage.Local do
      path = Storage.local_path(photo.source_key)
      File.mkdir_p!(Path.dirname(path))

      case File.open(path, [:write, :binary, :exclusive]) do
        {:ok, file} ->
          result = read_upload(conn, file, size, 0)
          File.close(file)

          case result do
            {:ok, conn} ->
              send_resp(conn, 200, "")

            {:error, conn} ->
              File.rm(path)
              error(conn, :unprocessable_entity, :size_mismatch)
          end

        _ ->
          error(conn, :conflict, :upload_exists)
      end
    else
      _ -> error(conn, :forbidden, :upload_rejected)
    end
  end

  def upload(conn, _), do: error(conn, :forbidden, :upload_rejected)

  defp read_upload(conn, file, limit, count) do
    case read_body(conn, length: 1_000_000, read_length: 1_000_000, read_timeout: 15000) do
      {status, bytes, conn} when status in [:ok, :more] ->
        total = count + byte_size(bytes)

        if total <= limit do
          IO.binwrite(file, bytes)

          if status == :more,
            do: read_upload(conn, file, limit, total),
            else: if(total == limit, do: {:ok, conn}, else: {:error, conn})
        else
          {:error, conn}
        end

      _ ->
        {:error, conn}
    end
  end

  defp respond(conn, {:ok, value}, fun), do: json(conn, fun.(value))

  defp respond(conn, {:error, reason}, _),
    do:
      error(conn, :unprocessable_entity, if(is_atom(reason), do: reason, else: :invalid_request))

  defp moderator?(conn),
    do: conn.assigns.community_user && conn.assigns.community_user.role in ["admin", "moderator"]

  defp cookie, do: StarsmapApiWeb.Plugs.CommunityAccess.cookie()

  defp cookie_opts,
    do: [
      http_only: true,
      secure: Application.get_env(:starsmap_api, :community_cookie_secure, true),
      same_site: "Lax",
      path: "/",
      max_age: 2_592_000
    ]

  defp error(conn, status, reason), do: conn |> put_status(status) |> json(%{error: reason})
end

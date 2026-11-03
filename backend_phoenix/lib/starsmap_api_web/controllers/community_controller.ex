defmodule StarsmapApiWeb.CommunityController do
  use StarsmapApiWeb, :controller

  alias StarsmapApi.Community.{
    Accounts,
    DeepFields,
    Depth,
    FieldCatalog,
    Findings,
    Photos,
    Ranking,
    Moderation,
    SkyOverlay,
    Storage,
    Tours,
    Transits
  }

  def config(conn, _),
    do:
      json(conn, %{
        enabled: StarsmapApi.Community.enabled?(),
        flights: StarsmapApi.Flights.enabled?(),
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

  # The account data with the photographer's own photos, for the account view.
  def me(conn, _) do
    conn = put_resp_header(conn, "cache-control", "no-store")

    if conn.assigns.community_user,
      do:
        json(
          conn,
          conn
          |> identity()
          |> Map.merge(%{
            photos: Photos.mine(conn.assigns.community_user),
            deep_field_future: not is_nil(conn.assigns.community_user.deep_field_consent_at)
          })
        ),
      else: json(conn, %{user: nil, csrf: "", photos: [], review_count: 0})
  end

  # The identity only. The client reads it at each start and at each refresh of a moderator.
  def session(conn, _) do
    conn = put_resp_header(conn, "cache-control", "no-store")

    if conn.assigns.community_user,
      do: json(conn, identity(conn)),
      else: json(conn, %{user: nil, csrf: "", review_count: 0})
  end

  defp identity(conn),
    do: %{
      user: Accounts.public(conn.assigns.community_user),
      csrf: Accounts.csrf(conn.assigns.community_secret),
      # Photos and reports that wait for this moderator. A member gets zero.
      review_count: if(moderator?(conn), do: Moderation.pending_count(), else: 0)
    }

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

  def sky(conn, params) do
    with {:ok, ra} <- bounded(params["ra"], 0, 360),
         {:ok, dec} <- bounded(params["dec"], -90, 90),
         {:ok, radius} <- bounded(params["radius"], 1, 180) do
      json(conn, %{photos: SkyOverlay.list(ra, dec, radius)})
    else
      :error -> error(conn, :bad_request, :invalid_area)
    end
  end

  def gallery(conn, %{"key" => key} = params),
    do:
      json(conn, %{
        photos: Photos.gallery(key, params["cursor"]),
        deep_field: DeepFields.for_key(key)
      })

  def show(conn, %{"id" => id}) do
    photo = Photos.get(id)

    if Photos.visible?(photo),
      do:
        json(
          conn,
          photo
          |> Photos.public()
          |> Map.merge(%{
            depth_ready: Depth.ready?(photo),
            deep_field_open: DeepFields.open_for(photo)
          })
        ),
      else: error(conn, :not_found, :not_found)
  end

  def photo_findings(conn, %{"id" => id}) do
    case Findings.visible_to(conn.assigns.community_user, id) do
      {:ok, findings} -> json(conn, %{findings: findings})
      _ -> error(conn, :not_found, :not_found)
    end
  end

  def object_findings(conn, %{"key" => key}),
    do: json(conn, %{findings: Findings.for_object(key)})

  def finding_public(conn, %{"id" => id} = params),
    do: respond(conn, Findings.set_public(conn.assigns.community_user, id, params["show"]), & &1)

  def review_findings(conn, _) do
    if moderator?(conn),
      do: json(conn, %{findings: Findings.review_list()}),
      else: error(conn, :forbidden, :not_allowed)
  end

  def review_finding(conn, %{"id" => id} = p),
    do:
      respond(
        conn,
        Findings.review(conn.assigns.community_user, id, p["action"], p["reason"]),
        &Map.take(&1, [:id, :state, :report])
      )

  def depth(conn, %{"id" => id}) do
    case Depth.public(id) do
      {:ok, layers} -> json(conn, layers)
      _ -> error(conn, :not_found, :not_found)
    end
  end

  def depth_permission(conn, %{"id" => id} = params),
    do:
      respond(
        conn,
        Depth.set_allowed(conn.assigns.community_user, id, params["allowed"]),
        & &1
      )

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

  def coverage(conn, params),
    do: json(conn, StarsmapApi.Community.Operations.coverage(params["catalog"], params["q"]))

  def photographers(conn, _), do: json(conn, %{photographers: Ranking.photographers()})

  def photographer(conn, %{"handle" => handle}) do
    case StarsmapApi.CommunityRepo.get_by(StarsmapApi.Community.User,
           handle: handle,
           suspended: false
         ) do
      nil ->
        error(conn, :not_found, :not_found)

      user ->
        # An account that has no published photo has a page with zero in each number.
        stats =
          Ranking.photographer(handle) ||
            %{
              handle: user.handle,
              name: user.name,
              h_index: 0,
              photos: 0,
              objects: 0,
              votes: 0,
              covers: 0,
              first_photos: 0
            }

        json(conn, %{
          photographer: Map.put(stats, :joined_at, user.inserted_at),
          photos: user.id |> Photos.by_author(48) |> Photos.public_many(),
          findings: Findings.for_author(user.id)
        })
    end
  end

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

  def rankings(conn, %{"period" => "new"} = params),
    do:
      json(conn, %{
        photos: params["offset"] |> offset() |> Photos.recent() |> Enum.map(&Photos.public/1)
      })

  def rankings(conn, params),
    do:
      json(conn, %{
        photos: Ranking.ranked(params["period"]) |> Enum.take(24) |> Enum.map(&Photos.public/1)
      })

  def review_queue(conn, _) do
    if moderator?(conn),
      do:
        json(conn, %{
          counts: Moderation.counts(),
          reports: Moderation.reports(),
          photos: Enum.map(Moderation.queue(), &Moderation.detail/1)
        }),
      else: error(conn, :forbidden, :not_allowed)
  end

  def review_list(conn, params) do
    if moderator?(conn),
      do:
        json(conn, %{
          photos:
            params["status"]
            |> Moderation.list(offset(params["offset"]))
            |> Enum.map(&Moderation.detail/1)
        }),
      else: error(conn, :forbidden, :not_allowed)
  end

  def review_log(conn, _) do
    if moderator?(conn),
      do: json(conn, %{actions: Moderation.log()}),
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

  def shared_tour(conn, %{"token" => token}) do
    case Tours.shared(token) do
      nil -> error(conn, :not_found, :not_found)
      tour -> json(conn, tour)
    end
  end

  def report_tour(conn, %{"token" => token} = p),
    do: respond(conn, Tours.report(token, p["reason"]), fn _ -> %{ok: true} end)

  def tours(conn, _), do: json(conn, %{tours: Tours.list(conn.assigns.community_user)})

  def create_tour(conn, params),
    do: respond(conn, Tours.create(conn.assigns.community_user, params), & &1)

  def update_tour(conn, %{"id" => id} = params),
    do: respond(conn, Tours.update(conn.assigns.community_user, id, params), & &1)

  def delete_tour(conn, %{"id" => id}),
    do: respond(conn, Tours.delete(conn.assigns.community_user, id), fn _ -> %{ok: true} end)

  def review_tours(conn, _) do
    if moderator?(conn),
      do: json(conn, %{tours: Tours.review_list()}),
      else: error(conn, :forbidden, :not_allowed)
  end

  def review_tour(conn, %{"id" => id} = p),
    do:
      respond(
        conn,
        Tours.review(conn.assigns.community_user, id, p["action"], p["reason"]),
        &Map.take(&1, [:id, :status])
      )

  def transits(conn, %{"key" => key}), do: json(conn, Transits.public_list(key))

  # The Gaia stars for one field. The radius has a low limit, because a frame of a
  # small telescope is small and this request reads a large table.
  def comparison_stars(conn, params) do
    with {:ok, ra} <- bounded(params["ra"], 0, 360),
         {:ok, dec} <- bounded(params["dec"], -90, 90),
         {:ok, radius} <- bounded(params["radius"], 0.05, 2) do
      stars =
        FieldCatalog.cone(ra, dec, radius, max_magnitude: 15.0, limit: 400)
        |> Enum.map(fn star ->
          %{
            key: star.key,
            ra: star.ra,
            dec: star.dec,
            magnitude: star.magnitude,
            bp_rp: is_map(star.facts) && star.facts["bp_rp"]
          }
        end)

      json(conn, %{stars: stars})
    else
      :error -> error(conn, :bad_request, :invalid_area)
    end
  end

  def my_transits(conn, _),
    do: json(conn, %{transits: Transits.mine(conn.assigns.community_user)})

  def fit_transit(conn, params), do: respond(conn, Transits.preview(params), & &1)

  def submit_transit(conn, params),
    do:
      respond(
        conn,
        Transits.submit(conn.assigns.community_user, params),
        &Map.take(&1, [:id, :review_state])
      )

  def queue_frame(conn, params),
    do:
      respond(
        conn,
        Transits.queue_frame(conn.assigns.community_user, params),
        &Map.take(&1, [:id, :status])
      )

  def frame_status(conn, %{"id" => id}),
    do: respond(conn, Transits.frame_status(conn.assigns.community_user, id), & &1)

  def review_transits(conn, params) do
    if moderator?(conn),
      do: json(conn, %{transits: Transits.review_list(params["state"])}),
      else: error(conn, :forbidden, :not_allowed)
  end

  def review_transit(conn, %{"id" => id} = p),
    do:
      respond(
        conn,
        Transits.review(conn.assigns.community_user, id, p["action"], p["reason"]),
        &Map.take(&1, [:id, :review_state])
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

  # Depth layers pass through this server, so that a canvas with them can record a clip.
  def media(conn, %{"id" => id, "size" => size}) when size in ["depth-base", "depth-sprites"] do
    photo = Photos.get(id)

    if Photos.visible?(photo) && photo.depth_allowed do
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
        case ExAws.S3.get_object(
               Application.fetch_env!(:starsmap_api, :community_s3_bucket),
               key
             )
             |> ExAws.request() do
          {:ok, %{body: bytes}} -> send_resp(conn, 200, bytes)
          _ -> error(conn, :not_found, :not_found)
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

  defp bounded(value, minimum, maximum) when is_binary(value) do
    case Float.parse(value) do
      {number, ""} when number >= minimum and number <= maximum -> {:ok, number}
      _ -> :error
    end
  end

  defp bounded(_, _, _), do: :error

  defp offset(value) do
    case Integer.parse(to_string(value || "0")) do
      {number, ""} when number in 0..10_000 -> number
      _ -> 0
    end
  end

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

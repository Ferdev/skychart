defmodule StarsmapApiWeb.DeepFieldController do
  use StarsmapApiWeb, :controller

  alias StarsmapApi.Community.{DeepField, DeepFieldBuild, DeepFields, Storage}
  alias StarsmapApi.CommunityRepo, as: Repo

  def show(conn, %{"slug" => slug}) do
    case DeepFields.public(slug) do
      {:ok, field} -> json(conn, field)
      _ -> error(conn, :not_found, :not_found)
    end
  end

  # An image passes through this server. Only the current build is public, so that a
  # takedown ends with the new build, and a former address gives nothing.
  def media(conn, %{"slug" => slug, "version" => version, "name" => name}) do
    with true <- name in DeepFields.files(),
         %DeepField{current_build_id: build_id} = field when not is_nil(build_id) <-
           DeepFields.by_slug(slug),
         %DeepFieldBuild{version: current} <- Repo.get(DeepFieldBuild, build_id),
         true <- to_string(current) == version do
      send_media(conn, DeepFields.file_key(field, current, name))
    else
      _ -> error(conn, :not_found, :not_found)
    end
  end

  defp send_media(conn, key) do
    conn =
      conn
      |> put_resp_header("cache-control", "public, max-age=300")
      |> put_resp_content_type("image/webp")
      |> put_resp_header("x-content-type-options", "nosniff")

    if Storage.adapter() == Storage.Local do
      path = Storage.local_path(key)

      if File.regular?(path),
        do: send_file(conn, 200, path),
        else: error(conn, :not_found, :not_found)
    else
      case ExAws.S3.get_object(Application.fetch_env!(:starsmap_api, :community_s3_bucket), key)
           |> ExAws.request() do
        {:ok, %{body: bytes}} -> send_resp(conn, 200, bytes)
        _ -> error(conn, :not_found, :not_found)
      end
    end
  end

  def frame(conn, %{"id" => id}),
    do: respond(conn, DeepFields.frame_state(conn.assigns.community_user, id))

  def add_frame(conn, %{"id" => id} = params),
    do:
      respond(
        conn,
        DeepFields.add_frame(conn.assigns.community_user, id, params["future"] == true)
      )

  def withdraw(conn, %{"id" => id}),
    do: respond(conn, DeepFields.withdraw(conn.assigns.community_user, id))

  def consent(conn, params),
    do: respond(conn, DeepFields.set_future(conn.assigns.community_user, params["future"]))

  def review(conn, _) do
    if moderator?(conn),
      do: json(conn, DeepFields.review()),
      else: error(conn, :forbidden, :not_allowed)
  end

  def open(conn, params) do
    if moderator?(conn) do
      case DeepFields.open(conn.assigns.community_user, params["key"]) do
        {:ok, field} -> json(conn, %{slug: field.slug})
        {:error, reason} -> error(conn, :unprocessable_entity, reason)
      end
    else
      error(conn, :forbidden, :not_allowed)
    end
  end

  def close(conn, %{"slug" => slug}) do
    if moderator?(conn) do
      case DeepFields.close(conn.assigns.community_user, slug) do
        {:ok, field} -> json(conn, %{slug: field.slug, status: field.status})
        {:error, reason} -> error(conn, :unprocessable_entity, reason)
      end
    else
      error(conn, :forbidden, :not_allowed)
    end
  end

  def rebuild(conn, %{"slug" => slug}) do
    if moderator?(conn) do
      case DeepFields.rebuild_now(slug) do
        {:ok, _job} -> json(conn, %{queued: true})
        {:error, reason} -> error(conn, :unprocessable_entity, reason)
      end
    else
      error(conn, :forbidden, :not_allowed)
    end
  end

  defp respond(conn, {:ok, value}), do: json(conn, value)

  defp respond(conn, {:error, :not_found}), do: error(conn, :not_found, :not_found)

  defp respond(conn, {:error, reason}), do: error(conn, :unprocessable_entity, reason)

  defp moderator?(conn), do: conn.assigns.community_user.role in ["admin", "moderator"]

  defp error(conn, status, reason), do: conn |> put_status(status) |> json(%{error: reason})
end

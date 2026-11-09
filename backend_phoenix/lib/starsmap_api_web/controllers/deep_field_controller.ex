defmodule StarsmapApiWeb.DeepFieldController do
  use StarsmapApiWeb, :controller

  alias StarsmapApi.Community.{DeepField, DeepFieldBuild, DeepFields, Storage}
  alias StarsmapApi.CommunityRepo, as: Repo

  @s3_timeout 30_000

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
      send_s3(conn, key)
    end
  end

  # The object goes to the client one chunk at a time, so a request holds one chunk in memory
  # and not the full image. A missing object gives 404 before the response starts.
  defp send_s3(conn, key) do
    bucket = Application.fetch_env!(:starsmap_api, :community_s3_bucket)
    opts = [async: :once] ++ Application.get_env(:ex_aws, :hackney_opts, recv_timeout: 30_000)

    with {:ok, url} <-
           ExAws.S3.presigned_url(ExAws.Config.new(:s3), :get, bucket, key, expires_in: 60),
         {:ok, ref} <- :hackney.request(:get, url, [], "", opts) do
      case s3_status(ref) do
        {200, length} ->
          conn |> send_chunked(200) |> s3_chunks(ref, length)

        _ ->
          :hackney.close(ref)
          error(conn, :not_found, :not_found)
      end
    else
      _ -> error(conn, :not_found, :not_found)
    end
  end

  defp s3_status(ref) do
    receive do
      {:hackney_response, ^ref, {:status, status, _}} ->
        receive do
          {:hackney_response, ^ref, {:headers, headers}} -> {status, content_length(headers)}
        after
          @s3_timeout -> :timeout
        end

      {:hackney_response, ^ref, _} ->
        :error
    after
      @s3_timeout -> :timeout
    end
  end

  defp content_length(headers) do
    Enum.find_value(headers, fn {name, value} ->
      if String.downcase(name) == "content-length", do: String.to_integer(value)
    end)
  end

  # `left` is the number of bytes still to come. hackney ends a body that the server cut short
  # with `done`, so the count tells a complete image from a part of one.
  defp s3_chunks(conn, ref, left) do
    :hackney.stream_next(ref)

    receive do
      {:hackney_response, ^ref, :done} when left in [0, nil] ->
        conn

      {:hackney_response, ^ref, :done} ->
        raise "deep-field media stream failed: #{left} bytes missing"

      {:hackney_response, ^ref, {:error, reason}} ->
        raise "deep-field media stream failed: #{inspect(reason)}"

      {:hackney_response, ^ref, chunk} when is_binary(chunk) ->
        case chunk(conn, chunk) do
          {:ok, conn} ->
            s3_chunks(conn, ref, left && left - byte_size(chunk))

          {:error, _closed} ->
            :hackney.close(ref)
            conn
        end
    after
      @s3_timeout ->
        :hackney.close(ref)
        # The status is sent. Only a broken connection tells the client the image is incomplete.
        raise "deep-field media stream timed out"
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

  # A signed-out visitor is not a moderator, so the action answers 403 and does not crash.
  defp moderator?(%{assigns: %{community_user: %{role: role}}}),
    do: role in ["admin", "moderator"]

  defp moderator?(_conn), do: false

  defp error(conn, status, reason), do: conn |> put_status(status) |> json(%{error: reason})
end

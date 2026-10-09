defmodule StarsmapApi.Community.Storage do
  @moduledoc "Private upload/master storage and approved public derivatives."
  def adapter, do: Application.fetch_env!(:starsmap_api, :community_storage)
  def root, do: Application.fetch_env!(:starsmap_api, :community_media_root)
  def local_path(key), do: Path.join(root(), key)
  def media_url(id, size), do: "/api/community/media/#{id}/#{size}"
  def public_key(photo, size), do: "public/#{photo.id}/#{photo.sha256}-#{size}.webp"
end

defmodule StarsmapApi.Community.Storage.Local do
  @moduledoc "Development storage; signed uploads are write-once and reads are gated."
  alias StarsmapApi.Community.Storage

  def intent(photo) do
    token =
      Phoenix.Token.sign(StarsmapApiWeb.Endpoint, "community-upload", %{
        id: photo.id,
        size: photo.size_bytes
      })

    {:ok,
     %{
       url: "/api/community/upload/#{photo.id}?token=#{URI.encode_www_form(token)}",
       method: "PUT"
     }}
  end

  def download(photo, path), do: File.cp(Storage.local_path(photo.source_key), path)
  def get(key, path), do: File.cp(Storage.local_path(key), path)

  def head(photo) do
    case File.stat(Storage.local_path(photo.source_key)) do
      {:ok, %{size: size}} when size == photo.size_bytes -> {:ok, "local-write-once"}
      _ -> {:error, :size_mismatch}
    end
  end

  def put(key, path, _public), do: copy(path, Storage.local_path(key))
  def delete(key), do: File.rm(Storage.local_path(key))

  defp copy(source, dest) do
    File.mkdir_p!(Path.dirname(dest))
    File.cp(source, dest)
  end
end

defmodule StarsmapApi.Community.Storage.S3 do
  @moduledoc "S3-compatible private uploads; masters are private, derivatives are public."
  def intent(photo) do
    case ExAws.S3.presigned_url(ExAws.Config.new(:s3), :put, bucket(), photo.source_key,
           expires_in: 900,
           headers: [
             {"content-length", Integer.to_string(photo.size_bytes)},
             {"if-none-match", "*"}
           ]
         ) do
      {:ok, url} -> {:ok, %{url: url, method: "PUT", headers: %{"if-none-match" => "*"}}}
      _ -> {:error, :storage_unavailable}
    end
  end

  def head(photo) do
    with {:ok, %{headers: headers}} <-
           ExAws.S3.head_object(bucket(), photo.source_key) |> ExAws.request(),
         {_, value} <-
           Enum.find(headers, fn {k, _} -> String.downcase(k) == "content-length" end),
         true <- value == Integer.to_string(photo.size_bytes),
         {_, etag} <- Enum.find(headers, fn {k, _} -> String.downcase(k) == "etag" end) do
      {:ok, etag}
    else
      _ -> {:error, :size_mismatch}
    end
  end

  def download(photo, path) do
    # Freeze bytes into a local file. The processor hashes and re-encodes these bytes;
    # later PUTs can never alter an already-processed master or derivative.
    with {:ok, %{body: bytes}} <-
           ExAws.S3.get_object(bucket(), photo.source_key, if_match: photo.assets["source_etag"])
           |> ExAws.request(),
         true <- byte_size(bytes) == photo.size_bytes do
      File.write(path, bytes)
    else
      _ -> {:error, :storage_unavailable}
    end
  end

  def get(key, path) do
    case ExAws.S3.get_object(bucket(), key) |> ExAws.request() do
      {:ok, %{body: bytes}} when byte_size(bytes) <= 10_000_000 -> File.write(path, bytes)
      _ -> {:error, :storage_unavailable}
    end
  end

  def put(key, path, public) do
    opts =
      if public,
        do: [content_type: "image/webp", cache_control: "public,max-age=60"],
        else: [content_type: "application/octet-stream"]

    case ExAws.S3.put_object(bucket(), key, File.read!(path), opts) |> ExAws.request() do
      {:ok, _} -> :ok
      _ -> {:error, :storage_unavailable}
    end
  end

  def delete(key) do
    case ExAws.S3.delete_object(bucket(), key) |> ExAws.request() do
      {:ok, _} -> :ok
      _ -> {:error, :storage_unavailable}
    end
  end

  defp bucket, do: Application.fetch_env!(:starsmap_api, :community_s3_bucket)
end

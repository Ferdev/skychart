defmodule StarsmapApiWeb.Plugs.FramePolicy do
  @moduledoc "Applies a narrow route-specific framing policy to browser documents."
  import Plug.Conn

  def init(options), do: options

  def call(conn, _options) do
    register_before_send(conn, fn conn ->
      conn =
        conn
        |> put_resp_header("x-content-type-options", "nosniff")
        |> put_resp_header("referrer-policy", "strict-origin-when-cross-origin")
        |> script_policy()

      if conn.request_path == "/embed",
        do: conn |> delete_resp_header("x-frame-options") |> put_frame_ancestors("*"),
        else:
          conn
          |> put_resp_header("x-frame-options", "SAMEORIGIN")
          |> put_frame_ancestors("'self'")
    end)
  end

  defp script_policy(conn) do
    body =
      if is_binary(conn.resp_body),
        do: conn.resp_body,
        else: IO.iodata_to_binary(conn.resp_body || "")

    hashes =
      Regex.scan(~r/<script(?![^>]*\bsrc=)([^>]*)>(.*?)<\/script>/s, body,
        capture: :all_but_first
      )
      |> Enum.filter(fn [attributes, script] ->
        String.contains?(attributes, ~s(type="application/ld+json")) or trusted_boot?(script)
      end)
      |> Enum.map(fn [_, script] ->
        "'sha256-" <> Base.encode64(:crypto.hash(:sha256, script)) <> "'"
      end)
      |> Enum.join(" ")

    put_resp_header(
      conn,
      "content-security-policy",
      "script-src 'self' https://visits.ferdev.com #{hashes}; object-src 'none'; base-uri 'self'"
    )
  end

  defp trusted_boot?("window.__ATLAS_BOOT__=" <> json) do
    case Jason.decode(json) do
      {:ok, %{"objectKey" => key} = values} when is_binary(key) and byte_size(key) <= 180 ->
        map_size(values) == 1

      _ ->
        false
    end
  end

  defp trusted_boot?(_), do: false

  defp put_frame_ancestors(conn, sources) do
    directives =
      conn
      |> get_resp_header("content-security-policy")
      |> List.first("")
      |> String.split(";", trim: true)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&String.starts_with?(&1, "frame-ancestors"))
      |> Kernel.++(["frame-ancestors #{sources}"])
      |> Enum.join("; ")

    put_resp_header(conn, "content-security-policy", directives)
  end
end

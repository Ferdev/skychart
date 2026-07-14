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

      if conn.request_path == "/embed",
        do: conn |> delete_resp_header("x-frame-options") |> put_frame_ancestors("*"),
        else:
          conn
          |> put_resp_header("x-frame-options", "SAMEORIGIN")
          |> put_frame_ancestors("'self'")
    end)
  end

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

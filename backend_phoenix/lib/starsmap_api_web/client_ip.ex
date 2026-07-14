defmodule StarsmapApiWeb.ClientIp do
  @moduledoc """
  Resolves the original client address only across the trusted Kamal/container proxy boundary.

  Forwarded headers from arbitrary public peers are ignored. Starting at the socket peer, the
  resolver walks `X-Forwarded-For` from right to left and stops at the first untrusted address,
  so a client-supplied prefix cannot spoof the identity used by rate limiting or analytics.
  """

  import Plug.Conn, only: [get_req_header: 2]

  @loopback_cidrs [{{127, 0, 0, 0}, 8}, {{0, 0, 0, 0, 0, 0, 0, 1}, 128}]

  def resolve(conn) do
    peer = conn.remote_ip || {0, 0, 0, 0}

    if trusted_proxy?(peer) do
      conn
      |> get_req_header("x-forwarded-for")
      |> Enum.join(",")
      |> String.split(",", trim: true)
      |> Enum.map(&parse_ip/1)
      |> Enum.reject(&is_nil/1)
      |> Kernel.++([peer])
      |> Enum.reverse()
      |> Enum.drop_while(&trusted_proxy?/1)
      |> List.first()
      |> Kernel.||(peer)
    else
      peer
    end
  end

  def trusted_proxy?(ip) when tuple_size(ip) in [4, 8],
    do: Enum.any?(trusted_proxy_cidrs(), &in_cidr?(ip, &1))

  def trusted_proxy?(_), do: false

  defp trusted_proxy_cidrs do
    :starsmap_api
    |> Application.get_env(:trusted_proxy_cidrs, @loopback_cidrs)
    |> Enum.flat_map(&parse_cidr/1)
  end

  defp parse_cidr({network, prefix} = cidr)
       when is_tuple(network) and is_integer(prefix),
       do: if(valid_prefix?(network, prefix), do: [cidr], else: [])

  defp parse_cidr(value) when is_binary(value) do
    with [address, prefix] <- String.split(value, "/", parts: 2),
         {:ok, network} <- :inet.parse_address(String.to_charlist(address)),
         {prefix, ""} <- Integer.parse(prefix),
         true <- valid_prefix?(network, prefix) do
      [{network, prefix}]
    else
      _ -> []
    end
  end

  defp parse_cidr(_), do: []

  defp valid_prefix?(network, prefix) when tuple_size(network) == 4,
    do: prefix in 0..32

  defp valid_prefix?(network, prefix) when tuple_size(network) == 8,
    do: prefix in 0..128

  defp valid_prefix?(_, _), do: false

  defp parse_ip(value) do
    value = value |> String.trim() |> String.trim_leading("[") |> String.trim_trailing("]")

    case :inet.parse_address(String.to_charlist(value)) do
      {:ok, ip} -> ip
      _ -> nil
    end
  end

  defp in_cidr?(ip, {network, prefix}) do
    if tuple_size(ip) == tuple_size(network) do
      bits = if tuple_size(ip) == 4, do: 32, else: 128
      shift = bits - prefix
      Bitwise.bsr(ip_integer(ip), shift) == Bitwise.bsr(ip_integer(network), shift)
    else
      false
    end
  end

  defp ip_integer(ip) when tuple_size(ip) == 4 do
    ip
    |> Tuple.to_list()
    |> Enum.reduce(0, fn part, acc -> Bitwise.bor(Bitwise.bsl(acc, 8), part) end)
  end

  defp ip_integer(ip) do
    ip
    |> Tuple.to_list()
    |> Enum.reduce(0, fn part, acc -> Bitwise.bor(Bitwise.bsl(acc, 16), part) end)
  end
end

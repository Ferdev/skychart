defmodule StarsmapApi.Catalog.Astrometry do
  @moduledoc "Versioned fixed-J2000 projection and tangent-vector proper motion."
  @external_resource Path.expand("../../../priv/catalog_coordinate_contract.json", __DIR__)
  @contract @external_resource |> File.read!() |> Jason.decode!()
  def contract, do: @contract

  def project(ra, dec, radius \\ 1.0) do
    r = radians(ra)
    d = radians(dec)
    e = radians(@contract["obliquity_deg"])
    y = radius * :math.cos(d) * :math.sin(r)
    z = radius * :math.sin(d)

    %{
      x: radius * :math.cos(d) * :math.cos(r),
      y: y * :math.cos(e) + z * :math.sin(e),
      z: -y * :math.sin(e) + z * :math.cos(e)
    }
  end

  def propagate(ra, dec, pmra, pmdec, source_epoch, target_epoch) do
    if is_nil(pmra) or is_nil(pmdec) do
      {ra, dec, source_epoch}
    else
      r = radians(ra)
      d = radians(dec)
      scale = radians((target_epoch - source_epoch) / 3_600_000)

      x =
        :math.cos(d) * :math.cos(r) +
          scale * (-pmra * :math.sin(r) - pmdec * :math.sin(d) * :math.cos(r))

      y =
        :math.cos(d) * :math.sin(r) +
          scale * (pmra * :math.cos(r) - pmdec * :math.sin(d) * :math.sin(r))

      z = :math.sin(d) + scale * pmdec * :math.cos(d)
      ra = degrees(:math.atan2(y, x))

      {if(ra < 0, do: ra + 360, else: ra), degrees(:math.atan2(z, :math.sqrt(x * x + y * y))),
       target_epoch}
    end
  end

  defp radians(value), do: value * :math.pi() / 180
  defp degrees(value), do: value * 180 / :math.pi()
end

defmodule StarsmapApi.Catalog.AstrometryTest do
  use ExUnit.Case, async: true
  alias StarsmapApi.Catalog.Astrometry

  test "fixed axes and explicit motion epochs agree with independent analytic fixtures" do
    assert Astrometry.project(0, 0) == %{x: 1.0, y: 0.0, z: 0.0}
    north = Astrometry.project(0, 90)
    assert_in_delta north.y, 0.39777715575, 1.0e-10
    assert_in_delta north.z, 0.91748206215, 1.0e-10
    {ra, dec, epoch} = Astrometry.propagate(0, 0, 3_600_000, 0, 2000, 2001)
    assert_in_delta ra, :math.atan(:math.pi() / 180) * 180 / :math.pi(), 1.0e-12
    assert dec == 0
    assert epoch == 2001
    assert Astrometry.propagate(12, 13, nil, 10, 2016, 2026) == {12, 13, 2016}
    {ra, dec, _} = Astrometry.propagate(359.9, 89.999, 10000, 10000, 2000, 2100)
    assert ra >= 0 and ra < 360 and dec < 90 and dec > -90
  end
end

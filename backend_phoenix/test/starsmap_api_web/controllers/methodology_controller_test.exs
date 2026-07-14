defmodule StarsmapApiWeb.MethodologyControllerTest do
  use StarsmapApiWeb.ConnCase

  test "methodology is readable without JavaScript and links authoritative sources", %{conn: conn} do
    body = conn |> get(~p"/methodology") |> html_response(200)
    assert body =~ "What the map position means"
    assert body =~ "DESI DR1"
    assert body =~ "Quaia"
    assert body =~ "HEASARC NEARGALCAT"
    assert body =~ "/docs/scientific-methodology.md#coordinate-frame-and-projection"
    assert body =~ "/docs/tile-format.md#levels-and-sampling"
    refute body =~ "development-plan"
    assert body =~ ~s(<link rel="canonical" href="https://skychart.org/methodology">)
    refute body =~ "<script"
  end
end

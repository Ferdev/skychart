defmodule StarsmapApiWeb.JsonLdTest do
  use ExUnit.Case, async: true

  alias StarsmapApiWeb.JsonLd

  test "encodes valid JSON while neutralizing script-closing and HTML characters" do
    encoded = JsonLd.encode!(%{"name" => "</script><b>&", "separator" => "\u2028\u2029"})

    refute encoded =~ "</script>"
    refute encoded =~ "<b>"
    refute encoded =~ "&"
    assert encoded =~ "\\u003c/script\\u003e"
    assert encoded =~ "\\u2028\\u2029"
    assert Jason.decode!(encoded) == %{"name" => "</script><b>&", "separator" => "\u2028\u2029"}
  end
end

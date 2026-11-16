defmodule StarsmapApi.Catalog.TargetSnapshotTest do
  use StarsmapApiWeb.ConnCase, async: false
  alias StarsmapApi.Catalog.{TargetSnapshot, TargetMatch}
  alias StarsmapApi.{AgentSkyFixtures, Repo}
  import Ecto.Query

  setup do
    StarsmapApiWeb.Plugs.RateLimit.reset()
    AgentSkyFixtures.seed_catalog()
    :ok
  end

  defp match(rows) do
    {:ok, result} = TargetMatch.run(rows)
    TargetSnapshot.receipt(result.rows)
  end

  test "snapshot remains identical after the catalog changes and works without an account", %{
    conn: conn
  } do
    receipt = match([%{"name" => "M31"}, %{"name" => "no-such-target"}, %{"name" => "M31"}])

    created =
      conn |> post("/api/catalog/target-snapshots", %{receipt: receipt}) |> json_response(201)

    token = created["url"] |> String.split("/") |> List.last()
    assert String.length(token) == 32
    saved = created["snapshot"]
    assert Enum.at(saved["rows"], 2)["duplicate_of"] == 0
    assert saved["catalog_revision"] =~ "sha256:"
    assert saved["rows"] |> hd() |> get_in(["object", "source_revision"])
    Repo.query!("DELETE FROM catalog_deep_sky_objects", [])
    assert {:ok, ^saved} = TargetSnapshot.read(token)
    fresh = build_conn() |> get("/api/catalog/target-snapshots/#{token}") |> json_response(200)
    assert fresh == saved
  end

  test "only signed matches and valid candidate selections can be saved" do
    assert {:error, _} = TargetSnapshot.prepare(%{"receipt" => "forged"})
    assert {:error, _} = TargetSnapshot.prepare(%{"rows" => [%{"status" => "matched"}]})

    receipt =
      TargetSnapshot.receipt([
        %{input: "ambiguous", status: "ambiguous", candidates: [%{key: "ngc-224", name: "M31"}]}
      ])

    chosen = match([%{"name" => "M31"}])

    assert {:ok, payload} =
             TargetSnapshot.prepare(%{"receipt" => receipt, "selections" => %{"0" => chosen}})

    assert hd(payload["rows"])["input"] == "ambiguous"
    assert hd(payload["rows"])["object"]["key"] == "ngc-224"

    assert {:error, _} =
             TargetSnapshot.prepare(%{"receipt" => receipt, "selections" => %{"-1" => chosen}})

    assert {:error, _} =
             TargetSnapshot.prepare(%{
               "receipt" => receipt,
               "selections" => %{"0" => match([%{"name" => "Voyager 1"}])}
             })
  end

  test "hostile source URLs are removed, payloads bounded and tokens validated" do
    row = %{
      input: "=HYPERLINK(\"evil\")",
      status: "matched",
      object: %{
        key: "m31",
        name: "<script>bad</script>",
        source: %{label: "x", url: "javascript:alert(1)"}
      }
    }

    assert {:ok, payload} = TargetSnapshot.prepare(%{"receipt" => TargetSnapshot.receipt([row])})
    refute hd(payload["rows"])["object"]["source"]["url"]

    assert {:error, _} =
             TargetSnapshot.prepare(%{
               "receipt" => TargetSnapshot.receipt(List.duplicate(row, 501))
             })

    assert {:error, _} = TargetSnapshot.read("../not-a-token")

    assert {:error, _} =
             TargetSnapshot.prepare(%{
               "receipt" =>
                 TargetSnapshot.receipt([Map.put(row, :input, String.duplicate("x", 600_000))])
             })
  end

  test "quota refusal preserves existing links and later-day opens count once per date" do
    receipt = match([%{"name" => "M31"}])
    assert {:ok, result} = TargetSnapshot.create(%{"receipt" => receipt})
    yesterday = DateTime.utc_now() |> DateTime.add(-86400)

    Repo.update_all("target_snapshots",
      set: [created_at: yesterday, bytes: TargetSnapshot.limits().total_bytes]
    )

    assert {:error, :quota_full} = TargetSnapshot.create(%{"receipt" => receipt})
    assert {:ok, _} = TargetSnapshot.read(result.token, true)
    assert {:ok, _} = TargetSnapshot.read(result.token, true)

    assert Repo.one(
             from s in "target_snapshots",
               where: s.token == ^result.token,
               select: s.later_day_opens
           ) == 1
  end
end

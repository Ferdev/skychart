defmodule StarsmapApi.SkyEvents.CalendarTest do
  use StarsmapApi.DataCase, async: true
  alias StarsmapApi.SkyEvents
  alias StarsmapApi.SkyEvents.{Calendar, SkyEvent}

  defp event(attrs) do
    now = DateTime.utc_now()

    %SkyEvent{}
    |> SkyEvent.changeset(
      Map.merge(
        %{
          source: "jpl_cneos",
          source_id: "2026 AB:#{Date.utc_today()}",
          kind: "close_approach",
          title: "2026 AB close approach",
          summary: "Predicted approach at 3.1 lunar distances.",
          starts_at: DateTime.add(now, 86_400),
          source_url: "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=2026%20AB"
        },
        attrs
      )
    )
    |> Repo.insert!()
  end

  defp unfold(text), do: String.replace(text, "\r\n ", "")

  test "the text has the required structure and CRLF line ends" do
    text = Calendar.render([event(%{})])
    assert String.starts_with?(text, "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:")
    assert String.ends_with?(text, "END:VCALENDAR\r\n")
    refute Regex.match?(~r/[^\r]\n/, text)

    for property <- ~w(UID DTSTAMP DTSTART DTEND SUMMARY URL),
        do: assert(text =~ "\r\n#{property}")
  end

  test "lines fold at 75 octets and a fold never splits a character" do
    summary = String.duplicate("Ñandú ☄ ", 80) |> String.slice(0, 240)
    text = Calendar.render([event(%{summary: summary})])
    assert text |> String.split("\r\n") |> Enum.all?(&(byte_size(&1) <= 75))
    assert String.valid?(text)
    assert unfold(text) =~ String.trim_trailing(summary)
  end

  test "text values escape the separators of the format" do
    text = Calendar.render([event(%{title: "A, B; C\\D", summary: "one\ntwo"})]) |> unfold()
    assert text =~ "SUMMARY:A\\, B\; C\\\\D\r\n"
    assert text =~ "DESCRIPTION:one\\ntwo"
  end

  test "a new predicted time on the same day keeps the UID" do
    first = event(%{source_id: "2026 AB:one", starts_at: ~U[2026-11-02 03:00:00.000000Z]})
    second = event(%{source_id: "2026 AB:two", starts_at: ~U[2026-11-02 21:40:00.000000Z]})
    assert Calendar.uid(first) == Calendar.uid(second)
  end

  test "an entry links to the object page, or to the atlas at the time of the event" do
    with_object = Calendar.render([event(%{catalog_key: "m31"})]) |> unfold()
    assert with_object =~ "URL:https://skychart.org/o/m31\r\n"

    other = Calendar.render([event(%{source_id: "2026 AB:other"})]) |> unfold()
    assert [_, url] = Regex.run(~r/URL:(\S+)/, other)
    assert url =~ "t=" and url =~ "z=24"
  end

  test "an exoplanet is an all-day entry" do
    text =
      Calendar.render([
        event(%{
          source: "nasa_exoplanet_archive",
          source_id: "TOI-1 b",
          kind: "new_exoplanet",
          title: "TOI-1 b confirmed",
          starts_at: ~U[2026-10-01 00:00:00.000000Z]
        })
      ])

    assert text =~ "DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261002\r\n"
  end

  test "the type filter applies before the limit, and a recent event stays in the calendar" do
    approach = event(%{starts_at: DateTime.add(DateTime.utc_now(), -5 * 86_400)})

    exoplanet =
      event(%{
        source: "nasa_exoplanet_archive",
        source_id: "TOI-2 b",
        kind: "new_exoplanet",
        title: "TOI-2 b confirmed"
      })

    assert Enum.map(SkyEvents.list_for_calendar(["close_approach"]), & &1.id) == [approach.id]
    assert Enum.map(SkyEvents.list_for_calendar(["new_exoplanet"]), & &1.id) == [exoplanet.id]
    assert length(SkyEvents.list_for_calendar([])) == 2
  end

  test "the types parameter accepts only known types" do
    assert Calendar.parse_kinds(nil) == {:ok, []}

    assert Calendar.parse_kinds("close_approach, new_exoplanet") ==
             {:ok, ~w(close_approach new_exoplanet)}

    assert Calendar.parse_kinds("close_approach,nope") == :error
  end
end

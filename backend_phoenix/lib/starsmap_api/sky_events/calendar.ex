defmodule StarsmapApi.SkyEvents.Calendar do
  @moduledoc """
  The RFC 5545 text of a calendar subscription.

  A UID comes from the identity of an event, not from its time, so that a new predicted
  time changes the entry in place. The identity of a close approach is the same one that
  `SkyEvents` uses to remove duplicates: the object and the UTC day.
  """

  alias StarsmapApi.AgentInterface
  alias StarsmapApi.SkyEvents

  @kinds ~w(close_approach new_exoplanet)
  @line_octets 75
  @approach_minutes 30

  def kinds, do: @kinds

  @doc "The event types of the `types` parameter. No value means all types."
  def parse_kinds(nil), do: {:ok, []}

  def parse_kinds(value) when is_binary(value) do
    kinds = value |> String.split(",", trim: true) |> Enum.map(&String.trim/1) |> Enum.uniq()
    if Enum.all?(kinds, &(&1 in @kinds)), do: {:ok, kinds}, else: :error
  end

  def parse_kinds(_), do: :error

  def render(events) do
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Cosmic Atlas//Sky events//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Cosmic Atlas sky events",
      "NAME:Cosmic Atlas sky events",
      "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
      "X-PUBLISHED-TTL:PT12H"
    ]
    |> Kernel.++(Enum.flat_map(events, &event/1))
    |> Kernel.++(["END:VCALENDAR"])
    |> Enum.map_join("", &(fold(&1) <> "\r\n"))
  end

  defp event(e) do
    url = atlas_url(e)

    [
      "BEGIN:VEVENT",
      "UID:#{uid(e)}",
      "DTSTAMP:#{stamp(e.updated_at)}",
      "LAST-MODIFIED:#{stamp(e.updated_at)}"
    ] ++
      times(e) ++
      [
        "SUMMARY:#{text(e.title)}",
        "DESCRIPTION:#{text(Enum.join(Enum.uniq([e.summary, url, e.source_url]), "\n"))}",
        "URL:#{url}",
        "CATEGORIES:#{category(e.kind)}",
        "TRANSP:TRANSPARENT",
        "END:VEVENT"
      ]
  end

  @doc false
  def uid(e) do
    identity =
      if e.kind == "close_approach",
        do: [e.source, e.kind, e.title, Date.to_iso8601(DateTime.to_date(e.starts_at))],
        else: [e.source, e.source_id]

    digest = :crypto.hash(:sha256, Enum.join(identity, "\n"))
    "#{digest |> binary_part(0, 16) |> Base.encode16(case: :lower)}@skychart.org"
  end

  # A publication has a day and no time of day, so it is an all-day entry.
  defp times(%{kind: "new_exoplanet"} = e) do
    day = DateTime.to_date(e.starts_at)
    ["DTSTART;VALUE=DATE:#{date(day)}", "DTEND;VALUE=DATE:#{date(Date.add(day, 1))}"]
  end

  defp times(e) do
    ends = e.ends_at || DateTime.add(e.starts_at, @approach_minutes, :minute)
    ["DTSTART:#{stamp(e.starts_at)}", "DTEND:#{stamp(ends)}"]
  end

  # An event with no catalog object has no page, so its link opens the atlas at the time of the event.
  defp atlas_url(%{catalog_key: key} = e) when is_binary(key), do: SkyEvents.public_url(e)

  defp atlas_url(e) do
    case AgentInterface.view_link(%{
           "center_x_au" => 0,
           "center_y_au" => 0,
           "zoom" => 24,
           "time" => DateTime.to_iso8601(DateTime.truncate(e.starts_at, :second))
         }) do
      {:ok, %{url: url}} -> url
      _ -> e.source_url
    end
  end

  defp category("close_approach"), do: "Close approach"
  defp category(_), do: "New exoplanet"

  defp stamp(datetime),
    do: datetime |> DateTime.truncate(:second) |> Calendar.strftime("%Y%m%dT%H%M%SZ")

  defp date(day), do: Calendar.strftime(day, "%Y%m%d")

  defp text(value) do
    value
    |> to_string()
    |> String.replace("\\", "\\\\")
    |> String.replace(";", "\;")
    |> String.replace(",", "\\,")
    |> String.replace(~r/\r\n|\r|\n/, "\\n")
  end

  # RFC 5545 3.1: a line has 75 octets at most, and a line break never splits a character.
  defp fold(line) do
    {head, rest} = take_octets(line, @line_octets)
    [head | continuation(rest)] |> Enum.join("\r\n")
  end

  defp continuation(""), do: []

  defp continuation(rest) do
    {head, tail} = take_octets(rest, @line_octets - 1)
    [" " <> head | continuation(tail)]
  end

  defp take_octets(text, limit) do
    size =
      text
      |> String.graphemes()
      |> Enum.reduce_while(0, fn grapheme, size ->
        if size + byte_size(grapheme) > limit,
          do: {:halt, size},
          else: {:cont, size + byte_size(grapheme)}
      end)

    {binary_part(text, 0, size), binary_part(text, size, byte_size(text) - size)}
  end
end

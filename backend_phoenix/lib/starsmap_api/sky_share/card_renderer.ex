defmodule StarsmapApi.SkyShare.CardRenderer do
  @moduledoc "Deterministic dependency-free 1200×630 PNG renderer for Sky unfurl cards."

  alias StarsmapApi.SkyShare.{Copy, State}

  @width 1200
  @height 630
  @signature <<137, 80, 78, 71, 13, 10, 26, 10>>
  @deg_to_rad :math.pi() / 180.0
  @constellation_segments [
    {"hip-8886", "hip-6686"},
    {"hip-6686", "hip-4427"},
    {"hip-4427", "hip-3179"},
    {"hip-3179", "hip-746"},
    {"hip-22449", "hip-25336"},
    {"hip-25336", "hip-26207"},
    {"hip-26207", "hip-27989"},
    {"hip-23607", "hip-22957"},
    {"hip-22957", "hip-22845"},
    {"hip-22845", "hip-22509"},
    {"hip-67301", "hip-65378"},
    {"hip-65378", "hip-62956"},
    {"hip-62956", "hip-59774"},
    {"hip-59774", "hip-58001"},
    {"hip-58001", "hip-57399"},
    {"hip-57399", "hip-55219"},
    {"hip-91971", "hip-91262"},
    {"hip-91262", "hip-91926"},
    {"hip-91926", "hip-91971"}
  ]

  @font %{
    "A" => "01110/10001/10001/11111/10001/10001/10001",
    "B" => "11110/10001/10001/11110/10001/10001/11110",
    "C" => "01111/10000/10000/10000/10000/10000/01111",
    "D" => "11110/10001/10001/10001/10001/10001/11110",
    "E" => "11111/10000/10000/11110/10000/10000/11111",
    "F" => "11111/10000/10000/11110/10000/10000/10000",
    "G" => "01111/10000/10000/10111/10001/10001/01111",
    "H" => "10001/10001/10001/11111/10001/10001/10001",
    "I" => "11111/00100/00100/00100/00100/00100/11111",
    "J" => "00111/00010/00010/00010/10010/10010/01100",
    "K" => "10001/10010/10100/11000/10100/10010/10001",
    "L" => "10000/10000/10000/10000/10000/10000/11111",
    "M" => "10001/11011/10101/10101/10001/10001/10001",
    "N" => "10001/11001/10101/10011/10001/10001/10001",
    "O" => "01110/10001/10001/10001/10001/10001/01110",
    "P" => "11110/10001/10001/11110/10000/10000/10000",
    "Q" => "01110/10001/10001/10001/10101/10010/01101",
    "R" => "11110/10001/10001/11110/10100/10010/10001",
    "S" => "01111/10000/10000/01110/00001/00001/11110",
    "T" => "11111/00100/00100/00100/00100/00100/00100",
    "U" => "10001/10001/10001/10001/10001/10001/01110",
    "V" => "10001/10001/10001/10001/10001/01010/00100",
    "W" => "10001/10001/10001/10101/10101/11011/10001",
    "X" => "10001/10001/01010/00100/01010/10001/10001",
    "Y" => "10001/10001/01010/00100/00100/00100/00100",
    "Z" => "11111/00001/00010/00100/01000/10000/11111",
    "0" => "01110/10001/10011/10101/11001/10001/01110",
    "1" => "00100/01100/00100/00100/00100/00100/01110",
    "2" => "01110/10001/00001/00010/00100/01000/11111",
    "3" => "11110/00001/00001/01110/00001/00001/11110",
    "4" => "00010/00110/01010/10010/11111/00010/00010",
    "5" => "11111/10000/10000/11110/00001/00001/11110",
    "6" => "01110/10000/10000/11110/10001/10001/01110",
    "7" => "11111/00001/00010/00100/01000/01000/01000",
    "8" => "01110/10001/10001/01110/10001/10001/01110",
    "9" => "01110/10001/10001/01111/00001/00001/01110",
    "-" => "00000/00000/00000/11111/00000/00000/00000",
    "." => "00000/00000/00000/00000/00000/00110/00110",
    ":" => "00000/00110/00110/00000/00110/00110/00000",
    "/" => "00001/00010/00010/00100/01000/01000/10000",
    "?" => "01110/10001/00001/00010/00100/00000/00100",
    " " => "00000/00000/00000/00000/00000/00000/00000"
  }

  def width, do: @width
  def height, do: @height

  def render(%State{} = state, observer, points, options \\ []) when is_list(points) do
    pixels = %{}
    pixels = draw_grid(pixels, state)
    pixels = if state.constellations, do: draw_constellations(pixels, state, points), else: pixels
    pixels = draw_points(pixels, state, points)
    pixels = draw_reticle(pixels)
    pixels = draw_card_chrome(pixels, state, observer, Keyword.get(options, :fallback, false))
    encode_png(pixels)
  end

  defp draw_grid(pixels, state) do
    pixels =
      Enum.reduce(0..330//30, pixels, fn longitude, acc ->
        directions = Enum.map(0..72, &direction(longitude, -90 + &1 * 2.5))
        draw_direction_path(acc, directions, state, {27, 58, 66})
      end)

    Enum.reduce([-60, -30, 0, 30, 60], pixels, fn latitude, acc ->
      directions = Enum.map(0..144, &direction(&1 * 2.5, latitude))

      draw_direction_path(
        acc,
        directions,
        state,
        if(latitude == 0, do: {40, 86, 91}, else: {25, 53, 61})
      )
    end)
  end

  defp draw_direction_path(pixels, directions, state, color) do
    {result, _previous} =
      Enum.reduce(directions, {pixels, nil}, fn direction, {acc, previous} ->
        case project(direction, state) do
          nil ->
            {acc, nil}

          projected when is_nil(previous) ->
            {acc, projected}

          projected ->
            if distance(projected, previous) > @width * 0.3,
              do: {acc, projected},
              else: {draw_line(acc, previous, projected, color), projected}
        end
      end)

    result
  end

  defp draw_constellations(pixels, state, points) do
    by_key = Map.new(points, &{&1.key, &1})

    Enum.reduce(@constellation_segments, pixels, fn {left_key, right_key}, acc ->
      with %{direction: left} <- by_key[left_key],
           %{direction: right} <- by_key[right_key],
           projected_left when not is_nil(projected_left) <- project(left, state),
           projected_right when not is_nil(projected_right) <- project(right, state) do
        draw_line(acc, projected_left, projected_right, {176, 137, 53})
      else
        _ -> acc
      end
    end)
  end

  defp draw_points(pixels, state, points) do
    Enum.reduce(points, pixels, fn point, acc ->
      case project(point.direction, state) do
        nil ->
          acc

        projected ->
          draw_circle(
            acc,
            round(projected.x),
            round(projected.y),
            radius(point),
            color(point.color)
          )
      end
    end)
  end

  defp draw_reticle(pixels) do
    center = %{x: @width / 2, y: @height / 2}

    pixels =
      draw_line(
        pixels,
        %{x: center.x - 9, y: center.y},
        %{x: center.x + 9, y: center.y},
        {111, 91, 45}
      )

    draw_line(
      pixels,
      %{x: center.x, y: center.y - 9},
      %{x: center.x, y: center.y + 9},
      {111, 91, 45}
    )
  end

  defp draw_card_chrome(pixels, state, observer, fallback?) do
    pixels =
      Map.reject(pixels, fn {offset, _color} ->
        div(offset, @width) <= 198 or div(offset, @width) >= 497
      end)

    pixels = put_text(pixels, "COSMIC ATLAS / SKYCHART.ORG", 52, 34, 3, {130, 203, 179}, 70)

    pixels =
      put_text(pixels, Copy.title(state.locale, observer.name), 52, 78, 5, {243, 238, 223}, 38)

    pixels =
      put_text(
        pixels,
        "UTC " <> DateTime.to_iso8601(state.epoch_utc),
        52,
        142,
        3,
        {215, 222, 216},
        62
      )

    pixels = put_text(pixels, distance_context(observer), 52, 516, 3, {248, 203, 101}, 62)

    settings =
      "CONSTELLATIONS " <>
        if(state.constellations, do: "ON", else: "OFF") <>
        hidden_context(state.hidden_object_types)

    pixels = put_text(pixels, settings, 52, 553, 2, {151, 183, 173}, 90)
    pixels = put_text(pixels, Copy.disclosure(state.locale), 52, 582, 2, {193, 202, 196}, 91)

    if fallback?,
      do:
        put_text(
          pixels,
          "CATALOG SCENE UNAVAILABLE / BRANDED FALLBACK",
          680,
          516,
          2,
          {248, 203, 101},
          40
        ),
      else: pixels
  end

  defp hidden_context([]), do: ""
  defp hidden_context(types), do: " / HIDDEN " <> Enum.join(types, ",")

  defp distance_context(%{distance_from_earth_km: distance})
       when is_number(distance) and distance < 1.0,
       do: "OBSERVER CONTEXT / EARTH"

  defp distance_context(%{distance_from_earth_km: distance}) when is_number(distance) do
    au = distance / 149_597_870.7

    if au < 100_000,
      do: "DISTANCE FROM EARTH / " <> format_number(au) <> " AU",
      else: "DISTANCE FROM EARTH / " <> format_number(distance / 9_460_730_472_580.8) <> " LY"
  end

  defp distance_context(_), do: "DISTANCE FROM EARTH / NOT SUPPLIED"

  defp project(vector, state) do
    yaw = state.yaw_deg * @deg_to_rad
    pitch = state.pitch_deg * @deg_to_rad

    forward = %{
      x: :math.cos(pitch) * :math.cos(yaw),
      y: :math.cos(pitch) * :math.sin(yaw),
      z: :math.sin(pitch)
    }

    right = %{x: -:math.sin(yaw), y: :math.cos(yaw), z: 0.0}

    up = %{
      x: -:math.sin(pitch) * :math.cos(yaw),
      y: -:math.sin(pitch) * :math.sin(yaw),
      z: :math.cos(pitch)
    }

    depth = dot(vector, forward)

    if depth <= 1.0e-4 do
      nil
    else
      focal = min(@width, @height) / (2.0 * :math.tan(state.fov_deg * @deg_to_rad / 2.0))
      x = @width / 2.0 + dot(vector, right) * focal / depth
      y = @height / 2.0 - dot(vector, up) * focal / depth
      if x < -16 or x > @width + 16 or y < -16 or y > @height + 16, do: nil, else: %{x: x, y: y}
    end
  end

  defp direction(longitude_deg, latitude_deg) do
    longitude = longitude_deg * @deg_to_rad
    latitude = latitude_deg * @deg_to_rad

    %{
      x: :math.cos(latitude) * :math.cos(longitude),
      y: :math.cos(latitude) * :math.sin(longitude),
      z: :math.sin(latitude)
    }
  end

  defp dot(left, right), do: left.x * right.x + left.y * right.y + left.z * right.z
  defp distance(left, right), do: :math.sqrt(square(left.x - right.x) + square(left.y - right.y))
  defp square(value), do: value * value

  defp radius(%{dynamic: true, type: "star"}), do: 5
  defp radius(%{dynamic: true}), do: 4

  defp radius(%{magnitude: value}) when is_number(value),
    do: value |> then(&(3.2 - &1 * 0.18)) |> max(1.0) |> min(4.0) |> round()

  defp radius(_), do: 1

  defp color("#" <> hex) when byte_size(hex) == 6 do
    with {red, ""} <- Integer.parse(binary_part(hex, 0, 2), 16),
         {green, ""} <- Integer.parse(binary_part(hex, 2, 2), 16),
         {blue, ""} <- Integer.parse(binary_part(hex, 4, 2), 16),
         do: {red, green, blue},
         else: (_ -> {216, 232, 255})
  end

  defp color(_), do: {216, 232, 255}

  defp draw_circle(pixels, center_x, center_y, radius, color) do
    Enum.reduce(-radius..radius, pixels, fn dy, acc ->
      Enum.reduce(-radius..radius, acc, fn dx, inner ->
        if dx * dx + dy * dy <= radius * radius,
          do: put_pixel(inner, center_x + dx, center_y + dy, color),
          else: inner
      end)
    end)
  end

  defp draw_line(pixels, left, right, color) do
    x0 = round(left.x)
    y0 = round(left.y)
    x1 = round(right.x)
    y1 = round(right.y)

    bresenham(
      pixels,
      x0,
      y0,
      x1,
      y1,
      abs(x1 - x0),
      -abs(y1 - y0),
      if(x0 < x1, do: 1, else: -1),
      if(y0 < y1, do: 1, else: -1),
      abs(x1 - x0) - abs(y1 - y0),
      color
    )
  end

  defp bresenham(pixels, x, y, x, y, _dx, _dy, _sx, _sy, _error, color),
    do: put_pixel(pixels, x, y, color)

  defp bresenham(pixels, x, y, x1, y1, dx, dy, sx, sy, error, color) do
    pixels = put_pixel(pixels, x, y, color)
    doubled = 2 * error
    {next_x, next_error} = if doubled >= dy, do: {x + sx, error + dy}, else: {x, error}
    {next_y, next_error} = if doubled <= dx, do: {y + sy, next_error + dx}, else: {y, next_error}
    bresenham(pixels, next_x, next_y, x1, y1, dx, dy, sx, sy, next_error, color)
  end

  defp fill_rect(pixels, left, top, right, bottom, color) do
    Enum.reduce(top..bottom, pixels, fn y, acc ->
      Enum.reduce(left..right, acc, fn x, inner -> put_pixel(inner, x, y, color) end)
    end)
  end

  defp put_text(pixels, value, x, y, scale, color, max_graphemes) do
    graphemes = value |> String.upcase() |> String.graphemes()

    graphemes =
      if length(graphemes) > max_graphemes,
        do: Enum.take(graphemes, max_graphemes - 3) ++ [".", ".", "."],
        else: graphemes

    graphemes
    |> Enum.with_index()
    |> Enum.reduce(pixels, fn {grapheme, index}, acc ->
      pattern = Map.get(@font, grapheme, @font["?"])
      draw_glyph(acc, pattern, x + index * 6 * scale, y, scale, color)
    end)
  end

  defp draw_glyph(pixels, pattern, x, y, scale, color) do
    pattern
    |> String.split("/")
    |> Enum.with_index()
    |> Enum.reduce(pixels, fn {row, row_index}, acc ->
      row
      |> String.graphemes()
      |> Enum.with_index()
      |> Enum.reduce(acc, fn
        {"1", column_index}, inner ->
          fill_rect(
            inner,
            x + column_index * scale,
            y + row_index * scale,
            x + (column_index + 1) * scale - 1,
            y + (row_index + 1) * scale - 1,
            color
          )

        {_value, _column_index}, inner ->
          inner
      end)
    end)
  end

  defp put_pixel(pixels, x, y, color) when x >= 0 and x < @width and y >= 0 and y < @height,
    do: Map.put(pixels, y * @width + x, color)

  defp put_pixel(pixels, _x, _y, _color), do: pixels

  defp encode_png(pixels) do
    raw =
      for y <- 0..(@height - 1), into: <<>> do
        row =
          for x <- 0..(@width - 1), into: <<>> do
            {red, green, blue} = Map.get(pixels, y * @width + x, background(x, y))
            <<red, green, blue>>
          end

        <<0, row::binary>>
      end

    ihdr = <<@width::unsigned-big-32, @height::unsigned-big-32, 8, 2, 0, 0, 0>>
    @signature <> chunk("IHDR", ihdr) <> chunk("IDAT", :zlib.compress(raw)) <> chunk("IEND", <<>>)
  end

  defp background(_x, y) when y <= 198, do: {5, 10, 13}
  defp background(_x, y) when y >= 497, do: {4, 8, 10}

  defp background(x, y) do
    vertical = round(13 - 7 * y / @height)
    vignette = round(abs(x - @width / 2) / (@width / 2) * 3)

    {max(2, vertical - vignette - 4), max(5, vertical - vignette),
     max(7, vertical - vignette + 3)}
  end

  defp chunk(type, data) do
    payload = type <> data
    <<byte_size(data)::unsigned-big-32, payload::binary, :erlang.crc32(payload)::unsigned-big-32>>
  end

  defp format_number(value) when value >= 10_000 or value < 0.01,
    do: :erlang.float_to_binary(value, [:scientific, decimals: 2])

  defp format_number(value), do: :erlang.float_to_binary(value, [:compact, decimals: 3])
end

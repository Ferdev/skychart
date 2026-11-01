defmodule StarsmapApi.Flights.Verifier do
  @moduledoc """
  The deterministic check of a narration. No model takes part in it.

  A model does not write a number. A sentence has text segments, and `fact` segments that point
  at one value of a stored tool result. The verifier takes the number from that result and
  compares the unit of the segment with the unit of the field. A text segment with a digit or a
  number word fails, in each supported language. A name in a text segment must come from the
  tool results, and a `fact` must belong to an object of its sentence. So a sentence in a
  published flight cannot hold a number that has no record behind it.

  This check does not find a wrong claim with no number and no name. See `docs/answer-flights.md`.
  """

  @max_steps 10
  @min_steps 4
  @max_sentences 4
  @max_text 400
  @max_title 120
  @min_supported 0.7

  # A word that is a common article in a language is not here: "one", "un", "ein", "一".
  @number_words %{
    "en" =>
      ~w(two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred hundreds thousand thousands million millions billion billions trillion trillions dozen dozens),
    "es" =>
      ~w(dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince veinte treinta cuarenta cincuenta sesenta setenta ochenta noventa cien ciento cientos mil millón millones billón billones docena),
    "fr" =>
      ~w(deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize vingt trente quarante cinquante soixante cent cents mille million millions milliard milliards douzaine),
    "de" =>
      ~w(zwei drei vier fünf sechs sieben acht neun zehn elf zwölf zwanzig dreißig vierzig fünfzig sechzig siebzig achtzig neunzig hundert tausend million millionen milliarde milliarden billion billionen dutzend),
    "pt-BR" =>
      ~w(dois duas três quatro cinco seis sete oito nove dez onze doze treze quinze vinte trinta quarenta cinquenta sessenta setenta oitenta noventa cem cento mil milhão milhões bilhão bilhões trilhão dúzia),
    "it" =>
      ~w(due tre quattro cinque sei sette otto nove dieci undici dodici venti trenta quaranta cinquanta sessanta settanta ottanta novanta cento mille mila milione milioni miliardo miliardi dozzina),
    "zh-Hans" => ~w(二 两 三 四 五 六 七 八 九 十 百 千 万 亿),
    "ja" => ~w(二 三 四 五 六 七 八 九 十 百 千 万 億),
    "ko" => ~w(백만 천만 십억 억)
  }
  @whole_word_locales ~w(en es fr de pt-BR it)
  # German writes each noun with a capital, and the other two scripts have no capitals.
  @capital_name_locales ~w(en es fr pt-BR it)

  @units [
    {~r/(^|_)light_years$|_ly$/, "ly"},
    {~r/(^|_)parsecs$|_pc$/, "pc"},
    {~r/(^|_)au$/, "au"},
    {~r/(^|_)km$/, "km"},
    {~r/_deg$/, "deg"},
    {~r/_minutes$/, "min"},
    {~r/_hours$/, "h"},
    {~r/_seconds$/, "s"},
    {~r/_mas$/, "mas"},
    {~r/magnitude$/, "mag"}
  ]

  def locales, do: Map.keys(@number_words)
  def min_steps, do: @min_steps
  def max_steps, do: @max_steps

  @doc "The unit of a field of a tool result, from its name. An empty text is a plain count."
  def unit_of(field) do
    Enum.find_value(@units, "", fn {pattern, unit} -> if field =~ pattern, do: unit end)
  end

  @doc """
  Checks one submission. `results` maps a reference to a stored tool result, with string keys.
  It returns the steps that passed and the report, or `{:error, text}` for a wrong shape.
  """
  def check(%{"steps" => steps} = input, results, locale)
      when is_list(steps) and is_map(results) do
    known = known_names(results)

    checked =
      steps
      |> Enum.take(@max_steps)
      |> Enum.with_index()
      |> Enum.map(&check_step(&1, results, locale, known))

    if Enum.any?(checked, &(&1 == :invalid)) do
      {:error,
       "Each step needs a title and a list of sentences. A sentence is a list of segments."}
    else
      {:ok, summary(input, checked, length(steps), locale, known)}
    end
  end

  def check(_, _, _), do: {:error, "The submission needs a list of steps."}

  defp summary(input, checked, submitted_steps, locale, known) do
    removed = Enum.flat_map(checked, & &1.removed)
    total = checked |> Enum.map(& &1.total) |> Enum.sum()
    kept = Enum.filter(checked, &(&1.sentences != []))
    passed = kept |> Enum.map(&length(&1.sentences)) |> Enum.sum()

    %{
      title: clean_title(input["title"], locale, known),
      steps: Enum.map(kept, &Map.take(&1, [:title, :object_key, :zoom, :sentences])),
      report: %{
        sentences: total,
        supported: passed,
        removed: removed,
        steps_submitted: submitted_steps,
        steps_kept: length(kept)
      },
      clean: removed == [] and submitted_steps in @min_steps..@max_steps,
      publishable:
        length(kept) >= @min_steps and total > 0 and passed / max(total, 1) >= @min_supported
    }
  end

  defp clean_title(title, locale, known) when is_binary(title) do
    trimmed = title |> String.trim() |> String.slice(0, @max_title)
    if trimmed != "" and text_problem(trimmed, locale, known, true) == nil, do: trimmed, else: nil
  end

  defp clean_title(_, _, _), do: nil

  defp check_step(
         {%{"title" => title, "sentences" => sentences} = step, index},
         results,
         locale,
         known
       )
       when is_binary(title) and is_list(sentences) do
    object_key = step_object(step["object_key"], known)

    outcome =
      sentences
      |> Enum.take(@max_sentences)
      |> Enum.with_index()
      |> Enum.map(fn {sentence, position} ->
        {position, check_sentence(sentence, results, locale, known, object_key)}
      end)

    title_problem = text_problem(String.trim(title), locale, known, true)

    removed =
      Enum.flat_map(outcome, fn
        {position, {:error, reason}} -> [%{step: index, sentence: position, reason: reason}]
        _ -> []
      end)

    %{
      title: if(title_problem, do: "", else: String.slice(String.trim(title), 0, @max_title)),
      object_key: object_key,
      zoom: if(is_number(step["zoom"]), do: step["zoom"], else: nil),
      sentences:
        if(title_problem,
          do: [],
          else: for({_, {:ok, sentence}} <- outcome, do: sentence)
        ),
      total: length(outcome),
      removed:
        if(title_problem,
          do: [%{step: index, sentence: nil, reason: title_problem}],
          else: removed
        )
    }
  end

  defp check_step(_, _, _, _), do: :invalid

  defp step_object(key, known) when is_binary(key) do
    if MapSet.member?(known.keys, key), do: key, else: nil
  end

  defp step_object(_, _), do: nil

  defp check_sentence(segments, results, locale, known, step_object)
       when is_list(segments) and segments != [] do
    checked =
      segments
      |> Enum.with_index()
      |> Enum.map(fn {segment, position} ->
        check_segment(segment, results, locale, known, position == 0)
      end)

    case Enum.find(checked, &match?({:error, _}, &1)) do
      {:error, reason} ->
        {:error, reason}

      nil ->
        sentence = Enum.map(checked, fn {:ok, value} -> value end)

        if facts_belong?(sentence, step_object),
          do: {:ok, sentence},
          else: {:error, "fact_of_another_object"}
    end
  end

  defp check_sentence(_, _, _, _, _), do: {:error, "empty_sentence"}

  defp check_segment(%{"kind" => "text", "text" => text}, _, locale, known, first?)
       when is_binary(text) do
    cond do
      String.length(text) > @max_text -> {:error, "text_too_long"}
      problem = text_problem(text, locale, known, first?) -> {:error, problem}
      true -> {:ok, %{kind: "text", text: text}}
    end
  end

  defp check_segment(%{"kind" => "object", "object_key" => key}, _, _, known, _)
       when is_binary(key) do
    case known.names[key] do
      nil -> {:error, "object_not_in_results"}
      name -> {:ok, %{kind: "object", key: key, text: name}}
    end
  end

  defp check_segment(
         %{"kind" => "fact", "ref" => ref, "path" => path} = segment,
         results,
         _,
         _,
         _
       )
       when is_binary(ref) and is_binary(path) do
    with {:ok, result} <- Map.fetch(results, ref),
         parts = String.split(path, "."),
         {:ok, value} <- dig(result["result"], parts),
         true <- is_number(value),
         unit = unit_of(List.last(parts)),
         true <- unit == (segment["unit"] || "") do
      {:ok,
       %{
         kind: "fact",
         value: value,
         unit: unit,
         ref: ref,
         path: path,
         keys: source_keys(result["result"], parts),
         as_of: result["result"]["time_utc"]
       }}
    else
      :error -> {:error, "fact_not_in_results"}
      false -> {:error, "fact_unit_mismatch"}
    end
  end

  defp check_segment(_, _, _, _, _), do: {:error, "unknown_segment"}

  defp dig(value, []), do: {:ok, value}

  defp dig(value, [part | rest]) when is_map(value) do
    case Map.fetch(value, part) do
      {:ok, next} -> dig(next, rest)
      :error -> :error
    end
  end

  defp dig(value, [part | rest]) when is_list(value) do
    case Integer.parse(part) do
      {index, ""} when index >= 0 and index < length(value) ->
        dig(Enum.at(value, index), rest)

      _ ->
        :error
    end
  end

  defp dig(_, _), do: :error

  # The record of a value: the nearest map on its path with a key. A separation has two records.
  defp source_keys(%{"from" => %{"key" => from}, "to" => %{"key" => to}}, ["separation" | _]),
    do: [from, to]

  defp source_keys(result, parts) do
    parts
    |> Enum.drop(-1)
    |> Enum.reduce({result, []}, fn part, {value, keys} ->
      next =
        cond do
          is_map(value) -> value[part]
          is_list(value) -> Enum.at(value, String.to_integer(part))
          true -> nil
        end

      {next, if(is_map(next) and is_binary(next["key"]), do: [next["key"]], else: keys)}
    end)
    |> elem(1)
  end

  # A fact in a sentence that names objects must come from one of them. In a sentence with no
  # name, the object of the step is the subject.
  defp facts_belong?(sentence, step_object) do
    named = for %{kind: "object", key: key} <- sentence, do: key
    subjects = if named == [], do: List.wrap(step_object), else: named

    subjects == [] or
      Enum.all?(sentence, fn
        %{kind: "fact", keys: []} -> true
        %{kind: "fact", keys: keys} -> Enum.any?(keys, &(&1 in subjects))
        _ -> true
      end)
  end

  defp text_problem(text, locale, known, first?) do
    bare = remove_known(text, known)

    cond do
      String.match?(bare, ~r/\p{Nd}/u) -> "number_in_text"
      number_word?(bare, locale) -> "number_in_text"
      unknown_name?(bare, locale, first?) -> "name_not_in_results"
      true -> nil
    end
  end

  # The longest name goes first, so that a long name does not leave a part of itself.
  defp remove_known(text, known) do
    Enum.reduce(known.words, text, fn name, rest ->
      Regex.replace(known.patterns[name], rest, " ")
    end)
  end

  defp number_word?(text, locale) do
    words = Map.get(@number_words, locale, [])

    if locale in @whole_word_locales do
      tokens = text |> String.downcase() |> String.split(~r/[^\p{L}]+/u, trim: true)
      Enum.any?(tokens, &(&1 in words))
    else
      Enum.any?(words, &String.contains?(text, &1))
    end
  end

  defp unknown_name?(text, locale, first?) when locale in @capital_name_locales do
    tokens = String.split(text, ~r/[^\p{L}]+/u, trim: true)
    tokens = if first?, do: Enum.drop(tokens, 1), else: tokens
    Enum.any?(tokens, &(&1 =~ ~r/^\p{Lu}/u))
  end

  defp unknown_name?(_, _, _), do: false

  @doc "The keys and the names in the tool results."
  def known_names(results) do
    pairs =
      results
      |> Map.values()
      |> Enum.flat_map(&collect(&1["result"]))

    names = Map.new(for {key, name} <- pairs, is_binary(key), do: {key, name})
    words = pairs |> Enum.map(&elem(&1, 1)) |> Enum.reject(&(&1 == "")) |> Enum.uniq()
    aliases = results |> Map.values() |> Enum.flat_map(&aliases(&1["result"]))

    # A name of digits only must not hide a number of the same digits in a sentence.
    words =
      (words ++ aliases)
      |> Enum.uniq()
      |> Enum.filter(&(String.length(&1) >= 2 and &1 =~ ~r/\p{L}/u))
      |> Enum.sort_by(&(-String.length(&1)))

    %{
      keys: MapSet.new(Map.keys(names)),
      names: names,
      words: words,
      patterns: Map.new(words, &{&1, Regex.compile!(Regex.escape(&1), "iu")})
    }
  end

  defp collect(value) when is_map(value) do
    own =
      case {value["key"], value["name"]} do
        {key, name} when is_binary(key) and is_binary(name) -> [{key, name}]
        _ -> []
      end

    own ++ (value |> Map.values() |> Enum.flat_map(&collect/1))
  end

  defp collect(value) when is_list(value), do: Enum.flat_map(value, &collect/1)
  defp collect(_), do: []

  defp aliases(value) when is_map(value) do
    own = if is_list(value["aliases"]), do: Enum.filter(value["aliases"], &is_binary/1), else: []
    own ++ (value |> Map.values() |> Enum.flat_map(&aliases/1))
  end

  defp aliases(value) when is_list(value), do: Enum.flat_map(value, &aliases/1)
  defp aliases(_), do: []
end

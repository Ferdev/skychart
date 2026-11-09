defmodule StarsmapApi.Flights.AnswerFlight do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "answer_flights" do
    field :slug, :string
    field :question, :string
    field :normalized_question, :string
    field :locale, :string
    field :status, :string
    field :title, :string
    field :steps, :map, default: %{}
    field :tool_results, :map, default: %{}
    field :verifier, :map, default: %{}
    field :model, :string
    field :refusal, :string
    field :input_tokens, :integer, default: 0
    field :output_tokens, :integer, default: 0
    field :cost_usd, :float, default: 0.0
    timestamps(type: :utc_datetime_usec)
  end
end

defmodule StarsmapApi.Flights.Spend do
  use Ecto.Schema
  @primary_key {:day, :date, autogenerate: false}
  schema "answer_flight_spend" do
    field :cost_usd, :float, default: 0.0
    field :calls, :integer, default: 0
  end
end

defmodule StarsmapApi.Flights do
  @moduledoc """
  Answer flights: one question gives one narrated flight, or a refusal with a nearby tour.

  The same question in the same language reuses the stored result, so a replay makes no model
  call. A daily cap stops new model calls, and the feature stays off with no API key.
  """
  import Ecto.Query

  alias StarsmapApi.AgentInterface
  alias StarsmapApi.AgentSky
  alias StarsmapApi.CommunityRepo, as: Repo
  alias StarsmapApi.Flights.{AnswerFlight, Spend, Verifier, Worker}

  @min_question 8
  @max_question 200
  @default_view "v=1&c=0%2C0&z=24&t=now"
  # Oban stops a flight job after this time.
  @job_limit_seconds 300
  # A job that stopped with a deploy leaves its row. After this time, a new request starts again.
  # It is longer than the job limit, so that a live job is never started a second time.
  @stale_seconds 2 * @job_limit_seconds
  @reusable ~w(published refused hidden)
  # Personal data has no place on a public page, and a link is never a sky question.
  @personal [
    ~r/[^\s@]+@[^\s@]+\.[^\s@]+/u,
    ~r/https?:\/\/|www\./iu
  ]
  # A run of digits with the separators of a phone number. `phone?/1` decides on each run.
  @digit_run ~r/(?<![\w+])(?:\+\s*)?\(?\d[\d\s().-]*\d\)?/u

  def enabled? do
    StarsmapApi.Community.enabled?() and
      match?(key when is_binary(key) and key != "", api_key())
  end

  defp api_key, do: Application.get_env(:starsmap_api, :answer_flight_api_key)

  def model_name,
    do: Application.get_env(:starsmap_api, :answer_flight_model_name, "claude-opus-5-5")

  def daily_limit, do: Application.get_env(:starsmap_api, :answer_flight_daily_usd, 5.0)

  def spent_today do
    case Repo.get(Spend, today()) do
      nil -> 0.0
      spend -> spend.cost_usd
    end
  end

  def over_budget?, do: spent_today() >= daily_limit()

  def add_spend(cost) do
    Repo.insert!(
      %Spend{day: today(), cost_usd: cost, calls: 1},
      on_conflict: [inc: [cost_usd: cost, calls: 1]],
      conflict_target: :day
    )
  end

  defp today, do: Date.utc_today()

  def normalize(question) do
    question
    |> String.normalize(:nfc)
    |> String.downcase()
    |> String.replace(~r/\s+/u, " ")
    |> String.trim()
    |> String.trim_trailing("?")
    |> String.trim_trailing("？")
    |> String.trim_trailing(".")
    |> String.trim_trailing("!")
    |> String.trim()
  end

  @doc "Starts a flight, or returns the stored flight of the same question and language."
  def request(question, locale) do
    with :ok <- check_feature(),
         {:ok, text} <- clean_question(question),
         {:ok, locale} <- check_locale(locale) do
      normalized = normalize(text)

      case Repo.get_by(AnswerFlight, normalized_question: normalized, locale: locale) do
        %AnswerFlight{status: status} = flight when status in @reusable ->
          {:ok, flight}

        %AnswerFlight{} = flight ->
          if stale?(flight), do: restart(flight), else: {:ok, flight}

        nil ->
          start(text, normalized, locale)
      end
    end
  end

  defp check_feature, do: if(enabled?(), do: :ok, else: {:error, :flights_unavailable})

  defp clean_question(question) when is_binary(question) do
    text = question |> String.replace(~r/[\p{Cc}\p{Cf}]/u, " ") |> String.trim()

    cond do
      not String.valid?(text) -> {:error, :question_rejected}
      String.length(text) < @min_question -> {:error, :question_rejected}
      String.length(text) > @max_question -> {:error, :question_rejected}
      Enum.any?(@personal, &(text =~ &1)) -> {:error, :question_rejected}
      phone?(text) -> {:error, :question_rejected}
      true -> {:ok, text}
    end
  end

  defp clean_question(_), do: {:error, :question_rejected}

  # A phone number has a plus and 8 or more digits, or 10 to 15 digits in groups. A date such as
  # 2026-11-05 and a catalog number with no separators, such as a Gaia DR3 id, are no phone number.
  defp phone?(text) do
    @digit_run
    |> Regex.scan(text)
    |> Enum.any?(fn [run] ->
      digits = run |> String.replace(~r/\D/u, "") |> String.length()

      cond do
        String.starts_with?(run, "+") -> digits >= 8
        not String.match?(run, ~r/[\s().-]/u) -> false
        String.match?(run, ~r/\d{4}-\d{2}-\d{2}/u) -> false
        true -> digits in 10..15
      end
    end)
  end

  @doc "The longest time of one flight job, in seconds."
  def job_limit_seconds, do: @job_limit_seconds

  defp check_locale(locale) do
    if locale in Verifier.locales(), do: {:ok, locale}, else: {:error, :question_rejected}
  end

  defp stale?(%AnswerFlight{status: "failed"}), do: true

  defp stale?(flight),
    do: DateTime.diff(StarsmapApi.Community.now(), flight.updated_at) > @stale_seconds

  defp start(text, normalized, locale) do
    if over_budget?() do
      {:error, :daily_limit}
    else
      now = StarsmapApi.Community.now()

      row = %{
        id: Ecto.UUID.generate(),
        slug: slug(normalized, locale),
        question: text,
        normalized_question: normalized,
        locale: locale,
        status: "queued",
        inserted_at: now,
        updated_at: now
      }

      Repo.transaction(fn ->
        # Two requests for one new question can arrive at the same time. Only the request that
        # inserts the row starts a job. The other gets the row of the first.
        case Repo.insert_all(AnswerFlight, [row],
               on_conflict: :nothing,
               conflict_target: [:normalized_question, :locale]
             ) do
          {1, _} ->
            {:ok, _} = Oban.insert(StarsmapApi.CommunityJobs, Worker.new(%{id: row.id}))
            Repo.get!(AnswerFlight, row.id)

          {0, _} ->
            Repo.get_by!(AnswerFlight, normalized_question: normalized, locale: locale)
        end
      end)
    end
  end

  defp restart(flight) do
    if over_budget?() do
      {:error, :daily_limit}
    else
      Repo.transaction(fn ->
        changed =
          flight
          |> Ecto.Changeset.change(status: "queued", refusal: nil)
          |> Ecto.Changeset.force_change(:updated_at, StarsmapApi.Community.now())
          |> Repo.update!()

        {:ok, _} = Oban.insert(StarsmapApi.CommunityJobs, Worker.new(%{id: flight.id}))
        changed
      end)
    end
  end

  defp slug(normalized, locale) do
    :crypto.hash(:sha256, locale <> "\n" <> normalized)
    |> Base.encode16(case: :lower)
    |> binary_part(0, 16)
  end

  def get(slug) when is_binary(slug), do: Repo.get_by(AnswerFlight, slug: slug)
  def get(_), do: nil

  @doc "The operator stops a public flight. The same question then gets a refusal."
  def hide(slug) do
    case get(slug) do
      nil ->
        {:error, :not_found}

      flight ->
        {:ok,
         flight
         |> Ecto.Changeset.change(status: "hidden", steps: %{"steps" => []}, refusal: "hidden")
         |> Repo.update!()}
    end
  end

  @doc """
  The job takes a queued flight. Only one job can take it: a second job for the same flight, or a
  job for a flight that is now hidden, gets `:taken` and makes no model call.
  """
  def mark_running(%AnswerFlight{id: id} = flight) do
    now = StarsmapApi.Community.now()

    case Repo.update_all(from(f in AnswerFlight, where: f.id == ^id and f.status == "queued"),
           set: [status: "running", updated_at: now]
         ) do
      {1, _} -> {:ok, %{flight | status: "running", updated_at: now}}
      {0, _} -> :taken
    end
  end

  def publish(flight, checked, state) do
    steps = with_views(checked.steps) |> with_sources(state.results)

    finish(flight, state,
      status: "published",
      title: checked.title || flight.question,
      steps: %{"steps" => steps},
      verifier: Map.take(checked, [:report])
    )
  end

  def refuse(flight, reason, state),
    do: finish(flight, state, status: "refused", refusal: reason)

  def fail(flight, reason, state),
    do: finish(flight, state, status: "failed", refusal: String.slice(reason, 0, 200))

  # The result goes in only while the flight is still running. A flight that the operator hid
  # during the job stays hidden. The spend of the job is in the daily total in each case.
  defp finish(%AnswerFlight{id: id} = flight, state, changes) do
    changes =
      changes ++
        [
          tool_results: state.results,
          model: state.model,
          input_tokens: flight.input_tokens + state.input_tokens,
          output_tokens: flight.output_tokens + state.output_tokens,
          cost_usd: flight.cost_usd + state.cost,
          updated_at: StarsmapApi.Community.now()
        ]

    case Repo.update_all(from(f in AnswerFlight, where: f.id == ^id and f.status == "running"),
           set: changes
         ) do
      {1, _} -> {:ok, Repo.get!(AnswerFlight, id)}
      {0, _} -> {:error, :not_running}
    end
  end

  # A step with no place keeps the view of the step before it.
  defp with_views(steps) do
    {views, _} =
      Enum.map_reduce(steps, @default_view, fn step, previous ->
        view = view_state(step) || previous
        {Map.put(step, :view_state, view), view}
      end)

    views
  end

  defp view_state(%{object_key: key} = step) when is_binary(key) do
    arguments =
      %{"object_key" => key}
      |> then(&if step.zoom, do: Map.put(&1, "zoom", step.zoom), else: &1)

    case AgentInterface.view_link(arguments) do
      {:ok, %{url: url}} ->
        URI.parse(url).query

      # A moving body has no fixed place. The atlas finds it from the selected key at this time.
      _ ->
        URI.encode_query([
          {"v", "1"},
          {"c", "0,0"},
          {"z", step.zoom || 24},
          {"t", "now"},
          {"o", key}
        ])
    end
  end

  defp view_state(_), do: nil

  # The last step lists each record that the narration reads.
  defp with_sources(steps, results) do
    names = Verifier.known_names(results).names

    keys =
      steps
      |> Enum.flat_map(& &1.sentences)
      |> List.flatten()
      |> Enum.flat_map(fn
        %{kind: "fact", keys: keys} -> keys
        %{kind: "object", key: key} -> [key]
        _ -> []
      end)
      |> Enum.uniq()

    sources =
      Enum.map(keys, fn key ->
        %{key: key, name: names[key] || key, catalog: catalog_of(key, results), url: "/o/#{key}"}
      end)

    List.update_at(steps, -1, &Map.put(&1, :sources, sources))
  end

  defp catalog_of(key, results) do
    Enum.find_value(results, fn {_, %{"result" => result}} ->
      if get_in(result, ["object", "key"]) == key do
        get_in(result, ["provenance", "catalog", "name"]) ||
          get_in(result, ["provenance", "source_type"])
      end
    end)
  end

  @doc "The data of the player and of the page. A flight that is not ready has only its state."
  def public(%AnswerFlight{} = flight) do
    base = %{
      slug: "answer-#{flight.slug}",
      flight: flight.slug,
      status: public_status(flight),
      question: flight.question,
      locale: flight.locale
    }

    case base.status do
      "published" ->
        Map.merge(base, %{
          title: flight.title,
          description: flight.question,
          created_at: flight.inserted_at,
          narrated: true,
          steps: Enum.map(flight.steps["steps"] || [], &step/1)
        })

      "refused" ->
        Map.merge(base, %{refusal: flight.refusal, suggested_tour: nearby_tour(flight)})

      # Only this reason is public. Another failure can hold the text of a server error.
      "failed" ->
        Map.put(base, :refusal, if(flight.refusal == "daily_limit", do: "daily_limit"))

      _ ->
        base
    end
  end

  defp public_status(%AnswerFlight{status: "hidden"}), do: "refused"
  defp public_status(%AnswerFlight{status: status}), do: status

  defp step(step) do
    segments = step["sentences"] || []

    %{
      viewState: step["view_state"],
      title: step["title"],
      body: plain_text(segments),
      sentences: segments,
      sources: step["sources"]
    }
  end

  defp plain_text(sentences) do
    Enum.map_join(sentences, " ", fn sentence ->
      Enum.map_join(sentence, "", fn
        %{"kind" => "fact", "value" => value, "unit" => unit} -> "#{value} #{unit}"
        %{"text" => text} -> text
      end)
    end)
  end

  @doc "The guided tour with the most words of the question, else the first tour."
  def nearby_tour(%AnswerFlight{normalized_question: question}, tours \\ AgentSky.tours().tours) do
    words = question |> String.split(~r/[^\p{L}\p{N}]+/u, trim: true) |> MapSet.new()

    best =
      Enum.max_by(
        tours,
        fn tour ->
          "#{tour.title} #{tour.description}"
          |> String.downcase()
          |> String.split(~r/[^\p{L}\p{N}]+/u, trim: true)
          |> MapSet.new()
          |> MapSet.intersection(words)
          |> MapSet.size()
        end,
        fn -> nil end
      )

    best && %{slug: best.slug, title: best.title}
  end

  @doc "The counts of the operator report in `docs/answer-flights.md`."
  def usage(days \\ 7) do
    since = DateTime.add(StarsmapApi.Community.now(), -days * 86_400, :second)

    Repo.all(
      from f in AnswerFlight,
        where: f.inserted_at >= ^since,
        group_by: f.status,
        select: {f.status, count(), sum(f.cost_usd)}
    )
  end
end

defmodule StarsmapApi.Flights.Worker do
  @moduledoc """
  One question. This queue runs in the web container, next to the scientific service that
  the position tools need. It waits for the network and holds no image in memory.
  """
  use Oban.Worker,
    queue: :flights,
    max_attempts: 1,
    unique: [keys: [:id], period: 300, states: [:available, :scheduled, :executing]]

  alias StarsmapApi.CommunityRepo, as: Repo
  alias StarsmapApi.Flights
  alias StarsmapApi.Flights.{Agent, AnswerFlight}

  @impl true
  def timeout(_job), do: :timer.seconds(Flights.job_limit_seconds())

  @impl true
  def perform(%Oban.Job{args: %{"id" => id}}) do
    # A running flight has a job already. A job that stopped leaves it running, and a new
    # request starts that flight again after the stale time.
    with %AnswerFlight{status: "queued"} = flight <- Repo.get(AnswerFlight, id),
         {:ok, flight} <- Flights.mark_running(flight) do
      case Agent.run(flight) do
        {:publish, checked, state} -> Flights.publish(flight, checked, state)
        {:refuse, reason, state} -> Flights.refuse(flight, reason, state)
        {:fail, reason, state} -> Flights.fail(flight, reason, state)
      end
    end

    :ok
  end
end

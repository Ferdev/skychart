# Answer flights

A person asks a sky question in the search panel. The atlas answers with a short narrated
flight in the tour player. Each number in the narration is a chip that opens its source
record, and the last step lists the sources. One question gives one flight of 4 to 10 steps.
The first version has no follow-up chat, no live classroom sync, no generated images, and no
accounts. It answers only questions about the atlas.

## Activation

The feature is off with no key. The form stays hidden, and `POST /api/flights` answers
`flights_unavailable`. It also needs `COMMUNITY_ENABLED`, because `answer_flights` is in
`CommunityRepo`.

| Setting | Type | Purpose |
| --- | --- | --- |
| `ANSWER_FLIGHTS_API_KEY` | secret | Anthropic API key. Use a key with its own workspace limit |
| `ANSWER_FLIGHTS_MODEL` | variable | Default `claude-opus-5-5` |
| `ANSWER_FLIGHTS_DAILY_USD` | variable | Daily spending cap in US dollars. Default 5 |

Set them with the `STAGING_` or `PRODUCTION_` prefix in GitHub. A paid key is a decision of the
owner. This repository change creates no key and sends no model request.

## Flow

1. `POST /api/flights` takes `question` (8 to 200 characters) and `locale`. It refuses an email
   address, a link, or a phone number, because a question can reach a public page. A client
   has six questions, and one more each 50 seconds (`scope: :flight_question`).
2. The same normalized question in the same language gives the stored flight, so a replay
   makes no model call. A flight that failed, or a job that a deploy stopped, starts again.
3. `Flights.Worker` runs in the `flights` queue, one job at a time, in the web container. The
   web container holds the scientific service that the position tools need. The worker
   container does not. The job waits for the network and holds no image in memory.
4. `Flights.Agent` gives the model only these tools: `search_sky_objects`, `get_sky_object`,
   `match_sky_objects`, `get_solar_system_positions`, `measure_object_separation`,
   `list_sky_events`, and `list_guided_tours`. These are the operations of `AgentInterface` and
   `AgentSky` behind the MCP tools. A conversation has at most 7 model calls and 14 tool calls.
5. The model ends with `submit_flight` or `decline_question`. The verifier checks a
   submission. A submission with a problem goes back once with the list of problems. After that
   retry, the unsupported sentences leave the flight.
6. The client polls `GET /api/flights/:flight` and shows the state. A published flight plays in
   the tour player at `/?tour=answer-<flight>`. A refusal gives the reason and a nearby tour.

Each flight has a stable public page at `/flights/<flight>`, with `X-Robots-Tag: noindex`,
because its text starts from a question of the public.

## The verifier

`Flights.Verifier` is deterministic. A model does not write a number. A sentence is a list of
segments:

| Segment | Rule |
| --- | --- |
| `text` | No digit in any script, and no number word of the language of the flight. A proper name must be in the tool results (`en`, `es`, `fr`, `pt-BR`, `it`) |
| `object` | The key must be in the tool results. The atlas writes the name from the record |
| `fact` | `ref` and `path` must reach a number in a stored tool result, and `unit` must equal the unit of that field. The atlas reads the value from the record |

A fact must belong to an object that its sentence names, or to the object of the step.

A flight is published when it keeps at least four steps and at least 70% of its sentences.
Otherwise the product declines and suggests a nearby tour.

The verifier has limits. Say them to a reviewer:

- It cannot find a wrong claim that has no number and no name, for example "the largest galaxy".
- German has capitals on each noun, and Chinese, Japanese and Korean have no capitals, so
  these locales have no check for names in text. Their numbers are checked.
- Korean and Japanese number words are a short list. Digits are complete in each script.
- A value from a position tool is the value at the time of the flight. A chip shows that date.
  A stored flight does not update.

## Cost

Each model response adds its cost to `answer_flight_spend`, from the token usage and the price
table in `Flights.Model`. An unknown model id has the high price of 10 and 50 dollars for each
million tokens, so the cap stays safe. A new question and each next model call check the cap. So
a day can pass the cap by at most one call for each web container. The request uses prompt
caching, `effort: medium`, and at most 8000 output tokens. It also opts in to the server-side
refusal fallback (`fallbacks: "default"`), so a safety refusal of the first model can run on
another model. The stored `model` of a flight is the model that answered. Remove the field from
`Flights.Model.Anthropic` to turn this off.

## Operations

```sql
SELECT status, count(*), sum(cost_usd) FROM answer_flights
WHERE inserted_at > now() - interval '7 days' GROUP BY status;
SELECT * FROM answer_flight_spend ORDER BY day DESC LIMIT 14;
```

To stop a public flight, run this command. The same question then gets a refusal.

```bash
docker exec <web container> env -u PHX_SERVER /app/bin/starsmap_api eval \
  'IO.inspect(StarsmapApi.Release.hide_answer_flight("<flight>"))'
```

## Checks before a release to the public

A real model run has not happened. Before activation, on staging:

1. Run 100 collected questions. A science reviewer records each factual error in the published
   flights.
2. Measure the refusal rate, and the share of questions that the tools cannot support.
3. Check the model cost for each published flight and the cache hit rate against the cap.
4. Measure the completion rate and the share rate against the guided tours.

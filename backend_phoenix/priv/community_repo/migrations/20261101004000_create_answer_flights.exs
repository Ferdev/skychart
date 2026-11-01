defmodule StarsmapApi.CommunityRepo.Migrations.CreateAnswerFlights do
  use Ecto.Migration

  def change do
    create table(:answer_flights, primary_key: false) do
      add :id, :uuid, primary_key: true
      add :slug, :text, null: false
      add :question, :text, null: false
      add :normalized_question, :text, null: false
      add :locale, :text, null: false
      add :status, :text, null: false
      add :title, :text
      add :steps, :map, null: false, default: %{}
      add :tool_results, :map, null: false, default: %{}
      add :verifier, :map, null: false, default: %{}
      add :model, :text
      add :refusal, :text
      add :input_tokens, :integer, null: false, default: 0
      add :output_tokens, :integer, null: false, default: 0
      add :cost_usd, :float, null: false, default: 0.0
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:answer_flights, [:slug])
    create unique_index(:answer_flights, [:normalized_question, :locale])

    # One row for each UTC day. A model call adds its cost before the next call can start.
    create table(:answer_flight_spend, primary_key: false) do
      add :day, :date, primary_key: true
      add :cost_usd, :float, null: false, default: 0.0
      add :calls, :integer, null: false, default: 0
    end
  end
end

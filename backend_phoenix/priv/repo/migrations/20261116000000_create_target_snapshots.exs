defmodule StarsmapApi.Repo.Migrations.CreateTargetSnapshots do
  use Ecto.Migration

  def change do
    create table(:target_snapshots, primary_key: false) do
      add :token, :string, primary_key: true
      add :payload, :map, null: false
      add :bytes, :integer, null: false
      add :created_at, :utc_datetime_usec, null: false
      add :last_open_date, :date
      add :later_day_opens, :integer, null: false, default: 0
    end
  end
end

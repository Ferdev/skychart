defmodule StarsmapApi.CommunityRepo.Migrations.AddReporterToTourReports do
  use Ecto.Migration

  # A keyed hash of the client of a report, different for each tour. It counts distinct
  # reporters and gives no address. Earlier reports have none, and each counts as one reporter.
  def change do
    alter table(:tour_reports) do
      add :reporter, :text
    end

    create index(:tour_reports, [:tour_id, :reporter])
  end
end

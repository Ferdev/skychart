defmodule StarsmapApi.CommunityRepo.Migrations.AddSubjectSnapshot do
  use Ecto.Migration

  def change do
    alter table(:subjects) do
      add :snapshot, :map, default: %{}, null: false
    end
  end
end

defmodule StarsmapApi.CommunityRepo.Migrations.AddFirstSignIn do
  use Ecto.Migration

  def up do
    alter table(:users) do
      add :first_sign_in_at, :utc_datetime_usec
    end

    # Accounts that show a completed sign-in are not new. The exact time is unknown.
    execute """
    UPDATE users SET first_sign_in_at = inserted_at
    WHERE suspended OR role <> 'member'
       OR id IN (SELECT user_id FROM user_tokens WHERE context = 'session')
       OR id IN (SELECT user_id FROM photos)
       OR id IN (SELECT user_id FROM photo_votes)
    """
  end

  def down do
    alter table(:users) do
      remove :first_sign_in_at
    end
  end
end

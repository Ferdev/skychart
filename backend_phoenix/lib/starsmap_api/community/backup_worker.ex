defmodule StarsmapApi.Community.BackupWorker do
  @moduledoc "Encrypted off-host backups; credentials and recovery secret are separate."
  use Oban.Worker, queue: :media, max_attempts: 3

  def perform(_) do
    case System.cmd("bash", ["/app/scripts/community-backup.sh"], stderr_to_stdout: true) do
      {_, 0} -> :ok
      _ -> {:error, "Community backup failed; inspect storage and database access"}
    end
  end
end

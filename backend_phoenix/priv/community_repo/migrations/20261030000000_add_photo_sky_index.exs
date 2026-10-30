defmodule StarsmapApi.CommunityRepo.Migrations.AddPhotoSkyIndex do
  use Ecto.Migration

  # The geometry is already in `photos.wcs`. This index serves the Sky view overlay query.
  def change do
    create index(:photos, ["((wcs->>'dec_deg')::float8)"],
             name: :photos_solved_dec_index,
             where: "status = 'published' AND wcs->>'status' = 'solved'"
           )
  end
end

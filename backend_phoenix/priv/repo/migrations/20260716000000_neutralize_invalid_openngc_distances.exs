defmodule StarsmapApi.Repo.Migrations.NeutralizeInvalidOpenngcDistances do
  use Ecto.Migration

  def up do
    execute """
    UPDATE catalog_deep_sky_objects
    SET distance_pc = NULL,
        distance_ly = NULL,
        x_au = NULL,
        y_au = NULL,
        z_au = NULL,
        x_km = NULL,
        y_km = NULL,
        z_km = NULL,
        facts = jsonb_set(COALESCE(facts, '{}'::jsonb), '{distance_quality}', '"not_available"'::jsonb, true),
        source_payload = jsonb_set(COALESCE(source_payload, '{}'::jsonb), '{distance_quality}', '"not_available"'::jsonb, true),
        projected_payload = jsonb_build_object(
          'distance_pc', NULL, 'distance_ly', NULL,
          'x_au', NULL, 'y_au', NULL, 'z_au', NULL,
          'x_km', NULL, 'y_km', NULL, 'z_km', NULL
        ),
        updated_at = NOW()
    WHERE source_type = 'openngc_ngc_ic_catalog'
      AND NOT COALESCE((
        (object_type = 'galaxy' AND facts->>'distance_quality' = 'hubble_flow_redshift_approximation')
        OR
        (object_type <> 'galaxy' AND facts->>'distance_quality' = 'parallax')
      ), FALSE)
    """
  end

  def down do
    :ok
  end
end

import registryJson from "../backend_phoenix/priv/science_semantics.json";

export type DistanceKind = "geometric_parallax" | "literature_distance" | "redshift_comoving" | "inferred_redshift_comoving" | "ephemeris_state";
export type ScienceSemantics = {
  coordinate_frame: string;
  projection: string;
  catalog_epoch: string;
  position_epoch: string;
  distance_kind: DistanceKind | null;
  uncertainty_fields: readonly string[];
  cosmology: { name: string; parameters: string } | null;
  source: { label: string; url: string; doi_url?: string; release: string };
  selection_caveat: string;
};
export type ScienceRecord = { position_model?: string | null; facts?: Record<string, unknown> | null };

export const SCIENCE_SEMANTICS_REGISTRY = registryJson as {
  schema_version: number;
  projection: { frame: string; display: string; ruler: string };
  position_models: Record<string, ScienceSemantics>;
};

export function scienceSemanticsFor(positionModel: string | null | undefined): ScienceSemantics | null {
  return positionModel ? SCIENCE_SEMANTICS_REGISTRY.position_models[positionModel] ?? null : null;
}

export function uncertaintySummary(record: ScienceRecord): string {
  const semantics = scienceSemanticsFor(record.position_model);
  if (!semantics) return "Uncertainty not supplied by this atlas source.";
  const facts = record.facts ?? {};
  const value = (name: string) => facts[name];
  const finite = (name: string) => typeof value(name) === "number" && Number.isFinite(value(name));
  if (finite("parallax_error_mas")) return `Parallax uncertainty: ${value("parallax_error_mas")} mas.`;
  if (finite("parallax_over_error")) return `Parallax signal-to-noise (parallax/error): ${value("parallax_over_error")}.`;
  if (finite("distance_error_mpc")) return `Published distance uncertainty: ±${value("distance_error_mpc")} Mpc${typeof value("distance_method") === "string" ? ` (${value("distance_method")})` : ""}.`;
  if (finite("distance_min_mpc") && finite("distance_max_mpc")) return `Published distance interval: ${value("distance_min_mpc")}–${value("distance_max_mpc")} Mpc.`;
  if (finite("redshift_error")) return `${semantics.distance_kind === "inferred_redshift_comoving" ? "Inferred" : "Spectroscopic"} redshift uncertainty: ${value("redshift_error")}.`;
  if (finite("redshift_uncertainty")) return `Inferred redshift uncertainty: ${value("redshift_uncertainty")}.`;
  if (typeof value("orbit_uncertainty") === "string") return `Orbit uncertainty: ${value("orbit_uncertainty")}.`;
  return "Uncertainty not supplied by this atlas source.";
}

export function measuredRedshift(record: ScienceRecord): number | null {
  const semantics = scienceSemanticsFor(record.position_model);
  const redshift = record.facts?.redshift;
  return semantics?.distance_kind === "redshift_comoving" && typeof redshift === "number" && Number.isFinite(redshift) ? redshift : null;
}

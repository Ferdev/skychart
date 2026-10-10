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
  /** Display conventions that stand in for values the source does not give. */
  conventions?: Record<string, string>;
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

/**
 * English sentences of the uncertainty summary. `src/i18n/dataLabelTranslations.ts` uses this table for English
 * and adds the other languages. This module does not import `i18n.ts`.
 */
export const UNCERTAINTY_TEXT_EN = {
  "uncertainty.notSupplied": "Uncertainty not supplied by this atlas source.",
  "uncertainty.parallax": "Parallax uncertainty: {value} mas.",
  "uncertainty.parallaxSignal": "Parallax signal-to-noise (parallax/error): {value}.",
  "uncertainty.distance": "Published distance uncertainty: ±{value} Mpc.",
  "uncertainty.distanceMethod": "Published distance uncertainty: ±{value} Mpc ({method}).",
  "uncertainty.distanceInterval": "Published distance interval: {min}–{max} Mpc.",
  "uncertainty.redshiftInferred": "Inferred redshift uncertainty: {value}.",
  "uncertainty.redshiftSpectroscopic": "Spectroscopic redshift uncertainty: {value}.",
  "uncertainty.orbit": "Orbit uncertainty: {value}.",
  "uncertainty.orbitSize": "Published orbit-size uncertainty: +{plus} / −{minus} AU.",
} as const;

type UncertaintyTextKey = keyof typeof UNCERTAINTY_TEXT_EN;
type UncertaintyTranslate = (key: UncertaintyTextKey, params?: Record<string, string | number>) => string;

const englishUncertaintyText: UncertaintyTranslate = (key, params = {}) =>
  UNCERTAINTY_TEXT_EN[key].replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ""));

/** The uncertainty that the source gives, as one sentence. The default language is English. */
export function uncertaintySummary(record: ScienceRecord, translate: UncertaintyTranslate = englishUncertaintyText): string {
  const semantics = scienceSemanticsFor(record.position_model);
  if (!semantics) return translate("uncertainty.notSupplied");
  const facts = record.facts ?? {};
  const value = (name: string) => facts[name] as string | number;
  const finite = (name: string) => typeof facts[name] === "number" && Number.isFinite(facts[name]);
  if (finite("parallax_error_mas")) return translate("uncertainty.parallax", { value: value("parallax_error_mas") });
  if (finite("parallax_over_error")) return translate("uncertainty.parallaxSignal", { value: value("parallax_over_error") });
  if (finite("distance_error_mpc")) {
    return typeof facts.distance_method === "string"
      ? translate("uncertainty.distanceMethod", { value: value("distance_error_mpc"), method: facts.distance_method })
      : translate("uncertainty.distance", { value: value("distance_error_mpc") });
  }
  if (finite("distance_min_mpc") && finite("distance_max_mpc")) return translate("uncertainty.distanceInterval", { min: value("distance_min_mpc"), max: value("distance_max_mpc") });
  if (finite("redshift_error")) {
    return translate(semantics.distance_kind === "inferred_redshift_comoving" ? "uncertainty.redshiftInferred" : "uncertainty.redshiftSpectroscopic", { value: value("redshift_error") });
  }
  if (finite("redshift_uncertainty")) return translate("uncertainty.redshiftInferred", { value: value("redshift_uncertainty") });
  if (typeof facts.orbit_uncertainty === "string") return translate("uncertainty.orbit", { value: facts.orbit_uncertainty });
  if (finite("semi_major_axis_au_err_plus") && finite("semi_major_axis_au_err_minus")) {
    return translate("uncertainty.orbitSize", { plus: value("semi_major_axis_au_err_plus"), minus: value("semi_major_axis_au_err_minus") });
  }
  return translate("uncertainty.notSupplied");
}

export function measuredRedshift(record: ScienceRecord): number | null {
  const semantics = scienceSemanticsFor(record.position_model);
  const redshift = record.facts?.redshift;
  return semantics?.distance_kind === "redshift_comoving" && typeof redshift === "number" && Number.isFinite(redshift) ? redshift : null;
}

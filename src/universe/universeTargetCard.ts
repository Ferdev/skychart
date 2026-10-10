import type { Body } from "../atlas/contracts";
import { objectTypeLabel } from "../format/objectTypeLabel";
import type { Vector3 } from "../sky/skyProjection";
import { formatFixed } from "../format/quantity";
import { AU_KM, hasRenderableRadius } from "./universeBodyGeometry";
import { brightnessGroupKey } from "./universeBrightness";
import { deepSkyModel } from "./universeDeepSkyModel";
import { formatDistanceAu } from "./universeFormat";
import { observerApparentMagnitude } from "./universePhotometry";
import type { UniversePoint } from "./universePointModel";

type Translate = (key: string, params?: Record<string, string | number>) => string;

export type UniverseTargetCardText = {
  distanceAu: number;
  meta: string;
  magnitude: string;
};

/** Builds the text of the 3D target card for the current flight position. */
export function universeTargetCardText(
  target: UniversePoint,
  position: Vector3,
  targetBody: Body | undefined,
  translate: Translate,
  atTarget = false,
): UniverseTargetCardText {
  const distance = Math.hypot(
    target.position.x - position.x,
    target.position.y - position.y,
    target.position.z - position.z,
  );
  const deepSky = deepSkyModel(target);
  const surface = deepSky
    ? translate(deepSky.schematicSize ? "universe3d.schematicVolume" : "universe3d.illustrativeVolume")
    : hasRenderableRadius(target) && target.radiusKm && target.radiusKm > 0
    ? distance <= target.radiusKm / AU_KM
      ? translate("universe3d.insideSurface")
      : translate("universe3d.aboveSurface", { distance: formatDistanceAu(distance - target.radiusKm / AU_KM) })
    : "";
  const place = translate("universe3d.targetMeta", {
    type: objectTypeLabel(target.object_type), distance: formatDistanceAu(distance), surface,
  }) + (targetBody?.catalog?.facts?.radius_calculated === true && surface ? ` · ${translate("exoplanet.radiusCalculated")}` : "");
  // At the target the card says so first: the flight buttons have nothing to do there.
  const meta = atTarget ? `${translate("universe3d.atTarget", { name: target.name })} · ${place}` : place;
  const apparentMagnitude = observerApparentMagnitude(target, position);
  const magnitude = apparentMagnitude === null
    ? translate("universe3d.unknownMagnitude")
    : translate("universe3d.estimatedMagnitude", {
      magnitude: formatFixed(apparentMagnitude, 1), group: translate(brightnessGroupKey(apparentMagnitude)),
    });
  return { distanceAu: distance, meta, magnitude };
}

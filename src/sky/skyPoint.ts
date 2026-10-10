import type { Vector3 } from "./skyProjection";

export type CatalogSkyPoint = {
  key: string;
  name: string;
  object_type?: string | null;
  catalog_group?: string | null;
  color?: string | null;
  apparent_magnitude?: number | null;
  direction: Vector3;
};

export type SkyPoint = CatalogSkyPoint & { dynamic: boolean };

export type RenderedHit = {
  point: SkyPoint;
  x: number;
  y: number;
  radius: number;
};

export function skyObjectType(point: Pick<SkyPoint, "object_type">): string {
  const type = point.object_type?.trim().toLowerCase();
  return type || "unknown";
}

export function numericMagnitude(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : Number.POSITIVE_INFINITY;
}

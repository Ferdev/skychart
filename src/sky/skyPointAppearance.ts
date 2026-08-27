export type SkyPointAppearanceInput = {
  object_type?: string | null;
  color?: string | null;
  apparent_magnitude?: number | null;
  dynamic: boolean;
};

export type SkyPointAppearance = {
  coreRadius: number;
  glowRadius: number;
  opacity: number;
  color: string;
  glowColors: {
    inner: string;
    middle: string;
    outer: string;
  };
  brightCore: boolean;
};

const STARLIGHT_TARGET: readonly [number, number, number] = [255, 250, 242];
const OBJECT_LIGHT_TARGET: readonly [number, number, number] = [241, 245, 247];

/** Maps catalog metadata to a compact, photographic point of light. */
export function skyPointAppearance(point: SkyPointAppearanceInput): SkyPointAppearance {
  const magnitude = point.apparent_magnitude;
  const brightness = Number.isFinite(magnitude)
    ? clamp((7 - Number(magnitude)) / 9, 0, 1)
    : point.dynamic ? 0.7 : 0.2;
  const isStar = point.object_type?.trim().toLowerCase() === "star";
  const coreRadius = 0.45 + 1.1 * brightness ** 0.8;
  const targetColor = isStar ? STARLIGHT_TARGET : OBJECT_LIGHT_TARGET;
  const sourceColor = parseHexColor(point.color) ?? targetColor;
  const color = mixRgb(sourceColor, targetColor, isStar ? 0.78 : 0.72);

  return {
    coreRadius,
    glowRadius: brightness >= 0.32 ? coreRadius + 1.25 + brightness * 1.35 : 0,
    opacity: 0.28 + brightness * 0.72,
    color: rgb(color),
    glowColors: {
      inner: rgba(color, 0.42),
      middle: rgba(color, 0.16),
      outer: rgba(color, 0),
    },
    brightCore: brightness >= 0.68,
  };
}

function parseHexColor(value: string | null | undefined): [number, number, number] | null {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function mixRgb(
  source: readonly [number, number, number],
  target: readonly [number, number, number],
  targetWeight: number,
): [number, number, number] {
  return source.map((channel, index) => Math.round(channel + (target[index]! - channel) * targetWeight)) as [number, number, number];
}

function rgb(color: readonly [number, number, number]): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function rgba(color: readonly [number, number, number], alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

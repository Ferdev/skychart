export type ScreenPoint = { x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type EdgeSide = "left" | "right" | "top" | "bottom";

export function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
export function lerp(start: number, end: number, progress: number) { return start + (end - start) * progress; }
export function easeInOutCubic(progress: number) { return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2; }
export function degToRad(value: number) { return (value * Math.PI) / 180; }
export function isPresent<T>(value: T | null | undefined): value is T { return value !== null && value !== undefined; }

export function niceStep(rawStep: number) {
  const exponent = Math.floor(Math.log10(Math.max(rawStep, 1e-12)));
  const base = 10 ** exponent;
  const fraction = rawStep / base;
  if (fraction <= 1) return base;
  if (fraction <= 2) return 2 * base;
  if (fraction <= 5) return 5 * base;
  return 10 * base;
}

export function expandedRect(rect: Rect, amount: number): Rect {
  return { left: rect.left - amount, top: rect.top - amount, right: rect.right + amount, bottom: rect.bottom + amount, width: rect.width + amount * 2, height: rect.height + amount * 2 };
}

export function pointRect(point: ScreenPoint, size: number): Rect {
  const half = size / 2;
  return { left: point.x - half, top: point.y - half, right: point.x + half, bottom: point.y + half, width: size, height: size };
}

export function rectUnion(a: Rect, b: Rect): Rect {
  const left = Math.min(a.left, b.left), top = Math.min(a.top, b.top), right = Math.max(a.right, b.right), bottom = Math.max(a.bottom, b.bottom);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function pointInRect(point: ScreenPoint, rect: Rect) { return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom; }
export function rectsOverlap(a: Rect, b: Rect) { return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom); }

export function edgeAnchorForScreen(target: ScreenPoint, origin: ScreenPoint, rect: Rect): { point: ScreenPoint; side: EdgeSide } {
  const insetRect = { left: rect.left + 16, top: rect.top + 16, right: rect.right - 16, bottom: rect.bottom - 16, width: Math.max(1, rect.width - 32), height: Math.max(1, rect.height - 32) };
  const dx = target.x - origin.x, dy = target.y - origin.y;
  const candidates: { t: number; point: ScreenPoint; side: EdgeSide }[] = [];
  if (dx > 0) addEdgeCandidate(candidates, (insetRect.right - origin.x) / dx, origin, dx, dy, insetRect, "right");
  if (dx < 0) addEdgeCandidate(candidates, (insetRect.left - origin.x) / dx, origin, dx, dy, insetRect, "left");
  if (dy > 0) addEdgeCandidate(candidates, (insetRect.bottom - origin.y) / dy, origin, dx, dy, insetRect, "bottom");
  if (dy < 0) addEdgeCandidate(candidates, (insetRect.top - origin.y) / dy, origin, dx, dy, insetRect, "top");
  const candidate = candidates.sort((a, b) => a.t - b.t)[0];
  if (candidate) return { point: candidate.point, side: candidate.side };
  const point = { x: clamp(target.x, insetRect.left, insetRect.right), y: clamp(target.y, insetRect.top, insetRect.bottom) };
  const overflows = [{ side: "left" as const, amount: rect.left - target.x }, { side: "right" as const, amount: target.x - rect.right }, { side: "top" as const, amount: rect.top - target.y }, { side: "bottom" as const, amount: target.y - rect.bottom }];
  return { point, side: overflows.sort((a, b) => b.amount - a.amount)[0]?.side ?? "right" };
}

function addEdgeCandidate(candidates: { t: number; point: ScreenPoint; side: EdgeSide }[], t: number, origin: ScreenPoint, dx: number, dy: number, rect: Rect, side: EdgeSide) {
  if (!Number.isFinite(t) || t <= 0) return;
  const point = { x: origin.x + dx * t, y: origin.y + dy * t };
  if (point.x < rect.left - 0.5 || point.x > rect.right + 0.5 || point.y < rect.top - 0.5 || point.y > rect.bottom + 0.5) return;
  candidates.push({ t, point, side });
}

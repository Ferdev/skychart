import { decodeViewState } from "../viewState.ts";

export const MAX_TOUR_STEPS = 30;

/** The translation key of the kind of view that a step shows. */
export function stepViewKey(viewState: string): string {
  const view = decodeViewState(viewState);
  if (view?.universe) return "community.tours.view.universe";
  if (view?.sky) return "community.tours.view.sky";
  return "community.tours.view.map";
}

/** Moves one step up or down. A move past the end of the list changes nothing. */
export function moveStep<T>(steps: readonly T[], index: number, direction: -1 | 1): T[] {
  const moved = [...steps];
  const target = index + direction;
  if (index < 0 || index >= moved.length || target < 0 || target >= moved.length) return moved;
  [moved[index], moved[target]] = [moved[target]!, moved[index]!];
  return moved;
}

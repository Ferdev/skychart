/** Keys that move the active option of a result list. */
export type OptionListKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function isOptionListKey(key: string): key is OptionListKey {
  return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End";
}

/**
 * Index of the active option after a key press. `currentIndex` is -1 when no option is active.
 * The list does not wrap: Arrow Down stays on the last option, and Arrow Up stays on the first.
 * Returns -1 for an empty list.
 */
export function nextOptionIndex(count: number, currentIndex: number, key: OptionListKey): number {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return currentIndex < 0 ? 0 : Math.min(currentIndex + 1, count - 1);
  return currentIndex < 0 ? count - 1 : Math.max(currentIndex - 1, 0);
}

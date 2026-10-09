import { objectTypeLabel } from "../format/objectTypeLabel";
import { formatCount } from "../format/quantity";
import { SKY_OBJECT_TYPES } from "../viewState";
import { skyObjectType, type SkyPoint } from "./skyPoint";

const SKY_OBJECT_TYPE_ORDER = new Map<string, number>(SKY_OBJECT_TYPES.map((type, index) => [type, index]));

/**
 * Builds the list of object type check boxes of the Sky layer panel.
 * A type gets a row when the sky has one object of it or more. A type that the user hid keeps its row,
 * so that the user can show it again.
 */
export function renderSkyLayerFilters(
  container: HTMLElement,
  points: readonly SkyPoint[],
  visibleObjectTypes: ReadonlyMap<string, boolean>,
): void {
  const counts = new Map<string, number>();
  for (const point of points) {
    const type = skyObjectType(point);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const hiddenTypes = [...visibleObjectTypes].filter(([, visible]) => !visible).map(([type]) => type);
  const types = [...new Set<string>([...counts.keys(), ...hiddenTypes])].sort((a, b) =>
    (SKY_OBJECT_TYPE_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) -
    (SKY_OBJECT_TYPE_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER) ||
    objectTypeLabel(a, "many").localeCompare(objectTypeLabel(b, "many")));
  const fragment = document.createDocumentFragment();
  for (const type of types) {
    const label = document.createElement("label");
    label.className = "sky-view__filter";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "sky-object-type";
    input.value = type;
    input.dataset.skyObjectType = type;
    input.checked = visibleObjectTypes.get(type) !== false;
    const text = document.createElement("span");
    text.textContent = objectTypeLabel(type, "many");
    const count = document.createElement("span");
    count.className = "sky-view__filter-count";
    count.textContent = formatCount(counts.get(type) ?? 0);
    label.append(input, text, count);
    fragment.append(label);
  }
  container.replaceChildren(fragment);
}

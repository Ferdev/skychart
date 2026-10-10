import type { Body } from "../atlas/contracts";
import type { atlasDom } from "../atlas/atlasDom";
import { labelClass } from "../labels/labelRank";
import { universeEntryAim, universeEntryState, type EntryAimCandidate } from "../navigation/universeNavigation";
import type { UniverseViewState } from "../viewState";
import { bindMinimapToggle, UniverseHintCard } from "./universeHintCard";
import { UniverseLabelAreas } from "./universeLabelAreas";
import { bodyToUniversePoint } from "./universePointModel";
import { UniverseTouchControls } from "./universeTouchControls";
import { UniverseViewController } from "./universeViewController";
import type { UniverseIntegrationOptions } from "./universeViewOptions";

export function createUniverseViewController(dom: typeof atlasDom, options: UniverseIntegrationOptions): UniverseViewController {
  bindMinimapToggle(dom.universeMinimapPanel, dom.universeMinimapToggle, options.translate);
  const controller = new UniverseViewController({
    ...options,
    labelAreas: new UniverseLabelAreas(dom.universeView, [dom.universeHeader, dom.universeMinimapPanel, dom.universeFlight, dom.universeTarget, dom.universeHint, dom.universeFooter]),
    hintCard: new UniverseHintCard({ card: dom.universeHint, text: dom.universeHintText, closeButton: dom.universeHintClose, translate: options.translate }),
    flightNote: dom.universeFlightNote,
    detailsButton: dom.universeDetails,
    root: dom.universeView,
    canvas: dom.universeCanvas,
    pointsCanvas: dom.universePoints,
    deepSkyCanvas: dom.universeDeepSky,
    bodiesCanvas: dom.universeBodies,
    toggleButton: dom.universeToggle,
    closeButton: dom.universeClose,
    resetButton: dom.universeReset,
    findButton: dom.universeFind,
    searchDialog: dom.universeSearchDialog,
    searchCloseButton: dom.universeSearchClose,
    searchInput: dom.universeSearchInput,
    searchResults: dom.universeSearchResults,
    positionLabel: dom.universePosition,
    speedLabel: dom.universeSpeed,
    speedGauge: dom.universeSpeedGauge,
    autopilotButton: dom.universeAutopilot,
    gravityButton: dom.universeGravity,
    minimapCanvas: dom.universeMinimap,
    routeLabel: dom.universeRoute,
    selectionConnector: dom.universeSelectionConnector,
    workspacePanel: dom.workspacePanel,
    selectedObjectPanel: dom.selectedObjectPanel,
    status: dom.universeStatus,
    tooltip: dom.universeTooltip,
    targetPanel: dom.universeTarget,
    targetName: dom.universeTargetName,
    targetMeta: dom.universeTargetMeta,
    targetMagnitude: dom.universeTargetMagnitude,
    flyButton: dom.universeFly,
    focusButton: dom.universeFocus,
    inspectButton: dom.universeInspect,
    skyButton: dom.universeSky,
  });
  new UniverseTouchControls({
    joystick: dom.universeJoystick,
    knob: dom.universeJoystickKnob,
    press: (move) => controller.holdMove(move),
    release: (move) => controller.releaseMove(move),
  });
  return controller;
}

/**
 * The 3D state at the entry from the 2D map. `moveStepAu` is one twelfth of the 2D view width.
 * With no selected object the view aims at the Sun or at the nearest major object (see `universeEntryAim`).
 */
export function initialUniverseState(
  center: { x: number; y: number }, moveStepAu: number, selected: Body | null, bodies: Iterable<Body> = [],
): UniverseViewState {
  const selectedPosition = bodyToUniversePoint(selected)?.position;
  const aim = selectedPosition ? undefined : universeEntryAim(center, moveStepAu * 6, entryAimCandidates(bodies));
  return universeEntryState(center, moveStepAu, selectedPosition, aim);
}

function* entryAimCandidates(bodies: Iterable<Body>): Iterable<EntryAimCandidate> {
  for (const body of bodies) {
    const point = bodyToUniversePoint(body);
    if (!point) continue;
    const pointClass = labelClass({ key: body.key, name: body.name, objectType: body.object_type });
    yield { key: body.key, position: point.position, major: pointClass === "major" || pointClass === "named" };
  }
}

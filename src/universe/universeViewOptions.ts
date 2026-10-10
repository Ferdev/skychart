import type { Body } from "../atlas/contracts";
import type { UniverseViewState } from "../viewState";
import type { UniverseLabelArea } from "./universeLabelAreas";

export type UniverseViewOptions = {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  pointsCanvas: HTMLCanvasElement;
  deepSkyCanvas: HTMLCanvasElement;
  bodiesCanvas: HTMLCanvasElement;
  toggleButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  findButton: HTMLButtonElement;
  searchDialog: HTMLDialogElement;
  searchCloseButton: HTMLButtonElement;
  searchInput: HTMLInputElement;
  searchResults: HTMLElement;
  positionLabel: HTMLElement;
  /** The status line next to the speed panel. It says what the autopilot does when it has no target. */
  flightNote: HTMLElement;
  speedLabel: HTMLOutputElement;
  speedGauge: HTMLElement;
  autopilotButton: HTMLButtonElement;
  gravityButton: HTMLButtonElement;
  minimapCanvas: HTMLCanvasElement;
  routeLabel: HTMLElement;
  selectionConnector: SVGSVGElement;
  workspacePanel: HTMLElement;
  selectedObjectPanel: HTMLElement;
  status: HTMLElement;
  tooltip: HTMLElement;
  targetPanel: HTMLElement;
  targetName: HTMLElement;
  targetMeta: HTMLElement;
  targetMagnitude: HTMLElement;
  flyButton: HTMLButtonElement;
  focusButton: HTMLButtonElement;
  /** Opens the object inspector for the target. */
  detailsButton: HTMLButtonElement;
  /** The control areas that labels must not use. */
  labelAreas: { get(): UniverseLabelArea; invalidate(): void };
  /** The card with the flight controls, shown at the first entry. */
  hintCard: { showOnce(): void; hide(): void };
  inspectButton: HTMLButtonElement;
  skyButton: HTMLButtonElement;
  bodyByKey: () => ReadonlyMap<string, Body>;
  selectedBody: () => Body | null;
  translate: (key: string, params?: Record<string, string | number>) => string;
  selectBody: (key: string) => Promise<void>;
  inspectInAtlas: (key: string) => void;
  searchDestinations: (query: string, signal: AbortSignal) => Promise<Body[]>;
  /** Loads the planets of the host star at this position into the atlas body list. */
  loadPlanetarySystem: (host: { x_au: number; y_au: number; z_au: number }) => Promise<void>;
  /** Opens Sky view from this object. `origin` is the 3D state that `Back to 3D` opens again. */
  openSky: (body: Body, origin?: UniverseViewState) => Promise<void>;
  /** Closes the object inspector and keeps the 3D target. */
  closeInspector: () => void;
  /** Suggested and recent destinations for the empty search field. */
  destinationSuggestions: () => { suggested: Body[]; recent: Body[] };
  stateChanged: (mode: "push" | "replace") => void;
  closeSky: () => void;
  resumeAtlas: () => void;
  initialState: () => UniverseViewState;
};

export type UniverseIntegrationOptions = Pick<UniverseViewOptions,
  "bodyByKey" | "selectedBody" | "translate" | "selectBody" | "inspectInAtlas" | "searchDestinations" | "loadPlanetarySystem" | "openSky" | "closeInspector" | "destinationSuggestions" | "stateChanged" | "closeSky" | "resumeAtlas" | "initialState">;

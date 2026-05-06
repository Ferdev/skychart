export type KeyboardKey = {
  label: string;
  code: string;
  ariaLabel: string;
};

export type KeyboardControl = {
  id: "thrust" | "brake" | "rotateLeft" | "rotateRight" | "warp";
  label: string;
  tooltip: string;
  keys: readonly KeyboardKey[];
  interaction: "hold" | "toggle";
  group: "ship";
};

export type FirstRunStep = {
  id: "pickDestination" | "centerDestination" | "flyShip" | "toggleWarp";
  label: string;
  body: string;
  actionLabel: string;
  controlHint?: readonly KeyboardKey[];
};

export type ModeCopy = {
  label: string;
  tooltip: string;
  activeLabel: string;
};

export const keyboardKeyVisual = {
  keyClassName: "keyboard-key",
  keyGroupClassName: "keyboard-key-group",
  chordSeparator: "/",
  size: "compact",
  treatment: "outlined keycap with mono label"
} as const;

export const keyboardControls = [
  {
    id: "thrust",
    label: "Forward thrust",
    tooltip: "Hold W to accelerate along the ship heading.",
    keys: [{ label: "W", code: "KeyW", ariaLabel: "W key" }],
    interaction: "hold",
    group: "ship"
  },
  {
    id: "brake",
    label: "Reverse thrust",
    tooltip: "Hold S to slow or back away from the current heading.",
    keys: [{ label: "S", code: "KeyS", ariaLabel: "S key" }],
    interaction: "hold",
    group: "ship"
  },
  {
    id: "rotateLeft",
    label: "Rotate left",
    tooltip: "Hold A to turn the ship left.",
    keys: [{ label: "A", code: "KeyA", ariaLabel: "A key" }],
    interaction: "hold",
    group: "ship"
  },
  {
    id: "rotateRight",
    label: "Rotate right",
    tooltip: "Hold D to turn the ship right.",
    keys: [{ label: "D", code: "KeyD", ariaLabel: "D key" }],
    interaction: "hold",
    group: "ship"
  },
  {
    id: "warp",
    label: "Warp",
    tooltip: "Press Space to toggle 250x flight speed.",
    keys: [{ label: "Space", code: "Space", ariaLabel: "Space key" }],
    interaction: "toggle",
    group: "ship"
  }
] as const satisfies readonly KeyboardControl[];

export const firstRunSteps = [
  {
    id: "pickDestination",
    label: "Pick destination",
    body: "Search or choose a frequent route.",
    actionLabel: "Target"
  },
  {
    id: "centerDestination",
    label: "Center",
    body: "Bring the destination or ship into view before launch.",
    actionLabel: "Center"
  },
  {
    id: "flyShip",
    label: "Fly",
    body: "Use thrust and rotation keys to line up with the route.",
    actionLabel: "Use W/S and A/D",
    controlHint: [
      { label: "W", code: "KeyW", ariaLabel: "W key" },
      { label: "S", code: "KeyS", ariaLabel: "S key" },
      { label: "A", code: "KeyA", ariaLabel: "A key" },
      { label: "D", code: "KeyD", ariaLabel: "D key" }
    ]
  },
  {
    id: "toggleWarp",
    label: "Toggle warp",
    body: "Use warp once the ship is pointed toward the target.",
    actionLabel: "Press Space",
    controlHint: [{ label: "Space", code: "Space", ariaLabel: "Space key" }]
  }
] as const satisfies readonly FirstRunStep[];

export const modeCopy = {
  pan: {
    label: "Pan",
    tooltip: "Drag the map to reposition the atlas.",
    activeLabel: "Pan mode"
  },
  target: {
    label: "Target",
    tooltip: "Select a body as the active destination.",
    activeLabel: "Target mode"
  },
  measure: {
    label: "Measure",
    tooltip: "Compare distance and light time between bodies.",
    activeLabel: "Measure mode"
  }
} as const satisfies Record<"pan" | "target" | "measure", ModeCopy>;

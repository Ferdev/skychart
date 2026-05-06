import "./styles.css";

const AU_KM_FALLBACK = 149_597_870.7;
const LIGHT_SPEED_KM_S = 299_792.458;
const EARTH_MOON_AVG_KM = 384_400;
const QUICK_TARGETS = ["moon", "mars", "jupiter", "saturn"];
const ICONS: Record<string, string> = {
  target:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2"></circle><path d="M12 3v3M12 18v3M3 12h3M18 12h3"></path></svg>',
  locate:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"></path><circle cx="12" cy="12" r="5"></circle></svg>',
  center:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h5M15 12h5M12 4v5M12 15v5"></path><circle cx="12" cy="12" r="2"></circle></svg>',
  check:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>',
  minus:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"></path></svg>',
  plus:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"></path></svg>',
  sun:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"></path></svg>',
  ship:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7 18-7-4-7 4 7-18Z"></path></svg>',
  back:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"></path></svg>',
  forward:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"></path></svg>',
  reset:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h7a6 6 0 1 1-5.2 9"></path><path d="M7 3v4h4"></path></svg>',
  restart:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20V5"></path><path d="M6 5h10l-2 4 2 4H6"></path></svg>'
};

type TargetKey = string;

type BodyPosition = {
  x_au: number;
  y_au: number;
  z_au: number;
  x_km: number;
  y_km: number;
  z_km: number;
  heliocentric_distance_km: number;
};

type Body = {
  key: string;
  name: string;
  radius_km: number;
  color: string;
  position: BodyPosition;
  distance_from_earth_km: number;
};

type Ephemeris = {
  timestamp_utc: string;
  generated_at_utc: string;
  data_source: string;
  coordinate_frame: string;
  units: Record<string, string>;
  au_km: number;
  earth_position: BodyPosition;
  bodies: Body[];
};

type Ship = {
  xAu: number;
  yAu: number;
  zAu: number;
  vxAuPerSec: number;
  vyAuPerSec: number;
  angleRad: number;
};

type JourneyStats = {
  targetKey: TargetKey;
  closestKm: number;
  arrived: boolean;
};

const canvas = requiredElement<HTMLCanvasElement>("#map");
const hudValues = requiredElement<HTMLElement>("#hud-values");
const loadState = requiredElement<HTMLElement>("#load-state");
const targetButtons = requiredElement<HTMLElement>("#target-buttons");
const destinationSearch = requiredElement<HTMLInputElement>("#destination-search");
const bodyOptions = requiredElement<HTMLDataListElement>("#body-options");
const setDestination = requiredElement<HTMLButtonElement>("#set-destination");
const jumpDestination = requiredElement<HTMLButtonElement>("#jump-destination");
const bodySelect = requiredElement<HTMLSelectElement>("#body-select");
const journey = requiredElement<HTMLElement>("#journey");
const bodyInfo = requiredElement<HTMLElement>("#body-info");
const flightValues = requiredElement<HTMLElement>("#flight-values");
const errorPanel = requiredElement<HTMLElement>("#error-panel");
const zoomIn = requiredElement<HTMLButtonElement>("#zoom-in");
const zoomOut = requiredElement<HTMLButtonElement>("#zoom-out");
const centerSun = requiredElement<HTMLButtonElement>("#center-sun");
const centerShip = requiredElement<HTMLButtonElement>("#center-ship");
const centerSelected = requiredElement<HTMLButtonElement>("#center-selected");
const targetSelected = requiredElement<HTMLButtonElement>("#target-selected");
const timeInput = requiredElement<HTMLInputElement>("#time-input");
const applyTime = requiredElement<HTMLButtonElement>("#apply-time");
const timeNow = requiredElement<HTMLButtonElement>("#time-now");
const resetShipButton = requiredElement<HTMLButtonElement>("#reset-ship");
const restartJourneyButton = requiredElement<HTMLButtonElement>("#restart-journey");
const ctx = requiredCanvasContext(canvas);

const keys = new Set<string>();
const camera = {
  xAu: 0,
  yAu: 0,
  pxPerAu: 64
};

let ephemeris: Ephemeris | null = null;
let bodyByKey = new Map<string, Body>();
let selectedTarget = "jupiter";
let selectedBodyKey = "jupiter";
let ship: Ship | null = null;
let journeyStats: JourneyStats = createJourneyStats(selectedTarget);
let warpEnabled = false;
let lastFrame = performance.now();
let isDragging = false;
let dragMoved = false;
let dragStart = { x: 0, y: 0, cameraXAu: 0, cameraYAu: 0 };

for (const target of QUICK_TARGETS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "target-card";
  button.dataset.target = target;
  button.setAttribute("aria-label", `Set target to ${labelForKey(target)}`);
  button.innerHTML = quickTargetMarkup(target);
  button.addEventListener("click", () => {
    setTarget(target, { inspect: true, center: false });
  });
  targetButtons.appendChild(button);
}
decorateStaticControls();
updateTargetButtons();

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    if (!event.repeat) {
      warpEnabled = !warpEnabled;
      updateHud();
    }
    return;
  }
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 0.86 : 1.16);
});

canvas.addEventListener("pointerdown", (event) => {
  isDragging = true;
  dragMoved = false;
  canvas.setPointerCapture(event.pointerId);
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    cameraXAu: camera.xAu,
    cameraYAu: camera.yAu
  };
});

canvas.addEventListener("pointermove", (event) => {
  if (!isDragging) return;
  if (Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) > 4) {
    dragMoved = true;
  }
  camera.xAu = dragStart.cameraXAu - (event.clientX - dragStart.x) / camera.pxPerAu;
  camera.yAu = dragStart.cameraYAu + (event.clientY - dragStart.y) / camera.pxPerAu;
});

canvas.addEventListener("pointerup", (event) => {
  isDragging = false;
  canvas.releasePointerCapture(event.pointerId);
  if (!dragMoved) {
    selectBodyAt(event.clientX, event.clientY);
  }
});

zoomIn.addEventListener("click", () => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25));
zoomOut.addEventListener("click", () => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.8));
centerSun.addEventListener("click", () => {
  camera.xAu = 0;
  camera.yAu = 0;
});
centerShip.addEventListener("click", () => {
  if (!ship) return;
  camera.xAu = ship.xAu;
  camera.yAu = ship.yAu;
});
centerSelected.addEventListener("click", () => centerOnBody(selectedBodyKey));
targetSelected.addEventListener("click", () => setTarget(selectedBodyKey, { inspect: true }));
bodySelect.addEventListener("change", () => {
  selectedBodyKey = bodySelect.value;
  updateHud();
});
destinationSearch.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    setDestination.click();
  }
});
setDestination.addEventListener("click", () => {
  const body = bodyFromSearchValue(destinationSearch.value);
  if (!body) {
    flashSearchError();
    return;
  }
  setTarget(body.key, { inspect: true });
});
jumpDestination.addEventListener("click", () => {
  const body = bodyFromSearchValue(destinationSearch.value) ?? bodyByKey.get(selectedTarget);
  if (!body) {
    flashSearchError();
    return;
  }
  centerOnBody(body.key);
});
applyTime.addEventListener("click", () => {
  const timestamp = datetimeLocalToIso(timeInput.value);
  if (timestamp) {
    loadEphemeris(timestamp, { preserveCamera: true });
  }
});
timeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    applyTime.click();
  }
});
timeNow.addEventListener("click", () => loadEphemeris(new Date().toISOString(), { preserveCamera: true }));
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-step-days]")) {
  button.addEventListener("click", () => {
    if (!ephemeris) return;
    const days = Number(button.dataset.stepDays ?? "0");
    const next = new Date(ephemeris.timestamp_utc);
    next.setUTCDate(next.getUTCDate() + days);
    loadEphemeris(next.toISOString(), { preserveCamera: true });
  });
}
resetShipButton.addEventListener("click", () => {
  resetShipNearEarth(false);
  updateHud();
});
restartJourneyButton.addEventListener("click", () => {
  resetShipNearEarth(true);
  updateHud();
});

resizeCanvas();
loadEphemeris();
requestAnimationFrame(loop);

async function loadEphemeris(timestampUtc?: string, options: { preserveCamera?: boolean } = {}) {
  try {
    loadState.textContent = "loading";
    const query = timestampUtc ? `?timestamp=${encodeURIComponent(timestampUtc)}` : "";
    const response = await fetch(`/api/ephemeris${query}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ephemeris API returned ${response.status}.\n${text}`);
    }

    ephemeris = (await response.json()) as Ephemeris;
    bodyByKey = new Map(ephemeris.bodies.map((body) => [body.key, body]));
    ensureSelectedKeysExist();
    populateCatalogControls();
    setTimeInputFromTimestamp(ephemeris.timestamp_utc);
    initializeShip();
    resetJourneyStats();
    if (!options.preserveCamera) {
      fitInitialView();
    }
    loadState.textContent = "live";
    errorPanel.hidden = true;
    updateHud();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loadState.textContent = "error";
    errorPanel.hidden = false;
    errorPanel.textContent = [
      "Could not load live ephemeris data.",
      "",
      "Start the Python API first, then reload the page.",
      "",
      message
    ].join("\n");
  }
}

function initializeShip(force = false) {
  const earth = bodyByKey.get("earth");
  if (!earth || (ship && !force)) return;

  const earthAngle = Math.atan2(earth.position.y_au, earth.position.x_au);
  const tangent = earthAngle + Math.PI / 2;
  ship = {
    xAu: earth.position.x_au + Math.cos(tangent) * 0.002,
    yAu: earth.position.y_au + Math.sin(tangent) * 0.002,
    zAu: earth.position.z_au,
    vxAuPerSec: 0,
    vyAuPerSec: 0,
    angleRad: tangent
  };
}

function resetShipNearEarth(resetStats: boolean) {
  initializeShip(true);
  if (resetStats) {
    resetJourneyStats();
  }
}

function fitInitialView() {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  const outerBody = bodyByKey.get("saturn");
  const radiusAu = outerBody ? Math.hypot(outerBody.position.x_au, outerBody.position.y_au) : 10;
  camera.pxPerAu = clamp(Math.min(width, height) / (radiusAu * 2.35), 18, 82);
  camera.xAu = 0;
  camera.yAu = 0;
}

function loop(now: number) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  updateShip(dt);
  draw();
  requestAnimationFrame(loop);
}

function updateShip(dt: number) {
  if (!ship) return;

  const rotationSpeed = warpEnabled ? 1.45 : 1.9;
  if (keys.has("KeyA")) ship.angleRad += rotationSpeed * dt;
  if (keys.has("KeyD")) ship.angleRad -= rotationSpeed * dt;

  const warpMultiplier = warpEnabled ? 250 : 1;
  const accelerationAu = 0.00000018 * warpMultiplier;
  const maxSpeedAu = 0.000026 * warpMultiplier;
  let thrust = 0;
  if (keys.has("KeyW")) thrust += 1;
  if (keys.has("KeyS")) thrust -= 0.75;

  if (thrust !== 0) {
    ship.vxAuPerSec += Math.cos(ship.angleRad) * accelerationAu * thrust * dt;
    ship.vyAuPerSec += Math.sin(ship.angleRad) * accelerationAu * thrust * dt;
  }

  if (!warpEnabled) {
    ship.vxAuPerSec *= 0.9995;
    ship.vyAuPerSec *= 0.9995;
  }

  const speed = Math.hypot(ship.vxAuPerSec, ship.vyAuPerSec);
  if (speed > maxSpeedAu) {
    const ratio = maxSpeedAu / speed;
    ship.vxAuPerSec *= ratio;
    ship.vyAuPerSec *= ratio;
  }

  ship.xAu += ship.vxAuPerSec * dt;
  ship.yAu += ship.vyAuPerSec * dt;

  const target = bodyByKey.get(selectedTarget);
  if (target) {
    updateJourneyStats(shipTargetDistanceKm(target), target);
  }
  updateHud();
}

function draw() {
  const width = canvas.width / devicePixelRatio;
  const height = canvas.height / devicePixelRatio;

  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0, 0, width, height);
  drawStarfield(width, height);
  drawDistanceRings();

  if (ephemeris) {
    drawTargetLines();
    drawTargetHeadingIndicator();
    for (const body of ephemeris.bodies) {
      drawBody(body);
    }
  }

  drawShip();
  ctx.restore();
}

function drawStarfield(width: number, height: number) {
  ctx.fillStyle = "#060607";
  ctx.fillRect(0, 0, width, height);

  const gridAu = pickGridAu();
  const left = camera.xAu - width / 2 / camera.pxPerAu;
  const right = camera.xAu + width / 2 / camera.pxPerAu;
  const bottom = camera.yAu - height / 2 / camera.pxPerAu;
  const top = camera.yAu + height / 2 / camera.pxPerAu;
  const startX = Math.floor(left / gridAu) * gridAu;
  const startY = Math.floor(bottom / gridAu) * gridAu;

  ctx.strokeStyle = "rgba(243, 240, 232, 0.055)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x <= right; x += gridAu) {
    const p = worldToScreen(x, 0);
    ctx.moveTo(p.x, 0);
    ctx.lineTo(p.x, height);
  }
  for (let y = startY; y <= top; y += gridAu) {
    const p = worldToScreen(0, y);
    ctx.moveTo(0, p.y);
    ctx.lineTo(width, p.y);
  }
  ctx.stroke();
}

function drawDistanceRings() {
  const rings = [0.39, 0.72, 1, 1.52, 5.2, 9.58, 19.2, 30.1];
  const sun = worldToScreen(0, 0);
  ctx.save();
  ctx.strokeStyle = "rgba(243, 240, 232, 0.12)";
  ctx.fillStyle = "rgba(243, 240, 232, 0.46)";
  ctx.font = "11px ui-sans-serif, system-ui";

  for (const au of rings) {
    const radius = au * camera.pxPerAu;
    if (radius < 6 || radius > Math.max(canvas.width, canvas.height) / devicePixelRatio * 2) continue;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (radius > 26) {
      ctx.fillText(`${formatAu(au)} AU`, sun.x + radius + 5, sun.y - 4);
    }
  }
  ctx.restore();
}

function drawTargetLines() {
  if (!ship) return;
  const earth = bodyByKey.get("earth");
  const target = bodyByKey.get(selectedTarget);
  if (!earth || !target) return;

  const earthScreen = worldToScreen(earth.position.x_au, earth.position.y_au);
  const targetScreen = worldToScreen(target.position.x_au, target.position.y_au);
  const shipScreen = worldToScreen(ship.xAu, ship.yAu);

  ctx.save();
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = "rgba(116, 196, 255, 0.44)";
  ctx.beginPath();
  ctx.moveTo(earthScreen.x, earthScreen.y);
  ctx.lineTo(targetScreen.x, targetScreen.y);
  ctx.stroke();

  ctx.setLineDash([2, 6]);
  ctx.strokeStyle = "rgba(255, 209, 102, 0.46)";
  ctx.beginPath();
  ctx.moveTo(shipScreen.x, shipScreen.y);
  ctx.lineTo(targetScreen.x, targetScreen.y);
  ctx.stroke();
  ctx.restore();
}

function drawTargetHeadingIndicator() {
  if (!ship) return;
  const target = bodyByKey.get(selectedTarget);
  if (!target) return;

  const shipScreen = worldToScreen(ship.xAu, ship.yAu);
  const direction = Math.atan2(target.position.y_au - ship.yAu, target.position.x_au - ship.xAu);
  const forward = { x: Math.cos(direction), y: -Math.sin(direction) };
  const side = { x: -forward.y, y: forward.x };
  const start = 28;
  const end = 74;

  ctx.save();
  ctx.strokeStyle = "rgba(255, 209, 102, 0.78)";
  ctx.fillStyle = "rgba(255, 209, 102, 0.92)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(shipScreen.x + forward.x * start, shipScreen.y + forward.y * start);
  ctx.lineTo(shipScreen.x + forward.x * end, shipScreen.y + forward.y * end);
  ctx.stroke();

  const tipX = shipScreen.x + forward.x * end;
  const tipY = shipScreen.y + forward.y * end;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - forward.x * 11 + side.x * 6, tipY - forward.y * 11 + side.y * 6);
  ctx.lineTo(tipX - forward.x * 11 - side.x * 6, tipY - forward.y * 11 - side.y * 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBody(body: Body) {
  const screen = worldToScreen(body.position.x_au, body.position.y_au);
  const radius = displayRadius(body);
  const isTarget = body.key === selectedTarget;
  const isSelectedBody = body.key === selectedBodyKey;

  ctx.save();
  if (body.key === "saturn") {
    ctx.strokeStyle = "rgba(216, 194, 138, 0.74)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y, radius * 1.65, radius * 0.55, -0.35, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = body.color;
  ctx.strokeStyle = isTarget ? "#f3f0e8" : isSelectedBody ? "#74c4ff" : "rgba(0, 0, 0, 0.38)";
  ctx.lineWidth = isTarget || isSelectedBody ? 2 : 1;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (isSelectedBody && !isTarget) {
    ctx.strokeStyle = "rgba(116, 196, 255, 0.72)";
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = body.key === "sun" ? "#ffe8a3" : "#f3f0e8";
  ctx.font = isTarget || isSelectedBody ? "700 13px ui-sans-serif, system-ui" : "12px ui-sans-serif, system-ui";
  ctx.textBaseline = "middle";
  ctx.fillText(body.name, screen.x + radius + 7, screen.y);
  ctx.restore();
}

function drawShip() {
  if (!ship) return;
  const screen = worldToScreen(ship.xAu, ship.yAu);
  const forward = { x: Math.cos(ship.angleRad), y: -Math.sin(ship.angleRad) };
  const side = { x: -forward.y, y: forward.x };
  const size = warpEnabled ? 14 : 11;

  ctx.save();
  if (warpEnabled) {
    ctx.strokeStyle = "rgba(116, 196, 255, 0.56)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, size + 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "#f3f0e8";
  ctx.strokeStyle = "#060607";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(screen.x + forward.x * size, screen.y + forward.y * size);
  ctx.lineTo(screen.x - forward.x * size * 0.75 + side.x * size * 0.62, screen.y - forward.y * size * 0.75 + side.y * size * 0.62);
  ctx.lineTo(screen.x - forward.x * size * 0.35, screen.y - forward.y * size * 0.35);
  ctx.lineTo(screen.x - forward.x * size * 0.75 - side.x * size * 0.62, screen.y - forward.y * size * 0.75 - side.y * size * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function updateHud() {
  if (!ephemeris || !ship) return;
  const target = bodyByKey.get(selectedTarget);
  if (!target) return;

  const shipTargetKm = shipTargetDistanceKm(target);
  const shipSpeedKmS = shipSpeedKmPerSecond();
  const scaleKm = ephemeris.au_km / camera.pxPerAu;
  const navigation = navigationMetrics(target, shipTargetKm);
  const inspectedBody = bodyByKey.get(selectedBodyKey);

  hudValues.innerHTML = "";
  appendDefinition("UTC", formatTimestamp(ephemeris.timestamp_utc));
  appendDefinition("Target", target.name);
  appendDefinition("Inspecting", inspectedBody?.name ?? "none");
  appendDefinition("Data", ephemeris.data_source.replace("NASA/JPL ", "JPL "));
  appendDefinition("Frame", "heliocentric ecliptic x/y");

  updateFlightValues(shipSpeedKmS, scaleKm, navigation);
  updateBodyInfo();
  updateJourney(target, shipTargetKm);
}

function appendDefinition(term: string, value: string) {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  hudValues.append(dt, dd);
}

function updateJourney(target: Body, shipTargetKm: number) {
  if (!ephemeris || !ship) return;
  const earth = bodyByKey.get("earth");
  if (!earth) return;

  const progress = journeyProgress(earth.position, target.position, ship);
  const progressPercent = progress * 100;
  const remainingLightSeconds = shipTargetKm / LIGHT_SPEED_KM_S;
  const comparison = target.distance_from_earth_km / EARTH_MOON_AVG_KM;
  const navigation = navigationMetrics(target, shipTargetKm);
  const thresholdKm = arrivalThresholdKm(target);
  const targetLightSeconds = target.distance_from_earth_km / LIGHT_SPEED_KM_S;
  const status = journeyStats.arrived
    ? "arrived"
    : shipTargetKm <= thresholdKm
      ? "inside arrival zone"
      : navigation.closingSpeedKmS > 0
        ? "closing"
        : "not closing";
  const statusLabel = journeyStats.arrived ? "Arrival confirmed" : status;
  const routeProgress = clamp(progressPercent, 0, 100);

  journey.innerHTML = `
    <div class="journey-hero">
      <div>
        <span class="eyebrow">Journey</span>
        <h2>Earth to ${escapeHtml(target.name)}</h2>
      </div>
      <span class="status-token">${statusLabel}</span>
    </div>
    <div class="route-card">
      <div class="route-body origin">
        ${bodyOrbHtml(earth, "large")}
        <span>Origin</span>
        <strong>${escapeHtml(earth.name)}</strong>
      </div>
      <div class="route-vector" aria-label="Route progress from Earth to ${escapeHtml(target.name)}">
        <div class="route-track">
          <span class="route-progress-dot" style="left: ${routeProgress.toFixed(2)}%"></span>
        </div>
        <span>${formatDistance(target.distance_from_earth_km)}</span>
      </div>
      <div class="route-body destination">
        ${bodyOrbHtml(target, "large")}
        <span>Destination</span>
        <strong>${escapeHtml(target.name)}</strong>
      </div>
    </div>
    <div class="distance-focus">
      <span>Distance remaining</span>
      <strong>${formatDistance(shipTargetKm)}</strong>
    </div>
    <div class="progress-track" aria-label="Journey progress">
      <div class="progress-fill" style="width: ${progressPercent.toFixed(2)}%"></div>
    </div>
    <div class="progress-caption">
      <span>${progressPercent.toFixed(2)}% along Earth-target vector</span>
      <span>${formatDuration(remainingLightSeconds)} light time remaining</span>
    </div>
    <div class="metric-tiles">
      <article>
        <span>ETA now</span>
        <strong>${navigation.etaText}</strong>
      </article>
      <article>
        <span>Heading error</span>
        <strong>${formatDegrees(navigation.headingErrorDeg)}</strong>
      </article>
      <article>
        <span>Closest approach</span>
        <strong>${Number.isFinite(journeyStats.closestKm) ? formatDistance(journeyStats.closestKm) : "not recorded"}</strong>
      </article>
      <article>
        <span>Arrival zone</span>
        <strong>${formatDistance(thresholdKm)}</strong>
      </article>
    </div>
    <div class="journey-grid detail-grid">
      <span>Earth-target distance</span><strong>${formatDistance(target.distance_from_earth_km)}</strong>
      <span>Earth-target light time</span><strong>${formatDuration(targetLightSeconds)}</strong>
      <span>Comparison</span><strong>${formatNumber(comparison)} Earth-Moon distances</strong>
    </div>
  `;
}

function updateFlightValues(shipSpeedKmS: number, scaleKm: number, navigation: ReturnType<typeof navigationMetrics>) {
  flightValues.innerHTML = `
    <div class="flight-metric">
      <span>Speed</span>
      <strong>${formatNumber(shipSpeedKmS)} km/s</strong>
    </div>
    <div class="flight-metric">
      <span>Warp</span>
      <strong>${warpEnabled ? "on · 250x" : "off"}</strong>
    </div>
    <div class="flight-metric">
      <span>Closing</span>
      <strong>${navigation.closingSpeedKmS > 0 ? `${formatNumber(navigation.closingSpeedKmS)} km/s` : "not closing"}</strong>
    </div>
    <div class="flight-metric">
      <span>Scale</span>
      <strong>${shortScaleText(scaleKm, ephemeris?.au_km ?? AU_KM_FALLBACK)}</strong>
    </div>
  `;
}

function updateBodyInfo() {
  if (!ephemeris) return;
  const body = bodyByKey.get(selectedBodyKey) ?? bodyByKey.get(selectedTarget);
  if (!body) {
    bodyInfo.textContent = "";
    return;
  }

  bodyInfo.innerHTML = `
    <div class="body-info-title">
      <div class="body-title-main">
        ${bodyOrbHtml(body)}
        <div>
          <span class="eyebrow">Inspected body</span>
          <strong>${escapeHtml(body.name)}</strong>
        </div>
      </div>
    </div>
    <div class="body-grid">
      <span>From Sun</span><strong>${formatDistance(body.position.heliocentric_distance_km)}</strong>
      <span>From Earth</span><strong>${formatDistance(body.distance_from_earth_km)}</strong>
      <span>Ecliptic z</span><strong>${formatDistance(body.position.z_km)}</strong>
      <span>Mean radius</span><strong>${formatDistance(body.radius_km)}</strong>
    </div>
  `;
}

function journeyProgress(earth: BodyPosition, target: BodyPosition, currentShip: Ship) {
  const ex = earth.x_au;
  const ey = earth.y_au;
  const ez = earth.z_au;
  const tx = target.x_au;
  const ty = target.y_au;
  const tz = target.z_au;
  const sx = currentShip.xAu;
  const sy = currentShip.yAu;
  const sz = currentShip.zAu;

  const vx = tx - ex;
  const vy = ty - ey;
  const vz = tz - ez;
  const wx = sx - ex;
  const wy = sy - ey;
  const wz = sz - ez;
  const mag2 = vx * vx + vy * vy + vz * vz;
  if (mag2 === 0) return 0;
  return clamp((wx * vx + wy * vy + wz * vz) / mag2, 0, 1);
}

function shipTargetDistanceKm(target: Body) {
  if (!ephemeris || !ship) return 0;
  const dx = ship.xAu - target.position.x_au;
  const dy = ship.yAu - target.position.y_au;
  const dz = ship.zAu - target.position.z_au;
  return Math.hypot(dx, dy, dz) * ephemeris.au_km;
}

function shipSpeedKmPerSecond() {
  if (!ephemeris || !ship) return 0;
  return Math.hypot(ship.vxAuPerSec, ship.vyAuPerSec) * ephemeris.au_km;
}

function navigationMetrics(target: Body, shipTargetKm: number) {
  if (!ephemeris || !ship) {
    return { closingSpeedKmS: 0, etaText: "unavailable", headingErrorDeg: 0 };
  }

  const dx = target.position.x_au - ship.xAu;
  const dy = target.position.y_au - ship.yAu;
  const dz = target.position.z_au - ship.zAu;
  const distanceAu = Math.hypot(dx, dy, dz);
  if (distanceAu === 0) {
    return { closingSpeedKmS: 0, etaText: "arrived", headingErrorDeg: 0 };
  }

  const closingSpeedAuS = (ship.vxAuPerSec * dx + ship.vyAuPerSec * dy) / distanceAu;
  const closingSpeedKmS = closingSpeedAuS * ephemeris.au_km;
  const etaText = closingSpeedKmS > 0.001 ? formatDuration(shipTargetKm / closingSpeedKmS) : "not closing";
  const targetBearing = Math.atan2(dy, dx);
  const headingErrorDeg = Math.abs(radToDeg(normalizeAngle(targetBearing - ship.angleRad)));

  return { closingSpeedKmS, etaText, headingErrorDeg };
}

function updateJourneyStats(shipTargetKm: number, target: Body) {
  if (journeyStats.targetKey !== selectedTarget) {
    resetJourneyStats();
  }

  journeyStats.closestKm = Math.min(journeyStats.closestKm, shipTargetKm);
  if (shipTargetKm <= arrivalThresholdKm(target)) {
    journeyStats.arrived = true;
  }
}

function resetJourneyStats() {
  journeyStats = createJourneyStats(selectedTarget);
  const target = bodyByKey.get(selectedTarget);
  if (target && ship) {
    journeyStats.closestKm = shipTargetDistanceKm(target);
    journeyStats.arrived = journeyStats.closestKm <= arrivalThresholdKm(target);
  }
}

function createJourneyStats(targetKey: TargetKey): JourneyStats {
  return {
    targetKey,
    closestKm: Number.POSITIVE_INFINITY,
    arrived: false
  };
}

function arrivalThresholdKm(target: Body) {
  return Math.max(25_000, target.radius_km * 8);
}

function selectBodyAt(clientX: number, clientY: number) {
  if (!ephemeris) return;

  const hit = ephemeris.bodies
    .map((body) => {
      const screen = worldToScreen(body.position.x_au, body.position.y_au);
      const distancePx = Math.hypot(screen.x - clientX, screen.y - clientY);
      return { body, distancePx, hitRadius: Math.max(14, displayRadius(body) + 8) };
    })
    .filter((candidate) => candidate.distancePx <= candidate.hitRadius)
    .sort((a, b) => a.distancePx - b.distancePx)[0];

  if (!hit) return;
  selectedBodyKey = hit.body.key;
  syncBodySelect();
  updateHud();
}

function centerOnBody(key: string) {
  const body = bodyByKey.get(key);
  if (!body) return;
  camera.xAu = body.position.x_au;
  camera.yAu = body.position.y_au;
}

function ensureSelectedKeysExist() {
  const loadedKeys = Array.from(bodyByKey.keys());
  if (!bodyByKey.has(selectedTarget)) {
    selectedTarget = bodyByKey.has(selectedBodyKey) ? selectedBodyKey : bodyByKey.has("jupiter") ? "jupiter" : (loadedKeys[0] ?? "");
  }
  if (!bodyByKey.has(selectedBodyKey)) {
    selectedBodyKey = selectedTarget;
  }
}

function populateCatalogControls() {
  if (!ephemeris) return;
  const previous = bodySelect.value || selectedBodyKey;
  bodySelect.innerHTML = "";
  bodyOptions.innerHTML = "";

  for (const body of ephemeris.bodies) {
    const option = document.createElement("option");
    option.value = body.key;
    option.textContent = body.name;
    bodySelect.appendChild(option);

    const searchOption = document.createElement("option");
    searchOption.value = bodySearchLabel(body);
    searchOption.label = body.key;
    bodyOptions.appendChild(searchOption);
  }

  selectedBodyKey = bodyByKey.has(previous) ? previous : selectedBodyKey;
  syncBodySelect();
  syncDestinationSearch();
  updateTargetButtons();
}

function syncBodySelect() {
  if (bodySelect.value !== selectedBodyKey) {
    bodySelect.value = selectedBodyKey;
  }
}

function decorateStaticControls() {
  setButtonContent(setDestination, "target", "Target");
  setButtonContent(jumpDestination, "locate", "Center", { compact: true });
  setButtonContent(targetSelected, "target", "Set as target", { compact: true });
  setButtonContent(centerSelected, "center", "Center map", { compact: true });
  setButtonContent(applyTime, "check", "Apply timestamp", { compact: true });
  setButtonContent(zoomOut, "minus", "Zoom out", { compact: true });
  setButtonContent(zoomIn, "plus", "Zoom in", { compact: true });
  setButtonContent(centerSun, "sun", "Center on Sun", { compact: true });
  setButtonContent(centerShip, "ship", "Center on ship", { compact: true });
  setButtonContent(resetShipButton, "reset", "Reset ship", { compact: true });
  setButtonContent(restartJourneyButton, "restart", "Restart journey", { compact: true });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-step-days]")) {
    const days = Number(button.dataset.stepDays ?? "0");
    const label = `${Math.abs(days)}d`;
    button.classList.add("time-step");
    button.classList.toggle("past", days < 0);
    button.classList.toggle("future", days > 0);
    button.innerHTML = `${icon(days < 0 ? "back" : "forward")}<span>${label}</span>`;
  }
}

function setButtonContent(button: HTMLButtonElement, iconName: string, label: string, options: { compact?: boolean } = {}) {
  const labelClass = options.compact ? "sr-only" : "button-label";
  button.innerHTML = `${icon(iconName)}<span class="${labelClass}">${escapeHtml(label)}</span>`;
}

function updateTargetButtons() {
  for (const button of targetButtons.querySelectorAll<HTMLButtonElement>("button")) {
    const key = button.dataset.target;
    if (!key) continue;
    const body = bodyByKey.get(key);
    button.classList.toggle("active", key === selectedTarget);
    button.disabled = !bodyByKey.has(key);
    button.setAttribute("aria-label", `Set target to ${body?.name ?? labelForKey(key)}`);
    button.innerHTML = quickTargetMarkup(key, body);
  }
}

function quickTargetMarkup(key: string, body?: Body) {
  const name = body?.name ?? labelForKey(key);
  const distance = body ? compactDistance(body.distance_from_earth_km) : "loading";
  return `
    ${bodyOrbHtml(body ?? key)}
    <span class="target-copy">
      <strong>${escapeHtml(name)}</strong>
      <small>${distance}</small>
    </span>
  `;
}

function setTarget(key: string, options: { inspect?: boolean; center?: boolean } = {}) {
  const body = bodyByKey.get(key);
  if (!body) return;

  selectedTarget = body.key;
  if (options.inspect) {
    selectedBodyKey = body.key;
    syncBodySelect();
  }
  syncDestinationSearch();
  resetJourneyStats();
  updateTargetButtons();
  if (options.center) {
    centerOnBody(body.key);
  }
  updateHud();
}

function bodyFromSearchValue(value: string) {
  const query = value.trim().toLowerCase();
  if (!query) return null;

  const bracketedKey = query.match(/\[([^\]]+)\]$/)?.[1];
  if (bracketedKey) {
    const keyedBody = Array.from(bodyByKey.values()).find((body) => body.key.toLowerCase() === bracketedKey);
    if (keyedBody) return keyedBody;
  }

  return (
    Array.from(bodyByKey.values()).find((body) => {
      return body.key.toLowerCase() === query || body.name.toLowerCase() === query || bodySearchLabel(body).toLowerCase() === query;
    }) ?? null
  );
}

function flashSearchError() {
  destinationSearch.setCustomValidity("No loaded body matches this destination.");
  destinationSearch.reportValidity();
  window.setTimeout(() => destinationSearch.setCustomValidity(""), 1800);
}

function bodySearchLabel(body: Body) {
  return body.name;
}

function bodyOrbHtml(bodyOrKey: Body | string, size: "large" | "" = "") {
  const key = typeof bodyOrKey === "string" ? bodyOrKey : bodyOrKey.key;
  const color = typeof bodyOrKey === "string" ? fallbackBodyColor(key) : safeCssColor(bodyOrKey.color);
  const classKey = key.replace(/[^a-z0-9_-]/gi, "");
  const className = ["body-orb", `body-${classKey}`, size].filter(Boolean).join(" ");
  return `<span class="${className}" style="--body-color: ${color};" aria-hidden="true"></span>`;
}

function fallbackBodyColor(key: string) {
  const colors: Record<string, string> = {
    sun: "#ffd166",
    mercury: "#b8a48a",
    venus: "#d8b26f",
    earth: "#62a8ff",
    moon: "#c8c8c8",
    mars: "#df6b43",
    jupiter: "#d9b382",
    saturn: "#d8c28a",
    uranus: "#83d8d8",
    neptune: "#6f8cff"
  };
  return colors[key] ?? "#d9b86f";
}

function safeCssColor(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#d9b86f";
}

function icon(name: string) {
  return ICONS[name] ?? "";
}

function compactDistance(km: number) {
  if (!Number.isFinite(km)) return "distance pending";
  const abs = Math.abs(km);
  if (abs >= AU_KM_FALLBACK * 0.1) return `${formatAu(km / AU_KM_FALLBACK)} AU`;
  if (abs >= 1_000_000) {
    const millions = km / 1_000_000;
    return `${millions >= 10 ? millions.toFixed(0) : millions.toFixed(1)}M km`;
  }
  if (abs >= 100_000) return `${(km / 1_000).toFixed(0)}k km`;
  return `${formatNumber(km)} km`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function syncDestinationSearch() {
  const target = bodyByKey.get(selectedTarget);
  if (target) {
    destinationSearch.value = bodySearchLabel(target);
  }
}

function resizeCanvas() {
  const ratio = devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * ratio);
  canvas.height = Math.floor(window.innerHeight * ratio);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
}

function zoomAt(clientX: number, clientY: number, factor: number) {
  const before = screenToWorld(clientX, clientY);
  camera.pxPerAu = clamp(camera.pxPerAu * factor, 4, 240_000);
  const after = screenToWorld(clientX, clientY);
  camera.xAu += before.xAu - after.xAu;
  camera.yAu += before.yAu - after.yAu;
  updateHud();
}

function worldToScreen(xAu: number, yAu: number) {
  return {
    x: window.innerWidth / 2 + (xAu - camera.xAu) * camera.pxPerAu,
    y: window.innerHeight / 2 - (yAu - camera.yAu) * camera.pxPerAu
  };
}

function screenToWorld(x: number, y: number) {
  return {
    xAu: camera.xAu + (x - window.innerWidth / 2) / camera.pxPerAu,
    yAu: camera.yAu - (y - window.innerHeight / 2) / camera.pxPerAu
  };
}

function displayRadius(body: Body) {
  if (body.key === "sun") return 15;
  if (body.key === "jupiter") return 10;
  if (body.key === "saturn") return 9;
  if (body.key === "uranus" || body.key === "neptune") return 7;
  if (body.key === "moon") return 3.5;
  return 5.5;
}

function pickGridAu() {
  const targetPx = 88;
  const rawAu = targetPx / camera.pxPerAu;
  const powers = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
  return powers.find((value) => value >= rawAu) ?? 20;
}

function scaleText(kmPerPx: number, auKm: number) {
  const auPerPx = kmPerPx / auKm;
  if (auPerPx >= 0.001) return `1 px = ${formatNumber(kmPerPx)} km / ${formatAu(auPerPx)} AU`;
  return `1 px = ${formatNumber(kmPerPx)} km`;
}

function shortScaleText(kmPerPx: number, auKm: number) {
  const auPerPx = kmPerPx / auKm;
  if (auPerPx >= 0.001) return `${formatAu(auPerPx)} AU/px`;
  return `${formatNumber(kmPerPx)} km/px`;
}

function formatTimestamp(timestampUtc: string) {
  return timestampUtc.replace("T", " ").replace(/\.\d+Z$/, " UTC").replace("Z", " UTC");
}

function formatDistance(km: number) {
  const abs = Math.abs(km);
  if (abs >= AU_KM_FALLBACK * 0.1) {
    return `${formatNumber(km)} km (${formatAu(km / AU_KM_FALLBACK)} AU)`;
  }
  return `${formatNumber(km)} km`;
}

function formatDuration(seconds: number) {
  if (seconds < 90) return `${seconds.toFixed(1)} s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${minutes.toFixed(1)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(2)} h`;
  return `${(hours / 24).toFixed(2)} d`;
}

function formatDegrees(degrees: number) {
  return `${degrees.toFixed(1)}°`;
}

function formatAu(au: number) {
  const abs = Math.abs(au);
  if (abs >= 10) return au.toFixed(1);
  if (abs >= 1) return au.toFixed(2);
  if (abs >= 0.01) return au.toFixed(3);
  return au.toExponential(2);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2
  }).format(value);
}

function labelForKey(key: string) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(radians: number) {
  let angle = radians;
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

function radToDeg(radians: number) {
  return (radians * 180) / Math.PI;
}

function datetimeLocalToIso(value: string) {
  if (!value) return null;
  const parsed = new Date(`${value.endsWith("Z") ? value.slice(0, -1) : value}Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function setTimeInputFromTimestamp(timestampUtc: string) {
  const parsed = new Date(timestampUtc);
  if (Number.isNaN(parsed.getTime())) return;
  timeInput.value = parsed.toISOString().slice(0, 19);
}

function requiredElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function requiredCanvasContext(targetCanvas: HTMLCanvasElement) {
  const context = targetCanvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }
  return context;
}

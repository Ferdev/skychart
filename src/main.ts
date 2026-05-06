import "./styles.css";

const AU_KM_FALLBACK = 149_597_870.7;
const LIGHT_SPEED_KM_S = 299_792.458;
const EARTH_MOON_AVG_KM = 384_400;
const TARGETS = ["moon", "mars", "jupiter", "saturn"] as const;

type TargetKey = (typeof TARGETS)[number];

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

const canvas = requiredElement<HTMLCanvasElement>("#map");
const hudValues = requiredElement<HTMLElement>("#hud-values");
const loadState = requiredElement<HTMLElement>("#load-state");
const targetButtons = requiredElement<HTMLElement>("#target-buttons");
const journey = requiredElement<HTMLElement>("#journey");
const errorPanel = requiredElement<HTMLElement>("#error-panel");
const zoomIn = requiredElement<HTMLButtonElement>("#zoom-in");
const zoomOut = requiredElement<HTMLButtonElement>("#zoom-out");
const centerSun = requiredElement<HTMLButtonElement>("#center-sun");
const centerShip = requiredElement<HTMLButtonElement>("#center-ship");
const ctx = requiredCanvasContext(canvas);

const keys = new Set<string>();
const camera = {
  xAu: 0,
  yAu: 0,
  pxPerAu: 64
};

let ephemeris: Ephemeris | null = null;
let bodyByKey = new Map<string, Body>();
let selectedTarget: TargetKey = "jupiter";
let ship: Ship | null = null;
let warpEnabled = false;
let lastFrame = performance.now();
let isDragging = false;
let dragStart = { x: 0, y: 0, cameraXAu: 0, cameraYAu: 0 };

for (const target of TARGETS) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.target = target;
  button.textContent = labelForKey(target);
  button.addEventListener("click", () => {
    selectedTarget = target;
    updateTargetButtons();
    updateHud();
  });
  targetButtons.appendChild(button);
}
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
  camera.xAu = dragStart.cameraXAu - (event.clientX - dragStart.x) / camera.pxPerAu;
  camera.yAu = dragStart.cameraYAu + (event.clientY - dragStart.y) / camera.pxPerAu;
});

canvas.addEventListener("pointerup", (event) => {
  isDragging = false;
  canvas.releasePointerCapture(event.pointerId);
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

resizeCanvas();
loadEphemeris();
requestAnimationFrame(loop);

async function loadEphemeris() {
  try {
    loadState.textContent = "loading";
    const response = await fetch("/api/ephemeris");
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ephemeris API returned ${response.status}.\n${text}`);
    }

    ephemeris = (await response.json()) as Ephemeris;
    bodyByKey = new Map(ephemeris.bodies.map((body) => [body.key, body]));
    initializeShip();
    fitInitialView();
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

function initializeShip() {
  const earth = bodyByKey.get("earth");
  if (!earth || ship) return;

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
  ctx.lineWidth = 1.5;
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

function drawBody(body: Body) {
  const screen = worldToScreen(body.position.x_au, body.position.y_au);
  const radius = displayRadius(body);
  const isTarget = body.key === selectedTarget;

  ctx.save();
  if (body.key === "saturn") {
    ctx.strokeStyle = "rgba(216, 194, 138, 0.74)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y, radius * 1.65, radius * 0.55, -0.35, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = body.color;
  ctx.strokeStyle = isTarget ? "#f3f0e8" : "rgba(0, 0, 0, 0.38)";
  ctx.lineWidth = isTarget ? 2 : 1;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = body.key === "sun" ? "#ffe8a3" : "#f3f0e8";
  ctx.font = isTarget ? "700 13px ui-sans-serif, system-ui" : "12px ui-sans-serif, system-ui";
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
  const shipSpeedKmS = Math.hypot(ship.vxAuPerSec, ship.vyAuPerSec) * ephemeris.au_km;
  const scaleKm = ephemeris.au_km / camera.pxPerAu;
  const lightTimeSeconds = target.distance_from_earth_km / LIGHT_SPEED_KM_S;

  hudValues.innerHTML = "";
  appendDefinition("UTC timestamp", ephemeris.timestamp_utc);
  appendDefinition("Selected target", target.name);
  appendDefinition("Earth-target", formatDistance(target.distance_from_earth_km));
  appendDefinition("Earth-target light", formatDuration(lightTimeSeconds));
  appendDefinition("Ship-target", formatDistance(shipTargetKm));
  appendDefinition("Ship speed", `${formatNumber(shipSpeedKmS)} km/s`);
  appendDefinition("Warp", warpEnabled ? "on, 250x thrust/speed cap" : "off");
  appendDefinition("Scale", scaleText(scaleKm, ephemeris.au_km));
  appendDefinition("Data source", ephemeris.data_source);
  appendDefinition("Frame", "heliocentric ecliptic x/y");

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

  journey.innerHTML = `
    <div class="journey-title">
      <span>Earth → ${target.name}</span>
      <span>${progressPercent.toFixed(2)}%</span>
    </div>
    <div class="progress-track" aria-label="Journey progress">
      <div class="progress-fill" style="width: ${progressPercent.toFixed(2)}%"></div>
    </div>
    <div class="journey-grid">
      <span>Origin</span><strong>Earth</strong>
      <span>Destination</span><strong>${target.name}</strong>
      <span>Distance remaining</span><strong>${formatDistance(shipTargetKm)}</strong>
      <span>Remaining light time</span><strong>${formatDuration(remainingLightSeconds)}</strong>
      <span>Comparison</span><strong>${formatNumber(comparison)} Earth-Moon distances</strong>
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

function updateTargetButtons() {
  for (const button of targetButtons.querySelectorAll<HTMLButtonElement>("button")) {
    button.classList.toggle("active", button.dataset.target === selectedTarget);
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

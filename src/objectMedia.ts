export type ObjectMediaItem = {
  kind: "curated" | "survey";
  imageUrl: string;
  title: string;
  alt: string;
  credit: string;
  license: string;
  sourceUrl: string;
  badge: string;
  description?: string;
};

export type ObjectMediaStatus = {
  badge: string;
  title: string;
  description: string;
};

type MediaLookupBody = {
  key: string;
  name: string;
  object_type?: string | null;
  aliases?: readonly string[];
  catalog?: {
    source_type?: string | null;
    position_model?: string | null;
    catalog_group?: string | null;
    ra_deg?: number | null;
    dec_deg?: number | null;
  } | null;
  deep_sky?: {
    angular_size_arcmin?: string | null;
    deep_sky_type_label?: string | null;
  } | null;
};

const OBJECT_MEDIA_BY_KEY: Record<string, ObjectMediaItem> = {
  sun: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/GSFC_20171208_Archive_e002035/GSFC_20171208_Archive_e002035~orig.jpg",
    title: "Full Disk View of the Sun",
    alt: "Solar Dynamics Observatory full disk view of the Sun.",
    credit: "NASA/SDO",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/GSFC_20171208_Archive_e002035",
    badge: "Curated NASA image"
  },
  mercury: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/PIA19419/PIA19419~orig.jpg",
    title: "Unmasking the Secrets of Mercury",
    alt: "Enhanced color MESSENGER view of Mercury.",
    credit: "NASA/Johns Hopkins University Applied Physics Laboratory/Carnegie Institution of Washington",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA19419",
    badge: "Curated NASA image"
  },
  venus: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/PIA00270/PIA00270~orig.jpg",
    title: "Venus - Global View Centered at 90 Degrees East Longitude",
    alt: "Computer-simulated global radar view of Venus.",
    credit: "NASA/JPL",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA00270",
    badge: "Curated NASA image"
  },
  earth: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/GSFC_20171208_Archive_e001386/GSFC_20171208_Archive_e001386~large.jpg",
    title: "Blue Marble 2012",
    alt: "Full disk view of Earth from space with blue oceans, white clouds, and visible continents.",
    credit: "NASA/GSFC",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/GSFC_20171208_Archive_e001386",
    badge: "Curated NASA image"
  },
  moon: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/PIA00302/PIA00302~orig.jpg",
    title: "Nearside of Earth's Moon as Seen by Clementine",
    alt: "Global nearside mosaic of Earth's Moon.",
    credit: "NASA/JPL/USGS",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA00302",
    badge: "Curated NASA image"
  },
  mars: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/PIA02005/PIA02005~orig.jpg",
    title: "Tharsis Volcanoes and Valles Marineris",
    alt: "Global Mars view showing the Tharsis volcanic region and the long Valles Marineris canyon system.",
    credit: "NASA/JPL/MSSS",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA02005",
    badge: "Curated NASA image"
  },
  jupiter: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/PIA02873/PIA02873~orig.jpg",
    title: "High Resolution Globe of Jupiter",
    alt: "Color globe of Jupiter with banded clouds and the Great Red Spot.",
    credit: "NASA/JPL/University of Arizona",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA02873",
    badge: "Curated NASA image"
  },
  saturn: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/PIA11657/PIA11657~orig.jpg",
    title: "Across Resplendent Rings",
    alt: "Cassini view of Saturn and its ring plane.",
    credit: "NASA/JPL/Space Science Institute",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA11657",
    badge: "Curated NASA image"
  },
  uranus: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/PIA18182/PIA18182~orig.jpg",
    title: "Uranus as Seen by Voyager 2",
    alt: "Voyager 2 image of Uranus as a blue-green disk.",
    credit: "NASA/JPL-Caltech",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA18182",
    badge: "Curated NASA image"
  },
  neptune: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/PIA01492/PIA01492~orig.jpg",
    title: "Neptune from Voyager 2",
    alt: "Voyager 2 image of Neptune with blue atmospheric features.",
    credit: "NASA/JPL",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA01492",
    badge: "Curated NASA image"
  },
  pluto: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/PIA21862/PIA21862~orig.jpg",
    title: "Global Mosaics of Pluto and Charon",
    alt: "New Horizons global mosaics of Pluto and Charon.",
    credit: "NASA/JHUAPL/SwRI",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA21862",
    badge: "Curated NASA image"
  },
  m31: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/GSFC_20171208_Archive_e000833/GSFC_20171208_Archive_e000833~orig.jpg",
    title: "Hubble's High-Definition Panoramic View of the Andromeda Galaxy",
    alt: "Wide Hubble mosaic of the Andromeda Galaxy showing dense star fields and dust lanes.",
    credit: "NASA, ESA, J. Dalcanton, B. F. Williams, and L. C. Johnson",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/GSFC_20171208_Archive_e000833",
    badge: "Curated NASA image"
  },
  m42: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/PIA04227/PIA04227~orig.jpg",
    title: "Orion Nebula and Bow Shock",
    alt: "Hubble view of glowing gas and dust in the Orion Nebula.",
    credit: "NASA and the Hubble Heritage Team STScI/AURA",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA04227",
    badge: "Curated NASA image"
  },
  m45: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/PIA08260/PIA08260~orig.jpg",
    title: "The Seven Sisters",
    alt: "Infrared view of the Pleiades star cluster and surrounding dust.",
    credit: "NASA/JPL-Caltech",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA08260",
    badge: "Curated NASA image"
  },
  m57: {
    kind: "curated",
    imageUrl: "https://images-assets.nasa.gov/image/PIA14443/PIA14443~orig.jpg",
    title: "Looking Down a Barrel of Gas at a Doomed Star",
    alt: "Hubble image of the Ring Nebula with glowing gas around a central star.",
    credit: "NASA, ESA, and the Hubble Heritage Team STScI/AURA",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA14443",
    badge: "Curated NASA image"
  }
};

const OBJECT_MEDIA_ALIASES: Record<string, string> = {
  "m31 andromeda galaxy": "m31",
  "andromeda galaxy": "m31",
  "m42 great nebula in orion": "m42",
  "great nebula in orion": "m42",
  "orion nebula": "m42",
  "m45 pleiades": "m45",
  "pleiades": "m45",
  "seven sisters": "m45",
  "m57 ring nebula": "m57",
  "ring nebula": "m57"
};

export function objectMediaFor(body: MediaLookupBody): ObjectMediaItem | null {
  const direct = OBJECT_MEDIA_BY_KEY[body.key.toLowerCase()];
  if (direct) return direct;

  const lookupValues = [body.name, ...(body.aliases ?? [])].map((value) => value.trim().toLowerCase()).filter(Boolean);
  for (const value of lookupValues) {
    const key = OBJECT_MEDIA_ALIASES[value];
    if (key && OBJECT_MEDIA_BY_KEY[key]) return OBJECT_MEDIA_BY_KEY[key];
  }

  return surveyMediaFor(body);
}

export function objectMediaStatusFor(body: MediaLookupBody): ObjectMediaStatus {
  const sourceLabel = sourceLabelFor(body);
  const coordinateLabel = coordinateFor(body) ? "The object has survey-ready sky coordinates." : "The object does not expose survey-ready sky coordinates yet.";
  return {
    badge: "Catalog-only object",
    title: "No image attached yet",
    description: `${coordinateLabel} Its scientific facts and position are still available from ${sourceLabel}.`
  };
}

function surveyMediaFor(body: MediaLookupBody): ObjectMediaItem | null {
  const coordinate = coordinateFor(body);
  if (!coordinate) return null;

  const fov = surveyFieldOfViewDeg(body);
  const imageParams = new URLSearchParams({
    hips: "CDS/P/DSS2/color",
    width: "920",
    height: "520",
    fov: fov.toFixed(3),
    projection: "TAN",
    coordsys: "icrs",
    ra: coordinate.raDeg.toFixed(6),
    dec: coordinate.decDeg.toFixed(6),
    format: "jpg"
  });
  const sourceParams = new URLSearchParams({
    target: `${coordinate.raDeg.toFixed(6)} ${coordinate.decDeg.toFixed(6)}`,
    fov: fov.toFixed(3),
    survey: "P/DSS2/color"
  });

  return {
    kind: "survey",
    imageUrl: `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${imageParams.toString()}`,
    title: `${body.name} survey field`,
    alt: `DSS2 color sky-survey cutout centered on ${body.name}.`,
    credit: "CDS/Aladin HiPS using DSS2 color survey data",
    license: "Sky-survey cutout",
    sourceUrl: `https://aladin.cds.unistra.fr/AladinLite/?${sourceParams.toString()}`,
    badge: "Survey cutout",
    description: `Generated from catalog coordinates at RA ${coordinate.raDeg.toFixed(3)} deg, Dec ${coordinate.decDeg.toFixed(3)} deg.`
  };
}

function coordinateFor(body: MediaLookupBody): { raDeg: number; decDeg: number } | null {
  const raDeg = finiteCoordinate(body.catalog?.ra_deg);
  const decDeg = finiteCoordinate(body.catalog?.dec_deg);
  if (raDeg == null || decDeg == null) return null;
  if (raDeg < 0 || raDeg >= 360 || decDeg < -90 || decDeg > 90) return null;
  return { raDeg, decDeg };
}

function finiteCoordinate(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function surveyFieldOfViewDeg(body: MediaLookupBody): number {
  const angularMajorArcmin = parseAngularMajorArcmin(body.deep_sky?.angular_size_arcmin);
  if (angularMajorArcmin) return clamp((angularMajorArcmin / 60) * 2.1, 0.12, 1.6);
  if (body.object_type === "galaxy" || body.object_type === "nebula") return 0.5;
  if (body.object_type === "star_cluster" || body.object_type === "asterism") return 0.35;
  if (body.object_type === "quasar" || body.object_type === "active_galaxy" || body.object_type === "black_hole" || body.object_type === "pulsar") return 0.18;
  return 0.12;
}

function parseAngularMajorArcmin(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/[\d.]+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sourceLabelFor(body: MediaLookupBody) {
  if (body.catalog?.source_type) return body.catalog.source_type.replace(/_/g, " ");
  if (body.catalog?.catalog_group) return body.catalog.catalog_group.replace(/_/g, " ");
  if (body.object_type) return `${body.object_type.replace(/_/g, " ")} catalog`;
  return "the scientific catalog";
}

export type ObjectMediaItem = {
  imageUrl: string;
  title: string;
  alt: string;
  credit: string;
  license: string;
  sourceUrl: string;
};

type MediaLookupBody = {
  key: string;
  name: string;
  aliases?: readonly string[];
};

const OBJECT_MEDIA_BY_KEY: Record<string, ObjectMediaItem> = {
  earth: {
    imageUrl: "https://images-assets.nasa.gov/image/GSFC_20171208_Archive_e001386/GSFC_20171208_Archive_e001386~large.jpg",
    title: "Blue Marble 2012",
    alt: "Full disk view of Earth from space with blue oceans, white clouds, and visible continents.",
    credit: "NASA/GSFC",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/GSFC_20171208_Archive_e001386"
  },
  mars: {
    imageUrl: "https://images-assets.nasa.gov/image/PIA02005/PIA02005~orig.jpg",
    title: "Tharsis Volcanoes and Valles Marineris",
    alt: "Global Mars view showing the Tharsis volcanic region and the long Valles Marineris canyon system.",
    credit: "NASA/JPL/MSSS",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA02005"
  },
  jupiter: {
    imageUrl: "https://images-assets.nasa.gov/image/PIA02873/PIA02873~orig.jpg",
    title: "High Resolution Globe of Jupiter",
    alt: "Color globe of Jupiter with banded clouds and the Great Red Spot.",
    credit: "NASA/JPL/University of Arizona",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA02873"
  },
  saturn: {
    imageUrl: "https://images-assets.nasa.gov/image/PIA11657/PIA11657~orig.jpg",
    title: "Across Resplendent Rings",
    alt: "Cassini view of Saturn and its ring plane.",
    credit: "NASA/JPL/Space Science Institute",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA11657"
  },
  m31: {
    imageUrl: "https://images-assets.nasa.gov/image/GSFC_20171208_Archive_e000833/GSFC_20171208_Archive_e000833~orig.jpg",
    title: "Hubble's High-Definition Panoramic View of the Andromeda Galaxy",
    alt: "Wide Hubble mosaic of the Andromeda Galaxy showing dense star fields and dust lanes.",
    credit: "NASA, ESA, J. Dalcanton, B. F. Williams, and L. C. Johnson",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/GSFC_20171208_Archive_e000833"
  },
  m42: {
    imageUrl: "https://images-assets.nasa.gov/image/PIA04227/PIA04227~orig.jpg",
    title: "Orion Nebula and Bow Shock",
    alt: "Hubble view of glowing gas and dust in the Orion Nebula.",
    credit: "NASA and the Hubble Heritage Team STScI/AURA",
    license: "NASA Image and Video Library",
    sourceUrl: "https://images.nasa.gov/details/PIA04227"
  }
};

const OBJECT_MEDIA_ALIASES: Record<string, string> = {
  "m31 andromeda galaxy": "m31",
  "andromeda galaxy": "m31",
  "m42 great nebula in orion": "m42",
  "great nebula in orion": "m42",
  "orion nebula": "m42"
};

export function objectMediaFor(body: MediaLookupBody): ObjectMediaItem | null {
  const direct = OBJECT_MEDIA_BY_KEY[body.key.toLowerCase()];
  if (direct) return direct;

  const lookupValues = [body.name, ...(body.aliases ?? [])].map((value) => value.trim().toLowerCase()).filter(Boolean);
  for (const value of lookupValues) {
    const key = OBJECT_MEDIA_ALIASES[value];
    if (key && OBJECT_MEDIA_BY_KEY[key]) return OBJECT_MEDIA_BY_KEY[key];
  }

  return null;
}

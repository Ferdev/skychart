/**
 * Object type names. `type.*` is the name of one object and `typePlural.*` is the name of a group.
 * English and Spanish singular names are in `i18n.ts` and `partialTranslations.ts`; this module adds the others.
 * Use them through `objectTypeLabel` (`format/objectTypeLabel.ts`), not directly.
 */
const TYPES = [
  "star", "planet", "moon", "dwarfPlanet", "galaxy", "quasar", "activeGalaxy", "blackHole", "pulsar", "nebula",
  "starCluster", "xraySource", "xrayExtended", "asterism", "milkyWayPatch", "asteroid", "comet", "smallBody", "object",
] as const;
const PLURAL_ONLY_TYPES = ["planetCandidate", "spacecraft"] as const;

const SINGULAR: Record<string, readonly string[]> = {
  fr: ["Étoile", "Planète", "Lune", "Planète naine", "Galaxie", "Quasar", "Galaxie active", "Trou noir", "Pulsar", "Nébuleuse", "Amas d’étoiles", "Source de rayons X", "Source étendue de rayons X", "Astérisme", "Région de la Voie lactée", "Astéroïde", "Comète", "Petit corps", "Objet"],
  de: ["Stern", "Planet", "Mond", "Zwergplanet", "Galaxie", "Quasar", "Aktive Galaxie", "Schwarzes Loch", "Pulsar", "Nebel", "Sternhaufen", "Röntgenquelle", "Ausgedehnte Röntgenquelle", "Asterismus", "Milchstraßenregion", "Asteroid", "Komet", "Kleinkörper", "Objekt"],
  "pt-BR": ["Estrela", "Planeta", "Lua", "Planeta anão", "Galáxia", "Quasar", "Galáxia ativa", "Buraco negro", "Pulsar", "Nebulosa", "Aglomerado estelar", "Fonte de raios X", "Fonte extensa de raios X", "Asterismo", "Região da Via Láctea", "Asteroide", "Cometa", "Corpo menor", "Objeto"],
  it: ["Stella", "Pianeta", "Luna", "Pianeta nano", "Galassia", "Quasar", "Galassia attiva", "Buco nero", "Pulsar", "Nebulosa", "Ammasso stellare", "Sorgente di raggi X", "Sorgente estesa di raggi X", "Asterismo", "Regione della Via Lattea", "Asteroide", "Cometa", "Corpo minore", "Oggetto"],
  "zh-Hans": ["恒星", "行星", "卫星", "矮行星", "星系", "类星体", "活动星系", "黑洞", "脉冲星", "星云", "星团", "X射线源", "延展X射线源", "星群", "银河区域", "小行星", "彗星", "小天体", "天体"],
  ja: ["恒星", "惑星", "衛星", "準惑星", "銀河", "クエーサー", "活動銀河", "ブラックホール", "パルサー", "星雲", "星団", "X線源", "広がったX線源", "アステリズム", "天の川の領域", "小惑星", "彗星", "小天体", "天体"],
  ko: ["항성", "행성", "위성", "왜행성", "은하", "퀘이사", "활동 은하", "블랙홀", "펄서", "성운", "성단", "X선 광원", "확장 X선 광원", "성군", "은하수 영역", "소행성", "혜성", "소천체", "천체"],
};

/** Plural names in the order of `TYPES`, then of `PLURAL_ONLY_TYPES`. */
const PLURAL: Record<string, readonly string[]> = {
  en: ["Stars", "Planets", "Moons", "Dwarf planets", "Galaxies", "Quasars", "Active galaxies", "Black holes", "Pulsars", "Nebulae", "Star clusters", "X-ray sources", "Extended X-ray sources", "Asterisms", "Milky Way patches", "Asteroids", "Comets", "Small bodies", "Objects", "Planet candidates", "Spacecraft"],
  es: ["Estrellas", "Planetas", "Lunas", "Planetas enanos", "Galaxias", "Cuásares", "Galaxias activas", "Agujeros negros", "Púlsares", "Nebulosas", "Cúmulos estelares", "Fuentes de rayos X", "Fuentes extensas de rayos X", "Asterismos", "Regiones de la Vía Láctea", "Asteroides", "Cometas", "Cuerpos menores", "Objetos", "Candidatos a planeta", "Naves espaciales"],
  fr: ["Étoiles", "Planètes", "Lunes", "Planètes naines", "Galaxies", "Quasars", "Galaxies actives", "Trous noirs", "Pulsars", "Nébuleuses", "Amas d’étoiles", "Sources de rayons X", "Sources étendues de rayons X", "Astérismes", "Régions de la Voie lactée", "Astéroïdes", "Comètes", "Petits corps", "Objets", "Planètes candidates", "Sondes spatiales"],
  de: ["Sterne", "Planeten", "Monde", "Zwergplaneten", "Galaxien", "Quasare", "Aktive Galaxien", "Schwarze Löcher", "Pulsare", "Nebel", "Sternhaufen", "Röntgenquellen", "Ausgedehnte Röntgenquellen", "Asterismen", "Milchstraßenregionen", "Asteroiden", "Kometen", "Kleinkörper", "Objekte", "Planetenkandidaten", "Raumsonden"],
  "pt-BR": ["Estrelas", "Planetas", "Luas", "Planetas anões", "Galáxias", "Quasares", "Galáxias ativas", "Buracos negros", "Pulsares", "Nebulosas", "Aglomerados estelares", "Fontes de raios X", "Fontes extensas de raios X", "Asterismos", "Regiões da Via Láctea", "Asteroides", "Cometas", "Corpos menores", "Objetos", "Candidatos a planeta", "Naves espaciais"],
  it: ["Stelle", "Pianeti", "Lune", "Pianeti nani", "Galassie", "Quasar", "Galassie attive", "Buchi neri", "Pulsar", "Nebulose", "Ammassi stellari", "Sorgenti di raggi X", "Sorgenti estese di raggi X", "Asterismi", "Regioni della Via Lattea", "Asteroidi", "Comete", "Corpi minori", "Oggetti", "Pianeti candidati", "Sonde spaziali"],
  "zh-Hans": [...SINGULAR["zh-Hans"], "候选行星", "航天器"],
  ja: [...SINGULAR.ja, "惑星候補", "宇宙機"],
  ko: [...SINGULAR.ko, "행성 후보", "우주선"],
};

function typeStrings(locale: string): Record<string, string> {
  const strings: Record<string, string> = {};
  SINGULAR[locale]?.forEach((value, index) => { strings[`type.${TYPES[index]}`] = value; });
  [...TYPES, ...PLURAL_ONLY_TYPES].forEach((type, index) => { strings[`typePlural.${type}`] = PLURAL[locale][index]; });
  return strings;
}

export const TYPE_TRANSLATIONS: Record<string, Record<string, string>> =
  Object.fromEntries(Object.keys(PLURAL).map((locale) => [locale, typeStrings(locale)]));

export type LocaleCode = "en" | "es" | "fr" | "de" | "pt-BR" | "it" | "zh-Hans" | "ja" | "ko";

type LocaleDefinition = {
  label: string;
  strings: Record<string, string>;
};

export const DEFAULT_LOCALE: LocaleCode = "en";
export const SUPPORTED_LOCALES: LocaleCode[] = ["en", "es", "fr", "de", "pt-BR", "it", "zh-Hans", "ja", "ko"];

const LOCALE_STORAGE_KEY = "cosmic-atlas:locale";

const en: Record<string, string> = {
  "meta.description": "Cosmic Atlas is a scientific 2D map of Solar System, nearby-star, and Messier catalog objects using real ephemeris and catalog data.",
  "meta.ogDescription": "A scientifically grounded 2D celestial atlas for inspecting, measuring, and comparing loaded objects.",
  "app.skipControls": "Skip to controls",
  "app.mapLabel": "2D heliocentric ecliptic celestial atlas",
  "loading.label": "Loading Cosmic Atlas",
  "loading.pipeline": "Data pipeline",
  "loading.title": "Loading Cosmic Atlas",
  "loading.starting": "Starting the local ephemeris API.",
  "loading.initializing": "Initializing",
  "loading.api": "Connect to local API",
  "loading.download": "Load ephemeris payload",
  "loading.parse": "Index catalog objects",
  "loading.render": "Prepare scientific map",
  "loading.source": "JPL DE440s/Skyfield data, Horizons vectors, nearby-star catalog, and Messier catalog snapshot.",
  "header.status": "Atlas status",
  "header.eyebrow": "Scientific celestial atlas",
  "controls.label": "Atlas controls",
  "scale.label": "Zoom and scale",
  "scale.expand": "Expand scale controls",
  "scale.title": "Scale",
  "scale.zoomOut": "Zoom out",
  "scale.zoomIn": "Zoom in",
  "scale.zoomLevel": "Zoom level",
  "scale.landmarks": "Scale landmarks",
  "scale.inner": "Inner",
  "scale.solar": "Solar",
  "scale.nearby": "Nearby",
  "scale.galaxy": "Galaxy",
  "scale.messier": "Messier",
  "scale.all": "All",
  "scale.deepSky": "deep sky",
  "scale.objectDisplay": "Object display",
  "scale.objectSizeMode": "Object size mode",
  "scale.readable": "Readable",
  "scale.hybrid": "Hybrid",
  "scale.true": "True",
  "scale.overlays": "Map overlays",
  "scale.displayToggles": "Display toggles",
  "scale.labels": "Labels",
  "scale.orbits": "Orbits",
  "scale.grid": "Grid",
  "scale.milkyWay": "Milky Way",
  "scale.edgeHints": "Edge hints",
  "time.title": "Time",
  "time.controls": "Time controls",
  "time.position": "Time position",
  "time.now": "Now",
  "time.currentUtc": "Current UTC",
  "time.timestamp": "UTC timestamp",
  "time.apply": "Apply",
  "time.stepSize": "Step size",
  "time.oneMonth": "1 month",
  "time.stepBy": "Step timestamp by selected amount",
  "time.back": "Back",
  "time.forward": "Forward",
  "workspace.nav": "Atlas workspaces",
  "workspace.search": "Search",
  "workspace.label": "Atlas workspace",
  "workspace.path": "Workspace path",
  "workspace.title": "Workspace",
  "workspace.close": "Close",
  "object.current": "Current object",
  "object.actions": "Selected object actions",
  "object.center": "Center",
  "object.zoom": "Zoom",
  "compare.label": "Compare selected object",
  "compare.eyebrow": "Compare",
  "compare.heading": "Compare with another object",
  "compare.clear": "Clear",
  "compare.lookup": "Comparison lookup",
  "compare.scope": "Comparison scope",
  "compare.filters": "Comparison filters",
  "compare.results": "Comparison results",
  "compare.objects": "Comparison objects",
  "search.catalog": "Catalog search",
  "search.find": "Find a celestial object",
  "search.lookup": "Catalog lookup",
  "search.query": "Catalog query",
  "search.placeholder": "Object name or catalog designation",
  "search.use": "Use",
  "search.focus": "Focus",
  "search.featured": "Featured objects",
  "search.scope": "Scope",
  "search.filters": "Object filters",
  "search.results": "Catalog results",
  "search.matches": "Matches",
  "search.loadedObjects": "Loaded celestial objects",
  "guided.label": "Guided object sets",
  "guided.title": "Guided sets",
  "language.label": "Language"
};

const PARTIAL_TRANSLATIONS: Record<Exclude<LocaleCode, "en">, { label: string; strings: Record<string, string> }> = {
  es: {
    label: "Español",
    strings: {
      "app.skipControls": "Saltar a los controles", "app.mapLabel": "Atlas celeste 2D heliocéntrico de la eclíptica", "loading.label": "Cargando Cosmic Atlas", "loading.pipeline": "Pipeline de datos", "loading.title": "Cargando Cosmic Atlas", "loading.starting": "Iniciando la API local de efemérides.", "loading.initializing": "Inicializando", "loading.api": "Conectar con la API local", "loading.download": "Cargar efemérides", "loading.parse": "Indexar objetos del catálogo", "loading.render": "Preparar mapa científico", "header.eyebrow": "Atlas celeste científico", "controls.label": "Controles del atlas", "scale.label": "Zoom y escala", "scale.expand": "Ampliar controles de escala", "scale.title": "Escala", "scale.zoomOut": "Alejar", "scale.zoomIn": "Acercar", "scale.zoomLevel": "Nivel de zoom", "scale.landmarks": "Referencias de escala", "scale.inner": "Interior", "scale.solar": "Solar", "scale.nearby": "Cercanas", "scale.galaxy": "Galaxia", "scale.all": "Todo", "scale.deepSky": "cielo profundo", "scale.objectDisplay": "Visualización de objetos", "scale.readable": "Legible", "scale.hybrid": "Híbrido", "scale.true": "Real", "scale.overlays": "Capas del mapa", "scale.labels": "Etiquetas", "scale.orbits": "Órbitas", "scale.grid": "Cuadrícula", "scale.milkyWay": "Vía Láctea", "scale.edgeHints": "Pistas en bordes", "time.title": "Tiempo", "time.position": "Posición temporal", "time.now": "Ahora", "time.currentUtc": "UTC actual", "time.apply": "Aplicar", "time.stepSize": "Tamaño del paso", "time.oneMonth": "1 mes", "time.back": "Atrás", "time.forward": "Adelante", "workspace.search": "Buscar", "workspace.title": "Espacio de trabajo", "workspace.close": "Cerrar", "object.center": "Centrar", "object.zoom": "Zoom", "compare.eyebrow": "Comparar", "compare.heading": "Comparar con otro objeto", "compare.clear": "Limpiar", "search.catalog": "Búsqueda en catálogo", "search.find": "Buscar un objeto celeste", "search.query": "Consulta del catálogo", "search.placeholder": "Nombre del objeto o designación de catálogo", "search.use": "Usar", "search.focus": "Enfocar", "search.scope": "Ámbito", "search.results": "Resultados del catálogo", "search.matches": "Coincidencias", "guided.title": "Conjuntos guiados", "language.label": "Idioma"
    }
  },
  fr: { label: "Français", strings: { "workspace.search": "Recherche", "scale.title": "Échelle", "scale.zoomOut": "Zoom arrière", "scale.zoomIn": "Zoom avant", "scale.zoomLevel": "Niveau de zoom", "time.title": "Temps", "time.now": "Maintenant", "time.apply": "Appliquer", "workspace.close": "Fermer", "object.center": "Centrer", "object.zoom": "Zoom", "compare.heading": "Comparer avec un autre objet", "search.find": "Trouver un objet céleste", "search.query": "Recherche catalogue", "search.placeholder": "Nom de l’objet ou désignation catalogue", "search.focus": "Cibler", "search.scope": "Portée", "search.matches": "Résultats", "language.label": "Langue" } },
  de: { label: "Deutsch", strings: { "workspace.search": "Suche", "scale.title": "Maßstab", "scale.zoomOut": "Verkleinern", "scale.zoomIn": "Vergrößern", "scale.zoomLevel": "Zoomstufe", "time.title": "Zeit", "time.now": "Jetzt", "time.apply": "Anwenden", "workspace.close": "Schließen", "object.center": "Zentrieren", "object.zoom": "Zoom", "compare.heading": "Mit einem anderen Objekt vergleichen", "search.find": "Himmelsobjekt finden", "search.query": "Katalogsuche", "search.placeholder": "Objektname oder Katalogbezeichnung", "search.focus": "Fokussieren", "search.scope": "Bereich", "search.matches": "Treffer", "language.label": "Sprache" } },
  "pt-BR": { label: "Português", strings: { "workspace.search": "Buscar", "scale.title": "Escala", "scale.zoomOut": "Afastar", "scale.zoomIn": "Aproximar", "scale.zoomLevel": "Nível de zoom", "time.title": "Tempo", "time.now": "Agora", "time.apply": "Aplicar", "workspace.close": "Fechar", "object.center": "Centralizar", "object.zoom": "Zoom", "compare.heading": "Comparar com outro objeto", "search.find": "Encontrar um objeto celeste", "search.query": "Consulta do catálogo", "search.placeholder": "Nome do objeto ou designação do catálogo", "search.focus": "Focar", "search.scope": "Escopo", "search.matches": "Resultados", "language.label": "Idioma" } },
  it: { label: "Italiano", strings: { "workspace.search": "Cerca", "scale.title": "Scala", "scale.zoomOut": "Riduci zoom", "scale.zoomIn": "Aumenta zoom", "scale.zoomLevel": "Livello zoom", "time.title": "Tempo", "time.now": "Ora", "time.apply": "Applica", "workspace.close": "Chiudi", "object.center": "Centra", "object.zoom": "Zoom", "compare.heading": "Confronta con un altro oggetto", "search.find": "Trova un oggetto celeste", "search.query": "Ricerca catalogo", "search.placeholder": "Nome oggetto o designazione catalogo", "search.focus": "Metti a fuoco", "search.scope": "Ambito", "search.matches": "Risultati", "language.label": "Lingua" } },
  "zh-Hans": { label: "简体中文", strings: { "workspace.search": "搜索", "scale.title": "比例", "scale.zoomOut": "缩小", "scale.zoomIn": "放大", "scale.zoomLevel": "缩放级别", "time.title": "时间", "time.now": "现在", "time.apply": "应用", "workspace.close": "关闭", "object.center": "居中", "object.zoom": "缩放", "compare.heading": "与另一个天体比较", "search.find": "查找天体", "search.query": "星表查询", "search.placeholder": "天体名称或星表编号", "search.focus": "聚焦", "search.scope": "范围", "search.matches": "匹配项", "language.label": "语言" } },
  ja: { label: "日本語", strings: { "workspace.search": "検索", "scale.title": "スケール", "scale.zoomOut": "縮小", "scale.zoomIn": "拡大", "scale.zoomLevel": "ズームレベル", "time.title": "時刻", "time.now": "現在", "time.apply": "適用", "workspace.close": "閉じる", "object.center": "中央へ", "object.zoom": "ズーム", "compare.heading": "別の天体と比較", "search.find": "天体を探す", "search.query": "カタログ検索", "search.placeholder": "天体名またはカタログ指定", "search.focus": "フォーカス", "search.scope": "範囲", "search.matches": "結果", "language.label": "言語" } },
  ko: { label: "한국어", strings: { "workspace.search": "검색", "scale.title": "축척", "scale.zoomOut": "축소", "scale.zoomIn": "확대", "scale.zoomLevel": "확대 수준", "time.title": "시간", "time.now": "현재", "time.apply": "적용", "workspace.close": "닫기", "object.center": "가운데로", "object.zoom": "확대", "compare.heading": "다른 천체와 비교", "search.find": "천체 찾기", "search.query": "카탈로그 검색", "search.placeholder": "천체 이름 또는 카탈로그 명칭", "search.focus": "초점", "search.scope": "범위", "search.matches": "결과", "language.label": "언어" } }
};

export const LOCALES: Record<LocaleCode, LocaleDefinition> = {
  en: { label: "English", strings: en },
  es: { label: PARTIAL_TRANSLATIONS.es.label, strings: { ...en, ...PARTIAL_TRANSLATIONS.es.strings } },
  fr: { label: PARTIAL_TRANSLATIONS.fr.label, strings: { ...en, ...PARTIAL_TRANSLATIONS.fr.strings } },
  de: { label: PARTIAL_TRANSLATIONS.de.label, strings: { ...en, ...PARTIAL_TRANSLATIONS.de.strings } },
  "pt-BR": { label: PARTIAL_TRANSLATIONS["pt-BR"].label, strings: { ...en, ...PARTIAL_TRANSLATIONS["pt-BR"].strings } },
  it: { label: PARTIAL_TRANSLATIONS.it.label, strings: { ...en, ...PARTIAL_TRANSLATIONS.it.strings } },
  "zh-Hans": { label: PARTIAL_TRANSLATIONS["zh-Hans"].label, strings: { ...en, ...PARTIAL_TRANSLATIONS["zh-Hans"].strings } },
  ja: { label: PARTIAL_TRANSLATIONS.ja.label, strings: { ...en, ...PARTIAL_TRANSLATIONS.ja.strings } },
  ko: { label: PARTIAL_TRANSLATIONS.ko.label, strings: { ...en, ...PARTIAL_TRANSLATIONS.ko.strings } }
};

let currentLocale = detectLocale();

export function locale() {
  return currentLocale;
}

export function t(key: string) {
  return LOCALES[currentLocale].strings[key] ?? en[key] ?? key;
}

export function initI18n() {
  const select = document.querySelector<HTMLSelectElement>("#locale-select");
  if (select) {
    select.innerHTML = "";
    for (const code of SUPPORTED_LOCALES) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = LOCALES[code].label;
      select.append(option);
    }
    select.value = currentLocale;
    select.addEventListener("change", () => setLocale(select.value));
  }
  applyTranslations();
}

export function setLocale(value: string) {
  currentLocale = normalizeLocale(value) ?? DEFAULT_LOCALE;
  window.localStorage.setItem(LOCALE_STORAGE_KEY, currentLocale);
  applyTranslations();
}

function applyTranslations() {
  document.documentElement.lang = currentLocale;
  document.title = "Cosmic Atlas";
  setMeta("description", t("meta.description"));
  setMetaProperty("og:description", t("meta.ogDescription"));
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n ?? "");
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-attrs]").forEach((element) => {
    for (const rule of (element.dataset.i18nAttrs ?? "").split(";")) {
      const [attribute, key] = rule.split(":");
      if (attribute && key) element.setAttribute(attribute, t(key));
    }
  });
}

function detectLocale(): LocaleCode {
  const stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY) ?? "");
  if (stored) return stored;
  for (const language of navigator.languages.length ? navigator.languages : [navigator.language]) {
    const normalized = normalizeLocale(language);
    if (normalized) return normalized;
  }
  return DEFAULT_LOCALE;
}

function normalizeLocale(value: string): LocaleCode | null {
  const lower = value.toLowerCase();
  if (lower === "pt-br" || lower === "pt") return "pt-BR";
  if (lower === "zh-hans" || lower === "zh-cn" || lower === "zh-sg" || lower === "zh") return "zh-Hans";
  const base = lower.split("-")[0];
  return SUPPORTED_LOCALES.find((code) => code.toLowerCase() === lower || code.toLowerCase().split("-")[0] === base) ?? null;
}

function setMeta(name: string, content: string) {
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.setAttribute("content", content);
}

function setMetaProperty(property: string, content: string) {
  document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.setAttribute("content", content);
}

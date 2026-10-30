/**
 * Text of the calendar subscription of the `Happening now` section (`now.*`).
 *
 * Each row has the nine locales in the order of `LOCALE_ORDER`. `areaTranslations.ts` merges the tables.
 */
const LOCALE_ORDER = ["en", "es", "fr", "de", "pt-BR", "it", "zh-Hans", "ja", "ko"] as const;

type Row = readonly [string, string, string, string, string, string, string, string, string];

const ROWS: Record<string, Row> = {
  "now.subscribe": ["Subscribe", "Suscribirse", "S’abonner", "Abonnieren", "Assinar", "Iscriviti", "订阅", "購読", "구독"],
  "now.subscribeTypes": ["Event types", "Tipos de eventos", "Types d’événements", "Ereignistypen", "Tipos de eventos", "Tipi di eventi", "事件类型", "イベントの種類", "이벤트 유형"],
  "now.type.close_approach": ["Asteroid close approaches", "Acercamientos de asteroides", "Passages rapprochés d’astéroïdes", "Asteroiden-Annäherungen", "Aproximações de asteroides", "Avvicinamenti di asteroidi", "小行星近距离飞掠", "小惑星の接近", "소행성 근접 통과"],
  "now.type.new_exoplanet": ["New exoplanets", "Nuevos exoplanetas", "Nouvelles exoplanètes", "Neue Exoplaneten", "Novos exoplanetas", "Nuovi esopianeti", "新系外行星", "新しい系外惑星", "새 외계행성"],
  "now.subscribeAddress": ["Calendar address", "Dirección del calendario", "Adresse du calendrier", "Kalenderadresse", "Endereço do calendário", "Indirizzo del calendario", "日历地址", "カレンダーのアドレス", "캘린더 주소"],
  "now.subscribeCopy": ["Copy address", "Copiar dirección", "Copier l’adresse", "Adresse kopieren", "Copiar endereço", "Copia indirizzo", "复制地址", "アドレスをコピー", "주소 복사"],
  "now.subscribeOpen": ["Open in calendar app", "Abrir en la app de calendario", "Ouvrir dans l’application de calendrier", "In der Kalender-App öffnen", "Abrir no app de calendário", "Apri nell’app del calendario", "在日历应用中打开", "カレンダーアプリで開く", "캘린더 앱에서 열기"],
  "now.subscribeCopied": ["Address copied", "Dirección copiada", "Adresse copiée", "Adresse kopiert", "Endereço copiado", "Indirizzo copiato", "地址已复制", "アドレスをコピーしました", "주소를 복사했습니다"],
  "now.subscribeCopyFailed": ["Could not copy. Select the address and copy it.", "No se pudo copiar. Selecciona la dirección y cópiala.", "Copie impossible. Sélectionnez l’adresse et copiez-la.", "Kopieren nicht möglich. Markieren Sie die Adresse und kopieren Sie sie.", "Não foi possível copiar. Selecione o endereço e copie-o.", "Impossibile copiare. Seleziona l’indirizzo e copialo.", "无法复制。请选中地址后手动复制。", "コピーできませんでした。アドレスを選択してコピーしてください。", "복사하지 못했습니다. 주소를 선택해 복사하세요."],
};

export const NOW_CALENDAR_TRANSLATIONS: Record<string, Record<string, string>> = Object.fromEntries(
  LOCALE_ORDER.map((code, column) => [code, Object.fromEntries(Object.entries(ROWS).map(([key, row]) => [key, row[column]!]))]),
);

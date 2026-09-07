const keys = ["type.spacecraft", "mission.signalTime", "mission.launch", "mission.agency", "mission.coverage", "mission.epoch", "mission.loading", "mission.available", "mission.out_of_coverage", "mission.temporarily_unavailable", "mission.trajectory", "mission.milestone"];
const rows: Record<string, string[]> = {
  en: ["Spacecraft", "Estimated one-way light time", "Launch", "Agency", "Trajectory coverage (TDB envelope)", "Position epoch (UTC)", "Loading position…", "Position available", "Outside trajectory coverage", "Position temporarily unavailable", "Provider trajectory; may include predictions and gaps. Coverage is not mission lifetime.", "NASA predicts Voyager 1 will reach one light-day from Earth on November 18, 2026."],
  es: ["Nave espacial", "Tiempo de luz estimado de ida", "Lanzamiento", "Agencia", "Cobertura de trayectoria (intervalo TDB)", "Época de posición (UTC)", "Cargando posición…", "Posición disponible", "Fuera de la cobertura", "Posición temporalmente no disponible", "Trayectoria del proveedor; puede incluir predicciones y lagunas. La cobertura no es la duración de la misión.", "La NASA prevé que Voyager 1 estará a un día luz de la Tierra el 18 de noviembre de 2026."],
  fr: ["Sonde spatiale", "Temps de lumière estimé à l’aller", "Lancement", "Agence", "Couverture de trajectoire (intervalle TDB)", "Époque de position (UTC)", "Chargement de la position…", "Position disponible", "Hors couverture", "Position temporairement indisponible", "Trajectoire du fournisseur pouvant inclure des prévisions et des lacunes. La couverture ne représente pas la durée de la mission.", "La NASA prévoit que Voyager 1 sera à un jour-lumière de la Terre le 18 novembre 2026."],
  de: ["Raumsonde", "Geschätzte einfache Lichtlaufzeit", "Start", "Organisation", "Bahnabdeckung (TDB-Zeitraum)", "Positionsepoche (UTC)", "Position wird geladen…", "Position verfügbar", "Außerhalb der Bahnabdeckung", "Position vorübergehend nicht verfügbar", "Anbieterbahn mit möglichen Vorhersagen und Lücken. Die Abdeckung entspricht nicht der Missionsdauer.", "Laut NASA wird Voyager 1 am 18. November 2026 einen Lichttag von der Erde entfernt sein."],
  "pt-BR": ["Nave espacial", "Tempo estimado da luz de ida", "Lançamento", "Agência", "Cobertura da trajetória (intervalo TDB)", "Época da posição (UTC)", "Carregando posição…", "Posição disponível", "Fora da cobertura", "Posição temporariamente indisponível", "Trajetória do provedor; pode incluir previsões e lacunas. A cobertura não é a duração da missão.", "A NASA prevê que a Voyager 1 estará a um dia-luz da Terra em 18 de novembro de 2026."],
  it: ["Sonda spaziale", "Tempo luce stimato di sola andata", "Lancio", "Agenzia", "Copertura della traiettoria (intervallo TDB)", "Epoca della posizione (UTC)", "Caricamento posizione…", "Posizione disponibile", "Fuori copertura", "Posizione temporaneamente non disponibile", "Traiettoria del fornitore; può includere previsioni e lacune. La copertura non è la durata della missione.", "La NASA prevede che Voyager 1 sarà a un giorno luce dalla Terra il 18 novembre 2026."],
  "zh-Hans": ["航天器", "估算单程光行时间", "发射", "机构", "轨迹覆盖范围（TDB区间）", "位置历元（UTC）", "正在加载位置…", "位置可用", "超出轨迹覆盖范围", "位置暂不可用", "提供方的轨迹可能包含预测和数据空缺。覆盖范围不代表任务寿命。", "NASA预计旅行者1号将于2026年11月18日到达距地球一光日的位置。"],
  ja: ["宇宙機", "推定片道光行時間", "打ち上げ", "機関", "軌道データの範囲（TDB区間）", "位置の元期（UTC）", "位置を読み込み中…", "位置データあり", "軌道データの範囲外", "位置を一時的に取得できません", "提供元の軌道には予測や欠測が含まれる場合があります。範囲はミッション期間とは異なります。", "NASAはボイジャー1号が2026年11月18日に地球から1光日の距離に達すると予測しています。"],
  ko: ["우주선", "추정 편도 빛 이동 시간", "발사", "기관", "궤적 범위(TDB 구간)", "위치 기준 시각(UTC)", "위치 불러오는 중…", "위치 사용 가능", "궤적 범위 밖", "일시적으로 위치를 사용할 수 없음", "제공된 궤적에는 예측과 데이터 공백이 포함될 수 있습니다. 범위는 임무 수명이 아닙니다.", "NASA는 보이저 1호가 2026년 11월 18일 지구에서 1광일 거리에 도달할 것으로 예측합니다."]
};
export const SPACECRAFT_TRANSLATIONS = Object.fromEntries(Object.entries(rows).map(([locale, values]) => [locale, Object.fromEntries(keys.map((key, i) => [key, values[i]!]))]));

const cutoffLabels: Record<string, string> = { en: "Trajectory cutoff (UTC)", es: "Fin de trayectoria (UTC)", fr: "Fin de trajectoire (UTC)", de: "Bahnende (UTC)", "pt-BR": "Fim da trajetória (UTC)", it: "Fine traiettoria (UTC)", "zh-Hans": "轨迹截止时间（UTC）", ja: "軌道の終了時刻（UTC）", ko: "궤적 종료 시각(UTC)" };
for (const [locale, label] of Object.entries(cutoffLabels)) SPACECRAFT_TRANSLATIONS[locale]["mission.cutoff"] = label;

const provenanceLabels: Record<string, [string, string]> = {
  en: ["Source revision", "Catalog audit"], es: ["Revisión de la fuente", "Revisión del catálogo"],
  fr: ["Révision de la source", "Vérification du catalogue"], de: ["Quellenrevision", "Katalogprüfung"],
  "pt-BR": ["Revisão da fonte", "Revisão do catálogo"], it: ["Revisione della fonte", "Verifica del catalogo"],
  "zh-Hans": ["来源修订日期", "目录审核日期"], ja: ["提供元の改訂日", "カタログの確認日"], ko: ["출처 개정일", "카탈로그 검토일"]
};
for (const [locale, labels] of Object.entries(provenanceLabels)) {
  SPACECRAFT_TRANSLATIONS[locale]["mission.revision"] = labels[0];
  SPACECRAFT_TRANSLATIONS[locale]["mission.audit"] = labels[1];
}

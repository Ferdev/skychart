/**
 * Text of the answer flights (`ask.*`): the form, the progress state, and the units of a chip.
 *
 * Each row has the nine locales in the order of `LOCALE_ORDER`. `areaTranslations.ts` merges the tables.
 */
const LOCALE_ORDER = ["en", "es", "fr", "de", "pt-BR", "it", "zh-Hans", "ja", "ko"] as const;

type Row = readonly [string, string, string, string, string, string, string, string, string];

const ROWS: Record<string, Row> = {
  "ask.title": ["Ask", "Preguntar", "Demander", "Fragen", "Perguntar", "Chiedi", "提问", "質問", "질문"],
  "ask.label": ["Ask a question about the sky", "Haz una pregunta sobre el cielo", "Posez une question sur le ciel", "Stellen Sie eine Frage zum Himmel", "Faça uma pergunta sobre o céu", "Fai una domanda sul cielo", "提一个关于天空的问题", "空について質問する", "하늘에 대해 질문하기"],
  "ask.placeholder": ["How far away is the Andromeda Galaxy?", "¿A qué distancia está la galaxia de Andrómeda?", "À quelle distance est la galaxie d’Andromède ?", "Wie weit ist die Andromedagalaxie entfernt?", "A que distância está a galáxia de Andrômeda?", "Quanto dista la galassia di Andromeda?", "仙女座星系有多远？", "アンドロメダ銀河までの距離は？", "안드로메다 은하는 얼마나 멀리 있나요?"],
  "ask.submit": ["Ask", "Preguntar", "Demander", "Fragen", "Perguntar", "Chiedi", "提问", "質問する", "질문하기"],
  "ask.help": ["A short flight answers your question. Each number comes from a catalog record.", "Un vuelo breve responde a tu pregunta. Cada número procede de un registro de catálogo.", "Un court vol répond à votre question. Chaque nombre provient d’une fiche de catalogue.", "Ein kurzer Flug beantwortet Ihre Frage. Jede Zahl stammt aus einem Katalogeintrag.", "Um voo curto responde à sua pergunta. Cada número vem de um registro de catálogo.", "Un breve volo risponde alla tua domanda. Ogni numero viene da una scheda di catalogo.", "一段简短的飞行回答你的问题，每个数字都来自星表记录。", "短いフライトで質問に答えます。数値はすべてカタログの記録に基づきます。", "짧은 비행이 질문에 답합니다. 모든 숫자는 카탈로그 기록에서 나옵니다."],
  "ask.queued": ["Your question is in the queue.", "Tu pregunta está en cola.", "Votre question est en attente.", "Ihre Frage steht in der Warteschlange.", "Sua pergunta está na fila.", "La tua domanda è in coda.", "你的问题正在排队。", "質問は順番待ちです。", "질문이 대기 중입니다."],
  "ask.running": ["Reading the catalog records and checking each number…", "Leyendo los registros y comprobando cada número…", "Lecture des fiches et vérification de chaque nombre…", "Katalogeinträge werden gelesen und jede Zahl geprüft …", "Lendo os registros e conferindo cada número…", "Lettura delle schede e controllo di ogni numero…", "正在读取星表记录并核对每个数字…", "カタログを読み、各数値を確認しています…", "카탈로그를 읽고 각 숫자를 확인하는 중…"],
  "ask.timeout": ["This takes longer than usual. Try again soon.", "Esto tarda más de lo normal. Inténtalo pronto otra vez.", "Cela prend plus de temps que d’habitude. Réessayez bientôt.", "Das dauert länger als üblich. Versuchen Sie es bald noch einmal.", "Isso está demorando mais que o normal. Tente novamente em breve.", "Ci vuole più del solito. Riprova tra poco.", "耗时比平常长，请稍后再试。", "通常より時間がかかっています。しばらくして再度お試しください。", "평소보다 오래 걸립니다. 잠시 후 다시 시도하세요."],
  "ask.failed": ["The flight cannot start now. Try again later.", "El vuelo no puede empezar ahora. Inténtalo más tarde.", "Le vol ne peut pas démarrer. Réessayez plus tard.", "Der Flug kann jetzt nicht starten. Versuchen Sie es später.", "O voo não pode começar agora. Tente mais tarde.", "Il volo non può partire ora. Riprova più tardi.", "飞行暂时无法开始，请稍后再试。", "今はフライトを開始できません。後でお試しください。", "지금은 비행을 시작할 수 없습니다. 나중에 다시 시도하세요."],
  "ask.refused.offTopic": ["This question is outside the atlas.", "Esta pregunta queda fuera del atlas.", "Cette question sort du cadre de l’atlas.", "Diese Frage liegt außerhalb des Atlas.", "Esta pergunta está fora do atlas.", "Questa domanda è fuori dall’atlante.", "这个问题超出了图集的范围。", "この質問はアトラスの対象外です。", "이 질문은 아틀라스 범위를 벗어납니다."],
  "ask.refused.unsupported": ["The atlas records cannot support an answer to this question.", "Los registros del atlas no permiten responder a esta pregunta.", "Les fiches de l’atlas ne permettent pas de répondre à cette question.", "Die Einträge des Atlas stützen keine Antwort auf diese Frage.", "Os registros do atlas não sustentam uma resposta a esta pergunta.", "Le schede dell’atlante non permettono di rispondere a questa domanda.", "图集的记录无法支持这个问题的回答。", "アトラスの記録ではこの質問に答えられません。", "아틀라스 기록으로는 이 질문에 답할 수 없습니다."],
  "ask.refused.try": ["Try this guided tour:", "Prueba esta visita guiada:", "Essayez cette visite guidée :", "Versuchen Sie diese Führung:", "Experimente esta visita guiada:", "Prova questa visita guidata:", "试试这个导览：", "このガイドツアーをお試しください：", "이 안내 투어를 시도해 보세요:"],
  "ask.sources": ["Sources", "Fuentes", "Sources", "Quellen", "Fontes", "Fonti", "来源", "出典", "출처"],
  "ask.listen": ["Listen", "Escuchar", "Écouter", "Anhören", "Ouvir", "Ascolta", "朗读", "読み上げ", "듣기"],
  "ask.stop": ["Stop voice", "Detener voz", "Arrêter la voix", "Stimme stoppen", "Parar voz", "Ferma voce", "停止朗读", "読み上げを停止", "음성 중지"],
  "ask.page": ["Flight page", "Página del vuelo", "Page du vol", "Flugseite", "Página do voo", "Pagina del volo", "飞行页面", "フライトのページ", "비행 페이지"],
  "ask.openRecord": ["Open the source record", "Abrir el registro de origen", "Ouvrir la fiche source", "Quelleneintrag öffnen", "Abrir o registro de origem", "Apri la scheda di origine", "打开来源记录", "出典の記録を開く", "출처 기록 열기"],
  "ask.asOf": ["(value of {date})", "(valor del {date})", "(valeur du {date})", "(Wert vom {date})", "(valor de {date})", "(valore del {date})", "（{date} 的值）", "（{date} の値）", "({date} 기준 값)"],
  "ask.unit.ly": ["light-years", "años luz", "années-lumière", "Lichtjahre", "anos-luz", "anni luce", "光年", "光年", "광년"],
  "ask.unit.pc": ["parsecs", "pársecs", "parsecs", "Parsec", "parsecs", "parsec", "秒差距", "パーセク", "파섹"],
  "ask.unit.au": ["AU", "UA", "ua", "AE", "UA", "UA", "天文单位", "天文単位", "천문단위"],
  "ask.unit.km": ["km", "km", "km", "km", "km", "km", "公里", "キロメートル", "킬로미터"],
  "ask.unit.deg": ["degrees", "grados", "degrés", "Grad", "graus", "gradi", "度", "度", "도"],
  "ask.unit.min": ["minutes", "minutos", "minutes", "Minuten", "minutos", "minuti", "分钟", "分", "분"],
  "ask.unit.h": ["hours", "horas", "heures", "Stunden", "horas", "ore", "小时", "時間", "시간"],
  "ask.unit.s": ["seconds", "segundos", "secondes", "Sekunden", "segundos", "secondi", "秒", "秒", "초"],
  "ask.unit.mas": ["milliarcseconds", "milisegundos de arco", "millisecondes d’arc", "Millibogensekunden", "milissegundos de arco", "millisecondi d’arco", "毫角秒", "ミリ秒角", "밀리초각"],
  "ask.unit.mag": ["magnitude", "de magnitud", "de magnitude", "Größenklassen", "de magnitude", "di magnitudine", "星等", "等級", "등급"],
  "community.error.question_rejected": ["Ask about the sky in 8 to 200 characters, with no address or link.", "Pregunta sobre el cielo en 8 a 200 caracteres, sin direcciones ni enlaces.", "Posez votre question en 8 à 200 caractères, sans adresse ni lien.", "Fragen Sie in 8 bis 200 Zeichen, ohne Adresse oder Link.", "Pergunte sobre o céu em 8 a 200 caracteres, sem endereço ou link.", "Chiedi in 8–200 caratteri, senza indirizzi né link.", "请用 8 到 200 个字符提问，不要包含地址或链接。", "8〜200文字で、住所やリンクを含めずに質問してください。", "주소나 링크 없이 8~200자로 질문하세요."],
  "community.error.flights_daily_limit": ["The daily limit of new flights is reached. Try again tomorrow.", "Se alcanzó el límite diario de vuelos nuevos. Inténtalo mañana.", "La limite quotidienne de nouveaux vols est atteinte. Réessayez demain.", "Das Tageslimit für neue Flüge ist erreicht. Versuchen Sie es morgen.", "O limite diário de novos voos foi atingido. Tente amanhã.", "Il limite giornaliero di nuovi voli è raggiunto. Riprova domani.", "今日新飞行已达上限，请明天再试。", "本日の新規フライトの上限に達しました。明日お試しください。", "오늘의 새 비행 한도에 도달했습니다. 내일 다시 시도하세요."],
  "community.error.flights_unavailable": ["Flights are not available now.", "Los vuelos no están disponibles ahora.", "Les vols ne sont pas disponibles.", "Flüge sind derzeit nicht verfügbar.", "Os voos não estão disponíveis agora.", "I voli non sono disponibili ora.", "飞行暂不可用。", "現在フライトは利用できません。", "지금은 비행을 사용할 수 없습니다."],
};

export const ANSWER_FLIGHT_TRANSLATIONS: Record<string, Record<string, string>> = Object.fromEntries(
  LOCALE_ORDER.map((locale, index) => [locale, Object.fromEntries(Object.entries(ROWS).map(([key, row]) => [key, row[index]!]))]),
);

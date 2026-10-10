/**
 * Names of the constellation figures in the languages of the application.
 * `LATIN` has the IAU names in the order of `sky/constellations.ts`. Each language has its names in the same order.
 * This module does not import `i18n.ts`: the caller gives the language.
 */
export const LATIN_CONSTELLATION_NAMES = [
  "Andromeda", "Antlia", "Apus", "Aquarius", "Aquila", "Ara", "Aries", "Auriga", "Boötes", "Caelum", "Camelopardalis", "Cancer",
  "Canes Venatici", "Canis Major", "Canis Minor", "Capricornus", "Carina", "Cassiopeia", "Centaurus", "Cepheus", "Cetus", "Chamaeleon",
  "Circinus", "Columba", "Coma Berenices", "Corona Australis", "Corona Borealis", "Corvus", "Crater", "Crux", "Cygnus", "Delphinus",
  "Dorado", "Draco", "Equuleus", "Eridanus", "Fornax", "Gemini", "Grus", "Hercules", "Horologium", "Hydra", "Hydrus", "Indus", "Lacerta",
  "Leo", "Leo Minor", "Lepus", "Libra", "Lupus", "Lynx", "Lyra", "Monoceros", "Musca", "Norma", "Octans", "Ophiuchus", "Orion", "Pavo",
  "Pegasus", "Perseus", "Phoenix", "Pictor", "Pisces", "Piscis Austrinus", "Puppis", "Pyxis", "Reticulum", "Sagitta", "Sagittarius",
  "Scorpius", "Sculptor", "Scutum", "Serpens Caput", "Serpens Cauda", "Sextans", "Taurus", "Telescopium", "Triangulum",
  "Triangulum Australe", "Tucana", "Ursa Major", "Ursa Minor", "Vela", "Virgo", "Volans", "Vulpecula",
] as const;

/** The names of each language, in the order of `LATIN_CONSTELLATION_NAMES`. English uses the IAU names. */
export const LOCAL_CONSTELLATION_NAMES: Record<string, readonly string[]> = {
  es: [
    "Andrómeda", "Máquina Neumática", "Ave del Paraíso", "Acuario", "Águila", "Altar", "Aries", "Auriga", "Boyero", "Cincel", "Jirafa", "Cáncer",
    "Lebreles", "Can Mayor", "Can Menor", "Capricornio", "Quilla", "Casiopea", "Centauro", "Cefeo", "Ballena", "Camaleón", "Compás", "Paloma",
    "Cabellera de Berenice", "Corona Austral", "Corona Boreal", "Cuervo", "Copa", "Cruz del Sur", "Cisne", "Delfín", "Dorado", "Dragón", "Caballito",
    "Erídano", "Horno", "Géminis", "Grulla", "Hércules", "Reloj", "Hidra", "Hidra Macho", "Indio", "Lagarto", "Leo", "León Menor", "Liebre", "Libra",
    "Lobo", "Lince", "Lira", "Unicornio", "Mosca", "Escuadra", "Octante", "Ofiuco", "Orión", "Pavo", "Pegaso", "Perseo", "Fénix", "Pintor", "Piscis",
    "Pez Austral", "Popa", "Brújula", "Retículo", "Flecha", "Sagitario", "Escorpio", "Escultor", "Escudo", "Cabeza de la Serpiente",
    "Cola de la Serpiente", "Sextante", "Tauro", "Telescopio", "Triángulo", "Triángulo Austral", "Tucán", "Osa Mayor", "Osa Menor", "Vela", "Virgo",
    "Pez Volador", "Zorra",
  ],
  fr: [
    "Andromède", "Machine pneumatique", "Oiseau de paradis", "Verseau", "Aigle", "Autel", "Bélier", "Cocher", "Bouvier", "Burin", "Girafe", "Cancer",
    "Chiens de chasse", "Grand Chien", "Petit Chien", "Capricorne", "Carène", "Cassiopée", "Centaure", "Céphée", "Baleine", "Caméléon", "Compas",
    "Colombe", "Chevelure de Bérénice", "Couronne australe", "Couronne boréale", "Corbeau", "Coupe", "Croix du Sud", "Cygne", "Dauphin", "Dorade",
    "Dragon", "Petit Cheval", "Éridan", "Fourneau", "Gémeaux", "Grue", "Hercule", "Horloge", "Hydre", "Hydre mâle", "Indien", "Lézard", "Lion",
    "Petit Lion", "Lièvre", "Balance", "Loup", "Lynx", "Lyre", "Licorne", "Mouche", "Règle", "Octant", "Ophiuchus", "Orion", "Paon", "Pégase",
    "Persée", "Phénix", "Peintre", "Poissons", "Poisson austral", "Poupe", "Boussole", "Réticule", "Flèche", "Sagittaire", "Scorpion", "Sculpteur",
    "Écu de Sobieski", "Tête du Serpent", "Queue du Serpent", "Sextant", "Taureau", "Télescope", "Triangle", "Triangle austral", "Toucan",
    "Grande Ourse", "Petite Ourse", "Voiles", "Vierge", "Poisson volant", "Petit Renard",
  ],
  de: [
    "Andromeda", "Luftpumpe", "Paradiesvogel", "Wassermann", "Adler", "Altar", "Widder", "Fuhrmann", "Bärenhüter", "Grabstichel", "Giraffe", "Krebs",
    "Jagdhunde", "Großer Hund", "Kleiner Hund", "Steinbock", "Kiel des Schiffs", "Kassiopeia", "Zentaur", "Kepheus", "Walfisch", "Chamäleon",
    "Zirkel", "Taube", "Haar der Berenike", "Südliche Krone", "Nördliche Krone", "Rabe", "Becher", "Kreuz des Südens", "Schwan", "Delphin",
    "Schwertfisch", "Drache", "Füllen", "Eridanus", "Chemischer Ofen", "Zwillinge", "Kranich", "Herkules", "Pendeluhr", "Wasserschlange",
    "Kleine Wasserschlange", "Indianer", "Eidechse", "Löwe", "Kleiner Löwe", "Hase", "Waage", "Wolf", "Luchs", "Leier", "Einhorn", "Fliege",
    "Winkelmaß", "Oktant", "Schlangenträger", "Orion", "Pfau", "Pegasus", "Perseus", "Phönix", "Maler", "Fische", "Südlicher Fisch",
    "Achterdeck des Schiffs", "Schiffskompass", "Netz", "Pfeil", "Schütze", "Skorpion", "Bildhauer", "Schild", "Kopf der Schlange",
    "Schwanz der Schlange", "Sextant", "Stier", "Teleskop", "Dreieck", "Südliches Dreieck", "Tukan", "Großer Bär", "Kleiner Bär", "Segel des Schiffs",
    "Jungfrau", "Fliegender Fisch", "Fuchs",
  ],
  "pt-BR": [
    "Andrômeda", "Máquina Pneumática", "Ave do Paraíso", "Aquário", "Águia", "Altar", "Áries", "Cocheiro", "Boieiro", "Buril", "Girafa", "Câncer",
    "Cães de Caça", "Cão Maior", "Cão Menor", "Capricórnio", "Quilha", "Cassiopeia", "Centauro", "Cefeu", "Baleia", "Camaleão", "Compasso", "Pomba",
    "Cabeleira de Berenice", "Coroa Austral", "Coroa Boreal", "Corvo", "Taça", "Cruzeiro do Sul", "Cisne", "Golfinho", "Dourado", "Dragão",
    "Cavalo Menor", "Erídano", "Fornalha", "Gêmeos", "Grou", "Hércules", "Relógio", "Hidra", "Hidra Macho", "Índio", "Lagarto", "Leão", "Leão Menor",
    "Lebre", "Libra", "Lobo", "Lince", "Lira", "Unicórnio", "Mosca", "Régua", "Oitante", "Ofiúco", "Órion", "Pavão", "Pégaso", "Perseu", "Fênix",
    "Pintor", "Peixes", "Peixe Austral", "Popa", "Bússola", "Retículo", "Flecha", "Sagitário", "Escorpião", "Escultor", "Escudo",
    "Cabeça da Serpente", "Cauda da Serpente", "Sextante", "Touro", "Telescópio", "Triângulo", "Triângulo Austral", "Tucano", "Ursa Maior",
    "Ursa Menor", "Vela", "Virgem", "Peixe Voador", "Raposa",
  ],
  it: [
    "Andromeda", "Macchina Pneumatica", "Uccello del Paradiso", "Acquario", "Aquila", "Altare", "Ariete", "Auriga", "Boote", "Bulino", "Giraffa",
    "Cancro", "Cani da Caccia", "Cane Maggiore", "Cane Minore", "Capricorno", "Carena", "Cassiopea", "Centauro", "Cefeo", "Balena", "Camaleonte",
    "Compasso", "Colomba", "Chioma di Berenice", "Corona Australe", "Corona Boreale", "Corvo", "Cratere", "Croce del Sud", "Cigno", "Delfino",
    "Dorado", "Dragone", "Cavallino", "Eridano", "Fornace", "Gemelli", "Gru", "Ercole", "Orologio", "Idra", "Idra Maschio", "Indiano", "Lucertola",
    "Leone", "Leone Minore", "Lepre", "Bilancia", "Lupo", "Lince", "Lira", "Unicorno", "Mosca", "Regolo", "Ottante", "Ofiuco", "Orione", "Pavone",
    "Pegaso", "Perseo", "Fenice", "Pittore", "Pesci", "Pesce Australe", "Poppa", "Bussola", "Reticolo", "Freccia", "Sagittario", "Scorpione",
    "Scultore", "Scudo", "Testa del Serpente", "Coda del Serpente", "Sestante", "Toro", "Telescopio", "Triangolo", "Triangolo Australe", "Tucano",
    "Orsa Maggiore", "Orsa Minore", "Vele", "Vergine", "Pesce Volante", "Volpetta",
  ],
  "zh-Hans": [
    "仙女座", "唧筒座", "天燕座", "宝瓶座", "天鹰座", "天坛座", "白羊座", "御夫座", "牧夫座", "雕具座", "鹿豹座", "巨蟹座", "猎犬座", "大犬座", "小犬座", "摩羯座", "船底座", "仙后座", "半人马座", "仙王座",
    "鲸鱼座", "蝘蜓座", "圆规座", "天鸽座", "后发座", "南冕座", "北冕座", "乌鸦座", "巨爵座", "南十字座", "天鹅座", "海豚座", "剑鱼座", "天龙座", "小马座", "波江座", "天炉座", "双子座", "天鹤座", "武仙座",
    "时钟座", "长蛇座", "水蛇座", "印第安座", "蝎虎座", "狮子座", "小狮座", "天兔座", "天秤座", "豺狼座", "天猫座", "天琴座", "麒麟座", "苍蝇座", "矩尺座", "南极座", "蛇夫座", "猎户座", "孔雀座", "飞马座",
    "英仙座", "凤凰座", "绘架座", "双鱼座", "南鱼座", "船尾座", "罗盘座", "网罟座", "天箭座", "人马座", "天蝎座", "玉夫座", "盾牌座", "巨蛇座（头）", "巨蛇座（尾）", "六分仪座", "金牛座", "望远镜座", "三角座",
    "南三角座", "杜鹃座", "大熊座", "小熊座", "船帆座", "室女座", "飞鱼座", "狐狸座",
  ],
  ja: [
    "アンドロメダ座", "ポンプ座", "ふうちょう座", "みずがめ座", "わし座", "さいだん座", "おひつじ座", "ぎょしゃ座", "うしかい座", "ちょうこくぐ座", "きりん座", "かに座", "りょうけん座", "おおいぬ座", "こいぬ座", "やぎ座",
    "りゅうこつ座", "カシオペヤ座", "ケンタウルス座", "ケフェウス座", "くじら座", "カメレオン座", "コンパス座", "はと座", "かみのけ座", "みなみのかんむり座", "かんむり座", "からす座", "コップ座", "みなみじゅうじ座", "はくちょう座",
    "いるか座", "かじき座", "りゅう座", "こうま座", "エリダヌス座", "ろ座", "ふたご座", "つる座", "ヘルクレス座", "とけい座", "うみへび座", "みずへび座", "インディアン座", "とかげ座", "しし座", "こじし座", "うさぎ座",
    "てんびん座", "おおかみ座", "やまねこ座", "こと座", "いっかくじゅう座", "はえ座", "じょうぎ座", "はちぶんぎ座", "へびつかい座", "オリオン座", "くじゃく座", "ペガスス座", "ペルセウス座", "ほうおう座", "がか座", "うお座",
    "みなみのうお座", "とも座", "らしんばん座", "レチクル座", "や座", "いて座", "さそり座", "ちょうこくしつ座", "たて座", "へび座（頭部）", "へび座（尾部）", "ろくぶんぎ座", "おうし座", "ぼうえんきょう座", "さんかく座",
    "みなみのさんかく座", "きょしちょう座", "おおぐま座", "こぐま座", "ほ座", "おとめ座", "とびうお座", "こぎつね座",
  ],
  ko: [
    "안드로메다자리", "공기펌프자리", "극락조자리", "물병자리", "독수리자리", "제단자리", "양자리", "마차부자리", "목동자리", "조각칼자리", "기린자리", "게자리", "사냥개자리", "큰개자리", "작은개자리", "염소자리", "용골자리",
    "카시오페이아자리", "센타우루스자리", "세페우스자리", "고래자리", "카멜레온자리", "컴퍼스자리", "비둘기자리", "머리털자리", "남쪽왕관자리", "북쪽왕관자리", "까마귀자리", "컵자리", "남십자자리", "백조자리", "돌고래자리",
    "황새치자리", "용자리", "조랑말자리", "에리다누스자리", "화로자리", "쌍둥이자리", "두루미자리", "헤르쿨레스자리", "시계자리", "바다뱀자리", "물뱀자리", "인디언자리", "도마뱀자리", "사자자리", "작은사자자리", "토끼자리",
    "천칭자리", "이리자리", "살쾡이자리", "거문고자리", "외뿔소자리", "파리자리", "직각자자리", "팔분의자리", "뱀주인자리", "오리온자리", "공작자리", "페가수스자리", "페르세우스자리", "봉황자리", "화가자리", "물고기자리",
    "남쪽물고기자리", "고물자리", "나침반자리", "그물자리", "화살자리", "궁수자리", "전갈자리", "조각가자리", "방패자리", "뱀자리 머리", "뱀자리 꼬리", "육분의자리", "황소자리", "망원경자리", "삼각형자리", "남쪽삼각형자리",
    "큰부리새자리", "큰곰자리", "작은곰자리", "돛자리", "처녀자리", "날치자리", "여우자리",
  ],
};

const INDEX_BY_LATIN = new Map<string, number>(LATIN_CONSTELLATION_NAMES.map((name, index) => [name, index]));

/** The name of a constellation in the given language. A language or a figure with no local name gets the IAU name. */
export function constellationName(latin: string, locale: string): string {
  const index = INDEX_BY_LATIN.get(latin);
  return (index === undefined ? undefined : LOCAL_CONSTELLATION_NAMES[locale]?.[index]) || latin;
}

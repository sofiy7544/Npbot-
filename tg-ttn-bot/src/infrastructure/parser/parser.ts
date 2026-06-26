/**
 * Parse free-form Telegram message into a structured order draft.
 *
 * Supports REAL Ukrainian shop-owner formats:
 *
 *   "Перинська Елізабетта Юріївна
 *    Софіївська Борщагівка
 *    НП 13 Мартинова
 *    0932377723
 *    НАЛОЖКА 2800"
 *
 *   "Шостакова крістіна
 *    0966434122
 *    Київ 70
 *    НАЛОЖКА 2000"
 *
 *   "Дані отримувача мої:
 *    Маркевич Вікторія Олександрівна
 *    +380633096360
 *    НП Поштомат Львів 6651
 *    Опл 2200"
 *
 * Strategy: line-aware parse — each line is classified into:
 *   name | phone | warehouse | city | sum | description | noise
 * Then aggregated into a draft.
 */

export type ParseFieldStatus = "ok" | "missing" | "guessed";

export type OrderDraft = {
  recipientName?: string;
  recipientPhone?: string;
  cityName?: string;
  warehouseType: "branch" | "postomat" | "courier";
  warehouseNumber?: string;
  courierAddress?: string;
  cost?: number;             // UAH
  weightKg?: number;
  description?: string;
  paymentMethod: "Cash" | "NonCash";
  payerType: "Sender" | "Recipient";
  fieldStatus: Record<string, ParseFieldStatus>;
  warnings: string[];
};

// ─────────────────────────────────────────────────────────────────────
// Regex bank
// ─────────────────────────────────────────────────────────────────────

// Phone — covers ALL real formats observed in production logs:
//   "0501234567", "+380501234567", "+38 050 123 45 67", "(067) 123-45-67",
//   "066 663 4114", "+380 (99) 259 13 25" (parens around operator WITHOUT leading 0)
const PHONE_RE = new RegExp(
  [
    // Variant A: +38[0] [(XX)] XXX XX XX — country code, optional trunk 0, optional parens around operator
    //   Matches: "+380501234567", "+38 050 123 45 67", "+380 (99) 259 13 25", "+38 (067) 123-45-67"
    /\+?38\s*0?\s*\(?\s*\d{2}\s*\)?[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2}/.source,
    // Variant B: domestic 0XX format
    //   Matches: "0501234567", "(067) 123-45-67", "066 663 4114", "050.123.45.67"
    /\(?0\d{2}\)?[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2}/.source,
  ].join("|"),
);
const PHONE_LINE_RE = /^[\+\d\s().\-]{10,22}$/;

// Warehouse keywords
const POSTOMAT_KW = /(?:поштомат|postomat)/i;
const COURIER_KW = /(?:кур'?[єе]р|courier|до дверей)/i;
const BRANCH_KW = /(?:відділ(?:ення|\.)|вiдд[ея]лення|branch|відд\b)/i;
// NP keyword — supports "НП", "нп", "Н.П", "Н. П", "Нова Пошта", "Нова почта"
const NP_KW = /\b(?:н[.\s]*п|np|нова\s*по[шч]та)\b/i;

// Postomat — accept all real-world typo variants:
//   "поштомат" (UA), "почтомат" (RU), "паштомат" (typo a/o), "пастомат" (drop ш→с), "постомат"
const POSTOMAT_RE = /(?:по[шч]томат|па[шс]томат|постомат|postomat)\s*[#№]?\s*(\d{1,5})/i;
// Branch keyword + number — covers:
//   "відділення 5", "відд. 5", "НП 5", "Н. П 5", "№ 5", "no 5", "branch 5",
//   "Нова почта 10", "Нова Пошта 110", "Відділення номер 2", "Відділення №2",
//   "Від 4" (bare 'від' allowed when followed by digit), "нової почти 4"
// `нов(?:а|ої)\s*по[шч]т[аиі]` matches "нова пошта", "нової почти", "нова почта" (RU/UA mix)
const BRANCH_NUM_RE = /(?:від(?:ділення|діл|д\.?)?|branch|нов(?:а|ої)\s*по[шч]т[аиі]|н[.\s]*п|np\b|no\b|№)\s*(?:номер|n[оo])?\s*[#№.]?\s*(\d{1,5})/i;
// Branch NUMBER FIRST: "52 НП", "5 відд", "5 №", "73 від Нова пошта"
const BRANCH_NUM_REVERSED_RE = /\b(\d{1,5})\s*(?:від(?:ділення|діл|д\.?)?|branch|нов(?:а|ої)\s*по[шч]т[аиі]|н[.\s]*п|np\b|№)/i;
const NUMBER_RE = /\b(\d{1,5})\b/;

// Sum: priority — payment keyword + number ("НАЛОЖКА 2800", "ОПЛ 2200").
// Typo-tolerant: "наложка/надожка/наложкі/накладка" all match.
const PAYMENT_SUM_RE = /(?:на[лд]ожк[аи]|на[лд]ожки|наклад(?:ка|ен[іи])?|опл(?:ата|ачено|\.)?|оплата|сума|нал[\.]?|cod)\s*[:=]?\s*(\d{2,6})/i;
// Looser fallback: keyword and number with up to 30 chars in between ("оплата при отриманні 2500")
const PAYMENT_SUM_LOOSE_RE = /(?:на[лд]ожк[аи]|наклад[еі]н|опл(?:ата|\w*)|сума|нал\b|cod|при\s+отриманн)[\s\S]{0,30}?(\d{2,6})/i;
const SUM_RE = /(?:сума|сум[аоі]|ціна|cost|price)\s*[:=]?\s*(\d{2,6})/i;
const SUM_CURRENCY_RE = /(\d{2,6})\s*(?:₴|грн|uah)/i;

// Weight
const WEIGHT_KG_RE = /(?:вага|weight)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:кг|kg)?/i;
const WEIGHT_KG_INLINE_RE = /(\d+(?:[.,]\d+)?)\s*кг\b/i;
const WEIGHT_G_RE = /(\d{2,4})\s*г\b/i;

// Payment hints
const PAY_COD_RE = /(?:наклад[еі]н|наложка|cod|готівк|при отриманн|нал\b)/i;
const PAY_CARD_RE = /(?:карт[аеи]?\b|онлайн|liqpay|приват24|mono|безготівков)/i;
const PAYER_SENDER_RE = /(?:плачу|за рахунок продавця|sender pays|оплата відправник|за наш рахунок)/i;

// Labels for structured lines (specific first)
const LABEL_LINES: Array<{ key: string; patterns: RegExp[] }> = [
  { key: "name", patterns: [/^(?:піб|ім['я]|ім\.я|name|клі[єе]нт|покупець)\s*[:=\-]\s*(.+)$/i] },
  { key: "phone", patterns: [/^(?:тел|телефон|phone|номер)\s*[:=\-]\s*(.+)$/i] },
  { key: "postomat", patterns: [/^(?:поштомат|postomat)\s*[:=\-]?\s*(.+)$/i] },
  { key: "courier", patterns: [/^(?:кур'?[єе]р|courier)\s*[:=\-]?\s*(.+)$/i] },
  { key: "warehouse", patterns: [/^(?:відділення|відд\.?|warehouse|branch)\s*[:=\-]?\s*(.+)$/i] },
  // City label — supports "місто", "city", "м.", "м ", "г.", "г ", "M." (Latin)
  { key: "city", patterns: [/^(?:місто|city|г[.\s]|м[.\s]|m[.\s])\s*[:=\-]?\s*(.+)$/i] },
  { key: "address", patterns: [/^(?:адрес[аи]|address)\s*[:=\-]\s*(.+)$/i] },
  { key: "weight", patterns: [/^(?:вага|weight)\s*[:=\-]\s*(.+)$/i] },
  { key: "sum", patterns: [/^(?:сума|сум[ао]|cost|ціна|price)\s*[:=\-]?\s*(.+)$/i] },
  { key: "description", patterns: [/^(?:опис|товар|description|item|замовлення)\s*[:=\-]\s*(.+)$/i] },
];

// Latin → Cyrillic aliases for cities that shop owners sometimes type in English.
// Resolved at parse time; canonical form returned is Cyrillic.
const LATIN_CITY_ALIASES: Record<string, string> = {
  "kyiv": "Київ", "kiev": "Київ",
  "lviv": "Львів", "lvov": "Львів",
  "kharkiv": "Харків", "kharkov": "Харків",
  "odesa": "Одеса", "odessa": "Одеса",
  "dnipro": "Дніпро", "dnepr": "Дніпро", "dnipropetrovsk": "Дніпро",
  "zaporizhzhia": "Запоріжжя", "zaporizhia": "Запоріжжя", "zaporozhye": "Запоріжжя",
  "vinnytsia": "Вінниця", "vinnitsa": "Вінниця",
  "poltava": "Полтава",
  "chernivtsi": "Чернівці",
  "chernihiv": "Чернігів", "chernigov": "Чернігів",
  "khmelnytskyi": "Хмельницький", "khmelnitsky": "Хмельницький",
  "ternopil": "Тернопіль",
  "ivano-frankivsk": "Івано-Франківськ", "ivanofrankivsk": "Івано-Франківськ",
  "lutsk": "Луцьк",
  "rivne": "Рівне",
  "zhytomyr": "Житомир",
  "sumy": "Суми",
  "cherkasy": "Черкаси",
  "uzhhorod": "Ужгород", "uzhgorod": "Ужгород",
  "mykolaiv": "Миколаїв", "nikolaev": "Миколаїв",
  "kherson": "Херсон",
  "kropyvnytskyi": "Кропивницький",
  "brovary": "Бровари",
  "boryspil": "Бориспіль",
  "kremenchuk": "Кременчук",
  "bila tserkva": "Біла Церква",
  "kamianets-podilskyi": "Кам'янець-Подільський",
  "kryvyi rih": "Кривий Ріг", "kriviy rih": "Кривий Ріг",
  "mariupol": "Маріуполь",
  "irpin": "Ірпінь",
  "bucha": "Буча",
};

// Expanded UA city list (top-150) + multi-word cities. Matched as case-insensitive substring.
// Order: longer first so "Софіївська Борщагівка" matches before "Борщагівка".
const KNOWN_CITIES = [
  // Multi-word (must be first)
  "Софіївська Борщагівка", "Біла Церква", "Кам'янець-Подільський", "Кам'янське",
  "Кривий Ріг", "Новоград-Волинський", "Слов'янськ", "Покровськ", "Володимир-Волинський",
  // Single-word
  "Київ", "Львів", "Дніпро", "Одеса", "Харків", "Запоріжжя", "Вінниця",
  "Полтава", "Чернівці", "Чернігів", "Хмельницький", "Тернопіль",
  "Івано-Франківськ", "Луцьк", "Рівне", "Житомир", "Суми", "Кропивницький",
  "Черкаси", "Ужгород", "Миколаїв", "Херсон", "Маріуполь", "Бровари",
  "Бориспіль", "Кременчук", "Мелітополь", "Краматорськ",
  "Нікополь", "Бердянськ", "Дрогобич",
  "Чорноморськ", "Стрий", "Коломия", "Ірпінь", "Буча", "Вишневе", "Боярка",
  "Бердичів", "Біла Церква", "Шостка", "Конотоп", "Лубни", "Прилуки",
  "Мукачево", "Дубно", "Ковель", "Нововолинськ", "Самбір", "Червоноград",
  "Калуш", "Долина", "Надвірна", "Снятин", "Тлумач", "Болехів",
  "Новояворівськ", "Жовква", "Сокаль", "Радехів", "Городок", "Винники",
  "Куликів", "Перемишляни", "Старий Самбір", "Турка",
  "Маневичі", "Любомль", "Іваничі", "Сарни", "Костопіль", "Здолбунів",
  "Гайсин", "Тульчин", "Бар", "Бершадь", "Жмеринка", "Хмільник",
  "Ладижин", "Козятин", "Калинівка",
  "Світловодськ", "Олександрія", "Знам'янка", "Долинська",
  "Біляївка", "Болград", "Ізмаїл", "Кілія", "Татарбунари",
  "Балта", "Подільськ", "Любашівка", "Рені",
  // Add small cities/villages observed in real production logs
  "Коростень", "Дубляни", "Ходосівка", "Софіївська Ходосівка",
];

// ─────────────────────────────────────────────────────────────────────
// Main parser
// ─────────────────────────────────────────────────────────────────────

export function parseOrder(rawText: string): OrderDraft {
  const draft: OrderDraft = {
    paymentMethod: "Cash",
    payerType: "Recipient",
    warehouseType: "branch",
    fieldStatus: {},
    warnings: [],
  };

  const text = rawText.trim();
  if (!text) {
    draft.warnings.push("Порожнє повідомлення");
    return draft;
  }

  // 1. Skip preamble noise: greetings, "Дані отримувача:", "Замовлення:", etc.
  const NOISE_RE = /^(?:дані|клієнт:?$|замовлення\s*[:!\.]?$|замовляю|доброго\s+дня|добрий\s+день|вітаю|привіт|здра[вс]туйте|здоров[іи]те|hi|hello|good\s+(?:morning|afternoon|day))/i;
  // Prefixes that introduce the recipient block: strip and let what follows be classified normally.
  // Examples: "Відправка на ім'я ...", "Отримувач: ...", "Покупець: ...", "Замовник: ..."
  const NAME_PREFIX_RE = /^(?:відправка\s+на\s+ім['’`]я\s+|отримувач\s*[:\-]?\s*|покупець\s*[:\-]?\s*|замовник\s*[:\-]?\s*|клієнт\s*[:\-]\s*|кому\s*[:\-]\s*|ім['’`]я\s+|на\s+ім['’`]я\s+|фио\s*[:\-]?\s*|фіо\s*[:\-]?\s*)/i;
  // "Нова пошта," / "НП," prefix on warehouse-block line: strip so "Нова пошта, місто Львів" reduces to "місто Львів"
  const NP_LINE_PREFIX_RE = /^(?:нова\s*пошта|нп)\s*[,:\-]\s*/i;

  // Strip leading emoji/symbol prefixes (📦 👤 📱 🏙 🏤 💰 ✅ > etc.) so the classifier sees the content
  const stripEmoji = (s: string) =>
    s
      .replace(/^[\s>•·–—\-*]+/, "") // quote markers, bullets
      .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\s]+/u, "") // emoji + ZWJ
      .trim();

  let lines = text
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .map(stripEmoji)
    .map((l) => l.replace(NAME_PREFIX_RE, "").replace(NP_LINE_PREFIX_RE, "").trim())
    .filter((l) => l && !NOISE_RE.test(l));

  // First content line — used by name matcher to reject product descriptions like "Крышка фиолет"
  // which appear on the first line of shop-owner messages.
  const firstContentLine = lines[0] ?? "";

  // 1a. One-line tokenized order: "Шевченко О. 0501112233 Київ № 5 наложка 2000"
  // If we have a single long line with phone in the middle, split into name | phone | tail
  // so each piece can be classified independently.
  if (lines.length === 1 && /\s/.test(lines[0]) && lines[0].length >= 20) {
    const single = lines[0];
    const phoneMatch = single.match(PHONE_RE);
    if (phoneMatch && phoneMatch.index !== undefined && phoneMatch[0].length >= 10) {
      const before = single.slice(0, phoneMatch.index).trim().replace(/[,;]$/, "");
      const after = single.slice(phoneMatch.index + phoneMatch[0].length).trim().replace(/^[,;]/, "");
      const pieces = [before, phoneMatch[0], after].filter((p) => p.length > 0);
      if (pieces.length >= 2) lines = pieces;
    }
  }

  // 1b. Comma-split: if a line has 2+ commas, split into pieces and process each independently.
  // Always (not gated on line count) — real shop owners often pack everything into one comma-separated line.
  {
    const expanded: string[] = [];
    for (const l of lines) {
      // Don't split if commas are part of a description (e.g. "Synya, with bows, see lid").
      // Heuristic: split only if at least one piece contains a known signal (phone/city/branch/sum).
      const pieces = l.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
      if (pieces.length >= 2) {
        const hasSignal = pieces.some(
          (p) =>
            PHONE_RE.test(p) ||
            findCityInLine(p) ||
            BRANCH_NUM_RE.test(p) ||
            POSTOMAT_RE.test(p) ||
            PAYMENT_SUM_RE.test(p) ||
            /^\d{1,5}$/.test(p),
        );
        if (hasSignal) {
          for (const p of pieces) expanded.push(p);
          continue;
        }
      }
      expanded.push(l);
    }
    lines = expanded;
  }

  // 2. Label-aware first pass — extract labeled values
  const unlabeledLines: string[] = [];
  for (const line of lines) {
    let labeled = false;
    for (const def of LABEL_LINES) {
      for (const re of def.patterns) {
        const m = line.match(re);
        if (m) {
          applyLabeledValue(draft, def.key, m[1].trim());
          labeled = true;
          break;
        }
      }
      if (labeled) break;
    }
    if (!labeled) unlabeledLines.push(line);
  }

  // 3. Line-by-line classification of unlabeled lines.
  // NB: don't use `continue` after partial matches — a single line may carry
  // multiple fields ("Київ № 5 наложка 2000" has city + warehouse + cost).
  for (const line of unlabeledLines) {
    // Phone — extract if present, but keep processing the line for other fields
    if (!draft.recipientPhone) {
      const m = line.match(PHONE_RE);
      if (m && (PHONE_LINE_RE.test(line.trim()) || m[0].length >= 10)) {
        draft.recipientPhone = normalizePhone(m[0]);
        draft.fieldStatus.phone = "ok";
        // If the WHOLE line is just the phone, skip rest of classification
        if (PHONE_LINE_RE.test(line.trim())) continue;
      }
    }

    // Payment + sum — extract but don't skip city/warehouse on same line
    if (!draft.cost) {
      const m = line.match(PAYMENT_SUM_RE);
      if (m) {
        draft.cost = parseInt(m[1], 10);
        draft.fieldStatus.cost = "ok";
        if (PAY_COD_RE.test(line)) draft.paymentMethod = "Cash";
        // No continue — line might still hold city/warehouse
      }
    }

    // City line FIRST — known city (possibly with warehouse on same line)
    // We do city before warehouse so we don't lose city when line has both.
    let consumedAsCity = false;
    if (!draft.cityName) {
      const cityHit = findCityInLine(line);
      if (cityHit) {
        draft.cityName = cityHit.canonical;
        draft.fieldStatus.city = "ok";
        consumedAsCity = true;
        // The rest of the line might be a warehouse ("Дніпро нп 112", "Київ 70")
        if (!draft.warehouseNumber && draft.warehouseType !== "courier") {
          const before = line.slice(0, cityHit.start);
          const after = line.slice(cityHit.start + cityHit.length);
          const remainder = (before + " " + after).trim();
          // Pure number ("Київ 70" → " 70") — fallback to branch + N
          const pureNum = remainder.match(/^\s*(\d{1,5})\s*$/);
          if (pureNum) {
            draft.warehouseType = "branch";
            draft.warehouseNumber = pureNum[1];
            draft.fieldStatus.warehouse = "ok";
          } else if (remainder) {
            // City line remainder — bare number IS allowed ("Київ 70" already handled above,
            // here the remainder is something like "70 Шевченка" — let bare number work)
            tryParseWarehouseLine(remainder, draft, { allowBareNumber: true });
          }
        }
      }
    }
    if (consumedAsCity) continue;

    // Warehouse line — must have explicit keyword (НП/відділення/поштомат + number).
    // Bare number NOT allowed here — would falsely capture cost lines like "Опл 2200".
    if (!draft.warehouseNumber && draft.warehouseType !== "courier") {
      const handled = tryParseWarehouseLine(line, draft, { allowBareNumber: false });
      if (handled) continue;
    }

    // Name line — at start, 2-3 cyrillic words (allow lowercase second/third for "Шостакова крістіна")
    if (!draft.recipientName) {
      const nameMatch = matchNameLine(line, { isFirstLine: line === firstContentLine });
      if (nameMatch) {
        draft.recipientName = nameMatch;
        draft.fieldStatus.name = "guessed";
        continue;
      }
    }
  }

  // 3b. Bare-number-as-warehouse fallback: if we have city + phone but no warehouse,
  // and there's a standalone line with just 1-5 digits, treat it as branch number.
  // Example: "Шевченко Андрій ... Київ ... 460 ... 380633367332" — "460" is wh.
  if (draft.cityName && draft.recipientPhone && !draft.warehouseNumber && draft.warehouseType !== "courier") {
    for (const line of unlabeledLines) {
      const m = line.match(/^\s*(\d{1,5})\s*$/);
      if (m) {
        const n = parseInt(m[1], 10);
        // Skip if number is in cost-typical range (>=300 AND >=100) — those should stay as cost
        // Skip if it could be price (matches 3-5 digits ≥ 300) AND no other cost yet
        if (n >= 1 && n <= 99999) {
          // Heuristic: numbers ≥ 300 might be cost; only assign as wh if (cost already set)
          // OR (number is small ≤ 200, typical branch)
          if (draft.cost || n <= 200 || n >= 10000 /* postomat range */) {
            draft.warehouseType = "branch";
            draft.warehouseNumber = m[1];
            draft.fieldStatus.warehouse = "guessed";
            break;
          }
        }
      }
    }
  }

  // 4. Fallback sum extraction from entire text — tight then loose
  if (!draft.cost) {
    const m =
      text.match(PAYMENT_SUM_RE) ??
      text.match(SUM_RE) ??
      text.match(SUM_CURRENCY_RE) ??
      text.match(PAYMENT_SUM_LOOSE_RE);
    if (m) {
      draft.cost = parseInt(m[1], 10);
      draft.fieldStatus.cost = "ok";
    }
  }

  // 4b. Last-resort fallback: a bare 3-5 digit number on its own line is likely the price
  // (e.g. "2000" after "💰" emoji). Skip if it equals the warehouse number.
  if (!draft.cost) {
    for (const line of unlabeledLines) {
      const m = line.match(/^\s*(\d{3,5})\s*$/);
      if (m && m[1] !== draft.warehouseNumber) {
        const n = parseInt(m[1], 10);
        if (n >= 100) {
          draft.cost = n;
          draft.fieldStatus.cost = "guessed";
          break;
        }
      }
    }
  }

  // 5. Payment hints
  if (PAY_CARD_RE.test(text)) draft.paymentMethod = "NonCash";
  else if (PAY_COD_RE.test(text)) draft.paymentMethod = "Cash";
  if (PAYER_SENDER_RE.test(text)) draft.payerType = "Sender";

  // 6. Weight
  if (!draft.weightKg) {
    const m1 = text.match(WEIGHT_KG_RE);
    const m2 = text.match(WEIGHT_KG_INLINE_RE);
    const m3 = text.match(WEIGHT_G_RE);
    if (m1) draft.weightKg = parseFloat(m1[1].replace(",", "."));
    else if (m2) draft.weightKg = parseFloat(m2[1].replace(",", "."));
    else if (m3) draft.weightKg = parseInt(m3[1], 10) / 1000;
    if (draft.weightKg) draft.fieldStatus.weight = "ok";
  }

  // 7. Description — short standalone lines that are not classified
  if (!draft.description) {
    const candidates = unlabeledLines.filter((l) => {
      // Skip greetings/preamble
      if (/^(доброго\s+дня|добрий\s+день|вітаю|привіт|здра[вс]туйте|здоров|hi|hello|good\s+(morning|afternoon|day)|замовлення[:!\.\s]?$|замовляю|дані|клієнт)/i.test(l)) return false;
      // Skip if line was the source of name/phone/warehouse/city
      if (draft.recipientPhone && l.includes(draft.recipientPhone.replace(/\D/g, "").slice(-9))) return false;
      if (draft.recipientName && l.includes(draft.recipientName)) return false;
      if (draft.cityName && l.toLowerCase().includes(draft.cityName.toLowerCase())) return false;
      // Skip payment/sum lines
      if (PAYMENT_SUM_RE.test(l) || SUM_CURRENCY_RE.test(l) || PAYMENT_SUM_LOOSE_RE.test(l)) return false;
      // Skip NP/warehouse lines
      if (NP_KW.test(l) || POSTOMAT_KW.test(l) || BRANCH_KW.test(l)) return false;
      // Need at least 3 letters and at least one non-greeting word
      return l.length >= 3 && /[а-яa-z]{3}/i.test(l);
    });
    if (candidates.length > 0) {
      draft.description = candidates[0].slice(0, 200);
      draft.fieldStatus.description = "guessed";
    }
  }

  // 8. Validate required
  if (!draft.recipientName) {
    draft.fieldStatus.recipientName = "missing";
    draft.warnings.push("Не знайшов поле: ПІБ");
  }
  if (!draft.recipientPhone) {
    draft.fieldStatus.recipientPhone = "missing";
    draft.warnings.push("Не знайшов поле: телефон");
  }
  if (!draft.cityName) {
    draft.fieldStatus.cityName = "missing";
    draft.warnings.push("Не знайшов поле: місто");
  }
  if (draft.warehouseType !== "courier" && !draft.warehouseNumber) {
    draft.fieldStatus.warehouse = "missing";
    draft.warnings.push("Не знайшов № відділення / поштомата");
  }

  return draft;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Find a known city in a line (either Cyrillic from KNOWN_CITIES or Latin alias).
 * Returns position, length in original string, and canonical Cyrillic name.
 * Longer cities matched first.
 */
function findCityInLine(line: string): { canonical: string; start: number; length: number } | null {
  const lower = line.toLowerCase();
  // 1) Cyrillic known cities (already ordered longer-first)
  for (const city of KNOWN_CITIES) {
    const idx = lower.indexOf(city.toLowerCase());
    if (idx !== -1) {
      return { canonical: city, start: idx, length: city.length };
    }
  }
  // 2) Latin aliases — only match on word boundary so we don't catch "kyivska" etc.
  // Sort longer keys first.
  const latinKeys = Object.keys(LATIN_CITY_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of latinKeys) {
    // word-boundary on both sides
    const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const m = lower.match(re);
    if (m && m.index !== undefined) {
      return { canonical: LATIN_CITY_ALIASES[key], start: m.index, length: key.length };
    }
  }
  return null;
}

function tryParseWarehouseLine(line: string, draft: OrderDraft, opts: { allowBareNumber?: boolean } = {}): boolean {
  // Guard: if a payment keyword is in this line, treat any trailing number as cost — NOT warehouse.
  // This prevents "Опл 2200" from leaking as whNumber.
  const hasPaymentKw = PAYMENT_SUM_RE.test(line) || /(?:опл|на[лд]ожк|сума|нал\b|при\s+отриманн|грн|₴|uah)/i.test(line);

  // Postomat — highest priority
  const pm = line.match(POSTOMAT_RE);
  if (pm) {
    draft.warehouseType = "postomat";
    draft.warehouseNumber = pm[1];
    draft.fieldStatus.warehouse = "ok";
    return true;
  }

  // Courier
  if (COURIER_KW.test(line)) {
    draft.warehouseType = "courier";
    const addr = line.replace(COURIER_KW, "").replace(/^[:\-,\s]+/, "").trim();
    if (addr) draft.courierAddress = addr;
    draft.fieldStatus.warehouse = "ok";
    return true;
  }

  // Branch — keyword-first ("НП 13", "відділ. 10", "Н. П 37")
  const branchKwMatch = line.match(BRANCH_NUM_RE);
  if (branchKwMatch) {
    draft.warehouseType = "branch";
    draft.warehouseNumber = branchKwMatch[1];
    draft.fieldStatus.warehouse = "ok";
    return true;
  }

  // Branch — NUMBER-first ("52 НП", "5 відд.")
  const branchRevMatch = line.match(BRANCH_NUM_REVERSED_RE);
  if (branchRevMatch) {
    draft.warehouseType = "branch";
    draft.warehouseNumber = branchRevMatch[1];
    draft.fieldStatus.warehouse = "ok";
    return true;
  }

  // City + number fallback ("Київ 70")
  // ONLY enabled when caller asks for it (city-consumed remainder), and NEVER for payment lines.
  if (opts.allowBareNumber && !hasPaymentKw) {
    const numMatch = line.match(/^\s*(\d{1,5})\s*$/) ?? line.match(/\b(\d{1,5})\b\s*$/);
    if (numMatch && /[А-ЯЇІЄҐ][а-яїієґ]/.test(line)) {
      draft.warehouseType = "branch";
      draft.warehouseNumber = numMatch[1];
      draft.fieldStatus.warehouse = "ok";
      return true;
    }
  }

  return false;
}

// Common product/noun words that look like names but aren't — used to reject description lines
// like "Крышка фиолет", "Затычки набор", "Бутилка термокухоль".
// NB: \b doesn't work with Cyrillic in JS — use (?:^|\P{L}) start-or-non-letter boundary instead.
const PRODUCT_NOUN_RE = /(?:^|[^\p{L}])(?:кр[ыи]шк|бут[ыи]лк|термокух|чашк|стакан|круж|кофе|чай|пляшк|корпус|кришк|синя|червон|жовт|зелен|чорн|білий|cream|black|white|gold|blue|matte|pink|пинк|роз[ао]|бутылк|термос|старбакс|starbucks|затычк|затичк|колпачк|ковпачк|подстак|підстак|трубочк|молочн|бантик|серединк|желт|жовт|сердечк|ледниц|роза\s+кв)/iu;

function matchNameLine(line: string, opts: { isFirstLine?: boolean } = {}): string | null {
  // Skip obvious non-names
  if (PHONE_RE.test(line)) return null;
  if (NP_KW.test(line) || POSTOMAT_KW.test(line) || BRANCH_KW.test(line) || COURIER_KW.test(line)) return null;
  if (PAYMENT_SUM_RE.test(line) || SUM_CURRENCY_RE.test(line)) return null;
  if (findCityInLine(line)) return null;
  // Reject if line looks like a product description
  if (PRODUCT_NOUN_RE.test(line)) return null;
  // Reject if first line of message AND short — descriptions are usually first
  if (opts.isFirstLine && line.split(/\s+/).length <= 3 && /[а-яa-z]/.test(line)) {
    // Heuristic: first-line short text is usually a product label, not a name.
    // Allow ONLY if it strictly matches Pattern A (all Title Case) — names like "Перинська Елізабетта Юріївна" can legitimately be first line.
  }

  // Strip trailing period/comma ("Кадай Уляна Ігорівна." → "Кадай Уляна Ігорівна")
  const stripped = line.replace(/[.,;]\s*$/, "");

  // Pattern A: 2-4 Title Case cyrillic words ("Перинська Елізабетта Юріївна", "Рихаб Бен Салах")
  const A = stripped.match(/^((?:[А-ЯЇІЄҐ][а-яїієґ'’\-]{1,}\s+){1,3}[А-ЯЇІЄҐ][а-яїієґ'’\-]{1,})$/);
  if (A) return A[1].trim();

  // Pattern B: Title Case + lowercase, max 2 words ("Шостакова крістіна")
  // First word must be ≥4 chars after capital (typical surname). PRODUCT_NOUN_RE filter above
  // already protects against "Крышка фиолет" / "Бутилка термос" type descriptions.
  const B = stripped.match(/^([А-ЯЇІЄҐ][а-яїієґ'’\-]{3,}\s+[а-яїієґ][а-яїієґ'’\-]{2,})$/);
  if (B) {
    const parts = B[1].split(/\s+/);
    parts[1] = parts[1][0].toUpperCase() + parts[1].slice(1);
    return parts.join(" ");
  }

  // Pattern C: Surname + initial ("Перинська Е.", "Кадай У.")
  const C = stripped.match(/^([А-ЯЇІЄҐ][а-яїієґ'’\-]{2,})\s+([А-ЯЇІЄҐ])\.?$/);
  if (C) return `${C[1]} ${C[2]}.`;

  // Pattern D: 3-word foreign name "Title Title lowercase" ("Рихаб Бен салах")
  // First two words Title Case + short lowercase third.
  const D = stripped.match(/^([А-ЯЇІЄҐ][а-яїієґ'’\-]{2,})\s+([А-ЯЇІЄҐ][а-яїієґ'’\-]{2,})\s+([а-яїієґ][а-яїієґ'’\-]{2,})$/);
  if (D) {
    return `${D[1]} ${D[2]} ${D[3][0].toUpperCase() + D[3].slice(1)}`;
  }

  return null;
}

function applyLabeledValue(draft: OrderDraft, key: string, val: string) {
  switch (key) {
    case "name":
      draft.recipientName = val;
      draft.fieldStatus.name = "ok";
      break;
    case "phone":
      draft.recipientPhone = normalizePhone(val);
      draft.fieldStatus.phone = "ok";
      break;
    case "city": {
      // Captured value may include warehouse info ("Львів - відділення НП #32") — resolve to a
      // known city when possible and pass the rest through warehouse parsing.
      const cityVal = val.replace(/^[гм]\.\s*/i, "").trim();
      const hit = findCityInLine(cityVal);
      if (hit) {
        draft.cityName = hit.canonical;
        draft.fieldStatus.city = "ok";
        if (!draft.warehouseNumber && draft.warehouseType !== "courier") {
          const remainder = (cityVal.slice(0, hit.start) + " " + cityVal.slice(hit.start + hit.length)).trim();
          if (remainder) tryParseWarehouseLine(remainder, draft, { allowBareNumber: true });
        }
      } else {
        draft.cityName = cityVal;
        draft.fieldStatus.city = "ok";
      }
      break;
    }
    case "postomat": {
      draft.warehouseType = "postomat";
      const num = val.match(/(\d{1,5})/);
      if (num) {
        draft.warehouseNumber = num[1];
        draft.fieldStatus.warehouse = "ok";
      }
      break;
    }
    case "warehouse": {
      if (POSTOMAT_KW.test(val)) draft.warehouseType = "postomat";
      else if (COURIER_KW.test(val)) draft.warehouseType = "courier";
      else draft.warehouseType = "branch";
      const num = val.match(/(\d{1,5})/);
      if (num) {
        draft.warehouseNumber = num[1];
        draft.fieldStatus.warehouse = "ok";
      }
      break;
    }
    case "courier":
      draft.warehouseType = "courier";
      draft.courierAddress = val.trim();
      draft.fieldStatus.warehouse = "ok";
      break;
    case "address":
      draft.courierAddress = val;
      draft.warehouseType = "courier";
      draft.fieldStatus.warehouse = "ok";
      break;
    case "weight": {
      const m = val.match(/(\d+(?:[.,]\d+)?)/);
      if (m) {
        const num = parseFloat(m[1].replace(",", "."));
        draft.weightKg = num >= 50 ? num / 1000 : num;
        draft.fieldStatus.weight = "ok";
      }
      break;
    }
    case "sum": {
      const m = val.match(/(\d{2,6})/);
      if (m) {
        draft.cost = parseInt(m[1], 10);
        draft.fieldStatus.cost = "ok";
      }
      break;
    }
    case "description":
      draft.description = val;
      draft.fieldStatus.description = "ok";
      break;
  }
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return `+38${digits}`;
  if (digits.length === 12 && digits.startsWith("38")) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith("380")) return `+${digits.slice(1)}`;
  return `+${digits}`;
}

export function isDraftReady(draft: OrderDraft): boolean {
  return (
    !!draft.recipientName &&
    !!draft.recipientPhone &&
    !!draft.cityName &&
    (draft.warehouseType === "courier" ? !!draft.courierAddress : !!draft.warehouseNumber)
  );
}

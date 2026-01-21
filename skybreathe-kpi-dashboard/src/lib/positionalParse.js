// src/lib/positionalParse.js

const BASES = [
  "AMS","BOD","BCN","FCO","CDG","NTE","PMI","MXP","LYS","LIN","MAN","LIS","NAP","BHX",
  "LTN","NCE","GVA","LGW","LPL","BSL","ALC","BER","OPO","SEN","ORY","AGP","BFS","GLA","EDI","BRS",
];

const BASE_SET = new Set(BASES);

function isPercentText(s) {
  return /^\d{1,3}%$/.test(s);
}
function isAxisPercentTick(s) {
  return s === "0%" || s === "25%" || s === "50%" || s === "75%" || s === "100%";
}
function isKgText(s) {
  return /^\d{2,5}\s*kg$/i.test(s);
}
function toInt(s) {
  const n = parseInt(String(s).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}
function cleanFuelNumber(n) {
  if (n == null) return null;
  const s = String(n);
  if (s.length >= 6) return toInt(s.slice(0, 3)); // 220099 -> 220
  return n;
}

function sortTopToBottom(items) {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

function withinRect(it, rect) {
  return it.x >= rect.x1 && it.x <= rect.x2 && it.y >= rect.y1 && it.y <= rect.y2;
}

/**
 * Title detection with safe banding.
 * Optional opts lets us widen Y band / filter by x for tricky panels.
 * NOTE: titles are now optional (rects are deterministic), but we keep this for target extraction.
 */
function findChartTitleItem(page, regex, opts = {}) {
  if (!page) return null;
  const r = regex instanceof RegExp ? regex : new RegExp(regex, "i");

  const minYFrac = opts.minYFrac ?? 0.18;
  const maxYFrac = opts.maxYFrac ?? 0.74;
  const minX = opts.minX ?? -Infinity;
  const maxX = opts.maxX ?? Infinity;

  const minY = page.height * minYFrac;
  const maxY = page.height * maxYFrac;

  const candidates = page.items
    .filter((it) => r.test(it.text))
    .filter((it) => it.y > minY && it.y < maxY)
    .filter((it) => it.x >= minX && it.x <= maxX);

  if (!candidates.length) return null;

  candidates.sort((a, b) => a.y - b.y);
  return candidates[0];
}

/**
 * Kept for reference / fallback only.
 */
function chartRectFromTitle(page, titleItem) {
  const margin = 10;
  const cols = page.pageNumber === 1 ? 4 : 2;
  const colW = page.width / cols;

  const idx = Math.max(0, Math.min(cols - 1, Math.floor(titleItem.x / colW)));

  const x1 = idx * colW + margin;
  const x2 = (idx + 1) * colW - margin;

  const y1 = titleItem.y + 8;
  const y2 = Math.min(page.height - margin, titleItem.y + 560);

  return { x1, y1, x2, y2 };
}

/**
 * Deterministic rects by KPI key
 * Page 1: 4 columns (OETD, OETD_WA, OETA, OETA_WA)
 */
function chartRectPage1ByKey(page, key) {
  const margin = 3;
  const colW = page.width / 4;

  const idx =
    key === "OETD" ? 0 :
    key === "OETD_WA" ? 1 :
    key === "OETA" ? 2 :
    key === "OETA_WA" ? 3 :
    null;

  if (idx == null) return null;

  const x1 = idx * colW + margin;
  const x2 = (idx + 1) * colW - margin;

  // match what you see on page 1: charts start a bit lower than tiles
  const y1 = page.height * 0.24;
  const y2 = page.height * 0.93;

  return { x1, y1, x2, y2 };
}


/**
 * Your proven formula for page 2.
 * Note: you intentionally use width/4 and idx 0/1 and it works for your layout.
 */
function chartRectPage2ByKey(page, key) {
  const margin = 3;
  const colW = page.width / 4;

  const idx = key === "DISC_FUEL" ? 1 : 0; // FLAP3 left, DISC_FUEL right

  const x1 = idx * colW + margin;
  const x2 = (idx + 1) * colW - margin;

  // Page 2 layout: tiles at top, charts below
  const y1 = page.height * 0.19; // below tiles
  const y2 = page.height * 0.72; // above footer area

  return { x1, y1, x2, y2 };
}

function extractRankingFromRegion(page, rect, mode, key) {
  const rectW = rect.x2 - rect.x1;

  // defaults
  let leftBandMaxX = rect.x1 + rectW * 0.60;
  let rightBandMinX = rect.x1 + rectW * 0.48;

  // WA panels shift: capture wider
  /*if (key === "OETD_WA" || key === "OETA_WA") {
    leftBandMaxX = rect.x1 + rectW * 0.66;
    rightBandMinX = rect.x1 + rectW * 0.40;
  }

  // OETA bottom rows: values can sit a bit left
 if (key === "OETA") {
    rightBandMinX = rect.x1 + rectW * 0.44;
  }
*/
  const inner = {
    x1: rect.x1,
    x2: rect.x2,
    y1: rect.y1 + 10,
    y2: rect.y2 - 2,
  };

  const regionItems = page.items.filter((it) => withinRect(it, inner));

  // Bases
  const baseItems = sortTopToBottom(
    regionItems.filter((it) => BASE_SET.has(it.text) && it.x <= leftBandMaxX)
  );

  const seen = new Set();
  const bases = [];
  for (const it of baseItems) {
    if (seen.has(it.text)) continue;
    seen.add(it.text);
    bases.push({ base: it.text, y: it.y });
  }

  // Values
  let valueItems = [];
  if (mode === "PERCENT") {
    valueItems = sortTopToBottom(
      regionItems.filter(
        (it) =>
          it.x >= rightBandMinX &&
          isPercentText(it.text) &&
          !isAxisPercentTick(it.text)
      )
    ).map((it) => ({ y: it.y, value: toInt(it.text) }));
  } else {
    valueItems = sortTopToBottom(
      regionItems
        .filter((it) => it.x >= rightBandMinX && (isKgText(it.text) || /^\d{2,5}$/.test(it.text)))
    ).map((it) => ({ y: it.y, value: cleanFuelNumber(toInt(it.text)) }));
  }

  valueItems = valueItems.filter((v) => v.value != null);

  // Pair by nearest Y
  const used = new Array(valueItems.length).fill(false);
  const ranking = [];
  let maxDY = 14;

  for (const b of bases) {
    let bestIdx = -1;
    let bestDY = Infinity;

    for (let i = 0; i < valueItems.length; i++) {
      if (used[i]) continue;
      const dy = Math.abs(valueItems[i].y - b.y);
      if (dy < bestDY) {
        bestDY = dy;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestDY <= maxDY) {
      used[bestIdx] = true;
      ranking.push({ base: b.base, value: valueItems[bestIdx].value });
    }
  }

  // Relaxed pass if bases=30 but we didn't pair all
  if (ranking.length < 30 && bases.length === 30 && valueItems.length >= 30) {
    const used2 = new Array(valueItems.length).fill(false);
    const ranking2 = [];
    maxDY = 26;

    for (const b of bases) {
      let bestIdx = -1;
      let bestDY = Infinity;

      for (let i = 0; i < valueItems.length; i++) {
        if (used2[i]) continue;
        const dy = Math.abs(valueItems[i].y - b.y);
        if (dy < bestDY) {
          bestDY = dy;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0 && bestDY <= maxDY) {
        used2[bestIdx] = true;
        ranking2.push({ base: b.base, value: valueItems[bestIdx].value });
      }
    }

    if (ranking2.length > ranking.length) {
      return { ranking: ranking2, debug: { bases: bases.length, values: valueItems.length } };
    }
  }

  return { ranking, debug: { bases: bases.length, values: valueItems.length } };
}

/**
 * Target near title (best case)
 */
function extractTargetNearTitle(page, titleItem, type) {
  const rect = {
    x1: Math.max(0, titleItem.x - 60),
    y1: titleItem.y - 14,
    x2: Math.min(page.width, titleItem.x + 320),
    y2: Math.min(page.height, titleItem.y + 80),
  };

  const items = page.items.filter((it) => withinRect(it, rect));
  const joined = items.map((i) => i.text).join(" ");

  if (type === "PERCENT") {
    const m = /FY26\s*Target\s*(\d{1,3})\s*%/i.exec(joined);
    return m ? toInt(m[1]) : null;
  }

  const m = /FY26\s*Target\s*(\d{1,5})\s*kg/i.exec(joined);
  return m ? toInt(m[1]) : null;
}

/**
 * Fallback target: scan the top band of the deterministic rect
 */
function extractTargetFromRectTopBand(page, rect, mode) {
  const topBand = {
    x1: rect.x1,
    x2: rect.x2,
    y1: rect.y1 - 60,
    y2: rect.y1 + 90,
  };
  const items = page.items.filter((it) => withinRect(it, topBand));
  const joined = items.map((i) => i.text).join(" ");

  if (mode === "PERCENT") {
    const m = /FY26\s*Target\s*(\d{1,3})\s*%/i.exec(joined);
    return m ? toInt(m[1]) : null;
  } else {
    const m = /FY26\s*Target\s*(\d{1,5})\s*kg/i.exec(joined);
    return m ? toInt(m[1]) : null;
  }
}

/**
 * Network avg from the top tiles (page 1 only)
 */
function extractNetworkAvgFromTiles(page, key) {
  if (!page) return null;

  const tileRowY1 = page.height * 0.06;
  const tileRowY2 = page.height * 0.30;

  const cols = 4;
  const colW = page.width / cols;

  const tileIdxByKey = {
    OETD: 0,
    OETD_WA: 1,
    OETA: 2,
    OETA_WA: 3,
  };

  const idx = tileIdxByKey[key];
  if (idx == null) return null;

  const rect = {
    x1: idx * colW + 10,
    x2: (idx + 1) * colW - 10,
    y1: tileRowY1,
    y2: tileRowY2,
  };

  const items = page.items.filter((it) => withinRect(it, rect));

  const pct = items.find((it) => isPercentText(it.text));
  if (!pct) return null;
  return toInt(pct.text);
}

/**
 * Network PDF parser
 */
export function parseNetworkFromLayout(layout) {
  const p1 = layout.pages.find((p) => p.pageNumber === 1);
  const p2 = layout.pages.find((p) => p.pageNumber === 2);

  const kpis = {};
  const debugRegions = [];

  function parseChart(page, key, titleRegex, mode) {
    if (!page) return;

    // Deterministic rects ensure boxes always appear
    let rect = null;
    if (page.pageNumber === 1) {
      rect = chartRectPage1ByKey(page, key);
    } else if (page.pageNumber === 2) {
      rect = chartRectPage2ByKey(page, key);
    }
    if (!rect) return;

    // Title is optional now (used mainly for target)
    const title = findChartTitleItem(page, titleRegex);

    const target = title
      ? extractTargetNearTitle(page, title, mode)
      : extractTargetFromRectTopBand(page, rect, mode);

    const { ranking, debug } = extractRankingFromRegion(page, rect, mode, key);

    const networkAvg =
      page.pageNumber === 1 && (key === "OETD" || key === "OETD_WA" || key === "OETA" || key === "OETA_WA")
        ? extractNetworkAvgFromTiles(page, key)
        : null;

    debugRegions.push({ page: page.pageNumber, key, rect, debug });

    if (ranking) kpis[key] = { target, networkAvg, ranking };
  }

  // Page 1
  parseChart(p1, "OETD", /OETD\s+KPI\s+Performance/i, "PERCENT");
  parseChart(p1, "OETD_WA", /OETD[-–]?WA\s+KPI\s+Performance/i, "PERCENT");
  parseChart(p1, "OETA", /OETA\s+KPI\s+Performance/i, "PERCENT");
  parseChart(
    p1,
    "OETA_WA",
    /(OETA[-–]?WA\s+KPI\s+Performance|EZY\s+OETA\s+without\s+APU\s+applied\s*\[AVG\])/i,
    "PERCENT"
  );

  // Page 2
  parseChart(p2, "FLAP3", /Flap\s+3/i, "PERCENT");
  parseChart(p2, "DISC_FUEL", /Discretionary\s+Fuel/i, "KG");

  const bases = Array.from(
    new Set(Object.values(kpis).flatMap((k) => (k.ranking || []).map((r) => r.base)))
  );

  return { kpis, bases, debugRegions };
}

export const KNOWN_BASES = BASES;

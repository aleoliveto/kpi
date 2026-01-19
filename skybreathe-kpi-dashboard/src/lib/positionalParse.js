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
 * Pick the correct title occurrence (SkyBreathe repeats titles).
 * We want the chart title in the KPI panel area, not the footer/AVG legend.
 */
function findChartTitleItem(page, regex) {
  const r = regex instanceof RegExp ? regex : new RegExp(regex, "i");

  const minY = page.height * 0.22; // below tiles
  const maxY = page.height * 0.70; // above legends

  const candidates = page.items
    .filter((it) => r.test(it.text))
    .filter((it) => it.y > minY && it.y < maxY);

  if (!candidates.length) return null;

  // choose top-most in that band (smallest y)
  candidates.sort((a, b) => a.y - b.y);
  return candidates[0];
}

/**
 * This is the critical fix:
 * define a rectangle that covers ONLY the chart panel (left or right column),
 * never full-width.
 */
function chartRectFromTitle(page, titleItem, orderedTitles) {
  const margin = 10;

  // Fallback: if orderedTitles is missing, default to 2 columns using x
  if (!orderedTitles || !orderedTitles.length) {
    const cols = page.pageNumber === 1 ? 4 : 2;
    const colW = page.width / cols;
    const idx = Math.max(0, Math.min(cols - 1, Math.floor(titleItem.x / colW)));

    const x1 = idx * colW + margin;
    const x2 = (idx + 1) * colW - margin;
    const y1 = titleItem.y + 8;
   const y2 = Math.min(page.height - margin, titleItem.y + 560);

    return { x1, y1, x2, y2 };
  }

  const cols = orderedTitles.length;
  const idx = orderedTitles.indexOf(titleItem);

  if (idx < 0) return null;

  const colW = page.width / cols;
  const x1 = idx * colW + margin;
  const x2 = (idx + 1) * colW - margin;
  const y1 = titleItem.y + 8;
  const y2 = Math.min(page.height - margin, titleItem.y + 560);


  return { x1, y1, x2, y2 };
}

/**
 * Extract ranking from a chart panel:
 * - bases: left side (known base codes only)
 * - values: right side (must be NN%)
 *
 * IMPORTANT:
 * - no decimal values (0.25 etc) because those are axis scale ticks for WA charts
 * - trim top/bottom modestly so we don't drop the bars
 */
function extractRankingFromRegion(page, rect, mode, key) {
 const rectW = rect.x2 - rect.x1;

// default
let leftBandMaxX = rect.x1 + rectW * 0.60;
let rightBandMinX = rect.x1 + rectW * 0.48;


// OETD_WA panel needs wider capture: bases shift right, values shift left
if (key === "OETD_WA") {
  leftBandMaxX = rect.x1 + rectW * 0.66;
  rightBandMinX = rect.x1 + rectW * 0.42;
}




const inner = {
  x1: rect.x1,
  x2: rect.x2,
  y1: rect.y1 + 10,
  y2: rect.y2 - 2,
};



  const regionItems = page.items.filter((it) => withinRect(it, inner));

  // Bases (keep y for pairing)
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

  // Values (keep y for pairing)
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
      regionItems.filter((it) => it.x >= rightBandMinX && (isKgText(it.text) || /^\d{2,5}$/.test(it.text)))
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

  // If we didn't get all rows, try again with a relaxed y tolerance
if (ranking.length < 30 && bases.length === 30 && valueItems.length >= 30) {
  const used2 = new Array(valueItems.length).fill(false);
  const ranking2 = [];
  maxDY = 24;

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
 * Target near title (FY26 Target X%)
 */
function extractTargetNearTitle(page, titleItem, type) {
  const rect = {
    x1: Math.max(0, titleItem.x - 40),
    y1: titleItem.y - 10,
    x2: Math.min(page.width, titleItem.x + 260),
    y2: Math.min(page.height, titleItem.y + 60),
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
 * Network PDF parser (page 1 charts + page 2 charts)
 */
export function parseNetworkFromLayout(layout) {
  const p1 = layout.pages.find((p) => p.pageNumber === 1);
  const p2 = layout.pages.find((p) => p.pageNumber === 2);

  const kpis = {};
  const debugRegions = [];
const page1Titles = [
  findChartTitleItem(p1, /OETD\s+KPI\s+Performance/i),
  findChartTitleItem(p1, /OETD-WA\s+KPI\s+Performance/i),
  findChartTitleItem(p1, /OETA\s+KPI\s+Performance/i),
  findChartTitleItem(p1, /OETA-WA\s+KPI\s+Performance/i),
].filter(Boolean).sort((a,b) => a.x - b.x);


 function parseChart(page, key, titleRegex, mode, orderedTitles = []) {
  if (!page) return;

  const title = findChartTitleItem(page, titleRegex);
  if (!title) return;

  const rect = chartRectFromTitle(page, title, orderedTitles);
  if (!rect) return;

  const target = extractTargetNearTitle(page, title, mode);
  const { ranking, debug } = extractRankingFromRegion(page, rect, mode, key);

  debugRegions.push({ page: page.pageNumber, key, rect, debug });

  if (ranking) kpis[key] = { target, ranking };
}



  parseChart(p1, "OETD", /OETD\s+KPI\s+Performance/i, "PERCENT", page1Titles);
  parseChart(p1, "OETD_WA", /OETD[-–]?WA\s+KPI\s+Performance/i, "PERCENT", page1Titles);
  parseChart(p1, "OETA", /OETA\s+KPI\s+Performance/i, "PERCENT", page1Titles);
  parseChart(
  p1,
  "OETA_WA",
  /(OETA[-–]?WA\s+KPI\s+Performance|EZY\s+OETA\s+without\s+APU\s+applied\s*\[AVG\])/i,
  "PERCENT",
  page1Titles
);



  parseChart(p2, "FLAP3", /Flap\s+3/i, "PERCENT");
  parseChart(p2, "DISC_FUEL", /Discretionary\s+Fuel/i, "KG", []);


  const bases = Array.from(
    new Set(Object.values(kpis).flatMap((k) => (k.ranking || []).map((r) => r.base)))
  );

  return { kpis, bases, debugRegions };
}

/**
 * Base PDF parser (latest = right-most label)
 */
export function parseBaseFromLayout(layout) {
  const p1 = layout.pages.find((p) => p.pageNumber === 1);
  const p2 = layout.pages.find((p) => p.pageNumber === 2);

  const kpis = {};
  const debugRegions = [];

  function parseTrend(page, key, titleRegex, mode) {
    if (!page) return;

    const title = findChartTitleItem(page, titleRegex);
    if (!title) return;

    const rect = {
      x1: Math.max(0, title.x - 40),
      x2: page.width - 20,
      y1: title.y + 10,
      y2: Math.min(page.height, title.y + 320),
    };

    const regionItems = page.items.filter((it) => withinRect(it, rect));

    let candidates = [];
    if (mode === "PERCENT") {
      candidates = regionItems
        .filter((it) => isPercentText(it.text) && !isAxisPercentTick(it.text))
        .map((it) => ({ x: it.x, y: it.y, v: toInt(it.text) }))
        .filter((x) => x.v != null);
    } else {
      candidates = regionItems
        .filter((it) => isKgText(it.text) || /^\d{2,5}$/.test(it.text))
        .map((it) => ({ x: it.x, y: it.y, v: cleanFuelNumber(toInt(it.text)) }))
        .filter((x) => x.v != null);
    }

    candidates.sort((a, b) => b.x - a.x);
    const latest = candidates.length ? candidates[0].v : null;

    debugRegions.push({ page: page.pageNumber, key, rect, points: candidates.length });

    if (latest != null) {
      kpis[key] = { latest };
    }
  }

  const anyText = [...(p1?.items || []), ...(p2?.items || [])].map((i) => i.text).join(" ");
  const m = /\bEZY\s+([A-Z]{3})\b/i.exec(anyText);
  const detectedBase = m ? m[1].toUpperCase() : null;

  parseTrend(p1, "OETD", /\bEZY\s+[A-Z]{3}\s+OETD\s+KPI\b/i, "PERCENT");
  parseTrend(p1, "OETA", /\bEZY\s+[A-Z]{3}\s+OETA\s+KPI\b/i, "PERCENT");
  parseTrend(p1, "FLAP3", /\bEZY\s+[A-Z]{3}\s+Flap\s+3\s+KPI\b/i, "PERCENT");
  parseTrend(p1, "DISC_FUEL", /\bEZY\s+[A-Z]{3}\s+Discretionary\s+Fuel\s+KPI\b/i, "KG");

  parseTrend(p2, "OETA_WA", /\bEZY\s+[A-Z]{3}\s+OETA-WA\s+KPI\b/i, "PERCENT");
  parseTrend(p2, "OETD_WA", /\bEZY\s+[A-Z]{3}\s+OETD-WA\s+KPI\b/i, "PERCENT");

  return { detectedBase, kpis, debugRegions };
}

export const KNOWN_BASES = BASES;

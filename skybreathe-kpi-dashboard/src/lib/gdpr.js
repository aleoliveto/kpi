export function buildPseudonymMapFromRanking(ranking, selectedBase) {
  const sel = String(selectedBase || "").toUpperCase();
  const map = new Map();

  let n = 1;
  for (const r of ranking || []) {
    const b = String(r?.base || "").toUpperCase();
    if (!b) continue;
    if (b === sel) continue;
    if (!map.has(b)) map.set(b, `EZY${n++}`);
  }

  if (sel) map.set(sel, sel);
  return map;
}

export function maskRanking(ranking, map, selectedBase) {
  const sel = String(selectedBase || "").toUpperCase();
  return (ranking || []).map((r) => {
    const b = String(r?.base || "").toUpperCase();
    return {
      ...r,
      displayBase: b === sel ? sel : (map.get(b) || "EZY"),
    };
  });
}

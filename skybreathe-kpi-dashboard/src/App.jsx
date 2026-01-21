// App.jsx
import { useMemo, useRef, useState, useEffect } from "react";
import html2canvas from "html2canvas";
import "./App.css";
import { extractPdfLayout, renderPdfPageToCanvas } from "./lib/pdfPos";
import { KNOWN_BASES, parseNetworkFromLayout } from "./lib/positionalParse";
import { buildPseudonymMapFromRanking, maskRanking } from "./lib/gdpr";

const KPI_LIST = [
  { key: "OETD", label: "OETD", mode: "PERCENT" },
  { key: "OETD_WA", label: "OETD-WA", mode: "PERCENT" },
  { key: "OETA", label: "OETA", mode: "PERCENT" },
  { key: "OETA_WA", label: "OETA-WA", mode: "PERCENT" },
  { key: "FLAP3", label: "Flap 3", mode: "PERCENT" },
  { key: "DISC_FUEL", label: "Discretionary Fuel", mode: "KG" },
];

const PAGE1_TILES = ["OETD", "OETD_WA", "OETA", "OETA_WA"];

export default function App() {
  const [networkFile, setNetworkFile] = useState(null);
  const [selectedBase, setSelectedBase] = useState("SEN");
  const [activeKpi, setActiveKpi] = useState("OETD");
  const [hideOtherBases, setHideOtherBases] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [networkData, setNetworkData] = useState(null);
  const [netDebug, setNetDebug] = useState(null);

  // Export refs (preserved)
  const exportRef = useRef(null); // full export block
  const exportRefRankingOnly = useRef(null); // active KPI chart export block

  // Per-panel export refs
  const panelRefs = useRef(new Map());
  const panelsBlockRef = useRef(null);

  const networkTarget = networkData?.kpis?.[activeKpi]?.target ?? null;
  const networkAvg = networkData?.kpis?.[activeKpi]?.networkAvg ?? null;

  const pseudonymMap = useMemo(() => {
    const raw = networkData?.kpis?.[activeKpi]?.ranking || [];
    if (!raw.length) return new Map();
    return buildPseudonymMapFromRanking(raw, selectedBase);
  }, [networkData, activeKpi, selectedBase]);

  const ranking = useMemo(() => {
    const raw = networkData?.kpis?.[activeKpi]?.ranking || [];
    return hideOtherBases ? maskRanking(raw, pseudonymMap, selectedBase) : raw;
  }, [networkData, activeKpi, hideOtherBases, pseudonymMap, selectedBase]);

  // Ensure active KPI stays valid if PDF lacks some KPIs
  useEffect(() => {
    if (!networkData?.kpis) return;
    if (!networkData.kpis[activeKpi]) {
      const fallback = Object.keys(networkData.kpis)[0];
      if (fallback) setActiveKpi(fallback);
    }
  }, [networkData, activeKpi]);

  async function onProcessNetworkOnly() {
    setErr("");
    if (!networkFile) {
      setErr("Please upload the Network PDF.");
      return;
    }
    setLoading(true);
    try {
      const netLayout = await extractPdfLayout(networkFile);
      const netParsed = parseNetworkFromLayout(netLayout);
      setNetworkData(netParsed);
      setNetDebug({ layout: netLayout, regions: netParsed.debugRegions });

      if (!Object.keys(netParsed.kpis || {}).length) {
        setErr(
          "Network KPIs not detected. Turn on Debug and check which regions are being found."
        );
      }

      // Guardrail
      for (const k of Object.keys(netParsed.kpis || {})) {
        const rows = netParsed.kpis[k]?.ranking?.length ?? 0;
        if (rows && rows !== 30) {
          setErr(
            `Parser warning: ${k} has ${rows}/30 rows. This is a parser bug (x-bands/rect/title), not UI.`
          );
          break;
        }
      }
    } catch (e) {
      setErr(e?.message || "Failed to parse Network PDF.");
      setNetworkData(null);
      setNetDebug(null);
    } finally {
      setLoading(false);
    }
  }

  async function exportNewsletterImages() {
    setErr("");
    if (!networkData) {
      setErr("Process the Network PDF first.");
      return;
    }
    try {
      if (exportRef.current) {
        await exportDomToPng(
          exportRef.current,
          `SkyBreathe_${activeKpi}_block.png`
        );
      }
      if (exportRefRankingOnly.current) {
        await exportDomToPng(
          exportRefRankingOnly.current,
          `SkyBreathe_${activeKpi}_chart.png`
        );
      }
    } catch (e) {
      setErr(e?.message || "Export failed.");
    }
  }

  async function exportActivePanel() {
    setErr("");
    const node = panelRefs.current.get(activeKpi);
    if (!node) {
      setErr("Active KPI panel not available to export.");
      return;
    }
    try {
      await exportDomToPng(node, `SkyBreathe_${activeKpi}_panel.png`);
    } catch (e) {
      setErr(e?.message || "Export failed.");
    }
  }

  async function exportAllPanelsOnly() {
    setErr("");
    if (!panelsBlockRef.current) {
      setErr("Panels block not available to export.");
      return;
    }
    try {
      await exportDomToPng(panelsBlockRef.current, `SkyBreathe_all_panels.png`);
    } catch (e) {
      setErr(e?.message || "Export failed.");
    }
  }

  const page1Kpis = PAGE1_TILES.map((k) => ({
    key: k,
    label: activeKpiLabel(k),
    target: networkData?.kpis?.[k]?.target ?? null,
    value: networkData?.kpis?.[k]?.networkAvg ?? null,
    mode: "PERCENT",
  }));

  return (
    <div className="sb-shell">
      <aside className="sb-nav">
        <div className="sb-nav-logo">SB</div>
        <div className="sb-nav-items">
          <div className="sb-nav-item active">
            <div className="sb-dot" />
            <span>KPI Reports</span>
          </div>
          <div className="sb-nav-item">
            <div className="sb-dot muted" />
            <span>Trends</span>
          </div>
          <div className="sb-nav-item">
            <div className="sb-dot muted" />
            <span>Fuel</span>
          </div>
        </div>
      </aside>

      <main className="sb-main">
        <div className="sb-topbar">
          <div className="sb-topbar-inner">
            <div className="sb-filters">
              <div className="sb-filter">
                <div className="sb-filter-label">Base</div>
                <select
                  className="sb-select"
                  value={selectedBase}
                  onChange={(e) => setSelectedBase(e.target.value)}
                >
                  {KNOWN_BASES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sb-filter">
                <div className="sb-filter-label">Period</div>
                <select className="sb-select" value="Monthly" readOnly>
                  <option>Monthly</option>
                </select>
              </div>

              <div className="sb-filter">
                <div className="sb-filter-label">Year</div>
                <select className="sb-select" value="FY26" readOnly>
                  <option>FY26</option>
                </select>
              </div>

              <div className="sb-filter">
                <div className="sb-filter-label">Month</div>
                <select className="sb-select" value="Latest" readOnly>
                  <option>Latest</option>
                </select>
              </div>

              <div className="sb-filter sb-filter-pill">
                <button className="sb-pill" type="button">
                  + Add filters
                </button>
              </div>

              <div className="sb-toggles">
                <label className="sb-toggle">
                  <input
                    type="checkbox"
                    checked={hideOtherBases}
                    onChange={(e) => setHideOtherBases(e.target.checked)}
                  />
                  <span>Hide other bases</span>
                </label>

                <label className="sb-toggle">
                  <input
                    type="checkbox"
                    checked={debugMode}
                    onChange={(e) => setDebugMode(e.target.checked)}
                  />
                  <span>Debug</span>
                </label>
              </div>
            </div>

            <div className="sb-actions">
              <label className="sb-file">
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) =>
                    setNetworkFile(e.target.files?.[0] || null)
                  }
                />
                <span className="sb-file-btn">Choose file</span>
                <span className="sb-file-name">
                  {networkFile ? networkFile.name : "No file"}
                </span>
              </label>

              <button
                className="sb-btn sb-btn-primary"
                onClick={onProcessNetworkOnly}
                disabled={loading}
              >
                {loading ? "Processing..." : "Process PDF"}
              </button>

              <button
                className="sb-btn"
                onClick={exportNewsletterImages}
                disabled={!networkData}
                title="Exports full block + active chart"
              >
                Export block
              </button>

              <button
                className="sb-btn"
                onClick={exportActivePanel}
                disabled={!networkData}
                title="Exports active KPI panel"
              >
                Export panel
              </button>

              <button
                className="sb-btn"
                onClick={exportAllPanelsOnly}
                disabled={!networkData}
                title="Exports all KPI panels as one image"
              >
                Export all panels
              </button>
            </div>
          </div>

          {err ? <div className="sb-error">{err}</div> : null}
        </div>

        <div className="sb-scroll">
          <div className="sb-content">
            <div className="sb-title-row">
              <div>
                <div className="sb-title">Base Captain KPI Reports</div>
                <div className="sb-subtitle">
                  Client-side PDF positional parsing (no OCR). Network PDF only.
                </div>
              </div>

              <div className="sb-mini-metrics">
                <div className="sb-mini">
                  <div className="sb-mini-label">Active KPI</div>
                  <div className="sb-mini-value">{activeKpiLabel(activeKpi)}</div>
                </div>
                <div className="sb-mini">
                  <div className="sb-mini-label">Target</div>
                  <div className="sb-mini-value">
                    {networkTarget != null ? formatKpi(activeKpi, networkTarget) : "—"}
                  </div>
                </div>
                <div className="sb-mini">
                  <div className="sb-mini-label">Network avg</div>
                  <div className="sb-mini-value">
                    {networkAvg != null ? formatKpi(activeKpi, networkAvg) : "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Export-ready wrapper (preserved) */}
            <div ref={exportRef} className="sb-export-surface">
              {/* KPI tiles (page 1 KPIs simultaneously) */}
              <div className="sb-kpi-tiles">
                {page1Kpis.map((t) => (
                  <KpiTile
                    key={t.key}
                    kpiKey={t.key}
                    label={t.label}
                    target={t.target}
                    value={t.value}
                    onClick={() => setActiveKpi(t.key)}
                    active={activeKpi === t.key}
                  />
                ))}
              </div>

              {/* Tabs (keep KPI selection, styled compact) */}
              <div className="sb-tabs">
                {KPI_LIST.map((k) => (
                  <button
                    key={k.key}
                    className={`sb-tab ${activeKpi === k.key ? "active" : ""}`}
                    onClick={() => setActiveKpi(k.key)}
                    disabled={!networkData}
                    title={k.label}
                  >
                    {k.label}
                  </button>
                ))}
              </div>

              {/* KPI panels grid like screenshot */}
              <div ref={panelsBlockRef} className="sb-panels">
                {PAGE1_TILES.map((kpiKey) => {
                  const kData = networkData?.kpis?.[kpiKey];
                  const itemsRaw = kData?.ranking || [];
                  const items = hideOtherBases
                    ? maskRanking(itemsRaw, buildPseudonymMapFromRanking(itemsRaw, selectedBase), selectedBase)
                    : itemsRaw;

                  return (
                    <div
                      key={kpiKey}
                      className={`sb-panel ${activeKpi === kpiKey ? "active" : ""}`}
                      ref={(node) => {
                        if (!node) return;
                        panelRefs.current.set(kpiKey, node);
                      }}
                      onClick={() => setActiveKpi(kpiKey)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") setActiveKpi(kpiKey);
                      }}
                    >
                      <div className="sb-panel-top">
                        <div className="sb-panel-top-title">{activeKpiLabel(kpiKey)} KPI Performance</div>
                        <div className="sb-panel-icons">
                          <span className="sb-icon" />
                          <span className="sb-icon" />
                          <span className="sb-icon" />
                          <span className="sb-icon" />
                          <span className="sb-icon" />
                        </div>
                      </div>

                      <div className="sb-panel-target">
                        FY26 Target {kData?.target != null ? formatKpi(kpiKey, kData.target) : "—"}
                      </div>

                      <div className="sb-panel-chart">
                        <RankingChart
                          items={items}
                          kpiKey={kpiKey}
                          selectedBase={selectedBase}
                          target={kData?.target ?? null}
                        />
                      </div>

                      <div className="sb-panel-foot">
                        <span className="sb-legend-dot" />
                        <span className="sb-legend-text">
                          {panelLegend(kpiKey)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Active KPI chart export block (preserved ref) */}
              <div className="sb-active-chart-wrap">
                <div className="sb-active-chart-head">
                  <div className="sb-active-chart-title">
                    Active chart export: <span className="sb-accent">{activeKpiLabel(activeKpi)}</span>
                  </div>
                  <div className="sb-active-chart-meta">
                    Rows: <strong>{ranking.length}</strong> / Raw:{" "}
                    <strong>{networkData?.kpis?.[activeKpi]?.ranking?.length ?? 0}</strong>
                  </div>
                </div>

                <div className="sb-active-chart" ref={exportRefRankingOnly}>
                  <RankingChart
                    items={ranking}
                    kpiKey={activeKpi}
                    selectedBase={selectedBase}
                    target={networkData?.kpis?.[activeKpi]?.target ?? null}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Debug drawer (collapsible bottom panel) */}
        <div className={`sb-debug-drawer ${debugMode ? "open" : ""}`}>
          <div className="sb-debug-head">
            <div className="sb-debug-title">Debug overlay</div>
            <div className="sb-debug-hint">
              Render PDF pages with detected regions overlaid (red boxes).
            </div>
          </div>

          <div className="sb-debug-body">
            <DebugCanvas
              file={networkFile}
              title="Network PDF"
              regions={netDebug?.regions || []}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function panelLegend(key) {
  if (key === "OETD_WA") return "EZY OETD-WA Applied [AVG]";
  if (key === "OETA_WA") return "EZY OETA without APU applied [AVG]";
  return `${activeKpiLabel(key)} KPI Performance (AVG)`;
}

function activeKpiLabel(key) {
  if (key === "DISC_FUEL") return "Discretionary Fuel";
  if (key === "FLAP3") return "Flap 3";
  return String(key || "").replace("_", "-");
}

function KpiTile({ kpiKey, label, target, value, onClick, active }) {
  const good =
    value != null && target != null
      ? isGood(kpiKey, value, target)
      : value != null;

  return (
    <button
      type="button"
      className={`sb-tile ${active ? "active" : ""}`}
      onClick={onClick}
      title={`Open ${label}`}
    >
      <div className="sb-tile-top">
        <div className="sb-tile-target">
          FY26 Target {target != null ? formatKpi(kpiKey, target) : "—"}
        </div>
      </div>
      <div className="sb-tile-label">{label}</div>
      <div className={`sb-tile-value ${value == null ? "" : good ? "good" : "bad"}`}>
        {value != null ? formatKpi(kpiKey, value) : "—"}
      </div>
    </button>
  );
}

function RankingChart({ items, kpiKey, selectedBase, target }) {
  const sorted = [...(items || [])]
    .filter((i) => i && i.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const max = Math.max(1, ...sorted.map((i) => i.value || 0));
  const ticks = kpiKey === "DISC_FUEL" ? [] : [0, 20, 40, 60, 80, 100];

  return (
    <div className="sb-chart">
      {/* axis baseline + ticks */}
      {kpiKey !== "DISC_FUEL" ? (
        <div className="sb-axis">
          {ticks.map((t) => (
            <div key={t} className="sb-tick" style={{ left: `${t}%` }}>
              <div className="sb-tick-line" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="sb-bars">
        {sorted.map((i) => {
          const value = i.value ?? 0;
          const pct = (value / max) * 100;
          const isSelected =
            String(i.base || "").toUpperCase() ===
            String(selectedBase || "").toUpperCase();

          const good = target != null ? isGood(kpiKey, value, target) : true;

          return (
            <div
              key={`${i.base}-${i.value}`}
              className={`sb-bar-row ${isSelected ? "selected" : ""}`}
            >
              <div className="sb-bar-label">{i.displayBase ?? i.base}</div>

              <div className="sb-bar-track">
                {/* target marker */}
                {target != null && kpiKey !== "DISC_FUEL" ? (
                  <div
                    className="sb-target-line"
                    style={{ left: `${Math.max(0, Math.min(100, target))}%` }}
                    title={`Target ${formatKpi(kpiKey, target)}`}
                  />
                ) : null}

                <div
                  className={`sb-bar-fill ${good ? "good" : "bad"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="sb-bar-value">{formatKpi(kpiKey, value)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isGood(kpiKey, value, target) {
  if (kpiKey === "DISC_FUEL") return value <= target;
  return value >= target;
}

function formatKpi(kpiKey, v) {
  if (v == null) return "—";
  if (kpiKey === "DISC_FUEL") return `${Math.round(v)} kg`;
  return `${Math.round(v)}%`;
}

async function exportDomToPng(domNode, filename) {
  const canvas = await html2canvas(domNode, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
  });
  const dataUrl = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function DebugCanvas({ file, title, regions }) {
  const [img1, setImg1] = useState(null);
  const [img2, setImg2] = useState(null);
  const [meta, setMeta] = useState(null);

  async function buildPage(pageNumber) {
    if (!file) return;
    const { canvas, width, height, scale } = await renderPdfPageToCanvas(
      file,
      pageNumber,
      1.1
    );
    setMeta({ width, height, scale });

    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2;
    ctx.strokeStyle = "red";
    ctx.fillStyle = "red";
    ctx.font = "12px system-ui";

    const pageRegions = (regions || []).filter((r) => r.page === pageNumber);
    pageRegions.forEach((r) => {
      const x = r.rect.x1 * scale;
      const y = r.rect.y1 * scale;
      const w = (r.rect.x2 - r.rect.x1) * scale;
      const h = (r.rect.y2 - r.rect.y1) * scale;
      ctx.strokeRect(x, y, w, h);
      const label = `${r.key} b:${r.debug?.bases ?? "?"} v:${r.debug?.values ?? "?"}`;
      ctx.fillText(label, x + 4, y + 14);
    });

    const url = canvas.toDataURL("image/png");
    if (pageNumber === 1) setImg1(url);
    if (pageNumber === 2) setImg2(url);
  }

  return (
    <div className="sb-debug-box">
      <div className="sb-debug-title2">{title}</div>

      <div className="sb-debug-actions">
        <button className="sb-btn sb-btn-small" onClick={() => buildPage(1)} disabled={!file}>
          Render page 1 overlay
        </button>
        <button className="sb-btn sb-btn-small" onClick={() => buildPage(2)} disabled={!file}>
          Render page 2 overlay
        </button>
      </div>

      {!file ? <div className="sb-empty">Upload a PDF to render.</div> : null}

      {img1 ? (
        <>
          <div className="sb-tiny">Page 1</div>
          <img className="sb-debug-img" src={img1} alt="debug page 1" />
        </>
      ) : null}

      {img2 ? (
        <>
          <div className="sb-tiny">Page 2</div>
          <img className="sb-debug-img" src={img2} alt="debug page 2" />
        </>
      ) : null}

      {meta ? (
        <div className="sb-tiny">
          Rendered: {Math.round(meta.width)}x{Math.round(meta.height)}
        </div>
      ) : null}
    </div>
  );
}

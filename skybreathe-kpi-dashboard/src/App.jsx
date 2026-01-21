import { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import "./App.css";
import { extractPdfLayout, renderPdfPageToCanvas } from "./lib/pdfPos";
import { KNOWN_BASES, parseNetworkFromLayout } from "./lib/positionalParse";
import { buildPseudonymMapFromRanking, maskRanking } from "./lib/gdpr";

const KPI_LIST = [
  { key: "OETD", label: "OETD" },
  { key: "OETA", label: "OETA" },
  { key: "OETD_WA", label: "OETD-WA" },
  { key: "OETA_WA", label: "OETA-WA" },
  { key: "FLAP3", label: "Flap 3" },
  { key: "DISC_FUEL", label: "Discretionary Fuel" },
];

export default function App() {
  const [networkFile, setNetworkFile] = useState(null);

  const [selectedBase, setSelectedBase] = useState("SEN");
  const [activeKpi, setActiveKpi] = useState("OETD");
  const [hideOtherBases, setHideOtherBases] = useState(true);
  const [debugMode, setDebugMode] = useState(true);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [networkData, setNetworkData] = useState(null);
  const [netDebug, setNetDebug] = useState(null);

  const exportRef = useRef(null);
  const exportRefRankingOnly = useRef(null);

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
        setErr("Network KPIs not detected. Turn on Debug mode and check which regions are being found.");
      }

      // Guardrail
      for (const k of Object.keys(netParsed.kpis || {})) {
        const rows = netParsed.kpis[k]?.ranking?.length ?? 0;
        if (rows && rows !== 30) {
          setErr(`Parser warning: ${k} has ${rows}/30 rows. This is a parser bug (x-bands/rect/title), not UI.`);
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
      // 1) Full “newsletter block” (cards + ranking)
      if (exportRef.current) {
        await exportDomToPng(exportRef.current, `SkyBreathe_${activeKpi}_newsletter.png`);
      }

      // 2) Ranking only (useful for tight newsletter layouts)
      if (exportRefRankingOnly.current) {
        await exportDomToPng(exportRefRankingOnly.current, `SkyBreathe_${activeKpi}_ranking.png`);
      }
    } catch (e) {
      setErr(e?.message || "Export failed.");
    }
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <div className="title">SkyBreathe KPI Dashboard</div>
          <div className="subtitle">Client-side PDF positional parsing (no OCR). Network PDF only.</div>
        </div>
        <div className="brandPill">easyJet style</div>
      </header>

      <section className="card">
        <div className="grid3">
          <div>
            <label className="label">Network PDF</label>
            <input type="file" accept="application/pdf" onChange={(e) => setNetworkFile(e.target.files?.[0] || null)} />
            <FileBadge file={networkFile} />
            <div className="hint">Flight Efficiencies KPI Performance export</div>
          </div>

          <div>
            <label className="label">Selected base</label>
            <select className="input" value={selectedBase} onChange={(e) => setSelectedBase(e.target.value)}>
              {KNOWN_BASES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <div className="row">
              <label className="checkbox">
                <input type="checkbox" checked={hideOtherBases} onChange={(e) => setHideOtherBases(e.target.checked)} />
                Hide other bases (EZY1, EZY2…)
              </label>
            </div>

            <div className="row">
              <label className="checkbox">
                <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
                Debug mode (show detected regions)
              </label>
            </div>
          </div>

          <div className="actions">
            <button className="btn primary" onClick={onProcessNetworkOnly} disabled={loading}>
              {loading ? "Processing..." : "Process Network PDF"}
            </button>

            <button className="btn ghost" onClick={exportNewsletterImages} disabled={!networkData}>
              Export newsletter images
            </button>

            {err ? <div className="error">{err}</div> : null}
            <div className="hint subtle">Exports PNGs of the UI graphics (cards + ranking). Paste into Outlook.</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="tabs">
          {KPI_LIST.map((k) => (
            <button
              key={k.key}
              className={`tab ${activeKpi === k.key ? "active" : ""}`}
              onClick={() => setActiveKpi(k.key)}
              disabled={!networkData}
              title={k.label}
            >
              {k.label}
            </button>
          ))}
        </div>

        {/* Export-ready wrapper */}
        <div ref={exportRef} className="newsletterBlock">
          <div className="newsletterHeader">
            <div className="newsletterTitle">
              Network KPI snapshot: <span className="accent">{activeKpiLabel(activeKpi)}</span>
            </div>
            <div className="newsletterMeta">
              Rows: <strong>{ranking.length}</strong> / Raw:{" "}
              <strong>{networkData?.kpis?.[activeKpi]?.ranking?.length ?? 0}</strong>
            </div>
          </div>

          <div className="kpiGrid2">
            <KpiCard label="Base" value={selectedBase} />
            <KpiCard label="Target" value={networkTarget != null ? formatKpi(activeKpi, networkTarget) : "—"} />
            <KpiCard label="Network avg" value={networkAvg != null ? formatKpi(activeKpi, networkAvg) : "—"} />
            <KpiCard
              label="Gap vs target"
              value={
                networkAvg != null && networkTarget != null ? formatGap(activeKpi, networkAvg - networkTarget) : "—"
              }
              tone="muted"
            />
          </div>

          <div className="compareOne">
            <div className="panel">
              <div className="panelTitle">Network ranking (all bases)</div>
              {!networkData ? (
                <div className="empty">Upload and process a Network PDF to see results.</div>
              ) : (
                <div ref={exportRefRankingOnly}>
                  <RankingChart items={ranking} kpiKey={activeKpi} selectedBase={selectedBase} />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {debugMode ? (
        <section className="card">
          <div className="panelTitle">Debug overlay</div>
          <div className="debugGrid">
            <DebugCanvas file={networkFile} title="Network PDF" regions={netDebug?.regions || []} />
          </div>
          <div className="small">
            If a KPI is not extracted, check whether its region rectangle is appearing and whether bases/values counts
            match (must be 30).
          </div>
        </section>
      ) : null}

      <footer className="footer">
        <span>Client-side parsing. PDFs stay in your browser.</span>
      </footer>
    </div>
  );
}

function activeKpiLabel(key) {
  if (key === "DISC_FUEL") return "Discretionary Fuel";
  if (key === "FLAP3") return "Flap 3";
  return key.replace("_", "-");
}

function KpiCard({ label, value, tone }) {
  return (
    <div className={`kpiCard2 ${tone === "muted" ? "muted" : ""}`}>
      <div className="kpiLabel2">{label}</div>
      <div className="kpiValue2">{value}</div>
    </div>
  );
}

function FileBadge({ file }) {
  if (!file) return <div className="fileBadge off">No file loaded</div>;
  const mb = (file.size / (1024 * 1024)).toFixed(2);
  return (
    <div className="fileBadge on" title={file.name}>
      Loaded: <strong>{file.name}</strong> ({mb} MB)
    </div>
  );
}

function RankingChart({ items, kpiKey, selectedBase }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="bars">
      {items.map((i) => {
        const pct = (i.value / max) * 100;
        const isSelected = (i.base || "").toUpperCase() === selectedBase.toUpperCase();
        return (
          <div key={`${i.base}-${i.value}`} className={`barRow ${isSelected ? "selected" : ""}`}>
            <div className="barLabel">{i.displayBase ?? i.base}</div>
            <div className="barTrack">
              <div className="barFill" style={{ width: `${pct}%` }} />
            </div>
            <div className="barValue">{formatKpi(kpiKey, i.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

function formatKpi(kpiKey, v) {
  if (v == null) return "";
  if (kpiKey === "DISC_FUEL") return `${Math.round(v)} kg`;
  return `${Math.round(v)}%`;
}

function formatGap(kpiKey, delta) {
  if (delta == null) return "";
  if (kpiKey === "DISC_FUEL") return `${Math.round(delta)} kg`;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${Math.round(delta)}%`;
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

    const { canvas, width, height, scale } = await renderPdfPageToCanvas(file, pageNumber, 1.1);
    setMeta({ width, height, scale });

    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2;
    ctx.strokeStyle = "red";
    ctx.fillStyle = "red";
    ctx.font = "12px system-ui";

    const pageRegions = regions.filter((r) => r.page === pageNumber);
    pageRegions.forEach((r) => {
      const x = r.rect.x1 * scale;
      const y = r.rect.y1 * scale;
      const w = (r.rect.x2 - r.rect.x1) * scale;
      const h = (r.rect.y2 - r.rect.y1) * scale;
      ctx.strokeRect(x, y, w, h);
      ctx.fillText(`${r.key} b:${r.debug?.bases ?? "?"} v:${r.debug?.values ?? "?"}`, x + 4, y + 14);
    });

    const url = canvas.toDataURL("image/png");
    if (pageNumber === 1) setImg1(url);
    if (pageNumber === 2) setImg2(url);
  }

  return (
    <div className="debugBox">
      <div className="debugTitle">{title}</div>

      <div className="row" style={{ marginTop: 0 }}>
        <button className="btn smallBtn ghost" onClick={() => buildPage(1)} disabled={!file}>
          Render page 1 overlay
        </button>
        <button className="btn smallBtn ghost" onClick={() => buildPage(2)} disabled={!file}>
          Render page 2 overlay
        </button>
      </div>

      {!file ? <div className="empty">Upload a PDF to render.</div> : null}

      {img1 ? (
        <>
          <div className="tiny" style={{ marginTop: 8 }}>
            Page 1
          </div>
          <img className="debugImg" src={img1} alt="debug page 1" />
        </>
      ) : null}

      {img2 ? (
        <>
          <div className="tiny" style={{ marginTop: 8 }}>
            Page 2
          </div>
          <img className="debugImg" src={img2} alt="debug page 2" />
        </>
      ) : null}

      {meta ? (
        <div className="tiny">
          Rendered: {Math.round(meta.width)}x{Math.round(meta.height)}
        </div>
      ) : null}
    </div>
  );
}

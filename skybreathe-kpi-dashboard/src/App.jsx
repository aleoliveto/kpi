import { useMemo, useState } from "react";
import "./App.css";
import { extractPdfLayout, renderPdfPageToCanvas } from "./lib/pdfPos";
import { KNOWN_BASES, parseNetworkFromLayout, parseBaseFromLayout } from "./lib/positionalParse";
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
  const [baseFile, setBaseFile] = useState(null);

  const [selectedBase, setSelectedBase] = useState("SEN");
  const [activeKpi, setActiveKpi] = useState("OETD");
  const [hideOtherBases, setHideOtherBases] = useState(true);
  const [debugMode, setDebugMode] = useState(true);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [networkData, setNetworkData] = useState(null);
  const [baseData, setBaseData] = useState(null);
  const [netDebug, setNetDebug] = useState(null);
  const [baseDebug, setBaseDebug] = useState(null);

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


  const selectedBaseValue = baseData?.kpis?.[activeKpi]?.latest ?? null;

  async function onProcess() {
    setErr("");
    if (!networkFile || !baseFile) {
      setErr("Please upload both PDFs.");
      return;
    }

    setLoading(true);
    try {
      const netLayout = await extractPdfLayout(networkFile);
      const baseLayout = await extractPdfLayout(baseFile);

      const netParsed = parseNetworkFromLayout(netLayout);
      const baseParsed = parseBaseFromLayout(baseLayout);

      setNetworkData(netParsed);
      setBaseData(baseParsed);

      setNetDebug({ layout: netLayout, regions: netParsed.debugRegions });
      setBaseDebug({ layout: baseLayout, regions: baseParsed.debugRegions });

      if (baseParsed?.detectedBase && KNOWN_BASES.includes(baseParsed.detectedBase)) {
        setSelectedBase(baseParsed.detectedBase);
      }

      if (!Object.keys(netParsed.kpis || {}).length) {
        setErr("Network KPIs not detected. Turn on Debug mode and check which regions are being found.");
      }
    } catch (e) {
      setErr(e?.message || "Failed to parse PDFs.");
      setNetworkData(null);
      setBaseData(null);
      setNetDebug(null);
      setBaseDebug(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <div className="title">SkyBreathe KPI Dashboard</div>
          <div className="subtitle">Position-based parsing with debug overlay.</div>
        </div>
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
            <label className="label">Base PDF</label>
            <input type="file" accept="application/pdf" onChange={(e) => setBaseFile(e.target.files?.[0] || null)} />
            <FileBadge file={baseFile} />
            <div className="hint">EZY base KPI Dashboard export</div>
          </div>

          <div>
            <label className="label">Selected base</label>
            <select className="input" value={selectedBase} onChange={(e) => setSelectedBase(e.target.value)}>
              {KNOWN_BASES.map((b) => (
                <option key={b} value={b}>{b}</option>
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
        </div>

        <div className="row">
          <button className="btn" onClick={onProcess} disabled={loading}>
            {loading ? "Processing..." : "Process PDFs"}
          </button>
          {err ? <div className="error">{err}</div> : null}
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
            >
              {k.key}
            </button>
          ))}
        </div>

        <div className="compare">
          <div className="panel">
            <div className="panelTitle">Network ranking</div>
            <div className="small">
  Rows: {ranking.length} / Raw: {networkData?.kpis?.[activeKpi]?.ranking?.length ?? 0}
</div>

            {!networkData ? (
              <div className="empty">Upload and process PDFs to see results.</div>
            ) : (
              <RankingChart items={ranking} kpiKey={activeKpi} selectedBase={selectedBase} />
            )}
          </div>

          <div className="panel">
            <div className="panelTitle">Selected base</div>

<div className="kpiGrid">
  <div className="kpiCard">
    <div className="kpiLabel">Base</div>
    <div className="kpiValue">{selectedBase}</div>
  </div>

  <div className="kpiCard">
    <div className="kpiLabel">Latest</div>
    <div className="kpiValue">
      {selectedBaseValue != null ? formatKpi(activeKpi, selectedBaseValue) : "—"}
    </div>
  </div>

  <div className="kpiCard">
    <div className="kpiLabel">Target</div>
    <div className="kpiValue">
      {networkTarget != null ? formatKpi(activeKpi, networkTarget) : "—"}
    </div>
  </div>

  <div className="kpiCard">
    <div className="kpiLabel">Network avg</div>
    <div className="kpiValue">
      {networkAvg != null ? formatKpi(activeKpi, networkAvg) : "—"}
    </div>
  </div>
</div>

<div className="gapLine">
  <span>Gap vs target:</span>
  <strong>
    {selectedBaseValue != null && networkTarget != null
      ? formatGap(activeKpi, selectedBaseValue - networkTarget)
      : "—"}
  </strong>
</div>

          </div>
        </div>
      </section>

      {debugMode ? (
        <section className="card">
          <div className="panelTitle">Debug overlay</div>
          <div className="debugGrid">
            <DebugCanvas file={networkFile} title="Network PDF" regions={netDebug?.regions || []} />
            <DebugCanvas file={baseFile} title="Base PDF" regions={baseDebug?.regions || []} />
          </div>
          <div className="small">
            If a KPI is not extracted, check whether its region rectangle is appearing and whether bases/values counts match.
          </div>
        </section>
      ) : null}

      <footer className="footer">
        <span>Client-side parsing. PDFs stay in your browser.</span>
      </footer>
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

function DebugCanvas({ file, title, regions }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [meta, setMeta] = useState(null);

  async function build() {
    if (!file) return;
    const { canvas, width, height, scale } = await renderPdfPageToCanvas(file, 1, 1.1);
    setMeta({ width, height, scale });

    // draw rectangles for page 1 only (simple, fast)
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2;
    ctx.strokeStyle = "red";
    ctx.fillStyle = "red";
    ctx.font = "12px sans-serif";

    const page1Regions = regions.filter(r => r.page === 1);
    page1Regions.forEach((r) => {
      const x = r.rect.x1 * scale;
      const y = r.rect.y1 * scale;
      const w = (r.rect.x2 - r.rect.x1) * scale;
      const h = (r.rect.y2 - r.rect.y1) * scale;
      ctx.strokeRect(x, y, w, h);
      ctx.fillText(`${r.key} b:${r.debug?.bases ?? "?"} v:${r.debug?.values ?? "?"}`, x + 4, y + 14);
    });

    setImgUrl(canvas.toDataURL("image/png"));
  }

  return (
    <div className="debugBox">
      <div className="debugTitle">{title}</div>
      <button className="btn smallBtn" onClick={build} disabled={!file}>
        Render page 1 overlay
      </button>
      <button className="btn smallBtn" onClick={() => buildPage(2)} disabled={!file}>
  Render page 2 overlay
</button>

      {!file ? <div className="empty">Upload a PDF to render.</div> : null}
      {imgUrl ? <img className="debugImg" src={imgUrl} alt="debug" /> : null}
      {meta ? <div className="tiny">Rendered: {Math.round(meta.width)}x{Math.round(meta.height)}</div> : null}
    </div>
  );
}

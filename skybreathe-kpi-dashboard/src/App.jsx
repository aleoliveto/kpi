// App.jsx
import { useMemo, useRef, useState } from "react";
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
];

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

  const exportRef = useRef(null);
  const exportRefRankingOnly = useRef(null);

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
    } catch (e) {
      setErr(e?.message || "Failed to parse Network PDF.");
      setNetworkData(null);
      setNetDebug(null);
    } finally {
      setLoading(false);
    }
  }

  async function exportNewsletterImages() {
    if (!exportRef.current) return;
    const canvas = await html2canvas(exportRef.current, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
    });
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `SkyBreathe_${activeKpi}.png`;
    a.click();
  }

  return (
    <div className="sb-shell">
      <aside className="sb-nav">
        <div className="sb-nav-logo">SB</div>
        <nav>
          <div className="sb-nav-item active">KPI Reports</div>
          <div className="sb-nav-item">Trends</div>
          <div className="sb-nav-item">Fuel</div>
        </nav>
      </aside>

      <main className="sb-main">
        <div className="sb-topbar">
          <div className="filters">
            <select value={selectedBase} onChange={e => setSelectedBase(e.target.value)}>
              {KNOWN_BASES.map(b => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <label className="toggle">
              <input
                type="checkbox"
                checked={hideOtherBases}
                onChange={e => setHideOtherBases(e.target.checked)}
              />
              Hide other bases
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={debugMode}
                onChange={e => setDebugMode(e.target.checked)}
              />
              Debug
            </label>
          </div>
          <div className="actions">
            <input
              type="file"
              accept="application/pdf"
              onChange={e => setNetworkFile(e.target.files?.[0] || null)}
            />
            <button onClick={onProcessNetworkOnly} disabled={loading}>
              {loading ? "Processing…" : "Process PDF"}
            </button>
            <button onClick={exportNewsletterImages} disabled={!networkData}>
              Export
            </button>
          </div>
        </div>

        <div className="sb-content" ref={exportRef}>
          <h1 className="sb-title">Base Captain KPI Reports</h1>

          <div className="sb-kpi-tiles">
            {KPI_LIST.map(k => {
              const data = networkData?.kpis?.[k.key];
              const value = data?.networkAvg;
              const target = data?.target;
              const good = value != null && target != null && value >= target;
              return (
                <div key={k.key} className="sb-kpi-tile">
                  <div className="sb-kpi-target">
                    FY26 Target {target != null ? `${target}%` : "—"}
                  </div>
                  <div className="sb-kpi-label">{k.label}</div>
                  <div className={`sb-kpi-value ${good ? "good" : "bad"}`}>
                    {value != null ? `${Math.round(value)}%` : "—"}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="sb-tabs">
            {KPI_LIST.map(k => (
              <button
                key={k.key}
                className={activeKpi === k.key ? "active" : ""}
                onClick={() => setActiveKpi(k.key)}
                disabled={!networkData}
              >
                {k.label}
              </button>
            ))}
          </div>

          <div className="sb-ranking" ref={exportRefRankingOnly}>
            <h2>{activeKpi} KPI Performance</h2>
            <RankingChart
              items={ranking}
              target={networkData?.kpis?.[activeKpi]?.target}
              selectedBase={selectedBase}
            />
          </div>
        </div>

        {debugMode && (
          <div className="sb-debug">
            <DebugCanvas
              file={networkFile}
              title="Network PDF"
              regions={netDebug?.regions || []}
            />
          </div>
        )}

        {err && <div className="sb-error">{err}</div>}
      </main>
    </div>
  );
}

function RankingChart({ items, target, selectedBase }) {
  const max = Math.max(1, ...items.map(i => i.value || 0));
  return (
    <div className="sb-bars">
      {items.map(i => {
        const pct = (i.value / max) * 100;
        const good = target != null && i.value >= target;
        const selected = i.base === selectedBase;
        return (
          <div key={i.base} className={`sb-bar-row ${selected ? "selected" : ""}`}>
            <div className="sb-bar-label">{i.displayBase ?? i.base}</div>
            <div className="sb-bar-track">
              <div
                className={`sb-bar-fill ${good ? "good" : "bad"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="sb-bar-value">{i.value}%</div>
          </div>
        );
      })}
    </div>
  );
}

function DebugCanvas({ file, title, regions }) {
  const [img, setImg] = useState(null);

  async function render() {
    if (!file) return;
    const { canvas } = await renderPdfPageToCanvas(file, 1, 1.1);
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "red";
    regions.forEach(r => {
      ctx.strokeRect(r.rect.x1, r.rect.y1, r.rect.x2 - r.rect.x1, r.rect.y2 - r.rect.y1);
    });
    setImg(canvas.toDataURL());
  }

  return (
    <div className="sb-debug-panel">
      <h3>{title}</h3>
      <button onClick={render}>Render overlay</button>
      {img && <img src={img} alt="debug" />}
    </div>
  );
}

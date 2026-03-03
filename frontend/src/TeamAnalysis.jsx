import React, { useState, useEffect } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2";

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler
);

const TEAMS = [
  "Payments Team",
  "Orders Team",
  "Customer API Team",
  "Data Pipeline Team",
  "Auth Platform Team",
  "Reporting Team",
];

const RISK_COLORS = {
  low: { bg: "#d1fae5", text: "#065f46", dot: "#10b981" },
  medium: { bg: "#fef3c7", text: "#92400e", dot: "#f59e0b" },
  high: { bg: "#fee2e2", text: "#991b1b", dot: "#ef4444" },
  critical: { bg: "#fce7f3", text: "#831843", dot: "#ec4899" },
};

/* ── KPI Card ── */
function KpiCard({ label, value, accent }) {
  return (
    <div className="td-kpi-card">
      <span className="td-kpi-label">{label}</span>
      <span className="td-kpi-value" style={accent ? { color: accent } : {}}>
        {value}
      </span>
    </div>
  );
}

/* ── Dynamic Chart Renderer ── */
function DynamicChart({ config }) {
  if (!config) return null;
  const { chart_type, chart_title, chart_labels, chart_datasets, stacked, description } = config;

  const isHorizontal = chart_type === "horizontalBar";
  const isDoughnut = chart_type === "doughnut";

  const data = {
    labels: chart_labels,
    datasets: (chart_datasets || []).map((ds) => ({
      ...ds,
      borderWidth: chart_type === "line" ? 2 : ds.borderWidth || 1,
      fill: chart_type === "line" ? true : undefined,
      tension: chart_type === "line" ? 0.4 : undefined,
      borderRadius: (chart_type === "bar" || isHorizontal) ? 4 : undefined,
    })),
  };

  const commonOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: isDoughnut ? "right" : "top",
        labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
      },
      tooltip: { mode: "index", intersect: false },
    },
    scales: !isDoughnut ? {
      x: {
        stacked: !!stacked,
        grid: { display: false },
        ticks: { font: { size: 10 } },
      },
      y: {
        stacked: !!stacked,
        beginAtZero: true,
        grid: { color: "rgba(148,163,184,0.12)" },
        ticks: { font: { size: 10 } },
      },
    } : undefined,
  };

  if (isHorizontal) {
    commonOpts.indexAxis = "y";
  }

  return (
    <div className="td-gemini-chart-card">
      <h4 className="td-chart-card-title">{chart_title}</h4>
      {description && <p className="td-chart-card-desc">{description}</p>}
      <div className="td-chart-wrap">
        {chart_type === "line" ? (
          <Line data={data} options={commonOpts} />
        ) : isDoughnut ? (
          <Doughnut data={data} options={{ ...commonOpts, cutout: "55%" }} />
        ) : (
          <Bar data={data} options={commonOpts} />
        )}
      </div>
    </div>
  );
}

/* ── Team Dashboard ── */
function TeamDashboard({ data }) {
  const d = data;
  const risk = d.risk_level;
  const rc = risk ? RISK_COLORS[risk] || RISK_COLORS.medium : null;

  return (
    <div className="td-dashboard">
      {/* ── Header ── */}
      <div className="td-header">
        <div className="td-header-left">
          <h2 className="td-team-name">{d.team}</h2>
          {rc && (
            <span className="td-risk-badge" style={{ backgroundColor: rc.bg, color: rc.text }}>
              <span className="td-risk-dot" style={{ backgroundColor: rc.dot }} />
              {risk.charAt(0).toUpperCase() + risk.slice(1)} Risk
            </span>
          )}
        </div>
        <div className="td-mom-pill">
          <span className={`td-mom-arrow ${d.mom_delta <= 0 ? "good" : "bad"}`}>
            {d.mom_delta > 0 ? "▲" : d.mom_delta < 0 ? "▼" : "—"} {Math.abs(d.mom_pct || 0)}%
          </span>
          <span className="td-mom-label">MoM</span>
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div className="td-kpi-row">
        <KpiCard label="Total Incidents" value={d.total_incidents} />
        <KpiCard label="Critical" value={d.critical_count} accent="#ef4444" />
        <KpiCard label="SLA Compliance" value={`${d.sla_compliance_pct}%`}
          accent={d.sla_compliance_pct >= 80 ? "#10b981" : d.sla_compliance_pct >= 60 ? "#f59e0b" : "#ef4444"} />
        <KpiCard label="Avg Resolution" value={`${d.avg_resolution_hours}h`} />
      </div>

      {/* ── Gemini Charts Grid ── */}
      {d.charts?.length > 0 && (
        <div className="td-charts-grid">
          {d.charts.map((chart, i) => (
            <DynamicChart key={i} config={chart} />
          ))}
        </div>
      )}

      {/* ── AI Insight ── */}
      {(d.insight || d.recommendation) && (
        <div className="td-panel td-full-panel td-ai-panel">
          <h3 className="td-panel-title">
            <span className="td-ai-sparkle">✨</span> AI Analysis
            <span className="td-ai-badge">Gemini</span>
          </h3>
          <div className="td-ai-content">
            {d.insight && (
              <div className="td-ai-section">
                <span className="td-ai-icon">🔍</span>
                <div>
                  <p className="td-ai-label">Insight</p>
                  <p className="td-ai-text">{d.insight}</p>
                </div>
              </div>
            )}
            {d.recommendation && (
              <div className="td-ai-section">
                <span className="td-ai-icon">💡</span>
                <div>
                  <p className="td-ai-label">Recommendation</p>
                  <p className="td-ai-text">{d.recommendation}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Gemini Error ── */}
      {d.gemini_error && !d.charts?.length && (
        <div className="td-panel td-full-panel">
          <div className="td-error" style={{ padding: "20px 0" }}>
            <span className="td-error-icon">⚠️</span>
            <p>Gemini API error: {d.gemini_error}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main page ── */
export default function TeamAnalysis() {
  const [activeTeam, setActiveTeam] = useState(TEAMS[0]);
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});

  async function loadTeam(team) {
    if (results[team]) return;
    setLoading((prev) => ({ ...prev, [team]: true }));
    setErrors((prev) => ({ ...prev, [team]: null }));
    try {
      const resp = await fetch(`/api/team-analysis/${encodeURIComponent(team)}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Server error");
      setResults((prev) => ({ ...prev, [team]: data }));
    } catch (err) {
      setErrors((prev) => ({ ...prev, [team]: err.message }));
    } finally {
      setLoading((prev) => ({ ...prev, [team]: false }));
    }
  }

  useEffect(() => {
    loadTeam(activeTeam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeam]);

  return (
    <div className="td-page">
      {/* Page header */}
      <div className="td-page-header">
        <h1 className="td-page-title">Team Intelligence</h1>
        <p className="td-page-subtitle">
          AI-generated dashboards uniquely tailored to each team's incident patterns, powered by Gemini.
        </p>
      </div>

      {/* Team tab strip */}
      <div className="td-tab-strip">
        {TEAMS.map((team) => (
          <button
            key={team}
            className={`td-tab ${activeTeam === team ? "td-tab-active" : ""}`}
            onClick={() => setActiveTeam(team)}
          >
            {team.replace(" Team", "")}
            {results[team] && !loading[team] && (
              <span
                className="td-tab-dot"
                style={{
                  backgroundColor: RISK_COLORS[results[team]?.risk_level]?.dot || "#6b7280",
                }}
              />
            )}
            {loading[team] && <span className="td-tab-spinner" />}
          </button>
        ))}
      </div>

      {/* Dashboard content */}
      <div className="td-content">
        {loading[activeTeam] && (
          <div className="td-loading">
            <div className="td-spinner" />
            <p>Gemini is generating dashboard for <strong>{activeTeam}</strong>…</p>
          </div>
        )}
        {errors[activeTeam] && !loading[activeTeam] && (
          <div className="td-error">
            <span className="td-error-icon">⚠️</span>
            <p>{errors[activeTeam]}</p>
            <button className="td-retry-btn" onClick={() => { setResults(p => { const n = { ...p }; delete n[activeTeam]; return n; }); loadTeam(activeTeam); }}>
              Retry
            </button>
          </div>
        )}
        {results[activeTeam] && !loading[activeTeam] && (
          <>
            <TeamDashboard data={results[activeTeam]} />
            <button
              className="td-regenerate-btn"
              onClick={() => { setResults(p => { const n = { ...p }; delete n[activeTeam]; return n; }); loadTeam(activeTeam); }}
            >
              ↺ Regenerate Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}

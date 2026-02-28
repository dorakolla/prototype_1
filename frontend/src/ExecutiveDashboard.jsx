import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement,
    Filler,
    Tooltip,
    Legend,
} from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2";
import { useNavigate } from "react-router-dom";

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement,
    Filler,
    Tooltip,
    Legend
);

const fetchJson = (path) => fetch(path).then((r) => r.json());

/* ── Team colours for the filter dropdown ── */
const TEAM_COLORS = [
    "#6366f1", "#3b82f6", "#22c55e", "#f59e0b",
    "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
    "#f97316", "#06b6d4",
];

/* ── Chevron icon ── */
const ChevDown = () => (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6,9 12,15 18,9" />
    </svg>
);

/* ── Compute display date range from timeFilter ── */
function getDateRange(tf) {
    const end = new Date();
    const start = new Date();
    const fmt = (d) =>
        d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    if (tf === "7d") start.setDate(end.getDate() - 7);
    else if (tf === "30d") start.setDate(end.getDate() - 30);
    else if (tf === "90d") start.setDate(end.getDate() - 90);
    else if (tf === "MTD") start.setDate(1);
    else if (tf === "YTD") { start.setMonth(0); start.setDate(1); }
    else if (tf === "1Y") start.setFullYear(end.getFullYear() - 1);
    return `${fmt(start)} – ${fmt(end)}`;
}

/* ── Team filter dropdown (checkbox list) ── */
function TeamFilterDropdown({ teams, selected, onSelect }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const label = selected ? "1 Team" : "All Teams";

    return (
        <div className="pf-wrapper" ref={ref}>
            <button
                className="pf-trigger"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-label={`Filter by team: ${label}`}
            >
                {label}
                <ChevDown />
            </button>
            {open && (
                <div className="pf-menu" role="listbox" aria-label="Select team">
                    {/* All Teams */}
                    <button
                        className="pf-item pf-all-item"
                        onClick={() => { onSelect(""); setOpen(false); }}
                    >
                        <input type="checkbox" readOnly checked={!selected} className="pf-checkbox" />
                        All Teams
                    </button>
                    {/* Separator */}
                    <div className="pf-separator" />
                    {/* Application teams (one level under "Product Lines") */}
                    <div className="pf-section-label">Applications</div>
                    {teams.map((team, idx) => (
                        <button
                            key={team}
                            className="pf-item"
                            onClick={() => { onSelect(selected === team ? "" : team); setOpen(false); }}
                        >
                            <input type="checkbox" readOnly checked={selected === team} className="pf-checkbox" />
                            <span
                                className="pf-dot"
                                style={{ backgroundColor: TEAM_COLORS[idx % TEAM_COLORS.length] }}
                            />
                            {team}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function ExecutiveDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedTeam, setSelectedTeam] = useState("");
    const [selectedImpact, setSelectedImpact] = useState("");
    const [timeFilter, setTimeFilter] = useState("30d");
    const navigate = useNavigate();

    useEffect(() => {
        setLoading(true);
        const params = new URLSearchParams();
        if (selectedTeam) params.set("app_team", selectedTeam);
        if (selectedImpact) params.set("business_impact", selectedImpact);
        params.set("time_filter", timeFilter);
        const qs = params.toString();
        fetchJson(`/api/executive-summary${qs ? `?${qs}` : ""}`)
            .then(setData)
            .finally(() => setLoading(false));
    }, [selectedTeam, selectedImpact, timeFilter]);

    /* ── Monthly chart data ── */
    const mLabels = useMemo(() => data?.monthly_severity_trends?.map((m) => m.month) || [], [data]);
    const mCritical = useMemo(() => data?.monthly_severity_trends?.map((m) => m.Critical) || [], [data]);
    const mHigh = useMemo(() => data?.monthly_severity_trends?.map((m) => m.High) || [], [data]);
    const mMedium = useMemo(() => data?.monthly_severity_trends?.map((m) => m.Medium) || [], [data]);
    const mLow = useMemo(() => data?.monthly_severity_trends?.map((m) => m.Low) || [], [data]);

    /* ── Heatmap ── */
    const heatMax = useMemo(() => {
        if (!data?.severity_heatmap) return 1;
        return Math.max(
            1,
            ...data.severity_heatmap.flatMap((r) => [r.Critical, r.High, r.Medium, r.Low])
        );
    }, [data]);

    const heatColor = (val, sev) => {
        const intensity = val / heatMax;
        if (sev === "Critical") return `rgba(239,68,68,${0.15 + intensity * 0.85})`;
        if (sev === "High") return `rgba(249,115,22,${0.15 + intensity * 0.85})`;
        if (sev === "Medium") return `rgba(245,158,11,${0.12 + intensity * 0.7})`;
        return `rgba(34,197,94,${0.1 + intensity * 0.6})`;
    };

    if (loading) {
        return (
            <div className="saas-dash">
                <div className="saas-loading" role="status" aria-live="polite">Loading executive summary…</div>
            </div>
        );
    }
    if (!data) {
        return (
            <div className="saas-dash">
                <div className="saas-loading">Unable to load data.</div>
            </div>
        );
    }

    const mom = data.mom_change;
    const sevDist = data.severity_distribution;
    const slaAvg = data.sla_compliance?.length
        ? Math.round(data.sla_compliance.reduce((a, c) => a + c.compliance_pct, 0) / data.sla_compliance.length)
        : 100;

    return (
        <div className="saas-dash">
            {/* ══════════════════════════════════════════
                TOP CHROME  (matches reference image)
            ══════════════════════════════════════════ */}
            <div className="saas-top-chrome">

                {/* ── KPI strip ── */}
                <div className="saas-kpi-strip">
                    {/* Left card */}
                    <div className="saas-kpi-block">
                        <div className="saas-kpi-label">Total Incidents</div>
                        <div className="saas-kpi-value">{data.total_incidents.toLocaleString()}</div>
                        <div className="saas-kpi-sub">
                            <span>
                                {mom?.previous_count ?? "—"} same period last cycle
                            </span>
                            {mom && (
                                <span
                                    className={`saas-kpi-badge ${mom.delta <= 0 ? "good" : "bad"}`}
                                    aria-label={`${mom.delta > 0 ? "Increased" : "Decreased"} ${Math.abs(mom.percent || 0)} percent`}
                                >
                                    <span aria-hidden="true">{mom.delta > 0 ? "▲" : "▼"} {Math.abs(mom.percent || 0)}%</span>
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Right card */}
                    <div className="saas-kpi-block saas-kpi-block-right">
                        <div className="saas-kpi-label">Monthly Active Incidents</div>
                        <div className="saas-kpi-value">{mom?.last_count ?? data.total_incidents}</div>
                        <div className="saas-kpi-sub">
                            <span>{slaAvg}% SLA compliance</span>
                        </div>
                    </div>
                </div>

                {/* ── Filter bar ── */}
                <div className="saas-filter-bar">
                    {/* Hierarchy breadcrumb */}
                    <span className="saas-breadcrumb">
                        Executive Dashboard
                        {selectedTeam && <> <span className="saas-bc-sep">›</span> {selectedTeam}</>}
                    </span>

                    <div className="saas-filter-right">
                        {/* Team / Application dropdown */}
                        <TeamFilterDropdown
                            teams={data.available_teams || []}
                            selected={selectedTeam}
                            onSelect={setSelectedTeam}
                        />

                        {/* Time period buttons */}
                        <div className="saas-time-group">
                            {["7d", "30d", "90d", "MTD", "YTD", "1Y"].map((tf) => (
                                <button
                                    key={tf}
                                    className={`saas-time-btn ${timeFilter === tf ? "active" : ""}`}
                                    onClick={() => setTimeFilter(tf)}
                                    aria-pressed={timeFilter === tf}
                                >
                                    {tf}
                                </button>
                            ))}
                        </div>

                        {/* Date range label */}
                        <span className="saas-date-range">{getDateRange(timeFilter)}</span>
                    </div>
                </div>
            </div>

            {/* ── Main bar chart (monthly severity trend) ── */}
            <div className="saas-chart-panel" role="img" aria-label="Monthly incident severity trend — stacked bar chart by month">
                <Bar
                    data={{
                        labels: mLabels,
                        datasets: [
                            { label: "Critical", data: mCritical, backgroundColor: "#ef4444", borderRadius: 2 },
                            { label: "High", data: mHigh, backgroundColor: "#f97316", borderRadius: 2 },
                            { label: "Medium", data: mMedium, backgroundColor: "#f59e0b", borderRadius: 2 },
                            { label: "Low", data: mLow, backgroundColor: "#60a5fa", borderRadius: 2 },
                        ],
                    }}
                    options={{
                        responsive: true,
                        plugins: {
                            legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
                        },
                        scales: {
                            x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
                            y: { stacked: true, grid: { color: "rgba(148,163,184,0.15)" }, beginAtZero: true },
                        },
                    }}
                />
            </div>

            {/* ══════════════════════════════════════════
                BODY — remaining executive sections
            ══════════════════════════════════════════ */}
            <div className="saas-body">

                {/* ── Key Insights ── */}
                {data.key_insights?.length > 0 && (
                    <section className="exec-section">
                        <h2 className="exec-section-title">Key Insights</h2>
                        <div className="insights-titles">
                            {data.key_insights.map((ins, i) => (
                                <div key={i} className={`insight-title-item insight-title-${ins.sentiment}`}>
                                    <span className={`insight-dot insight-dot-${ins.sentiment}`} aria-hidden="true" />
                                    <div className="insight-title-content">
                                        <span className="visually-hidden">{ins.sentiment}: </span>
                                        <span className="insight-title-text">{ins.title}</span>
                                        <span className="insight-subtitle-text">{ins.subtitle}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* ── Detailed KPIs ── */}
                <section className="exec-kpi-row-compact">
                    <div className="exec-kpi-card-saas">
                        <span className="kpi-saas-label">Total Incidents</span>
                        <span className="kpi-saas-value">{data.total_incidents}</span>
                        <div className="kpi-saas-compare">
                            <span
                                className={`kpi-badge ${mom?.delta >= 0 ? "badge-bad" : "badge-good"}`}
                                aria-label={`${mom?.delta >= 0 ? "Increased" : "Decreased"} ${Math.abs(mom?.percent || 0)} percent vs previous ${timeFilter}`}
                            >
                                <span aria-hidden="true">{mom?.delta >= 0 ? "↑" : "↓"} {Math.abs(mom?.percent || 0)}%</span>
                            </span>
                            <span className="kpi-compare-text">vs previous {timeFilter}</span>
                        </div>
                    </div>
                    <div className="exec-kpi-card-saas">
                        <span className="kpi-saas-label">Critical Incidents</span>
                        <span className="kpi-saas-value">{sevDist?.Critical || 0}</span>
                        <div className="kpi-saas-compare">
                            <span className="kpi-badge badge-neutral">
                                {data.total_incidents
                                    ? Math.round(((sevDist?.Critical || 0) / data.total_incidents) * 100)
                                    : 0}%
                            </span>
                            <span className="kpi-compare-text">of total</span>
                        </div>
                    </div>
                    <div className="exec-kpi-card-saas">
                        <span className="kpi-saas-label">Month-over-Month</span>
                        <span className="kpi-saas-value">
                            {mom ? `${mom.delta >= 0 ? "+" : ""}${mom.delta}` : "—"}
                        </span>
                        <div className="kpi-saas-compare">
                            <span className={`kpi-badge ${mom?.delta >= 0 ? "badge-bad" : "badge-good"}`}>
                                {mom?.delta >= 0 ? "Action Required" : "On Track"}
                            </span>
                            <span className="kpi-compare-text">net change</span>
                        </div>
                    </div>
                    <div className="exec-kpi-card-saas">
                        <span className="kpi-saas-label">SLA Compliance</span>
                        <span className="kpi-saas-value">{slaAvg}%</span>
                        <div className="kpi-saas-compare">
                            <span className="kpi-badge badge-good">Target 95%</span>
                            <span className="kpi-compare-text">overall</span>
                        </div>
                    </div>
                </section>

                {/* ── Business Impact Filter ── */}
                <section className="exec-section">
                    <h2 className="exec-section-title">Business Impact</h2>
                    <div className="impact-filter-bar">
                        {(data.available_impacts || []).slice().reverse().map((level) => {
                            const count = data.impact_distribution?.[level] || 0;
                            const isActive = selectedImpact === level;
                            return (
                                <button
                                    key={level}
                                    className={`impact-filter-btn impact-lvl-${level.toLowerCase()} ${isActive ? "active" : ""}`}
                                    onClick={() => setSelectedImpact(isActive ? "" : level)}
                                    aria-pressed={isActive}
                                >
                                    <span className="impact-btn-level">{level}</span>
                                    <span className="impact-btn-count">{count}</span>
                                </button>
                            );
                        })}
                        {selectedImpact && (
                            <button className="impact-clear-btn" onClick={() => setSelectedImpact("")}>
                                ✕ Clear
                            </button>
                        )}
                    </div>
                    {selectedImpact && (
                        <p className="impact-active-hint">
                            Showing only <strong>{selectedImpact}</strong> business impact incidents.
                        </p>
                    )}
                </section>

                {/* ── Top Risk Areas ── */}
                <section className="exec-section">
                    <h2 className="exec-section-title">Top Risk Areas</h2>
                    <div className="exec-risk-cards">
                        {data.top_risk_areas.map((risk, i) => (
                            <div
                                key={risk.type}
                                className={`exec-risk-card priority-border-${i === 0 ? "critical" : i === 1 ? "high" : "medium"}`}
                            >
                                <div className="exec-risk-top">
                                    <span className="exec-risk-rank">#{i + 1}</span>
                                    <span className="exec-risk-name">{risk.type}</span>
                                    <span className="exec-risk-ratio">{risk.risk_ratio}% high+crit</span>
                                </div>
                                <p className="exec-risk-desc">{risk.description}</p>
                                <div className="exec-risk-stats">
                                    <span><span aria-hidden="true">🔴</span> {risk.critical} Critical</span>
                                    <span><span aria-hidden="true">🟠</span> {risk.high} High</span>
                                    <span>Total: {risk.total}</span>
                                </div>
                                <div className="exec-risk-action">
                                    <strong>→</strong> {risk.top_action}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ── Team Accountability ── */}
                <section className="exec-section">
                    <h2 className="exec-section-title">Team Accountability</h2>
                    <div className="exec-table-wrap">
                        <table className="exec-table" aria-label="Team accountability summary">
                            <thead>
                                <tr>
                                    <th scope="col">Team</th>
                                    <th scope="col">Total</th>
                                    <th scope="col">Share</th>
                                    <th scope="col">This Month</th>
                                    <th scope="col">Last Month</th>
                                    <th scope="col">MoM Trend</th>
                                    <th scope="col">Critical</th>
                                    <th scope="col">High</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.team_accountability.map((t) => (
                                    <tr key={t.team}>
                                        <td className="team-name-cell">{t.team}</td>
                                        <td>{t.total}</td>
                                        <td>{t.share_percent}%</td>
                                        <td>{t.this_month}</td>
                                        <td>{t.last_month}</td>
                                        <td>
                                            <span
                                                className={`trend-pill trend-${t.mom_trend}`}
                                                aria-label={`${t.mom_trend === "up" ? "Increased" : t.mom_trend === "down" ? "Decreased" : "No change"} by ${Math.abs(t.mom_delta)}`}
                                            >
                                                <span aria-hidden="true">
                                                    {t.mom_trend === "up" ? "▲" : t.mom_trend === "down" ? "▼" : "—"}{" "}
                                                    {t.mom_delta >= 0 ? "+" : ""}{t.mom_delta}
                                                </span>
                                            </span>
                                        </td>
                                        <td className="sev-cell-critical">{t.critical}</td>
                                        <td className="sev-cell-high">{t.high}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* ── Risk Heatmap ── */}
                <section className="exec-section">
                    <h2 className="exec-section-title">Risk Heatmap — Severity × Type</h2>
                    <div className="exec-heatmap">
                        <div className="heatmap-corner" />
                        {["Critical", "High", "Medium", "Low"].map((s) => (
                            <div key={s} className={`heatmap-col-head sev-head-${s.toLowerCase()}`}>{s}</div>
                        ))}
                        {data.severity_heatmap.map((row) => (
                            <React.Fragment key={row.type}>
                                <div className="heatmap-row-head">{row.type}</div>
                                {["Critical", "High", "Medium", "Low"].map((s) => (
                                    <div
                                        key={`${row.type}-${s}`}
                                        className="heatmap-cell"
                                        style={{ backgroundColor: heatColor(row[s], s) }}
                                        aria-label={`${row.type}, ${s}: ${row[s]} incidents`}
                                    >
                                        {row[s]}
                                    </div>
                                ))}
                            </React.Fragment>
                        ))}
                    </div>
                </section>

                {/* ── Strategic Actions ── */}
                <section className="exec-section">
                    <h2 className="exec-section-title">Strategic Actions</h2>
                    <div className="exec-actions-list">
                        {data.strategic_actions.map((sa, i) => (
                            <div key={i} className={`exec-action-card priority-border-${sa.priority}`}>
                                <div className="exec-action-top">
                                    <span className={`priority-badge ${sa.priority}`}>{sa.priority.toUpperCase()}</span>
                                    <span className="exec-action-owner">{sa.owner}</span>
                                </div>
                                <h4>{sa.title}</h4>
                                <p className="exec-action-desc">{sa.description}</p>
                                <div className="exec-action-row">
                                    <div><strong><span aria-hidden="true">📋</span> Action:</strong> {sa.action}</div>
                                    <div><strong><span aria-hidden="true">📈</span> Impact:</strong> {sa.impact}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ── SLA Compliance + Team Contribution ── */}
                <section className="exec-section exec-chart-row">
                    <div className="exec-panel exec-panel-wide">
                        <h3>SLA Compliance by Business Impact</h3>
                        {data.sla_compliance?.length > 0 && (
                            <>
                                <div className="sla-chart-container" role="img" aria-label="SLA compliance by business impact — horizontal stacked bar chart">
                                    <Bar
                                        data={{
                                            labels: data.sla_compliance.map((s) => s.level),
                                            datasets: [
                                                {
                                                    label: "Within SLA",
                                                    data: data.sla_compliance.map((s) => s.within_sla),
                                                    backgroundColor: "rgba(34,197,94,.7)",
                                                    borderRadius: 6,
                                                },
                                                {
                                                    label: "Breached",
                                                    data: data.sla_compliance.map((s) => s.breached),
                                                    backgroundColor: "rgba(239,68,68,.7)",
                                                    borderRadius: 6,
                                                },
                                            ],
                                        }}
                                        options={{
                                            responsive: true,
                                            indexAxis: "y",
                                            plugins: { legend: { position: "top" } },
                                            scales: {
                                                x: { stacked: true, grid: { color: "rgba(148,163,184,0.12)" } },
                                                y: { stacked: true, grid: { display: false } },
                                            },
                                        }}
                                    />
                                </div>
                                <table className="sla-table" aria-label="SLA compliance by business impact">
                                    <thead>
                                        <tr>
                                            <th scope="col">Impact</th>
                                            <th scope="col">Target</th>
                                            <th scope="col">Avg Res.</th>
                                            <th scope="col">Compliance</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.sla_compliance.map((s) => (
                                            <tr key={s.level}>
                                                <td>
                                                    <span className={`sla-level-dot sla-dot-${s.level.toLowerCase()}`} />
                                                    {s.level}
                                                </td>
                                                <td>{s.sla_target_hours}h</td>
                                                <td>{s.avg_resolution_hours}h</td>
                                                <td>
                                                    <span className={`sla-pct ${s.compliance_pct >= 80 ? "sla-good" : s.compliance_pct >= 60 ? "sla-warn" : "sla-bad"}`}>
                                                        {s.compliance_pct}%
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </>
                        )}
                    </div>

                    <div className="exec-panel">
                        <h3>Team Contribution</h3>
                        {data.team_contribution?.length > 0 && (
                            <>
                                <div className="team-doughnut-wrap" role="img" aria-label="Team contribution doughnut chart">
                                    <Doughnut
                                        data={{
                                            labels: data.team_contribution.map((t) => t.team),
                                            datasets: [
                                                {
                                                    data: data.team_contribution.map((t) => t.count),
                                                    backgroundColor: [
                                                        "#6366f1", "#f59e0b", "#ef4444",
                                                        "#3b82f6", "#22c55e", "#8b5cf6",
                                                        "#ec4899", "#14b8a6",
                                                    ],
                                                    borderWidth: 2,
                                                    borderColor: "#fff",
                                                },
                                            ],
                                        }}
                                        options={{
                                            responsive: true,
                                            cutout: "55%",
                                            plugins: { legend: { display: false } },
                                        }}
                                    />
                                </div>
                                <div className="team-legend">
                                    {data.team_contribution.map((t, idx) => (
                                        <div key={t.team} className="team-legend-item">
                                            <span
                                                className="team-legend-dot"
                                                style={{
                                                    backgroundColor: ["#6366f1", "#f59e0b", "#ef4444", "#3b82f6", "#22c55e", "#8b5cf6", "#ec4899", "#14b8a6"][idx % 8],
                                                }}
                                            />
                                            <span className="team-legend-name">{t.team}</span>
                                            <span className="team-legend-pct">{t.percentage}%</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </section>

                {/* ── Source Breakdown + Source Trend ── */}
                <section className="exec-section exec-chart-row">
                    <div className="exec-panel">
                        <h3>Incident Source Breakdown</h3>
                        {data.source_breakdown?.length > 0 && (
                            <>
                                <div className="team-doughnut-wrap" role="img" aria-label="Incident source breakdown doughnut chart">
                                    <Doughnut
                                        data={{
                                            labels: data.source_breakdown.map((s) => s.source),
                                            datasets: [
                                                {
                                                    data: data.source_breakdown.map((s) => s.count),
                                                    backgroundColor: ["#3b82f6", "#f59e0b"],
                                                    borderWidth: 2,
                                                    borderColor: "#fff",
                                                },
                                            ],
                                        }}
                                        options={{
                                            responsive: true,
                                            cutout: "55%",
                                            plugins: { legend: { display: false } },
                                        }}
                                    />
                                </div>
                                <div className="source-legend">
                                    {data.source_breakdown.map((s, idx) => (
                                        <div key={s.source} className="source-legend-item">
                                            <span
                                                className="team-legend-dot"
                                                style={{ backgroundColor: ["#3b82f6", "#f59e0b"][idx] }}
                                            />
                                            <span className="source-legend-label">
                                                <strong>{s.source}</strong>
                                                <span className="source-legend-pct">{s.percentage}% ({s.count})</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    <div className="exec-panel exec-panel-wide">
                        <h3>Database vs Application — Monthly Trend</h3>
                        {data.source_trend?.length > 0 && (
                            <div role="img" aria-label="Database vs Application monthly trend — area line chart">
                                <Line
                                    data={{
                                        labels: data.source_trend.map((t) => t.month),
                                        datasets: [
                                            {
                                                label: "Database",
                                                data: data.source_trend.map((t) => t.Database),
                                                borderColor: "#3b82f6",
                                                backgroundColor: "rgba(59,130,246,.1)",
                                                fill: true,
                                                tension: 0.35,
                                                pointRadius: 3,
                                            },
                                            {
                                                label: "Application",
                                                data: data.source_trend.map((t) => t.Application),
                                                borderColor: "#f59e0b",
                                                backgroundColor: "rgba(245,158,11,.1)",
                                                fill: true,
                                                tension: 0.35,
                                                pointRadius: 3,
                                            },
                                        ],
                                    }}
                                    options={{
                                        responsive: true,
                                        plugins: { legend: { position: "top" } },
                                        scales: {
                                            x: { grid: { display: false } },
                                            y: { grid: { color: "rgba(148,163,184,0.12)" }, beginAtZero: true },
                                        },
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </section>

                {/* ── Team × Root Cause Heatmap ── */}
                <section className="exec-section">
                    <h2 className="exec-section-title">Team × Root Cause Analysis</h2>
                    {data.team_source_heatmap?.length > 0 && (
                        <div className="team-source-grid">
                            <div className="ts-corner" />
                            {["Database", "Application"].map((src) => (
                                <div key={src} className="ts-col-head">{src}</div>
                            ))}
                            <div className="ts-col-head">Total</div>
                            {data.team_source_heatmap.map((row) => (
                                <React.Fragment key={row.team}>
                                    <div className="ts-row-head">{row.team}</div>
                                    {["Database", "Application"].map((src) => {
                                        const pct = row[`${src}_pct`] || 0;
                                        const bgOpacity = Math.min(pct / 100, 1) * 0.5 + 0.05;
                                        const colors = { Database: "59,130,246", Application: "245,158,11" };
                                        return (
                                            <div
                                                key={`${row.team}-${src}`}
                                                className="ts-cell"
                                                style={{ backgroundColor: `rgba(${colors[src]},${bgOpacity})` }}
                                            >
                                                <span className="ts-cell-count">{row[src]}</span>
                                                <span className="ts-cell-pct">{pct}%</span>
                                            </div>
                                        );
                                    })}
                                    <div className="ts-cell ts-total">{row.total}</div>
                                </React.Fragment>
                            ))}
                        </div>
                    )}
                </section>

            </div>{/* end saas-body */}
        </div>
    );
}

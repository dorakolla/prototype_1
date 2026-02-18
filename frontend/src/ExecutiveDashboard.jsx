import React, { useEffect, useMemo, useState } from "react";
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

/* ── tiny SVG gauge arc ── */
function HealthGauge({ score, label }) {
    const r = 70, cx = 90, cy = 90, sw = 14;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, score)) / 100;
    const color =
        score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : score >= 40 ? "#f97316" : "#ef4444";

    return (
        <svg viewBox="0 0 180 180" className="exec-gauge-svg">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,.15)" strokeWidth={sw} />
            <circle
                cx={cx} cy={cy} r={r} fill="none"
                stroke={color} strokeWidth={sw}
                strokeDasharray={c}
                strokeDashoffset={c * (1 - pct)}
                strokeLinecap="round"
                transform={`rotate(-90 ${cx} ${cy})`}
                style={{ transition: "stroke-dashoffset .8s ease" }}
            />
            <text x={cx} y={cy - 6} textAnchor="middle" className="gauge-score">{score}</text>
            <text x={cx} y={cy + 18} textAnchor="middle" className="gauge-label">{label}</text>
        </svg>
    );
}

export default function ExecutiveDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedTeam, setSelectedTeam] = useState("");
    const [selectedImpact, setSelectedImpact] = useState("");
    const navigate = useNavigate();

    useEffect(() => {
        setLoading(true);
        const params = new URLSearchParams();
        if (selectedTeam) params.set("app_team", selectedTeam);
        if (selectedImpact) params.set("business_impact", selectedImpact);
        const qs = params.toString();
        fetchJson(`/api/executive-summary${qs ? `?${qs}` : ""}`)
            .then(setData)
            .finally(() => setLoading(false));
    }, [selectedTeam, selectedImpact]);

    /* ── Quarterly chart data ── */
    const qLabels = useMemo(() => data?.quarterly_trends?.map(([q]) => q) || [], [data]);
    const qValues = useMemo(() => data?.quarterly_trends?.map(([, v]) => v) || [], [data]);

    /* ── Heatmap max for colour scaling ── */
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
            <div className="page exec-page">
                <div className="loading">Loading executive summary…</div>
            </div>
        );
    }
    if (!data) {
        return (
            <div className="page exec-page">
                <div className="loading">Unable to load data.</div>
            </div>
        );
    }

    const mom = data.mom_change;
    const sevDist = data.severity_distribution;

    return (
        <div className="page exec-page">
            {/* ── Header ── */}
            <header className="exec-hero">
                <div className="exec-hero-left">
                    <p className="eyebrow">
                        Oracle EC2 / RDS • {selectedTeam ? selectedTeam : "All Applications"}
                    </p>
                    <h1>Executive Incident Brief</h1>
                    <p className="subtitle">
                        {selectedTeam
                            ? `Incident posture and strategic actions for ${selectedTeam}.`
                            : "High-level posture, team accountability, and strategic actions for Application Team Heads & Chapter Leads."}
                    </p>
                </div>
                <div className="exec-hero-right">
                    <div className="exec-team-selector">
                        <label htmlFor="team-filter" className="team-filter-label">Application</label>
                        <select
                            id="team-filter"
                            className="team-filter-select"
                            value={selectedTeam}
                            onChange={(e) => setSelectedTeam(e.target.value)}
                        >
                            <option value="">All Applications</option>
                            {(data?.available_teams || []).map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                    </div>
                    <button className="role-switch-btn" onClick={() => navigate("/dashboard")}>
                        ↩ Switch to Developer View
                    </button>
                </div>
            </header>

            {/* ── Health + KPI row ── */}
            <section className="exec-top-row">
                <div className="exec-gauge-card">
                    <HealthGauge score={data.health_score} label={data.health_label} />
                    <p className="exec-gauge-caption">Incident Health Score</p>
                </div>

                <div className="exec-kpi-grid">
                    <div className="exec-kpi">
                        <span className="exec-kpi-value">{data.total_incidents}</span>
                        <span className="exec-kpi-label">Total Incidents</span>
                    </div>
                    <div className="exec-kpi">
                        <span className="exec-kpi-value">{data.total_databases}</span>
                        <span className="exec-kpi-label">Active Databases</span>
                    </div>
                    <div className="exec-kpi">
                        <span className={`exec-kpi-value ${mom?.delta >= 0 ? "kpi-bad" : "kpi-good"}`}>
                            {mom ? `${mom.delta >= 0 ? "+" : ""}${mom.percent}%` : "—"}
                        </span>
                        <span className="exec-kpi-label">Month-over-Month</span>
                    </div>
                    <div className="exec-kpi">
                        <span className="exec-kpi-value kpi-bad">{sevDist.Critical}</span>
                        <span className="exec-kpi-label">Critical Incidents</span>
                    </div>
                </div>
            </section>

            {/* ── Business Impact Filter ── */}
            <section className="exec-section">
                <h2 className="exec-section-title">📊 Business Impact</h2>
                <div className="impact-filter-bar">
                    {(data.available_impacts || []).slice().reverse().map((level) => {
                        const count = data.impact_distribution?.[level] || 0;
                        const isActive = selectedImpact === level;
                        return (
                            <button
                                key={level}
                                className={`impact-filter-btn impact-lvl-${level.toLowerCase()} ${isActive ? "active" : ""}`}
                                onClick={() => setSelectedImpact(isActive ? "" : level)}
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
                        All sections below are filtered.
                    </p>
                )}
            </section>

            {/* ── Top 3 Risk Areas ── */}
            <section className="exec-section">
                <h2 className="exec-section-title">🔴 Top Risk Areas</h2>
                <div className="exec-risk-cards">
                    {data.top_risk_areas.map((risk, i) => (
                        <div key={risk.type} className={`exec-risk-card priority-border-${i === 0 ? "critical" : i === 1 ? "high" : "medium"}`}>
                            <div className="exec-risk-top">
                                <span className="exec-risk-rank">#{i + 1}</span>
                                <span className="exec-risk-name">{risk.type}</span>
                                <span className="exec-risk-ratio">{risk.risk_ratio}% high+crit</span>
                            </div>
                            <p className="exec-risk-desc">{risk.description}</p>
                            <div className="exec-risk-stats">
                                <span>🔴 {risk.critical} Critical</span>
                                <span>🟠 {risk.high} High</span>
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
                <h2 className="exec-section-title">👥 Team Accountability</h2>
                <div className="exec-table-wrap">
                    <table className="exec-table">
                        <thead>
                            <tr>
                                <th>Team</th>
                                <th>Total</th>
                                <th>Share</th>
                                <th>This Month</th>
                                <th>Last Month</th>
                                <th>MoM Trend</th>
                                <th>Critical</th>
                                <th>High</th>
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
                                        <span className={`trend-pill trend-${t.mom_trend}`}>
                                            {t.mom_trend === "up" ? "▲" : t.mom_trend === "down" ? "▼" : "—"}{" "}
                                            {t.mom_delta >= 0 ? "+" : ""}{t.mom_delta}
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

            {/* ── Charts row: Quarterly + Heatmap ── */}
            <section className="exec-charts-row">
                <div className="exec-panel">
                    <h3>Quarterly Incident Trend</h3>
                    <Line
                        data={{
                            labels: qLabels,
                            datasets: [
                                {
                                    label: "Incidents",
                                    data: qValues,
                                    borderColor: "#3b82f6",
                                    backgroundColor: "rgba(59,130,246,0.15)",
                                    tension: 0.35,
                                    fill: true,
                                    pointRadius: 5,
                                    pointBackgroundColor: "#3b82f6",
                                },
                            ],
                        }}
                        options={{
                            responsive: true,
                            plugins: { legend: { display: false } },
                            scales: {
                                x: { grid: { display: false } },
                                y: { grid: { color: "rgba(148,163,184,0.15)" }, beginAtZero: true },
                            },
                        }}
                    />
                </div>

                <div className="exec-panel">
                    <h3>Risk Heatmap — Severity × Type</h3>
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
                                    >
                                        {row[s]}
                                    </div>
                                ))}
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Strategic Actions ── */}
            <section className="exec-section">
                <h2 className="exec-section-title">🎯 Strategic Actions</h2>
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
                                <div><strong>📋 Action:</strong> {sa.action}</div>
                                <div><strong>📈 Impact:</strong> {sa.impact}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── SLA Compliance & Team Contribution ── */}
            <section className="exec-section exec-chart-row">
                {/* SLA Compliance Chart */}
                <div className="exec-panel exec-panel-wide">
                    <h3>⏱️ SLA Compliance by Business Impact</h3>
                    {data.sla_compliance?.length > 0 && (
                        <>
                            <div className="sla-chart-container">
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
                            <table className="sla-table">
                                <thead>
                                    <tr>
                                        <th>Impact</th>
                                        <th>Target</th>
                                        <th>Avg Res.</th>
                                        <th>Compliance</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.sla_compliance.map((s) => (
                                        <tr key={s.level}>
                                            <td><span className={`sla-level-dot sla-dot-${s.level.toLowerCase()}`} />{s.level}</td>
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

                {/* Team Contribution Doughnut */}
                <div className="exec-panel">
                    <h3>👥 Team Contribution</h3>
                    {data.team_contribution?.length > 0 && (
                        <>
                            <div className="team-doughnut-wrap">
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
                                        plugins: {
                                            legend: { display: false },
                                        },
                                    }}
                                />
                            </div>
                            <div className="team-legend">
                                {data.team_contribution.map((t, idx) => (
                                    <div key={t.team} className="team-legend-item">
                                        <span
                                            className="team-legend-dot"
                                            style={{ backgroundColor: ["#6366f1", "#f59e0b", "#ef4444", "#3b82f6", "#22c55e", "#8b5cf6", "#ec4899", "#14b8a6"][idx % 8] }}
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

            {/* ── Incident Source Breakdown ── */}
            <section className="exec-section exec-chart-row">
                <div className="exec-panel">
                    <h3>🔴 Incident Source Breakdown</h3>
                    {data.source_breakdown?.length > 0 && (
                        <>
                            <div className="team-doughnut-wrap">
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
                    <h3>📉 Database vs Application — Monthly Trend</h3>
                    {data.source_trend?.length > 0 && (
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
                                        tension: .35,
                                        pointRadius: 3,
                                    },
                                    {
                                        label: "Application",
                                        data: data.source_trend.map((t) => t.Application),
                                        borderColor: "#f59e0b",
                                        backgroundColor: "rgba(245,158,11,.1)",
                                        fill: true,
                                        tension: .35,
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
                    )}
                </div>
            </section>

            {/* ── Team × Root Cause Heatmap ── */}
            <section className="exec-section">
                <h2 className="exec-section-title">🏢 Team × Root Cause Analysis</h2>
                {data.team_source_heatmap?.length > 0 && (
                    <div className="team-source-grid">
                        {/* header */}
                        <div className="ts-corner" />
                        {["Database", "Application"].map((src) => (
                            <div key={src} className="ts-col-head">{src}</div>
                        ))}
                        <div className="ts-col-head">Total</div>
                        {/* rows */}
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
        </div>
    );
}

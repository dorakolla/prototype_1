import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend
);

// Dark mode defaults for Chart.js
ChartJS.defaults.color = "#8b95a8";
ChartJS.defaults.borderColor = "rgba(54,59,71,0.7)";

const chartColors = {
  gold: "#f0b429",
  teal: "#2ec4b6",
  blue: "#3b82f6",
  slate: "#0f172a",
  rose: "#fb7185",
  mint: "#99f6e4"
};

const fetchJson = (path) => fetch(path).then((res) => res.json());

const quarterKeyFromMonth = (monthLabel) => {
  const [year, monthPart] = String(monthLabel || "").split("-");
  const month = Number(monthPart);
  if (!year || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
};

export default function App() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [patterns, setPatterns] = useState(null);
  const [incidentTypeDetails, setIncidentTypeDetails] = useState([]);
  const [causePeriod, setCausePeriod] = useState("90d");
  const [selectedCauseTypes, setSelectedCauseTypes] = useState([]);
  const [causeAnalysis, setCauseAnalysis] = useState(null);
  const [causeLoading, setCauseLoading] = useState(false);
  const [causeError, setCauseError] = useState("");
  const [loading, setLoading] = useState(true);
  const [patternView, setPatternView] = useState("weekday");
  const [monthQuarterFilter, setMonthQuarterFilter] = useState("all");
  const [shareStatus, setShareStatus] = useState("idle");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState(null);
  const [expandedType, setExpandedType] = useState(null);
  const [suggestions, setSuggestions] = useState({});  // { incidentType: [...] }
  const [suggestionText, setSuggestionText] = useState("");
  const [suggestionAuthor, setSuggestionAuthor] = useState("");
  const [submittingSuggestion, setSubmittingSuggestion] = useState(false);

  // ── Global filters ──
  const [productLineFilter, setProductLineFilter] = useState("");
  const [appFilter, setAppFilter] = useState("");
  const [filterOptions, setFilterOptions] = useState({ product_lines: [], app_teams: [] });

  // ── DB Health ──
  const [dbHealth, setDbHealth] = useState([]);

  // Build query string from active filters
  const buildFilterQs = (pl, ap) => {
    const p = new URLSearchParams();
    if (pl) p.set("product_line", pl);
    if (ap) p.set("app_team", ap);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  // Fetch app teams whenever product line changes
  useEffect(() => {
    const qs = productLineFilter
      ? `?product_line=${encodeURIComponent(productLineFilter)}`
      : "";
    fetchJson(`/api/filter-options${qs}`).then((data) => {
      setFilterOptions(data);
      // reset app filter if currently selected team no longer available
      setAppFilter((prev) => (data.app_teams.includes(prev) ? prev : ""));
    });
  }, [productLineFilter]);

  // Fetch main data whenever filters change (runs on mount too)
  useEffect(() => {
    const qs = buildFilterQs(productLineFilter, appFilter);
    setLoading(true);
    Promise.all([
      fetchJson(`/api/summary${qs}`),
      fetchJson(`/api/patterns${qs}`),
      fetchJson(`/api/incident-type-details${qs}`),
      fetchJson(`/api/db-health${qs}`),
    ])
      .then(([summaryData, patternsData, typeDetails, healthData]) => {
        setSummary(summaryData);
        setPatterns(patternsData);
        setIncidentTypeDetails(typeDetails);
        setDbHealth(healthData);
      })
      .finally(() => setLoading(false));
  }, [productLineFilter, appFilter]);

  const trackEvent = (name, meta = {}) =>
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, meta })
    }).catch(() => { });

  const topDb = useMemo(() => {
    if (!summary?.by_database?.length) return null;
    const [name, count] = summary.by_database[0];
    return { name, count };
  }, [summary]);

  const incidentTypeOptions = useMemo(
    () => incidentTypeDetails.map((item) => item.type),
    [incidentTypeDetails]
  );

  const quarterOptions = useMemo(() => {
    if (!summary?.by_month?.length) return [];
    const seen = new Set();
    return summary.by_month
      .map(([monthLabel]) => quarterKeyFromMonth(monthLabel))
      .filter((key) => {
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((key) => ({ value: key, label: key.replace("-", " ") }));
  }, [summary]);

  useEffect(() => {
    if (!incidentTypeOptions.length) return;
    setSelectedCauseTypes((prev) => (prev.length ? prev : incidentTypeOptions));
  }, [incidentTypeOptions]);

  useEffect(() => {
    if (!selectedCauseTypes.length) {
      setCauseAnalysis(null);
      return;
    }

    const params = new URLSearchParams();
    params.set("period", causePeriod);
    params.set("types", selectedCauseTypes.join(","));

    setCauseLoading(true);
    setCauseError("");
    fetchJson(`/api/common-causes?${params.toString()}`)
      .then((data) => {
        setCauseAnalysis(data);
      })
      .catch(() => {
        setCauseError("Unable to analyze closure notes right now.");
      })
      .finally(() => setCauseLoading(false));
  }, [causePeriod, selectedCauseTypes]);

  const toggleCauseType = (type) => {
    setSelectedCauseTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  // ── Fetch suggestions for an incident type ──
  const fetchSuggestions = (incType) => {
    fetchJson(`/api/suggestions?incident_type=${encodeURIComponent(incType)}`)
      .then((data) => setSuggestions((prev) => ({ ...prev, [incType]: data })));
  };

  // ── Submit a new suggestion ──
  const submitSuggestion = (incType) => {
    if (!suggestionText.trim()) return;
    setSubmittingSuggestion(true);
    fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incidentType: incType,
        suggestion: suggestionText.trim(),
        author: suggestionAuthor.trim() || "Anonymous",
      }),
    })
      .then((r) => r.json())
      .then(() => {
        setSuggestionText("");
        fetchSuggestions(incType);
      })
      .finally(() => setSubmittingSuggestion(false));
  };

  // ── Upvote a suggestion ──
  const voteSuggestion = (incType, sid) => {
    fetch(`/api/suggestions/${sid}/vote`, { method: "POST" })
      .then((r) => r.json())
      .then(() => fetchSuggestions(incType));
  };

  useEffect(() => {
    if (monthQuarterFilter === "all") return;
    if (!quarterOptions.some((option) => option.value === monthQuarterFilter)) {
      setMonthQuarterFilter("all");
    }
  }, [monthQuarterFilter, quarterOptions]);

  // Generate actionable insights from data
  const actionableInsights = useMemo(() => {
    if (!summary || !patterns) return [];
    const insights = [];

    // Insight 1: Peak incident day
    const peakDay = patterns.weekday.reduce((max, curr) =>
      curr[1] > max[1] ? curr : max, patterns.weekday[0]);
    insights.push({
      id: "peak-day",
      priority: "high",
      category: "Temporal Pattern",
      title: `Peak Incidents on ${peakDay[0]}s`,
      description: `${peakDay[0]}s have the highest incident rate with ${peakDay[1]} incidents. Consider scheduling preventive maintenance before this day.`,
      action: "Schedule maintenance for day before peak",
      impact: "Could reduce incidents by 15-20%"
    });

    // Insight 2: Peak hour
    const peakHour = patterns.hour.reduce((max, curr) =>
      curr[1] > max[1] ? curr : max, patterns.hour[0]);
    insights.push({
      id: "peak-hour",
      priority: "medium",
      category: "Temporal Pattern",
      title: `Peak Hour: ${peakHour[0]}:00`,
      description: `Hour ${peakHour[0]} sees the most incidents (${peakHour[1]} total). Ensure on-call coverage is strong during this period.`,
      action: "Strengthen monitoring at peak hours",
      impact: "Faster incident response time"
    });

    // Insight 3: High-risk database
    if (topDb) {
      const totalIncidents = summary.totals.incidents;
      const dbPercentage = ((topDb.count / totalIncidents) * 100).toFixed(1);
      insights.push({
        id: "high-risk-db",
        priority: "critical",
        category: "Database Health",
        title: `${topDb.name} Needs Attention`,
        description: `${topDb.name} accounts for ${dbPercentage}% of all incidents (${topDb.count} out of ${totalIncidents}). This database requires immediate review.`,
        action: "Conduct deep-dive analysis on this database",
        impact: "Significant reduction in overall incidents"
      });
    }

    // Insight 4: Top incident type
    if (summary.by_type?.length) {
      const [topType, topTypeCount] = summary.by_type[0];
      insights.push({
        id: "top-incident-type",
        priority: "high",
        category: "Incident Type",
        title: `"${topType}" Most Common`,
        description: `${topType} is the leading incident type with ${topTypeCount} occurrences. Investigate root causes and implement preventive measures.`,
        action: "Create runbook for this incident type",
        impact: "Reduced mean time to resolution"
      });
    }

    // Insight 5: MoM trend
    if (summary.mom_change) {
      const { delta, percent, last_month, previous_month } = summary.mom_change;
      const isIncreasing = delta > 0;
      insights.push({
        id: "mom-trend",
        priority: isIncreasing ? "critical" : "low",
        category: "Trend Analysis",
        title: isIncreasing ? "Incidents Trending Up" : "Incidents Trending Down",
        description: `${isIncreasing ? "⚠️" : "✅"} Incidents ${isIncreasing ? "increased" : "decreased"} by ${Math.abs(percent)}% from ${previous_month} to ${last_month}. ${isIncreasing ? "Urgent attention needed." : "Keep up the good work!"}`,
        action: isIncreasing ? "Identify and address new incident sources" : "Document what's working well",
        impact: isIncreasing ? "Prevent further degradation" : "Maintain positive trajectory"
      });
    }

    // Insight 6: Severity distribution
    const criticalSev = summary.by_severity.find(([s]) => s === "Critical");
    if (criticalSev && criticalSev[1] > 0) {
      insights.push({
        id: "critical-severity",
        priority: "critical",
        category: "Severity",
        title: `${criticalSev[1]} Critical Incidents`,
        description: `You have ${criticalSev[1]} critical severity incidents that need immediate attention.`,
        action: "Review and resolve critical incidents first",
        impact: "Prevent major outages"
      });
    }

    return insights.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }, [summary, patterns, topDb]);

  const handleSharePulse = async () => {
    if (!summary) return;
    trackEvent("share_clicked", { surface: "hero" });

    const mom = summary.mom_change;
    const delta =
      mom && typeof mom.delta === "number"
        ? `${mom.delta >= 0 ? "+" : ""}${mom.delta}`
        : "n/a";
    const pct =
      mom && mom.percent !== null ? ` (${mom.percent}%)` : "";
    const dateLabel = new Date().toLocaleDateString();
    const shareText = `Incident Pulse ${dateLabel}: MoM ${delta}${pct}. Top DB ${topDb?.name}. Total incidents ${summary.totals.incidents}.`;
    const shareUrl = window.location.href;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Incident Pulse",
          text: shareText,
          url: shareUrl
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      } else {
        throw new Error("no share surface");
      }
      trackEvent("share_success", { surface: "hero" });
      setShareStatus("success");
    } catch (error) {
      setShareStatus("error");
    }
  };

  useEffect(() => {
    if (shareStatus === "idle") return;
    const timer = setTimeout(() => setShareStatus("idle"), 2500);
    return () => clearTimeout(timer);
  }, [shareStatus]);

  if (loading) {
    return (
      <div className="page">
        <div className="loading">Loading incident analytics…</div>
      </div>
    );
  }

  const monthlyPoints = summary.by_month.filter(
    ([month]) =>
      monthQuarterFilter === "all" || quarterKeyFromMonth(month) === monthQuarterFilter
  );
  const monthLabels = monthlyPoints.map(([month]) => month);
  const monthValues = monthlyPoints.map(([, count]) => count);

  const dbLabels = summary.by_database.map(([name]) => name);
  const dbValues = summary.by_database.map(([, count]) => count);

  const weekdayLabels = patterns.weekday.map(([day]) => day);
  const weekdayValues = patterns.weekday.map(([, count]) => count);

  const hourLabels = patterns.hour.map(([hour]) => hour);
  const hourValues = patterns.hour.map(([, count]) => count);

  const patternConfig =
    patternView === "weekday"
      ? {
        title: "Incident patterns by weekday",
        labels: weekdayLabels,
        values: weekdayValues,
        chart: "bar",
        color: chartColors.rose
      }
      : {
        title: "Incident patterns by hour",
        labels: hourLabels,
        values: hourValues,
        chart: "line",
        color: chartColors.gold
      };

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Oracle EC2 / RDS • Enterprise Incident Desk</p>
          <h1>Incident Analysis Dashboard</h1>
          <p className="subtitle">
            Stale baseline data highlighting monthly trend swings, high-risk databases,
            and temporal patterns across Oracle RDS and Oracle on EC2.
          </p>
        </div>
        <div className="hero-side">
          <button className="role-switch-btn" onClick={() => navigate("/executive")} style={{ marginBottom: 8 }}>
            📊 Switch to Leadership View
          </button>
          <div className="hero-card">
            <div>
              <div className="hero-label">Total incidents</div>
              <div className="hero-value">{summary.totals.incidents}</div>
            </div>
            <div>
              <div className="hero-label">Active databases</div>
              <div className="hero-value">{summary.totals.databases}</div>
            </div>
          </div>
          <div className="share-card">
            <div>
              <div className="hero-label">Share incident pulse</div>
              <p className="share-copy">
                Send a quick snapshot to your team with one click.
              </p>
            </div>
            <button className="share-button" onClick={handleSharePulse}>
              Share pulse
            </button>
            {shareStatus === "success" && (
              <div className="share-status success">Shared. Link copied.</div>
            )}
            {shareStatus === "error" && (
              <div className="share-status error">
                Sharing unavailable. Try another browser.
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Global Filters */}
      <section className="global-filter-bar">
        <div className="gf-label">Filters</div>
        <div className="gf-controls">
          <div className="gf-group">
            <label className="gf-field-label" htmlFor="pl-filter">Product Line</label>
            <select
              id="pl-filter"
              className="select gf-select"
              value={productLineFilter}
              onChange={(e) => setProductLineFilter(e.target.value)}
            >
              <option value="">All Product Lines</option>
              {filterOptions.product_lines.map((pl) => (
                <option key={pl} value={pl}>{pl}</option>
              ))}
            </select>
          </div>

          <div className="gf-group">
            <label className="gf-field-label" htmlFor="app-filter">
              Application
              {productLineFilter && (
                <span className="gf-scoped-tag">scoped to {productLineFilter}</span>
              )}
            </label>
            <select
              id="app-filter"
              className="select gf-select"
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
              disabled={filterOptions.app_teams.length === 0}
            >
              <option value="">All Applications</option>
              {filterOptions.app_teams.map((team) => (
                <option key={team} value={team}>{team}</option>
              ))}
            </select>
          </div>

          {(productLineFilter || appFilter) && (
            <button
              className="gf-clear-btn"
              onClick={() => { setProductLineFilter(""); setAppFilter(""); }}
            >
              Clear filters
            </button>
          )}
        </div>

        {(productLineFilter || appFilter) && (
          <div className="gf-active-chips">
            {productLineFilter && (
              <span className="gf-chip">
                {productLineFilter}
                <button onClick={() => setProductLineFilter("")} aria-label="Remove product line filter">×</button>
              </span>
            )}
            {appFilter && (
              <span className="gf-chip">
                {appFilter}
                <button onClick={() => setAppFilter("")} aria-label="Remove application filter">×</button>
              </span>
            )}
          </div>
        )}
      </section>

      {/* DB Health Status */}
      {dbHealth.length > 0 && (
        <section className="db-health-section">
          <div className="db-health-header">
            <h2>Database Health Status</h2>
            <p className="db-health-sub">Per-database incident health — product line &amp; application scoped</p>
          </div>
          <div className="db-health-grid">
            {dbHealth.map((db) => {
              const statusLabel = db.health_status === "healthy" ? "Healthy"
                : db.health_status === "warning" ? "Warning" : "Critical";
              const sevMax = Math.max(
                db.severity_breakdown.Low,
                db.severity_breakdown.Medium,
                db.severity_breakdown.High,
                db.severity_breakdown.Critical,
                1
              );
              const momDir = db.mom.delta > 0 ? "up" : db.mom.delta < 0 ? "down" : "flat";
              return (
                <div key={db.name} className={`db-health-tile status-${db.health_status}`}>
                  {/* Tile header */}
                  <div className="dbt-header">
                    <div className="dbt-name-row">
                      <span className={`dbt-status-dot dot-${db.health_status}`} />
                      <span className="dbt-name">{db.name}</span>
                      <span className="dbt-badge">{db.type}</span>
                    </div>
                    <span className={`dbt-status-label label-${db.health_status}`}>{statusLabel}</span>
                  </div>

                  {/* Counts */}
                  <div className="dbt-counts">
                    <div className="dbt-count-item">
                      <span className="dbt-count-val">{db.total_incidents}</span>
                      <span className="dbt-count-label">Total</span>
                    </div>
                    <div className="dbt-count-divider" />
                    <div className="dbt-count-item">
                      <span className="dbt-count-val">{db.last_7d_incidents}</span>
                      <span className="dbt-count-label">Last 7d</span>
                    </div>
                    <div className="dbt-count-divider" />
                    <div className="dbt-count-item">
                      <span className="dbt-count-val">{db.last_30d_incidents}</span>
                      <span className="dbt-count-label">Last 30d</span>
                    </div>
                  </div>

                  {/* Severity bars */}
                  <div className="dbt-sev-section">
                    <div className="dbt-sev-title">Severity Split</div>
                    {["Critical", "High", "Medium", "Low"].map((sev) => (
                      <div key={sev} className="dbt-sev-row">
                        <span className={`dbt-sev-label sev-${sev.toLowerCase()}`}>{sev}</span>
                        <div className="dbt-sev-track">
                          <div
                            className={`dbt-sev-fill sev-fill-${sev.toLowerCase()}`}
                            style={{ width: `${(db.severity_breakdown[sev] / sevMax) * 100}%` }}
                          />
                        </div>
                        <span className="dbt-sev-count">{db.severity_breakdown[sev]}</span>
                      </div>
                    ))}
                  </div>

                  {/* Top issue & team */}
                  <div className="dbt-meta-grid">
                    <div className="dbt-meta-item">
                      <span className="dbt-meta-label">Top Issue</span>
                      <span className="dbt-meta-val">{db.top_incident_type.name}</span>
                      <span className="dbt-meta-pct">{db.top_incident_type.percent}%</span>
                    </div>
                    <div className="dbt-meta-item">
                      <span className="dbt-meta-label">Top Application</span>
                      <span className="dbt-meta-val">{db.top_app_team.name}</span>
                      <span className="dbt-meta-pct">{db.top_app_team.percent}%</span>
                    </div>
                  </div>

                  {/* Type breakdown */}
                  <div className="dbt-breakdown-section">
                    <div className="dbt-sev-title">Issue Breakdown</div>
                    {db.type_breakdown.map((t) => (
                      <div key={t.name} className="dbt-breakdown-row">
                        <span className="dbt-breakdown-name">{t.name}</span>
                        <div className="dbt-breakdown-track">
                          <div className="dbt-breakdown-fill" style={{ width: `${t.percent}%` }} />
                        </div>
                        <span className="dbt-breakdown-pct">{t.percent}%</span>
                      </div>
                    ))}
                  </div>

                  {/* Footer */}
                  <div className="dbt-footer">
                    <div className="dbt-footer-item">
                      <span className="dbt-footer-label">Avg Resolution</span>
                      <span className="dbt-footer-val">
                        {db.avg_resolution_hours != null ? `${db.avg_resolution_hours}h` : "—"}
                      </span>
                    </div>
                    <div className="dbt-footer-item">
                      <span className="dbt-footer-label">MoM (30d)</span>
                      <span className={`dbt-mom-val mom-${momDir}`}>
                        {momDir === "up" ? "↑" : momDir === "down" ? "↓" : "→"}
                        {" "}{Math.abs(db.mom.percent)}%
                        {" "}({db.mom.delta >= 0 ? "+" : ""}{db.mom.delta})
                      </span>
                    </div>
                    <div className="dbt-footer-item">
                      <span className="dbt-footer-label">High/Crit %</span>
                      <span className={`dbt-hc-pct ${db.high_crit_percent >= 30 ? "hc-danger" : db.high_crit_percent >= 15 ? "hc-warn" : "hc-ok"}`}>
                        {db.high_crit_percent}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Actionable Insights Dropdown */}
      <section className="insights-section">
        <div
          className={`insights-header ${insightsOpen ? 'open' : ''}`}
          onClick={() => setInsightsOpen(!insightsOpen)}
        >
          <div className="insights-title">
            <span className="insights-icon">💡</span>
            <h2>Actionable Insights</h2>
            <span className="insights-badge">{actionableInsights.length} items</span>
          </div>
          <span className="insights-chevron">{insightsOpen ? '▲' : '▼'}</span>
        </div>

        {insightsOpen && (
          <div className="insights-dropdown">
            <div className="insights-list">
              {actionableInsights.map((insight) => (
                <div
                  key={insight.id}
                  className={`insight-item ${selectedInsight === insight.id ? 'selected' : ''} priority-${insight.priority}`}
                  onClick={() => setSelectedInsight(selectedInsight === insight.id ? null : insight.id)}
                >
                  <div className="insight-header">
                    <span className={`priority-badge ${insight.priority}`}>
                      {insight.priority.toUpperCase()}
                    </span>
                    <span className="insight-category">{insight.category}</span>
                  </div>
                  <h4 className="insight-title">{insight.title}</h4>

                  {selectedInsight === insight.id && (
                    <div className="insight-details">
                      <p className="insight-description">{insight.description}</p>
                      <div className="insight-action">
                        <strong>📋 Recommended Action:</strong>
                        <p>{insight.action}</p>
                      </div>
                      <div className="insight-impact">
                        <strong>📈 Expected Impact:</strong>
                        <p>{insight.impact}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="grid">
        <div className="card">
          <h2>Most frequent database</h2>
          <p className="metric">{topDb?.name}</p>
          <p className="muted">{topDb?.count} incidents logged</p>
        </div>
        <div className="card mom-card">
          <h2>Month-over-month change</h2>
          {summary.mom_change ? (
            <>
              <div className="mom-display">
                <span className={`mom-arrow ${summary.mom_change.delta >= 0 ? 'up' : 'down'}`}>
                  {summary.mom_change.delta >= 0 ? '↑' : '↓'}
                </span>
                <p className="metric">
                  {summary.mom_change.delta >= 0 ? "+" : ""}
                  {summary.mom_change.delta}
                </p>
              </div>
              <div className={`percent-badge ${summary.mom_change.delta >= 0 ? 'negative' : 'positive'}`}>
                {summary.mom_change.delta >= 0 ? '📈' : '📉'}
                <span className="percent-value">
                  {summary.mom_change.percent !== null
                    ? `${summary.mom_change.delta >= 0 ? '+' : ''}${summary.mom_change.percent}%`
                    : 'N/A'}
                </span>
                <span className="percent-label">
                  {summary.mom_change.delta >= 0 ? 'increase' : 'decrease'}
                </span>
              </div>
              <p className="mom-period">
                {summary.mom_change.previous_month} → {summary.mom_change.last_month}
              </p>
              <p className="mom-counts">
                {summary.mom_change.previous_count} → {summary.mom_change.last_count} incidents
              </p>
            </>
          ) : (
            <p className="muted">Not enough history</p>
          )}
        </div>
      </section>

      {/* Incident Types — Full-width standalone section */}
      <section className="incident-types-section">
        <div className="it-header-bar">
          <div>
            <h2>Incident Types Overview</h2>
            <p className="it-subtitle">Click any incident type to explore root causes, severity distribution, and recommended actions</p>
          </div>
          <span className="it-total-badge">{incidentTypeDetails.length} types tracked</span>
        </div>

        <div className="cause-model-panel">
          <div className="cause-model-header">
            <h3>Common Causes From Closure Notes</h3>
            <p>Select incident types and a time window. The model analyzes closure notes and groups root causes.</p>
          </div>
          <div className="cause-model-controls">
            <label className="cause-control">
              <span>Period</span>
              <select className="select" value={causePeriod} onChange={(event) => setCausePeriod(event.target.value)}>
                <option value="30d">Last 30 days</option>
                <option value="60d">Last 60 days</option>
                <option value="90d">Last 90 days</option>
                <option value="180d">Last 180 days</option>
              </select>
            </label>
            <div className="cause-type-select">
              <div className="cause-type-actions">
                <button
                  type="button"
                  className="cause-action-btn"
                  onClick={() => setSelectedCauseTypes(incidentTypeOptions)}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="cause-action-btn"
                  onClick={() => setSelectedCauseTypes([])}
                >
                  Clear
                </button>
              </div>
              <div className="cause-type-chips">
                {incidentTypeOptions.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`cause-type-chip ${selectedCauseTypes.includes(type) ? "active" : ""}`}
                    onClick={() => toggleCauseType(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {causeLoading && <p className="cause-model-state">Analyzing closure notes...</p>}
          {causeError && <p className="cause-model-state error">{causeError}</p>}
          {!causeLoading && !causeError && !selectedCauseTypes.length && (
            <p className="cause-model-state">Select at least one incident type to run cause analysis.</p>
          )}
          {!causeLoading && !causeError && causeAnalysis && (
            <div className="cause-model-results">
              {causeAnalysis.summary && (
                <div className="cause-summary-card">
                  <p className="cause-summary-label">Model Summary</p>
                  <p className="cause-summary-text">{causeAnalysis.summary}</p>
                </div>
              )}
              {causeAnalysis.analysis_engine?.model_available && (
                <p className="cause-engine-meta">
                  Engine: {causeAnalysis.analysis_engine.mode}
                </p>
              )}
              {causeAnalysis.clustering_engine?.available && (
                <p className="cause-engine-meta">
                  Clustering: {causeAnalysis.clustering_engine.algorithm} ({causeAnalysis.clustering_engine.clusters_found} clusters, {causeAnalysis.clustering_engine.noise_points} noise)
                </p>
              )}
              <p className="cause-model-meta">
                {causeAnalysis.total_incidents_analyzed} incidents analyzed from {causeAnalysis.window_start} to {causeAnalysis.window_end}
              </p>

              {causeAnalysis.semantic_clusters?.length > 0 && (
                <div className="semantic-clusters-card">
                  <h4>Semantic Clusters (HDBSCAN)</h4>
                  <div className="semantic-cluster-list">
                    {causeAnalysis.semantic_clusters.map((cluster) => (
                      <div key={cluster.cluster_id} className="semantic-cluster-item">
                        <div className="semantic-cluster-top">
                          <span className="semantic-cluster-id">Cluster {cluster.cluster_id}</span>
                          <span className="semantic-cluster-size">{cluster.size} ({cluster.percent}%)</span>
                        </div>
                        <p className="semantic-cluster-cause">Dominant cause: {cluster.dominant_cause}</p>
                        <div className="semantic-phrase-list">
                          {cluster.top_phrases.map((item, idx) => (
                            <span key={`${cluster.cluster_id}-${idx}`} className="semantic-phrase-chip">
                              {item.phrase} ({item.count})
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="cause-bars">
                {causeAnalysis.top_causes.length ? (
                  causeAnalysis.top_causes.map((cause) => (
                    <div key={cause.label} className="cause-bar-item">
                      <div className="cause-bar-top">
                        <span className="cause-name">{cause.label}</span>
                        <span className="cause-metric">{cause.count} ({cause.percent}%)</span>
                      </div>
                      <div className="cause-bar-track">
                        <div className="cause-bar-fill" style={{ width: `${cause.percent}%` }} />
                      </div>
                      <p className="cause-sample">Example: {cause.sample}</p>
                    </div>
                  ))
                ) : (
                  <p className="cause-model-state">No incidents found for the selected filter.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="incident-type-list">
          {incidentTypeDetails.slice(0, 7).map((detail, index) => {
            const isExpanded = expandedType === detail.type;
            const severityOrder = ["Critical", "High", "Medium", "Low"];
            const severityEntries = severityOrder
              .filter((sev) => detail.severity_breakdown[sev] !== undefined)
              .map((sev) => [sev, detail.severity_breakdown[sev]]);
            const maxSev = Math.max(...severityEntries.map(([, count]) => count), 1);
            const maxCount = incidentTypeDetails[0]?.total_count || 1;
            const barPercent = (detail.total_count / maxCount) * 100;
            const totalIncidents = Math.max(summary.totals.incidents || 1, 1);
            const sharePercent = ((detail.total_count / totalIncidents) * 100).toFixed(1);
            const trendLabel =
              detail.recent_trend === "up" ? "Rising" : detail.recent_trend === "down" ? "Falling" : "Stable";
            const topAppTeamPercent = detail.app_team_contribution?.[0]?.percent || 0;
            const teamContributionRows = (() => {
              const teams = detail.app_team_contribution || [];
              if (teams.length <= 4) return teams;
              const top = teams.slice(0, 4);
              const others = teams.slice(4).reduce(
                (acc, team) => ({
                  team: "Others",
                  count: acc.count + team.count,
                  percent: Number((acc.percent + team.percent).toFixed(1))
                }),
                { team: "Others", count: 0, percent: 0 }
              );
              return [...top, others];
            })();
            return (
              <div key={detail.type} className={`incident-type-item ${isExpanded ? 'expanded' : ''}`}>
                <button
                  type="button"
                  className="incident-type-row"
                  onClick={() => {
                    const nextType = isExpanded ? null : detail.type;
                    setExpandedType(nextType);
                    if (nextType) fetchSuggestions(nextType);
                  }}
                  aria-expanded={isExpanded}
                  aria-label={`Toggle ${detail.type} details`}
                >
                  <div className="incident-type-left">
                    <span className="incident-type-rank">#{index + 1}</span>
                    <span className={`trend-dot ${detail.recent_trend}`} title={`Trend: ${detail.recent_trend}`} />
                    <div className="incident-type-name-wrap">
                      <span className="incident-type-name">{detail.type}</span>
                      <span className={`incident-type-trend trend-${detail.recent_trend}`}>{trendLabel}</span>
                    </div>
                  </div>
                  <div className="incident-type-right">
                    <div className="count-bar-wrap">
                      <div className="count-bar-fill" style={{ width: `${barPercent}%` }} />
                    </div>
                    <span className="incident-type-count">{detail.total_count}</span>
                    <span className="incident-type-share">{sharePercent}%</span>
                    <span className="incident-type-chevron" aria-hidden="true">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="incident-type-expanded">
                    {detail.generated_summary ? (
                      <div className="it-description-wrap">
                        <span className="it-description-label">Auto Summary</span>
                        <p className="it-description">{detail.generated_summary}</p>
                      </div>
                    ) : (
                      <p className="it-description">{detail.description}</p>
                    )}

                    <div className="it-detail-grid">
                      <div className="it-col">
                        <div className="it-section it-module app-team-module">
                          <h4>Application Team Contribution</h4>
                          <div className="app-contrib-header">
                            <span className="app-contrib-value">{detail.app_team_count || 0}</span>
                            <span className="app-contrib-label">application teams contributed to this issue</span>
                          </div>
                          <div className="app-contrib-track" aria-label="Top team share">
                            <div className="app-contrib-fill" style={{ width: `${topAppTeamPercent}%` }} />
                          </div>
                          <div className="app-team-breakdown">
                            {teamContributionRows.length > 0 ? (
                              teamContributionRows.map((teamItem, idx) => (
                                <div key={`${detail.type}-${teamItem.team}`} className="app-team-row">
                                  <div className="app-team-row-top">
                                    <span className="app-team-name">#{idx + 1} {teamItem.team}</span>
                                    <strong>{teamItem.count} ({teamItem.percent}%)</strong>
                                  </div>
                                  <div className="app-team-row-track">
                                    <div className="app-team-row-fill" style={{ width: `${teamItem.percent}%` }} />
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="app-cause-item neutral">No team contribution data available for this issue.</p>
                            )}
                          </div>
                        </div>

                        <div className="it-section it-module">
                          <h4>Common Causes</h4>
                          <div className="cause-tags">
                            {detail.common_causes.map((cause, i) => (
                              <span key={i} className="cause-tag">{cause}</span>
                            ))}
                          </div>
                        </div>

                        <div className="it-section it-module">
                          <h4>Severity Breakdown</h4>
                          <div className="severity-bars">
                            {severityEntries.map(([sev, count]) => (
                              <div key={sev} className="severity-bar-row">
                                <span className={`sev-label sev-${sev.toLowerCase()}`}>{sev}</span>
                                <div className="sev-track">
                                  <div
                                    className={`sev-fill sev-fill-${sev.toLowerCase()}`}
                                    style={{ width: `${(count / maxSev) * 100}%` }}
                                  />
                                </div>
                                <span className="sev-count">{count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="it-col">
                        <div className="it-section it-module">
                          <h4>Affected Databases</h4>
                          <div className="db-chips">
                            {detail.affected_databases.map((db) => (
                              <span key={db.name} className="db-chip">
                                <span className="db-icon">⬤</span>
                                {db.name}
                                <strong>{db.count}</strong>
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="it-section it-module">
                          <h4>Recommended Actions</h4>
                          <ul className="action-list">
                            {detail.recommended_actions.map((action, i) => (
                              <li key={i} className="action-item">{action}</li>
                            ))}
                          </ul>

                          {/* ── User Suggestions ── */}
                          <div className="user-suggestions">
                            <h4 className="suggestions-title">💡 Community Suggestions
                              <span className="suggestions-count">
                                {(suggestions[detail.type] || []).length}
                              </span>
                            </h4>
                            {(suggestions[detail.type] || []).length > 0 && (
                              <div className="suggestions-list">
                                {(suggestions[detail.type] || []).map((s) => (
                                  <div key={s.id} className="suggestion-card">
                                    <div className="suggestion-body">
                                      <p className="suggestion-text">{s.suggestion}</p>
                                      <span className="suggestion-meta">
                                        by <strong>{s.author}</strong> · {new Date(s.created_at).toLocaleDateString()}
                                      </span>
                                    </div>
                                    <button
                                      className="suggestion-vote-btn"
                                      onClick={() => voteSuggestion(detail.type, s.id)}
                                      title="Upvote this suggestion"
                                    >
                                      👍 {s.votes}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="suggestion-form">
                              <input
                                type="text"
                                className="suggestion-author-input"
                                placeholder="Your name (optional)"
                                value={suggestionAuthor}
                                onChange={(e) => setSuggestionAuthor(e.target.value)}
                              />
                              <div className="suggestion-input-row">
                                <input
                                  type="text"
                                  className="suggestion-input"
                                  placeholder="Suggest an action for this incident type…"
                                  value={suggestionText}
                                  onChange={(e) => setSuggestionText(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && submitSuggestion(detail.type)}
                                />
                                <button
                                  className="suggestion-submit-btn"
                                  onClick={() => submitSuggestion(detail.type)}
                                  disabled={submittingSuggestion || !suggestionText.trim()}
                                >
                                  {submittingSuggestion ? "…" : "Submit"}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>


      <section className="chart-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Monthly incident volume</h3>
            <select
              className="select"
              value={monthQuarterFilter}
              onChange={(event) => setMonthQuarterFilter(event.target.value)}
            >
              <option value="all">All quarters</option>
              {quarterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <Line
            data={{
              labels: monthLabels,
              datasets: [
                {
                  label: "Incidents",
                  data: monthValues,
                  borderColor: chartColors.teal,
                  backgroundColor: "rgba(46,196,182,0.2)",
                  tension: 0.35,
                  fill: true
                }
              ]
            }}
            options={{
              responsive: true,
              plugins: {
                legend: { display: false }
              },
              scales: {
                x: { grid: { display: false } },
                y: { grid: { color: "rgba(148,163,184,0.2)" } }
              }
            }}
          />
        </div>
        <div className="panel">
          <h3>Incidents by database</h3>
          <Bar
            data={{
              labels: dbLabels,
              datasets: [
                {
                  label: "Incidents",
                  data: dbValues,
                  backgroundColor: [chartColors.gold, chartColors.blue]
                }
              ]
            }}
            options={{
              responsive: true,
              plugins: { legend: { display: false } },
              scales: {
                x: { grid: { display: false } },
                y: { grid: { color: "rgba(148,163,184,0.2)" } }
              }
            }}
          />
        </div>
        <div className="panel">
          <div className="panel-header">
            <h3>{patternConfig.title}</h3>
            <select
              className="select"
              value={patternView}
              onChange={(event) => setPatternView(event.target.value)}
            >
              <option value="weekday">Weekday pattern</option>
              <option value="hour">Hourly pattern</option>
            </select>
          </div>
          {patternConfig.chart === "bar" ? (
            <Bar
              data={{
                labels: patternConfig.labels,
                datasets: [
                  {
                    label: "Incidents",
                    data: patternConfig.values,
                    backgroundColor: patternConfig.color
                  }
                ]
              }}
              options={{
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                  x: { grid: { display: false } },
                  y: { grid: { color: "rgba(148,163,184,0.2)" } }
                }
              }}
            />
          ) : (
            <Line
              data={{
                labels: patternConfig.labels,
                datasets: [
                  {
                    label: "Incidents",
                    data: patternConfig.values,
                    borderColor: patternConfig.color,
                    backgroundColor: "rgba(240,180,41,0.2)",
                    tension: 0.35,
                    fill: true
                  }
                ]
              }}
              options={{
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                  x: { grid: { display: false } },
                  y: { grid: { color: "rgba(148,163,184,0.2)" } }
                }
              }}
            />
          )}
        </div>
      </section>
    </div>
  );
}

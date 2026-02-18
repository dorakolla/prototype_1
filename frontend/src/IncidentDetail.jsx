import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";

const fetchJson = (path) => fetch(path).then((r) => r.json());

const COMMENT_TYPE_META = {
    investigation: { icon: "🔍", label: "Investigation" },
    root_cause: { icon: "🎯", label: "Root Cause" },
    action_taken: { icon: "✅", label: "Action Taken" },
    escalation: { icon: "🚨", label: "Escalation" },
    note: { icon: "📝", label: "Note" },
};

const STATUS_FLOW = ["Open", "Acknowledged", "Investigating", "Resolved", "Closed"];
const STATUS_COLORS = {
    Open: "#f59e0b",
    Acknowledged: "#6366f1",
    Investigating: "#3b82f6",
    Resolved: "#22c55e",
    Closed: "#64748b",
};

export default function IncidentDetail() {
    const { incidentId } = useParams();
    const navigate = useNavigate();

    const [incident, setIncident] = useState(null);
    const [comments, setComments] = useState([]);
    const [actions, setActions] = useState([]);
    const [similar, setSimilar] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Comment form
    const [commentText, setCommentText] = useState("");
    const [commentType, setCommentType] = useState("note");
    const [commentAuthor, setCommentAuthor] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [autoSuggestion, setAutoSuggestion] = useState(null);

    // Transition
    const [transitioning, setTransitioning] = useState(false);

    // Root cause form
    const [rcText, setRcText] = useState("");
    const [settingRc, setSettingRc] = useState(false);

    const reload = useCallback(() => {
        setLoading(true);
        setError("");
        Promise.all([
            fetchJson(`/api/incidents/${incidentId}`),
            fetchJson(`/api/incidents/${incidentId}/comments`),
            fetchJson(`/api/incidents/${incidentId}/recommended-actions`),
            fetchJson(`/api/incidents/${incidentId}/similar`),
        ])
            .then(([inc, cmts, acts, sim]) => {
                if (inc.error) { setError(inc.error); return; }
                setIncident(inc);
                setComments(cmts);
                setActions(acts);
                setSimilar(sim.slice(0, 8));
            })
            .catch(() => setError("Failed to load incident"))
            .finally(() => setLoading(false));
    }, [incidentId]);

    useEffect(() => { reload(); }, [reload]);

    const handleTransition = async (newStatus) => {
        setTransitioning(true);
        try {
            const res = await fetch(`/api/incidents/${incidentId}/transition`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status: newStatus,
                    author: commentAuthor || "Dashboard User",
                    comment: `Transitioned to ${newStatus}`,
                }),
            });
            const data = await res.json();
            if (data.error) { setError(data.error); return; }
            reload();
        } finally {
            setTransitioning(false);
        }
    };

    const handleAddComment = async () => {
        if (!commentText.trim()) return;
        setSubmitting(true);
        setAutoSuggestion(null);
        try {
            const res = await fetch(`/api/incidents/${incidentId}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: commentText.trim(),
                    type: commentType,
                    author: commentAuthor.trim() || "Anonymous",
                }),
            });
            const data = await res.json();
            if (data.auto_suggestion) setAutoSuggestion(data.auto_suggestion);
            setCommentText("");
            reload();
        } finally {
            setSubmitting(false);
        }
    };

    const handleSetRootCause = async (cause, category) => {
        setSettingRc(true);
        try {
            await fetch(`/api/incidents/${incidentId}/root-cause`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    cause: cause || rcText.trim(),
                    category: category || "",
                    author: commentAuthor.trim() || "Dashboard User",
                }),
            });
            setRcText("");
            setAutoSuggestion(null);
            reload();
        } finally {
            setSettingRc(false);
        }
    };

    const handleAutoClassify = async () => {
        try {
            const res = await fetch(`/api/incidents/${incidentId}/auto-classify`, { method: "POST" });
            const data = await res.json();
            if (!data.error) setAutoSuggestion(data);
        } catch { /* ignore */ }
    };

    if (loading) {
        return (
            <div className="page">
                <div className="loading">Loading incident {incidentId}…</div>
            </div>
        );
    }
    if (error || !incident) {
        return (
            <div className="page">
                <div className="inc-detail-error">
                    <h2>Incident Not Found</h2>
                    <p>{error || "This incident does not exist."}</p>
                    <button className="inc-btn-primary" onClick={() => navigate("/dashboard")}>← Back to Dashboard</button>
                </div>
            </div>
        );
    }

    const currentIdx = STATUS_FLOW.indexOf(incident.status);
    const allowedNext = {
        Open: ["Acknowledged", "Investigating"],
        Acknowledged: ["Investigating"],
        Investigating: ["Resolved"],
        Resolved: ["Closed", "Investigating"],
        Closed: [],
    };
    const nextStatuses = allowedNext[incident.status] || [];

    return (
        <div className="page">
            {/* ── Header ── */}
            <header className="inc-detail-header">
                <div className="inc-detail-nav">
                    <button className="inc-btn-ghost" onClick={() => navigate("/dashboard")}>← Dashboard</button>
                    <span className="inc-id-badge">{incident.id}</span>
                </div>
                <div className="inc-detail-title-row">
                    <div>
                        <h1 className="inc-detail-title">{incident.incident_type}</h1>
                        <p className="inc-detail-meta">
                            {incident.db_name} • {incident.severity} severity • {incident.business_impact} impact
                            {incident.app_team && ` • ${incident.app_team}`}
                        </p>
                    </div>
                    <div className="inc-detail-badges">
                        <span className="inc-status-badge" style={{ background: STATUS_COLORS[incident.status] }}>
                            {incident.status}
                        </span>
                        <span className="inc-source-badge">{incident.incident_source}</span>
                    </div>
                </div>
            </header>

            {/* ── Status Progress ── */}
            <section className="inc-status-bar">
                <div className="inc-status-flow">
                    {STATUS_FLOW.map((s, i) => (
                        <div key={s} className={`inc-status-step ${i <= currentIdx ? "done" : ""} ${s === incident.status ? "current" : ""}`}>
                            <div className="inc-status-dot" style={i <= currentIdx ? { background: STATUS_COLORS[s] } : {}} />
                            <span className="inc-status-label">{s}</span>
                        </div>
                    ))}
                </div>
                {nextStatuses.length > 0 && (
                    <div className="inc-transition-btns">
                        {nextStatuses.map((ns) => (
                            <button
                                key={ns}
                                className="inc-btn-transition"
                                style={{ borderColor: STATUS_COLORS[ns], color: STATUS_COLORS[ns] }}
                                onClick={() => handleTransition(ns)}
                                disabled={transitioning}
                            >
                                → {ns}
                            </button>
                        ))}
                    </div>
                )}
            </section>

            <div className="inc-detail-grid">
                {/* ── Left Column: Comments + Root Cause ── */}
                <div className="inc-detail-left">
                    {/* Root Cause Card */}
                    <div className="inc-card">
                        <h3 className="inc-card-title">🎯 Root Cause</h3>
                        {incident.root_cause ? (
                            <div className="inc-rc-display">
                                <p className="inc-rc-text">{incident.root_cause}</p>
                                <div className="inc-rc-meta">
                                    <span className="inc-rc-category">{incident.root_cause_category}</span>
                                    {incident.root_cause_confidence != null && (
                                        <span className="inc-rc-conf">
                                            {(incident.root_cause_confidence * 100).toFixed(0)}% confidence
                                        </span>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="inc-rc-empty">
                                <p>No root cause identified yet.</p>
                                <div className="inc-rc-form">
                                    <input
                                        type="text"
                                        className="inc-input"
                                        placeholder="Describe the root cause…"
                                        value={rcText}
                                        onChange={(e) => setRcText(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && rcText.trim() && handleSetRootCause()}
                                    />
                                    <button
                                        className="inc-btn-primary"
                                        onClick={() => handleSetRootCause()}
                                        disabled={settingRc || !rcText.trim()}
                                    >
                                        Set Root Cause
                                    </button>
                                    <button className="inc-btn-secondary" onClick={handleAutoClassify}>
                                        🤖 Auto-Classify
                                    </button>
                                </div>
                            </div>
                        )}
                        {autoSuggestion && (
                            <div className="inc-auto-suggest">
                                <div className="inc-auto-suggest-header">
                                    <span>🤖 ML Suggestion</span>
                                    <span className="inc-auto-conf">
                                        {autoSuggestion.confidence ? `${(autoSuggestion.confidence * 100).toFixed(0)}%` : "rule-based"}
                                    </span>
                                </div>
                                <p className="inc-auto-category">{autoSuggestion.suggested_category}</p>
                                {autoSuggestion.playbook_action && (
                                    <p className="inc-auto-playbook">📋 {autoSuggestion.playbook_action}</p>
                                )}
                                <div className="inc-auto-actions">
                                    <button
                                        className="inc-btn-accept"
                                        onClick={() => handleSetRootCause(
                                            autoSuggestion.analyzed_text || autoSuggestion.suggested_category,
                                            autoSuggestion.suggested_category
                                        )}
                                    >
                                        ✓ Accept
                                    </button>
                                    <button className="inc-btn-ghost" onClick={() => setAutoSuggestion(null)}>
                                        ✕ Dismiss
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Comment Thread */}
                    <div className="inc-card">
                        <h3 className="inc-card-title">💬 Resolution Thread ({comments.length})</h3>
                        <div className="inc-comment-list">
                            {comments.length === 0 && (
                                <p className="inc-empty-msg">No comments yet. Add an investigation note to get started.</p>
                            )}
                            {comments.map((c) => {
                                const meta = COMMENT_TYPE_META[c.type] || COMMENT_TYPE_META.note;
                                return (
                                    <div key={c.id} className={`inc-comment inc-comment-${c.type}`}>
                                        <div className="inc-comment-header">
                                            <span className="inc-comment-icon">{meta.icon}</span>
                                            <span className="inc-comment-type">{meta.label}</span>
                                            <span className="inc-comment-author">{c.author}</span>
                                            <span className="inc-comment-time">
                                                {new Date(c.created_at).toLocaleString()}
                                            </span>
                                        </div>
                                        <p className="inc-comment-body">{c.content}</p>
                                        {c.metadata?.transition && (
                                            <span className="inc-comment-transition">
                                                {c.metadata.transition.from} → {c.metadata.transition.to}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {/* Add Comment Form */}
                        <div className="inc-comment-form">
                            <div className="inc-comment-form-top">
                                <select
                                    className="inc-select"
                                    value={commentType}
                                    onChange={(e) => setCommentType(e.target.value)}
                                >
                                    {Object.entries(COMMENT_TYPE_META).map(([key, m]) => (
                                        <option key={key} value={key}>{m.icon} {m.label}</option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    className="inc-input inc-author-input"
                                    placeholder="Your name"
                                    value={commentAuthor}
                                    onChange={(e) => setCommentAuthor(e.target.value)}
                                />
                            </div>
                            <div className="inc-comment-form-body">
                                <textarea
                                    className="inc-textarea"
                                    placeholder="Add a comment…"
                                    value={commentText}
                                    onChange={(e) => setCommentText(e.target.value)}
                                    rows={3}
                                />
                                <button
                                    className="inc-btn-primary"
                                    onClick={handleAddComment}
                                    disabled={submitting || !commentText.trim()}
                                >
                                    {submitting ? "Posting…" : "Post Comment"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Right Column: Actions + Similar ── */}
                <div className="inc-detail-right">
                    {/* Recommended Actions */}
                    <div className="inc-card">
                        <h3 className="inc-card-title">⚡ Recommended Actions</h3>
                        {actions.length === 0 ? (
                            <p className="inc-empty-msg">No actions available. Set a root cause to get recommendations.</p>
                        ) : (
                            <div className="inc-action-list">
                                {actions.map((a, i) => (
                                    <div key={i} className={`inc-action-item inc-action-${a.source}`}>
                                        <div className="inc-action-header">
                                            <span className={`inc-action-priority ${a.priority}`}>{a.priority}</span>
                                            <span className="inc-action-source">
                                                {a.source === "playbook" && "📘 Playbook"}
                                                {a.source === "type_default" && "📋 Type Default"}
                                                {a.source === "ml_pattern" && "🧠 ML Pattern"}
                                                {a.source === "community" && "👥 Community"}
                                            </span>
                                            {a.confidence != null && (
                                                <span className="inc-action-conf">{(a.confidence * 100).toFixed(0)}%</span>
                                            )}
                                        </div>
                                        <p className="inc-action-text">{a.action}</p>
                                        {a.similar_incidents != null && (
                                            <span className="inc-action-meta">{a.similar_incidents} similar incidents used this</span>
                                        )}
                                        {a.votes != null && (
                                            <span className="inc-action-meta">👍 {a.votes} votes</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Timeline */}
                    <div className="inc-card">
                        <h3 className="inc-card-title">⏱ Timeline</h3>
                        <div className="inc-timeline">
                            <div className="inc-timeline-item">
                                <span className="inc-tl-dot" style={{ background: "#f59e0b" }} />
                                <div>
                                    <strong>Occurred</strong>
                                    <span>{new Date(incident.occurred_at).toLocaleString()}</span>
                                </div>
                            </div>
                            {incident.acknowledged_at && (
                                <div className="inc-timeline-item">
                                    <span className="inc-tl-dot" style={{ background: "#6366f1" }} />
                                    <div>
                                        <strong>Acknowledged</strong>
                                        <span>{new Date(incident.acknowledged_at).toLocaleString()}</span>
                                    </div>
                                </div>
                            )}
                            {incident.resolved_at && (
                                <div className="inc-timeline-item">
                                    <span className="inc-tl-dot" style={{ background: "#22c55e" }} />
                                    <div>
                                        <strong>Resolved</strong>
                                        <span>{new Date(incident.resolved_at).toLocaleString()}</span>
                                        {incident.resolution_hours != null && (
                                            <span className="inc-tl-duration">({incident.resolution_hours}h)</span>
                                        )}
                                    </div>
                                </div>
                            )}
                            {incident.closed_at && (
                                <div className="inc-timeline-item">
                                    <span className="inc-tl-dot" style={{ background: "#64748b" }} />
                                    <div>
                                        <strong>Closed</strong>
                                        <span>{new Date(incident.closed_at).toLocaleString()}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Similar Incidents */}
                    <div className="inc-card">
                        <h3 className="inc-card-title">🔗 Similar Resolved Incidents</h3>
                        {similar.length === 0 ? (
                            <p className="inc-empty-msg">No similar incidents found.</p>
                        ) : (
                            <div className="inc-similar-list">
                                {similar.map((s) => (
                                    <div
                                        key={s.id}
                                        className="inc-similar-item"
                                        onClick={() => navigate(`/incident/${s.id}`)}
                                        role="button"
                                        tabIndex={0}
                                    >
                                        <div className="inc-similar-top">
                                            <span className="inc-similar-id">{s.id}</span>
                                            <span className="inc-similar-score">{(s.similarity_score * 100).toFixed(0)}% match</span>
                                        </div>
                                        <div className="inc-similar-meta">
                                            <span>{s.severity}</span>
                                            {s.root_cause_category && <span>• {s.root_cause_category}</span>}
                                            {s.resolution_hours != null && <span>• {s.resolution_hours}h</span>}
                                        </div>
                                        {s.root_cause && <p className="inc-similar-cause">{s.root_cause}</p>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

from __future__ import annotations

from datetime import datetime, timedelta, date
from collections import Counter, defaultdict
import re
import random

from flask import Flask, jsonify, request
from flask_cors import CORS
try:
    from sentence_transformers import SentenceTransformer, util
except Exception:  # pragma: no cover - optional runtime dependency
    SentenceTransformer = None
    util = None
try:
    import hdbscan
except Exception:  # pragma: no cover - optional runtime dependency
    hdbscan = None

app = Flask(__name__)
CORS(app)

DBS = [
    {"name": "Oracle RDS", "type": "RDS", "engine": "oracle"},
    {"name": "Oracle EC2", "type": "EC2", "engine": "oracle"},
]

INCIDENT_TYPES = [
    "Connection spikes",
    "Slow queries",
    "Storage latency",
    "Backup failures",
    "Replication lag",
    "CPU saturation",
    "IOPS throttling",
]

APP_TEAMS = [
    "Payments Team",
    "Orders Team",
    "Customer API Team",
    "Data Pipeline Team",
    "Auth Platform Team",
    "Reporting Team",
]

INCIDENT_TYPE_TEAM_WEIGHTS = {
    "Connection spikes": [("Customer API Team", 0.30), ("Orders Team", 0.26), ("Auth Platform Team", 0.20), ("Payments Team", 0.14), ("Data Pipeline Team", 0.06), ("Reporting Team", 0.04)],
    "Slow queries": [("Orders Team", 0.30), ("Reporting Team", 0.24), ("Payments Team", 0.18), ("Customer API Team", 0.14), ("Data Pipeline Team", 0.10), ("Auth Platform Team", 0.04)],
    "Storage latency": [("Data Pipeline Team", 0.33), ("Reporting Team", 0.22), ("Orders Team", 0.16), ("Payments Team", 0.14), ("Customer API Team", 0.09), ("Auth Platform Team", 0.06)],
    "Backup failures": [("Data Pipeline Team", 0.36), ("Reporting Team", 0.22), ("Orders Team", 0.14), ("Payments Team", 0.12), ("Customer API Team", 0.10), ("Auth Platform Team", 0.06)],
    "Replication lag": [("Data Pipeline Team", 0.29), ("Orders Team", 0.22), ("Reporting Team", 0.20), ("Customer API Team", 0.13), ("Payments Team", 0.10), ("Auth Platform Team", 0.06)],
    "CPU saturation": [("Reporting Team", 0.28), ("Orders Team", 0.24), ("Payments Team", 0.18), ("Customer API Team", 0.14), ("Data Pipeline Team", 0.10), ("Auth Platform Team", 0.06)],
    "IOPS throttling": [("Data Pipeline Team", 0.34), ("Reporting Team", 0.24), ("Orders Team", 0.16), ("Payments Team", 0.12), ("Customer API Team", 0.08), ("Auth Platform Team", 0.06)],
}

SEVERITIES = ["Low", "Medium", "High", "Critical"]

# ── Incident Lifecycle ──
INCIDENT_STATUSES = ["Open", "Acknowledged", "Investigating", "Resolved", "Closed"]
ALLOWED_TRANSITIONS = {
    "Open": ["Acknowledged", "Investigating"],
    "Acknowledged": ["Investigating"],
    "Investigating": ["Resolved"],
    "Resolved": ["Closed", "Investigating"],   # can re-open from Resolved
    "Closed": [],
}
COMMENT_TYPES = ["investigation", "root_cause", "action_taken", "escalation", "note"]

# ── Business Impact level mapping ──
# Higher-impact incident types get their severity elevated by 1 level
HIGH_IMPACT_TYPES = {"Connection spikes", "Slow queries", "CPU saturation"}       # revenue / customer-facing
CRITICAL_IMPACT_TYPES = {"Backup failures", "Replication lag"}                    # data-integrity / compliance
IMPACT_LEVELS = ["Low", "Medium", "High", "Critical"]

def _compute_business_impact(severity: str, incident_type: str) -> str:
    """Derive business impact level from severity + incident type."""
    idx = IMPACT_LEVELS.index(severity) if severity in IMPACT_LEVELS else 0
    if incident_type in CRITICAL_IMPACT_TYPES:
        idx = min(idx + 1, 3)
    elif incident_type in HIGH_IMPACT_TYPES and idx < 2:
        idx = min(idx + 1, 3)
    return IMPACT_LEVELS[idx]

# SLA targets in hours per business impact level
SLA_TARGETS = {
    "Critical": 1,
    "High": 4,
    "Medium": 8,
    "Low": 24,
}

# ── Incident Source classification ──
INCIDENT_SOURCE_MAP = {
    "Slow queries":       "Database",
    "Connection spikes":  "Application",
    "Replication lag":    "Database",
    "Backup failures":    "Database",
    "Storage latency":    "Database",
    "CPU saturation":     "Application",
    "IOPS throttling":    "Database",
}
INCIDENT_SOURCES = ["Database", "Application"]

PERIOD_DAY_OPTIONS = {"30d": 30, "60d": 60, "90d": 90, "180d": 180}
CAUSE_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
CAUSE_MODEL_MIN_CONFIDENCE = 0.36

CAUSE_TAXONOMY_RULES = [
    ("Indexing issue", ["index", "predicate", "where", "cartesian", "full table scan"]),
    ("Connection management", ["connection pool", "connection leak", "sessions", "processes"]),
    ("Execution plan regression", ["execution plan", "optimizer", "plan baseline", "dbms_xplan"]),
    ("Lock/contention pressure", ["lock contention", "concurrent dml", "contention"]),
    ("Storage/I/O limits", ["iops", "throughput", "storage", "redo-log", "redo", "temp", "ebs"]),
    ("Capacity saturation", ["cpu", "undersized", "burst credit", "throttle"]),
    ("Backup/recovery pipeline", ["backup", "rman", "fra", "archivelog", "restore validate"]),
    ("Replication/transport lag", ["replica", "replication", "standby", "dataguard", "apply lag"]),
    ("Network/dependency", ["network", "timeout", "dns", "health-check", "upstream"]),
    ("Credential/access", ["iam", "credential", "auth", "permission"]),
]
CAUSE_ACTION_PLAYBOOK = {
    "Indexing issue": "Prioritize index review and query plan validation for top offenders.",
    "Connection management": "Audit connection pooling/session limits and fix connection leaks.",
    "Execution plan regression": "Capture plan changes and pin known-good baselines for critical SQL.",
    "Lock/contention pressure": "Reduce hot-table contention with batching and transaction tuning.",
    "Storage/I/O limits": "Increase IOPS/throughput headroom and isolate heavy I/O workloads.",
    "Capacity saturation": "Right-size compute and control peak batch workload concurrency.",
    "Backup/recovery pipeline": "Stabilize backup windows and enforce FRA/RMAN health checks.",
    "Replication/transport lag": "Tune transport/apply throughput and investigate large write bursts.",
    "Network/dependency": "Harden network paths and timeout/retry strategy for dependencies.",
    "Credential/access": "Automate credential rotation and access validation checks.",
    "Other/uncategorized": "Review unresolved closure notes and refine taxonomy mappings.",
}

_CAUSE_MODEL = None
_CAUSE_MODEL_LABEL_EMBEDDINGS = None
_CAUSE_MODEL_LOAD_ERROR: str | None = None

INCIDENT_TYPE_INFO = {
    "Connection spikes": {
        "description": "Sudden surge in database connections exceeding normal thresholds, potentially exhausting the connection pool and causing new requests to queue or fail.",
        "common_causes": [
            "Application deployment without connection pooling",
            "Load balancer health-check storms",
            "Connection leak in application code",
            "Sudden traffic surge from upstream services",
            "DNS failover redirecting all traffic to one instance",
        ],
        "recommended_actions": [
            "Configure connection pool limits (min/max) in the application",
            "Implement connection timeout and retry-with-backoff",
            "Review and set Oracle PROCESSES and SESSIONS parameters",
            "Add circuit-breaker patterns in the service layer",
        ],
    },
    "Slow queries": {
        "description": "SQL statements taking significantly longer than their historical baseline to execute, degrading overall application response time.",
        "common_causes": [
            "Missing or stale indexes on frequently queried columns",
            "Execution plan regression after optimizer stats refresh",
            "Lock contention from concurrent DML on hot tables",
            "Cartesian joins or missing WHERE predicates",
            "High redo-log I/O wait during peak write windows",
        ],
        "recommended_actions": [
            "Capture and analyze SQL execution plans with DBMS_XPLAN",
            "Add composite indexes for top offending queries",
            "Pin stable execution plans using SQL Plan Baselines",
            "Schedule stats gathering during low-traffic windows",
        ],
    },
    "Storage latency": {
        "description": "Increased I/O wait times for read/write operations on the underlying storage layer, often surfacing as db file sequential/scattered read waits.",
        "common_causes": [
            "EBS volume hitting IOPS or throughput limits",
            "Noisy-neighbor effect on shared storage",
            "Tablespace fragmentation or auto-extend overhead",
            "Large sort-to-disk operations spilling to TEMP",
            "Backup jobs competing for I/O bandwidth",
        ],
        "recommended_actions": [
            "Upgrade to gp3/io2 volumes with provisioned IOPS",
            "Separate DATA, TEMP, and REDO onto dedicated volumes",
            "Enable and tune Oracle Automatic Storage Management (ASM)",
            "Schedule backups outside peak hours",
        ],
    },
    "Backup failures": {
        "description": "Scheduled or ad-hoc backup jobs (RMAN / snapshots) failing to complete, leaving the database without a recent recovery point.",
        "common_causes": [
            "Insufficient space in backup destination or FRA",
            "Network timeout during backup to S3 or NFS",
            "Archivelog destination full blocking log shipping",
            "RMAN channel allocation conflicts",
            "Expired or rotated AWS IAM credentials",
        ],
        "recommended_actions": [
            "Set up FRA space alerts at 80% threshold",
            "Validate RMAN backups nightly with RESTORE VALIDATE",
            "Use incremental-merge backup strategy to reduce window",
            "Automate credential rotation and test connectivity",
        ],
    },
    "Replication lag": {
        "description": "Growing delay between the primary database and its read replicas or standby instances, risking stale reads and failover data loss.",
        "common_causes": [
            "High write throughput exceeding apply rate",
            "Network bandwidth saturation between AZs",
            "Large DDL operations blocking redo apply",
            "Single-threaded apply bottleneck on standby",
            "Unoptimized supplemental logging configuration",
        ],
        "recommended_actions": [
            "Enable multi-threaded slave (MTS) apply on standby",
            "Monitor V$DATAGUARD_STATS for transport and apply lag",
            "Use parallel apply for large transaction workloads",
            "Place primary and standby in the same region for lower latency",
        ],
    },
    "CPU saturation": {
        "description": "Database host CPU utilization sustained above 90%, causing query queuing, increased latencies, and possible ORA-errors under load.",
        "common_causes": [
            "Untuned PL/SQL with excessive context switches",
            "Full table scans on large objects instead of index access",
            "Excessive parsing due to non-use of bind variables",
            "Background processes (AWR, ASH) competing with user sessions",
            "Undersized instance class for workload requirements",
        ],
        "recommended_actions": [
            "Identify top CPU consumers via ASH/AWR reports",
            "Convert literal SQL to use bind variables (cursor sharing)",
            "Right-size the EC2/RDS instance based on CPU credits",
            "Offload read-heavy queries to read replicas",
        ],
    },
    "IOPS throttling": {
        "description": "The storage subsystem enforcing I/O rate limits, causing database operations to stall until the next throttling window resets.",
        "common_causes": [
            "EBS burst credit depletion on gp2 volumes",
            "Exceeding provisioned IOPS limit on io1/io2 volumes",
            "RDS storage auto-scale triggering temporary throttle",
            "Heavy batch jobs (ETL, data loads) saturating I/O budget",
            "Concurrent RMAN backup and user workload contention",
        ],
        "recommended_actions": [
            "Migrate from gp2 to gp3 for baseline IOPS guarantees",
            "Provision IOPS based on peak + 20% headroom",
            "Stagger ETL and backup windows to flatten I/O peaks",
            "Enable Enhanced Monitoring to track I/O queue depth",
        ],
    },
}


def _normalize_cause(cause_text: str) -> str:
    text = cause_text.lower()
    for canonical, keywords in CAUSE_TAXONOMY_RULES:
        if any(keyword in text for keyword in keywords):
            return canonical
    return "Other/uncategorized"


def _generate_sample_data(days: int = 180) -> list[dict]:
    rng = random.Random(42)
    today = date.today()
    data: list[dict] = []
    for i in range(days):
        day = today - timedelta(days=i)
        # Mild seasonality: more incidents mid-month
        seasonal = 1.0 + (0.35 if 10 <= day.day <= 20 else 0.0)
        for db in DBS:
            base = 1 if db["type"] == "EC2" else 2
            daily_incidents = rng.randint(0, base + 2)
            daily_incidents = int(daily_incidents * seasonal)
            for _ in range(daily_incidents):
                hour = rng.choice([1, 3, 7, 9, 11, 13, 16, 19, 22])
                minute = rng.randint(0, 59)
                occurred_at = datetime.combine(day, datetime.min.time()).replace(
                    hour=hour, minute=minute
                )
                inc_type = rng.choice(INCIDENT_TYPES)
                info = INCIDENT_TYPE_INFO.get(inc_type, {})
                team_distribution = INCIDENT_TYPE_TEAM_WEIGHTS.get(inc_type, [])
                team_names = [name for name, _ in team_distribution] or APP_TEAMS
                team_weights = [weight for _, weight in team_distribution] or [1] * len(APP_TEAMS)
                app_team = rng.choices(team_names, weights=team_weights, k=1)[0]
                causes = info.get("common_causes", []) or ["Unknown operational issue"]
                actions = info.get("recommended_actions", []) or ["Investigate and apply remediation"]
                picked_cause = rng.choice(causes)
                picked_action = rng.choice(actions)
                closure_note = (
                    f"Root cause: {picked_cause}. "
                    f"Impact validated in post-incident review. "
                    f"Resolution: {picked_action}. "
                    f"Prevention follow-up assigned to {app_team}."
                )
                sev = rng.choices(SEVERITIES, weights=[50, 30, 15, 5])[0]
                bi = _compute_business_impact(sev, inc_type)
                # Simulate resolution time based on impact level
                sla_hrs = SLA_TARGETS.get(bi, 8)
                # ~75% resolved within SLA, rest breach
                if rng.random() < 0.75:
                    res_hours = round(rng.uniform(sla_hrs * 0.2, sla_hrs * 0.95), 1)
                else:
                    res_hours = round(rng.uniform(sla_hrs * 1.05, sla_hrs * 3.0), 1)
                resolved_at = occurred_at + timedelta(hours=res_hours)
                data.append(
                    {
                        "id": f"INC-{day.strftime('%Y%m%d')}-{rng.randint(100,999)}",
                        "db_name": db["name"],
                        "db_type": db["type"],
                        "engine": db["engine"],
                        "incident_type": inc_type,
                        "severity": sev,
                        "status": "Closed",
                        "occurred_at": occurred_at.isoformat(),
                        "acknowledged_at": (occurred_at + timedelta(minutes=rng.randint(2, 20))).isoformat(),
                        "resolved_at": resolved_at.isoformat(),
                        "closed_at": (resolved_at + timedelta(minutes=rng.randint(5, 60))).isoformat(),
                        "closure_note": closure_note,
                        "root_cause": picked_cause,
                        "root_cause_category": _normalize_cause(picked_cause),
                        "root_cause_confidence": None,
                        "assigned_to": None,
                        "app_team": app_team,
                        "business_impact": bi,
                        "resolution_hours": res_hours,
                        "incident_source": INCIDENT_SOURCE_MAP.get(inc_type, "Other"),
                    }
                )
    return data


INCIDENTS = _generate_sample_data()
# Index for fast lookup by incident ID
_INCIDENTS_BY_ID: dict[str, dict] = {inc["id"]: inc for inc in INCIDENTS}
EVENT_COUNTS = Counter()
EVENT_LOG: list[dict] = []
USER_SUGGESTIONS: list[dict] = []   # user-submitted action suggestions
_suggestion_counter = 0
INCIDENT_COMMENTS: dict[str, list[dict]] = defaultdict(list)  # inc_id -> comments
_comment_counter = 0
AUDIT_LOG: list[dict] = []          # state-change audit trail
_inc_sequence = len(INCIDENTS)


@app.post("/api/suggestions")
def create_suggestion():
    """Submit a user-suggested action for an incident type."""
    global _suggestion_counter
    body = request.get_json(force=True, silent=True) or {}
    incident_type = (body.get("incidentType") or "").strip()
    suggestion = (body.get("suggestion") or "").strip()
    author = (body.get("author") or "Anonymous").strip()
    if not incident_type or not suggestion:
        return jsonify({"error": "incidentType and suggestion are required"}), 400
    _suggestion_counter += 1
    entry = {
        "id": _suggestion_counter,
        "incident_type": incident_type,
        "suggestion": suggestion,
        "author": author,
        "votes": 0,
        "created_at": datetime.now().isoformat(),
    }
    USER_SUGGESTIONS.append(entry)
    return jsonify(entry), 201


@app.post("/api/suggestions/<int:sid>/vote")
def vote_suggestion(sid: int):
    """Upvote a suggestion."""
    for s in USER_SUGGESTIONS:
        if s["id"] == sid:
            s["votes"] += 1
            return jsonify(s)
    return jsonify({"error": "not found"}), 404


@app.get("/api/suggestions")
def list_suggestions():
    """List user suggestions, optionally filtered by incident_type."""
    inc_type = request.args.get("incident_type", "").strip()
    items = USER_SUGGESTIONS
    if inc_type:
        items = [s for s in items if s["incident_type"] == inc_type]
    return jsonify(sorted(items, key=lambda x: x["votes"], reverse=True))


def _month_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m")


def _parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s)


def _pct(part: int, whole: int) -> float:
    if whole <= 0:
        return 0.0
    return round((part / whole) * 100, 1)


def _get_cause_model():
    global _CAUSE_MODEL, _CAUSE_MODEL_LOAD_ERROR
    if SentenceTransformer is None:
        return None
    if _CAUSE_MODEL is not None:
        return _CAUSE_MODEL
    if _CAUSE_MODEL_LOAD_ERROR:
        return None
    try:
        _CAUSE_MODEL = SentenceTransformer(CAUSE_MODEL_NAME)
        return _CAUSE_MODEL
    except Exception as exc:  # pragma: no cover - depends on runtime env/model download
        _CAUSE_MODEL_LOAD_ERROR = str(exc)
        return None


def _classify_cause_with_model(cause_text: str) -> tuple[str | None, float | None]:
    global _CAUSE_MODEL_LABEL_EMBEDDINGS

    model = _get_cause_model()
    if model is None or util is None:
        return None, None

    label_texts = [
        f"{label}. signals: {', '.join(keywords)}"
        for label, keywords in CAUSE_TAXONOMY_RULES
    ]
    if _CAUSE_MODEL_LABEL_EMBEDDINGS is None:
        _CAUSE_MODEL_LABEL_EMBEDDINGS = model.encode(
            label_texts, convert_to_tensor=True, normalize_embeddings=True
        )

    query_embedding = model.encode(
        cause_text, convert_to_tensor=True, normalize_embeddings=True
    )
    similarities = util.cos_sim(query_embedding, _CAUSE_MODEL_LABEL_EMBEDDINGS)[0]
    best_index = int(similarities.argmax().item())
    best_score = float(similarities[best_index].item())
    if best_score < CAUSE_MODEL_MIN_CONFIDENCE:
        return None, round(best_score, 3)
    return CAUSE_TAXONOMY_RULES[best_index][0], round(best_score, 3)


def _select_summary_sentences_with_model(
    sentences: list[str], query: str, max_sentences: int = 2
) -> str | None:
    model = _get_cause_model()
    if model is None or util is None or not sentences:
        return None

    cleaned = [s.strip() for s in sentences if s and s.strip()]
    if not cleaned:
        return None

    try:
        sentence_embeddings = model.encode(
            cleaned, convert_to_tensor=True, normalize_embeddings=True
        )
        query_embedding = model.encode(
            query, convert_to_tensor=True, normalize_embeddings=True
        )
        similarities = util.cos_sim(query_embedding, sentence_embeddings)[0]
        ranked = sorted(
            range(len(cleaned)),
            key=lambda idx: float(similarities[idx].item()),
            reverse=True,
        )[:max_sentences]
        ranked.sort()
        return " ".join(cleaned[i] for i in ranked)
    except Exception:
        return None


def _cluster_semantic_causes_with_hdbscan(
    extracted_causes: list[str],
    normalized_labels: list[str],
) -> tuple[list[dict], dict]:
    model = _get_cause_model()
    if model is None:
        return [], {"available": False, "reason": "model_unavailable"}
    if hdbscan is None:
        return [], {"available": False, "reason": "hdbscan_unavailable"}
    if len(extracted_causes) < 6:
        return [], {"available": False, "reason": "insufficient_samples"}

    try:
        embeddings = model.encode(
            extracted_causes, convert_to_numpy=True, normalize_embeddings=True
        )
        min_cluster_size = max(3, min(10, len(extracted_causes) // 6))
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=2,
            metric="euclidean",
            cluster_selection_method="eom",
        )
        cluster_labels = clusterer.fit_predict(embeddings)
    except Exception as exc:
        return [], {"available": False, "reason": f"cluster_error: {exc}"}

    grouped: dict[int, list[int]] = defaultdict(list)
    noise_count = 0
    for idx, cluster_id in enumerate(cluster_labels):
        cid = int(cluster_id)
        if cid < 0:
            noise_count += 1
            continue
        grouped[cid].append(idx)

    clusters = []
    total = len(extracted_causes)
    for cid, indices in sorted(grouped.items(), key=lambda item: len(item[1]), reverse=True):
        phrase_counts = Counter(extracted_causes[i] for i in indices)
        label_counts = Counter(normalized_labels[i] for i in indices)
        clusters.append(
            {
                "cluster_id": cid,
                "size": len(indices),
                "percent": _pct(len(indices), total),
                "dominant_cause": label_counts.most_common(1)[0][0] if label_counts else "Other/uncategorized",
                "top_phrases": [
                    {"phrase": phrase, "count": count}
                    for phrase, count in phrase_counts.most_common(3)
                ],
            }
        )

    meta = {
        "available": True,
        "algorithm": "hdbscan",
        "metric": "euclidean_on_normalized_embeddings",
        "min_cluster_size": min_cluster_size,
        "clusters_found": len(clusters),
        "noise_points": noise_count,
    }
    return clusters, meta




def _extract_cause_from_closure_note(note: str) -> str:
    if not note:
        return "Unspecified"
    patterns = [
        r"root cause:\s*(.+?)(?:\.|$)",
        r"caused by\s+(.+?)(?:\.|$)",
        r"due to\s+(.+?)(?:\.|$)",
        r"because\s+of\s+(.+?)(?:\.|$)",
        r"triggered by\s+(.+?)(?:\.|$)",
    ]
    for pat in patterns:
        match = re.search(pat, note, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    first_sentence = note.split(".", 1)[0].strip()
    return first_sentence if first_sentence else "Unspecified"


def _summarize_common_causes(
    top_causes: list[dict],
    total_incidents: int,
    days: int,
    selected_types: set[str],
) -> str | None:
    if _get_cause_model() is None:
        return None

    if total_incidents == 0:
        return "No incidents matched the selected filters, so no common-cause pattern could be inferred."

    scope = (
        f"{len(selected_types)} selected incident types"
        if selected_types
        else "all incident types"
    )
    primary = top_causes[0] if top_causes else None
    secondary = top_causes[1] if len(top_causes) > 1 else None
    if primary is None:
        return (
            f"Analyzed {total_incidents} incidents over {days} days for {scope}, "
            "but cause extraction produced no confident categories."
        )

    priority_action = CAUSE_ACTION_PLAYBOOK.get(
        primary["label"], "Review closure-note quality and refine remediation playbooks."
    )
    secondary_text = (
        f" Secondary contributor is {secondary['label']} ({secondary['percent']}%)."
        if secondary
        else ""
    )
    candidate_sentences = [
        f"Analyzed {total_incidents} incidents in the last {days} days for {scope}.",
        f"Primary common cause is {primary['label']} at {primary['percent']}% of matched incidents.",
        (
            f"Secondary contributor is {secondary['label']} at {secondary['percent']}%."
            if secondary else "No strong secondary contributor was detected."
        ),
        f"Priority action is: {priority_action}",
    ]
    model_summary = _select_summary_sentences_with_model(
        candidate_sentences,
        query="summarize risk trend impact and priority action for common incident causes",
        max_sentences=3,
    )
    return model_summary


def _build_incident_type_summary(
    inc_type: str,
    info: dict,
    severity_breakdown: dict,
    total_count: int,
    total_incidents: int,
    this_month_count: int,
    last_month_count: int,
    affected_databases: list[dict],
) -> str | None:
    if _get_cause_model() is None:
        return None

    actions = info.get("recommended_actions", [])

    critical = severity_breakdown.get("Critical", 0)
    high = severity_breakdown.get("High", 0)
    high_critical = critical + high
    high_critical_pct = _pct(high_critical, total_count)
    top_severity, top_sev_count = max(severity_breakdown.items(), key=lambda x: x[1]) if severity_breakdown else ("Unknown", 0)
    type_share_pct = _pct(total_count, total_incidents)

    month_delta = this_month_count - last_month_count
    if last_month_count == 0 and this_month_count > 0:
        trend_phrase = f"newly emerged this month with {this_month_count} incidents"
    elif last_month_count == 0 and this_month_count == 0:
        trend_phrase = "currently stable month over month"
    else:
        change_pct = _pct(abs(month_delta), last_month_count)
        direction = "up" if month_delta > 0 else ("down" if month_delta < 0 else "flat")
        if direction == "up":
            trend_phrase = f"rising month over month (+{change_pct}%, {last_month_count} -> {this_month_count})"
        elif direction == "down":
            trend_phrase = f"declining month over month (-{change_pct}%, {last_month_count} -> {this_month_count})"
        else:
            trend_phrase = f"flat month over month ({last_month_count} -> {this_month_count})"

    primary_db = affected_databases[0]["name"] if affected_databases else "all tracked databases"
    primary_db_count = affected_databases[0]["count"] if affected_databases else 0
    primary_db_share_pct = _pct(primary_db_count, total_count)

    if high_critical_pct >= 35:
        risk_level = "high"
    elif high_critical_pct >= 20:
        risk_level = "elevated"
    else:
        risk_level = "moderate"

    if month_delta > 0 and len(actions) > 1:
        next_action = actions[1]
    elif critical > 0 and len(actions) > 2:
        next_action = actions[2]
    else:
        next_action = actions[0] if actions else "continue targeted remediation and monitoring"

    candidate_sentences = [
        f"{inc_type} has {total_count} incidents, representing {type_share_pct}% of total incidents.",
        f"Trend is {trend_phrase}.",
        f"Risk is {risk_level}, with {high_critical} High/Critical incidents ({high_critical_pct}%).",
        f"Most common severity is {top_severity} with {top_sev_count} cases.",
        f"Impact is concentrated on {primary_db}, accounting for {primary_db_share_pct}% of this incident type.",
        f"Priority action: {next_action}.",
    ]
    model_summary = _select_summary_sentences_with_model(
        candidate_sentences,
        query=f"summarize risk trend impact and priority action for {inc_type}",
        max_sentences=4,
    )
    return model_summary


def _summaries():
    incidents = INCIDENTS

    per_db = Counter([i["db_name"] for i in incidents])
    per_type = Counter([i["incident_type"] for i in incidents])
    per_sev = Counter([i["severity"] for i in incidents])

    by_month = defaultdict(int)
    for inc in incidents:
        by_month[_month_key(_parse_dt(inc["occurred_at"]))] += 1

    months_sorted = sorted(by_month.keys())
    last_month = months_sorted[-1] if months_sorted else None
    prev_month = months_sorted[-2] if len(months_sorted) >= 2 else None

    mom_change = None
    if last_month and prev_month:
        prev = by_month[prev_month]
        last = by_month[last_month]
        mom_change = {
            "previous_month": prev_month,
            "last_month": last_month,
            "previous_count": prev,
            "last_count": last,
            "delta": last - prev,
            "percent": round(((last - prev) / prev) * 100, 2) if prev else None,
        }

    return {
        "totals": {
            "incidents": len(incidents),
            "databases": len(DBS),
        },
        "by_database": per_db.most_common(),
        "by_type": per_type.most_common(),
        "by_severity": per_sev.most_common(),
        "by_month": sorted(by_month.items()),
        "mom_change": mom_change,
    }


def _patterns():
    weekday = Counter()
    hour = Counter()
    for inc in INCIDENTS:
        dt = _parse_dt(inc["occurred_at"])
        weekday[dt.strftime("%a")] += 1
        hour[dt.hour] += 1

    weekday_order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    weekday_sorted = [(d, weekday[d]) for d in weekday_order]
    hour_sorted = [(str(h).zfill(2), hour[h]) for h in range(24)]

    return {
        "weekday": weekday_sorted,
        "hour": hour_sorted,
    }


@app.get("/api/incidents")
def get_incidents():
    return jsonify(INCIDENTS)


@app.get("/api/summary")
def get_summary():
    return jsonify(_summaries())


@app.get("/api/patterns")
def get_patterns():
    return jsonify(_patterns())


@app.get("/api/incident-type-details")
def get_incident_type_details():
    """Return enriched details for each incident type."""
    type_incidents: dict[str, list[dict]] = defaultdict(list)
    for inc in INCIDENTS:
        type_incidents[inc["incident_type"]].append(inc)

    today = date.today()
    this_month = today.strftime("%Y-%m")
    last_month = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")

    results = []
    for inc_type in INCIDENT_TYPES:
        items = type_incidents[inc_type]
        total = len(items)

        # Severity breakdown
        sev_counter = Counter(i["severity"] for i in items)
        severity_breakdown = {s: sev_counter.get(s, 0) for s in SEVERITIES}

        # Affected databases
        db_counter = Counter(i["db_name"] for i in items)
        affected_dbs = [
            {"name": name, "count": count}
            for name, count in db_counter.most_common()
        ]

        # Application team contribution
        app_team_counter = Counter(i.get("app_team", "Unknown Team") for i in items)
        app_team_contribution = [
            {
                "team": team,
                "count": count,
                "percent": _pct(count, total),
            }
            for team, count in app_team_counter.most_common()
        ]

        # Recent trend (this month vs last month)
        this_count = sum(
            1 for i in items if _parse_dt(i["occurred_at"]).strftime("%Y-%m") == this_month
        )
        last_count = sum(
            1 for i in items if _parse_dt(i["occurred_at"]).strftime("%Y-%m") == last_month
        )
        if last_count > 0:
            trend = "up" if this_count > last_count else ("down" if this_count < last_count else "flat")
        else:
            trend = "up" if this_count > 0 else "flat"

        info = INCIDENT_TYPE_INFO.get(inc_type, {})
        generated_summary = _build_incident_type_summary(
            inc_type=inc_type,
            info=info,
            severity_breakdown=severity_breakdown,
            total_count=total,
            total_incidents=len(INCIDENTS),
            this_month_count=this_count,
            last_month_count=last_count,
            affected_databases=affected_dbs,
        )
        results.append({
            "type": inc_type,
            "total_count": total,
            "severity_breakdown": severity_breakdown,
            "affected_databases": affected_dbs,
            "app_team_count": len(app_team_counter),
            "app_team_contribution": app_team_contribution,
            "recent_trend": trend,
            "description": info.get("description", ""),
            "generated_summary": generated_summary,
            "common_causes": info.get("common_causes", []),
            "recommended_actions": info.get("recommended_actions", []),
        })

    results.sort(key=lambda x: x["total_count"], reverse=True)
    return jsonify(results)


@app.get("/api/common-causes")
def get_common_causes():
    period = request.args.get("period", "90d").strip().lower()
    days = PERIOD_DAY_OPTIONS.get(period, 90)

    raw_types = request.args.get("types", "").strip()
    selected_types = {t.strip() for t in raw_types.split(",") if t.strip()}

    today = date.today()
    start_date = today - timedelta(days=days)

    filtered = []
    for inc in INCIDENTS:
        inc_dt = _parse_dt(inc["occurred_at"]).date()
        if inc_dt < start_date:
            continue
        if selected_types and inc["incident_type"] not in selected_types:
            continue
        filtered.append(inc)

    cause_counter = Counter()
    cause_samples: dict[str, str] = {}
    cause_confidence: dict[str, list[float]] = defaultdict(list)
    extracted_counter = Counter()
    extracted_items: list[str] = []
    normalized_items: list[str] = []
    model_classifications = 0
    rule_classifications = 0
    fallback_classifications = 0
    for inc in filtered:
        note = inc.get("closure_note", "")
        extracted = _extract_cause_from_closure_note(note)
        extracted_counter[extracted] += 1

        model_label, model_score = _classify_cause_with_model(extracted)
        if model_label:
            normalized = model_label
            model_classifications += 1
            cause_confidence[normalized].append(model_score or 0.0)
        else:
            normalized = _normalize_cause(extracted)
            if model_score is None:
                rule_classifications += 1
            else:
                fallback_classifications += 1

        cause_counter[normalized] += 1
        cause_samples.setdefault(normalized, extracted)
        extracted_items.append(extracted)
        normalized_items.append(normalized)

    total = len(filtered)
    top_causes = []
    for label, count in cause_counter.most_common(8):
        top_causes.append(
            {
                "label": label,
                "count": count,
                "percent": _pct(count, total),
                "sample": cause_samples.get(label, ""),
                "avg_confidence": round(sum(cause_confidence[label]) / len(cause_confidence[label]), 3)
                if cause_confidence.get(label)
                else None,
            }
        )

    narrative_summary = _summarize_common_causes(
        top_causes=top_causes,
        total_incidents=total,
        days=days,
        selected_types=selected_types,
    )
    semantic_clusters, clustering_engine = _cluster_semantic_causes_with_hdbscan(
        extracted_causes=extracted_items,
        normalized_labels=normalized_items,
    )
    model_available = _get_cause_model() is not None

    return jsonify(
        {
            "period": period,
            "days": days,
            "window_start": start_date.isoformat(),
            "window_end": today.isoformat(),
            "selected_types": sorted(selected_types) if selected_types else [],
            "total_incidents_analyzed": total,
            "summary": narrative_summary,
            "analysis_engine": {
                "model_name": CAUSE_MODEL_NAME,
                "model_available": model_available,
                "mode": "embedding+rules" if model_available else "rules-only",
                "summary_mode": "embedding-sentence-selection"
                if (model_available and narrative_summary)
                else "disabled_no_model",
                "model_min_confidence": CAUSE_MODEL_MIN_CONFIDENCE,
                "model_classifications": model_classifications,
                "rule_classifications": rule_classifications,
                "fallback_classifications": fallback_classifications,
                "model_load_error": _CAUSE_MODEL_LOAD_ERROR,
            },
            "clustering_engine": clustering_engine,
            "semantic_clusters": semantic_clusters,
            "top_causes": top_causes,
            "top_extracted_causes": [
                {"cause": cause, "count": count, "percent": _pct(count, total)}
                for cause, count in extracted_counter.most_common(8)
            ],
        }
    )


@app.post("/api/track")
def track_event():
    payload = request.get_json(silent=True) or {}
    name = payload.get("name")
    if not name:
        return jsonify({"ok": False, "error": "missing name"}), 400

    EVENT_COUNTS[name] += 1
    EVENT_LOG.append(
        {
            "name": name,
            "at": datetime.utcnow().isoformat(),
            "meta": payload.get("meta", {}),
        }
    )
    return jsonify({"ok": True})


@app.get("/api/metrics")
def get_metrics():
    return jsonify(
        {
            "counts": EVENT_COUNTS.most_common(),
            "recent": EVENT_LOG[-25:],
        }
    )


# ────────────────────────────────────────────────────────────
# Phase 1: Incident Lifecycle – Create, Transition, Comments
# ────────────────────────────────────────────────────────────

@app.post("/api/incidents")
def create_incident():
    """Create a new incident."""
    global _inc_sequence
    body = request.get_json(force=True, silent=True) or {}
    required = ["db_name", "incident_type", "severity"]
    missing = [f for f in required if not body.get(f)]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400
    inc_type = body["incident_type"]
    sev = body["severity"]
    if inc_type not in INCIDENT_TYPES:
        return jsonify({"error": f"Unknown incident_type. Valid: {INCIDENT_TYPES}"}), 400
    if sev not in SEVERITIES:
        return jsonify({"error": f"Unknown severity. Valid: {SEVERITIES}"}), 400
    db_info = next((d for d in DBS if d["name"] == body["db_name"]), None)
    if db_info is None:
        valid_dbs = [d["name"] for d in DBS]
        return jsonify({"error": f"Unknown db_name. Valid: {valid_dbs}"}), 400

    _inc_sequence += 1
    now = datetime.now()
    inc_id = f"INC-{now.strftime('%Y%m%d')}-{_inc_sequence:04d}"
    bi = _compute_business_impact(sev, inc_type)
    app_team = body.get("app_team", "")
    if app_team and app_team not in APP_TEAMS:
        return jsonify({"error": f"Unknown app_team. Valid: {APP_TEAMS}"}), 400

    incident = {
        "id": inc_id,
        "db_name": body["db_name"],
        "db_type": db_info["type"],
        "engine": db_info["engine"],
        "incident_type": inc_type,
        "severity": sev,
        "status": "Open",
        "occurred_at": body.get("occurred_at", now.isoformat()),
        "acknowledged_at": None,
        "resolved_at": None,
        "closed_at": None,
        "closure_note": None,
        "root_cause": None,
        "root_cause_category": None,
        "root_cause_confidence": None,
        "assigned_to": body.get("assigned_to"),
        "app_team": app_team or None,
        "business_impact": bi,
        "resolution_hours": None,
        "incident_source": INCIDENT_SOURCE_MAP.get(inc_type, "Other"),
        "description": body.get("description", ""),
    }
    INCIDENTS.append(incident)
    _INCIDENTS_BY_ID[inc_id] = incident
    AUDIT_LOG.append({"incident_id": inc_id, "action": "created", "from": None, "to": "Open", "by": body.get("author", "system"), "at": now.isoformat()})
    return jsonify(incident), 201


def _find_incident(inc_id: str):
    return _INCIDENTS_BY_ID.get(inc_id)


@app.post("/api/incidents/<inc_id>/transition")
def transition_incident(inc_id: str):
    """Transition an incident to a new status."""
    global _comment_counter
    inc = _find_incident(inc_id)
    if inc is None:
        return jsonify({"error": "Incident not found"}), 404
    body = request.get_json(force=True, silent=True) or {}
    new_status = (body.get("status") or "").strip()
    if new_status not in INCIDENT_STATUSES:
        return jsonify({"error": f"Invalid status. Valid: {INCIDENT_STATUSES}"}), 400
    current = inc["status"]
    allowed = ALLOWED_TRANSITIONS.get(current, [])
    if new_status not in allowed:
        return jsonify({"error": f"Cannot transition from '{current}' to '{new_status}'. Allowed: {allowed}"}), 400

    now = datetime.now()
    old_status = current
    inc["status"] = new_status
    if new_status == "Acknowledged":
        inc["acknowledged_at"] = now.isoformat()
    elif new_status == "Resolved":
        inc["resolved_at"] = now.isoformat()
        occurred = _parse_dt(inc["occurred_at"])
        inc["resolution_hours"] = round((now - occurred).total_seconds() / 3600, 1)
    elif new_status == "Closed":
        inc["closed_at"] = now.isoformat()
        if body.get("closure_note"):
            inc["closure_note"] = body["closure_note"]

    # Auto-add a comment for the transition
    comment_text = body.get("comment", f"Status changed from {old_status} to {new_status}")
    _comment_counter += 1
    comment = {
        "id": _comment_counter,
        "incident_id": inc_id,
        "author": body.get("author", "system"),
        "type": "note",
        "content": comment_text,
        "created_at": now.isoformat(),
        "metadata": {"transition": {"from": old_status, "to": new_status}},
    }
    INCIDENT_COMMENTS[inc_id].append(comment)
    AUDIT_LOG.append({"incident_id": inc_id, "action": "transition", "from": old_status, "to": new_status, "by": body.get("author", "system"), "at": now.isoformat()})
    return jsonify({"incident": inc, "comment": comment})


@app.post("/api/incidents/<inc_id>/comments")
def add_comment(inc_id: str):
    """Add a resolution comment to an incident."""
    global _comment_counter
    inc = _find_incident(inc_id)
    if inc is None:
        return jsonify({"error": "Incident not found"}), 404
    body = request.get_json(force=True, silent=True) or {}
    content = (body.get("content") or "").strip()
    ctype = (body.get("type") or "note").strip()
    if not content:
        return jsonify({"error": "content is required"}), 400
    if ctype not in COMMENT_TYPES:
        return jsonify({"error": f"Invalid comment type. Valid: {COMMENT_TYPES}"}), 400
    _comment_counter += 1
    now = datetime.now()
    comment = {
        "id": _comment_counter,
        "incident_id": inc_id,
        "author": body.get("author", "Anonymous"),
        "type": ctype,
        "content": content,
        "created_at": now.isoformat(),
        "metadata": body.get("metadata", {}),
    }
    INCIDENT_COMMENTS[inc_id].append(comment)
    # If comment is a root_cause type, auto-suggest classification
    auto_suggestion = None
    if ctype == "root_cause":
        model_label, model_score = _classify_cause_with_model(content)
        if model_label:
            auto_suggestion = {
                "suggested_category": model_label,
                "confidence": model_score,
                "playbook_action": CAUSE_ACTION_PLAYBOOK.get(model_label, ""),
            }
    return jsonify({"comment": comment, "auto_suggestion": auto_suggestion}), 201


@app.get("/api/incidents/<inc_id>/comments")
def list_comments(inc_id: str):
    """List comments for an incident, newest first."""
    inc = _find_incident(inc_id)
    if inc is None:
        return jsonify({"error": "Incident not found"}), 404
    comments = sorted(INCIDENT_COMMENTS.get(inc_id, []), key=lambda c: c["created_at"])
    return jsonify(comments)


# ────────────────────────────────────────────────────────────
# Phase 2: Root Cause Intelligence
# ────────────────────────────────────────────────────────────

@app.post("/api/incidents/<inc_id>/root-cause")
def set_root_cause(inc_id: str):
    """Manually set or update the root cause for an incident."""
    inc = _find_incident(inc_id)
    if inc is None:
        return jsonify({"error": "Incident not found"}), 404
    body = request.get_json(force=True, silent=True) or {}
    cause = (body.get("cause") or "").strip()
    if not cause:
        return jsonify({"error": "cause is required"}), 400
    category = (body.get("category") or "").strip()
    if not category:
        # Auto-classify if not provided
        model_label, model_score = _classify_cause_with_model(cause)
        if model_label:
            category = model_label
            inc["root_cause_confidence"] = model_score
        else:
            category = _normalize_cause(cause)
            inc["root_cause_confidence"] = None
    else:
        inc["root_cause_confidence"] = 1.0   # manual = fully confident
    inc["root_cause"] = cause
    inc["root_cause_category"] = category
    AUDIT_LOG.append({"incident_id": inc_id, "action": "root_cause_set", "from": None, "to": category, "by": body.get("author", "system"), "at": datetime.now().isoformat()})
    return jsonify({"root_cause": cause, "root_cause_category": category, "confidence": inc["root_cause_confidence"]})


@app.post("/api/incidents/<inc_id>/auto-classify")
def auto_classify_incident(inc_id: str):
    """ML auto-classify root cause from all comments."""
    inc = _find_incident(inc_id)
    if inc is None:
        return jsonify({"error": "Incident not found"}), 404
    comments = INCIDENT_COMMENTS.get(inc_id, [])
    # Gather root-cause and investigation comments
    cause_texts = [c["content"] for c in comments if c["type"] in ("root_cause", "investigation")]
    if not cause_texts:
        # Fall back to closure note
        if inc.get("closure_note"):
            cause_texts = [_extract_cause_from_closure_note(inc["closure_note"])]
    if not cause_texts:
        return jsonify({"error": "No root-cause or investigation comments found to classify"}), 400
    combined = ". ".join(cause_texts)
    model_label, model_score = _classify_cause_with_model(combined)
    if not model_label:
        model_label = _normalize_cause(combined)
        model_score = None
    source_ids = [c["id"] for c in comments if c["type"] in ("root_cause", "investigation")]
    return jsonify({
        "suggested_category": model_label,
        "confidence": model_score,
        "source_comment_ids": source_ids,
        "analyzed_text": combined[:200],
        "playbook_action": CAUSE_ACTION_PLAYBOOK.get(model_label, ""),
    })


@app.get("/api/incidents/<inc_id>/similar")
def find_similar_incidents(inc_id: str):
    """Find historically similar resolved incidents."""
    inc = _find_incident(inc_id)
    if inc is None:
        return jsonify({"error": "Incident not found"}), 404
    inc_type = inc["incident_type"]
    root_cat = inc.get("root_cause_category")
    similar = []
    for other in INCIDENTS:
        if other["id"] == inc_id:
            continue
        if other["incident_type"] != inc_type:
            continue
        if other.get("status") not in ("Resolved", "Closed"):
            continue
        score = 0.5  # baseline: same type
        if root_cat and other.get("root_cause_category") == root_cat:
            score += 0.3
        if other.get("severity") == inc.get("severity"):
            score += 0.1
        if other.get("db_name") == inc.get("db_name"):
            score += 0.1
        similar.append({
            "id": other["id"],
            "incident_type": other["incident_type"],
            "severity": other["severity"],
            "root_cause": other.get("root_cause"),
            "root_cause_category": other.get("root_cause_category"),
            "resolution_hours": other.get("resolution_hours"),
            "closure_note": other.get("closure_note", "")[:120],
            "similarity_score": round(score, 2),
        })
    similar.sort(key=lambda x: x["similarity_score"], reverse=True)
    return jsonify(similar[:15])


# ────────────────────────────────────────────────────────────
# Phase 3: Recommended Actions (merged from 4 sources)
# ────────────────────────────────────────────────────────────

@app.get("/api/incidents/<inc_id>/recommended-actions")
def get_recommended_actions(inc_id: str):
    """Return ranked recommended actions from multiple sources."""
    inc = _find_incident(inc_id)
    if inc is None:
        return jsonify({"error": "Incident not found"}), 404
    inc_type = inc["incident_type"]
    root_cat = inc.get("root_cause_category")
    actions: list[dict] = []

    # Source 1: Playbook (static per category)
    if root_cat and root_cat in CAUSE_ACTION_PLAYBOOK:
        actions.append({
            "source": "playbook",
            "action": CAUSE_ACTION_PLAYBOOK[root_cat],
            "priority": "P1",
            "confidence": 1.0,
        })

    # Source 2: Type-based defaults
    info = INCIDENT_TYPE_INFO.get(inc_type, {})
    for idx, act in enumerate(info.get("recommended_actions", [])):
        actions.append({
            "source": "type_default",
            "action": act,
            "priority": "P1" if idx == 0 else "P2",
            "confidence": 0.9,
        })

    # Source 3: ML pattern – actions from similar resolved incidents
    similar_causes = Counter()
    similar_actions = Counter()
    for other in INCIDENTS:
        if other["id"] == inc_id or other["incident_type"] != inc_type:
            continue
        if other.get("status") not in ("Resolved", "Closed"):
            continue
        cn = other.get("closure_note", "")
        if cn:
            pat = re.search(r"Resolution:\s*(.+?)(?:\.|$)", cn, re.IGNORECASE)
            if pat:
                similar_actions[pat.group(1).strip()] += 1
    for act_text, count in similar_actions.most_common(3):
        actions.append({
            "source": "ml_pattern",
            "action": act_text,
            "priority": "P2",
            "confidence": round(min(count / 20, 0.95), 2),
            "similar_incidents": count,
        })

    # Source 4: Community suggestions
    suggestions = [s for s in USER_SUGGESTIONS if s["incident_type"] == inc_type]
    for s in sorted(suggestions, key=lambda x: x["votes"], reverse=True)[:3]:
        actions.append({
            "source": "community",
            "action": s["suggestion"],
            "priority": "P3",
            "votes": s["votes"],
        })

    # Deduplicate by action text
    seen = set()
    unique_actions = []
    for a in actions:
        key = a["action"].lower().strip()
        if key not in seen:
            seen.add(key)
            unique_actions.append(a)

    # Sort by priority then confidence
    priority_order = {"P1": 0, "P2": 1, "P3": 2}
    unique_actions.sort(key=lambda x: (priority_order.get(x.get("priority", "P3"), 3), -(x.get("confidence", 0))))
    return jsonify(unique_actions)


@app.get("/api/incidents/<inc_id>")
def get_incident_detail(inc_id: str):
    """Get full incident detail including comments."""
    inc = _find_incident(inc_id)
    if inc is None:
        return jsonify({"error": "Incident not found"}), 404
    comments = sorted(INCIDENT_COMMENTS.get(inc_id, []), key=lambda c: c["created_at"])
    return jsonify({**inc, "comments": comments})


@app.get("/api/audit-log")
def get_audit_log():
    """Return recent audit log entries."""
    inc_id = request.args.get("incident_id", "").strip()
    entries = AUDIT_LOG
    if inc_id:
        entries = [e for e in entries if e["incident_id"] == inc_id]
    return jsonify(entries[-50:])


@app.get("/api/executive-summary")
def get_executive_summary():
    """High-level executive summary for leadership roles."""
    from flask import request as req
    selected_team = req.args.get("app_team", "").strip()
    selected_impact = req.args.get("business_impact", "").strip()
    available_teams = sorted(set(i.get("app_team") or "Unknown" for i in INCIDENTS))
    # Count impacts before filtering so the UI knows totals per level
    impact_dist = Counter(i.get("business_impact", "Low") for i in INCIDENTS)
    incidents = INCIDENTS
    if selected_team:
        incidents = [i for i in incidents if i.get("app_team") == selected_team]
        impact_dist = Counter(i.get("business_impact", "Low") for i in incidents)
    if selected_impact:
        incidents = [i for i in incidents if i.get("business_impact") == selected_impact]
    total = len(incidents)
    today = date.today()

    # ── Severity distribution ──
    sev_counter = Counter(i["severity"] for i in incidents)
    critical_count = sev_counter.get("Critical", 0)
    high_count = sev_counter.get("High", 0)
    medium_count = sev_counter.get("Medium", 0)
    low_count = sev_counter.get("Low", 0)

    # ── Health score (0-100) ──
    # Penalize for critical/high incidents and upward MoM trend
    severity_penalty = min(40, (critical_count * 4 + high_count * 1.5) / max(total, 1) * 100)
    summary_data = _summaries()
    mom = summary_data.get("mom_change")
    trend_penalty = 0
    if mom and mom.get("delta", 0) > 0:
        trend_penalty = min(20, abs(mom["percent"] or 0) * 0.5)
    critical_ratio_penalty = min(20, (critical_count / max(total, 1)) * 200)
    health_score = max(0, min(100, round(100 - severity_penalty - trend_penalty - critical_ratio_penalty)))

    if health_score >= 80:
        health_label = "Healthy"
    elif health_score >= 60:
        health_label = "Needs Attention"
    elif health_score >= 40:
        health_label = "At Risk"
    else:
        health_label = "Critical"

    # ── Top 3 risk areas (by critical+high ratio) ──
    type_incidents: dict[str, list[dict]] = defaultdict(list)
    for inc in incidents:
        type_incidents[inc["incident_type"]].append(inc)

    risk_areas = []
    for inc_type, items in type_incidents.items():
        type_total = len(items)
        type_sev = Counter(i["severity"] for i in items)
        crit_high = type_sev.get("Critical", 0) + type_sev.get("High", 0)
        risk_ratio = crit_high / max(type_total, 1)
        info = INCIDENT_TYPE_INFO.get(inc_type, {})
        risk_areas.append({
            "type": inc_type,
            "total": type_total,
            "critical": type_sev.get("Critical", 0),
            "high": type_sev.get("High", 0),
            "risk_ratio": round(risk_ratio * 100, 1),
            "description": info.get("description", ""),
            "top_action": (info.get("recommended_actions") or ["Review and remediate"])[0],
        })
    risk_areas.sort(key=lambda x: x["risk_ratio"], reverse=True)

    # ── Team accountability matrix ──
    this_month = today.strftime("%Y-%m")
    last_month_date = today.replace(day=1) - timedelta(days=1)
    last_month = last_month_date.strftime("%Y-%m")

    team_counter = Counter(i.get("app_team", "Unknown") for i in incidents)
    team_this_month: Counter = Counter()
    team_last_month: Counter = Counter()
    team_severity: dict[str, Counter] = defaultdict(Counter)
    for inc in incidents:
        team = inc.get("app_team", "Unknown")
        team_severity[team][inc["severity"]] += 1
        m = _month_key(_parse_dt(inc["occurred_at"]))
        if m == this_month:
            team_this_month[team] += 1
        elif m == last_month:
            team_last_month[team] += 1

    teams = []
    for team, count in team_counter.most_common():
        tm = team_this_month.get(team, 0)
        lm = team_last_month.get(team, 0)
        delta = tm - lm
        sev = team_severity[team]
        teams.append({
            "team": team,
            "total": count,
            "share_percent": _pct(count, total),
            "this_month": tm,
            "last_month": lm,
            "mom_delta": delta,
            "mom_trend": "up" if delta > 0 else ("down" if delta < 0 else "flat"),
            "critical": sev.get("Critical", 0),
            "high": sev.get("High", 0),
        })

    # ── Quarterly trends ──
    quarterly: dict[str, int] = defaultdict(int)
    for inc in incidents:
        dt = _parse_dt(inc["occurred_at"])
        q = f"{dt.year}-Q{(dt.month - 1) // 3 + 1}"
        quarterly[q] += 1
    quarterly_sorted = sorted(quarterly.items())

    # ── Severity heatmap data (type × severity) ──
    heatmap = []
    for inc_type in INCIDENT_TYPES:
        items = type_incidents.get(inc_type, [])
        sev = Counter(i["severity"] for i in items)
        heatmap.append({
            "type": inc_type,
            "Critical": sev.get("Critical", 0),
            "High": sev.get("High", 0),
            "Medium": sev.get("Medium", 0),
            "Low": sev.get("Low", 0),
        })

    # ── Strategic actions ──
    strategic_actions = []
    if risk_areas:
        top_risk = risk_areas[0]
        strategic_actions.append({
            "priority": "critical",
            "title": f"Address {top_risk['type']} — Highest Risk",
            "description": f"{top_risk['type']} has a {top_risk['risk_ratio']}% critical+high rate across {top_risk['total']} incidents.",
            "action": top_risk["top_action"],
            "impact": "Significant reduction in high-severity incidents",
            "owner": "Engineering Leadership",
        })

    top_team = teams[0] if teams else None
    if top_team:
        strategic_actions.append({
            "priority": "high",
            "title": f"{top_team['team']} — Largest Incident Contributor",
            "description": f"Accounts for {top_team['share_percent']}% of all incidents ({top_team['total']} total). Review team's deployment practices and monitoring.",
            "action": "Schedule architecture review with team lead",
            "impact": "Reduce incident volume from top contributor",
            "owner": "Chapter Lead",
        })

    if mom and mom.get("delta", 0) > 0:
        strategic_actions.append({
            "priority": "high",
            "title": "Incident Volume Trending Upward",
            "description": f"Month-over-month increase of {mom.get('percent', 0)}% ({mom.get('previous_count', 0)} → {mom.get('last_count', 0)}). Investigate new sources.",
            "action": "Conduct cross-team incident review",
            "impact": "Reverse upward incident trend",
            "owner": "Application Team Heads",
        })
    elif mom and mom.get("delta", 0) < 0:
        strategic_actions.append({
            "priority": "low",
            "title": "Positive Downward Trend — Continue Momentum",
            "description": f"Month-over-month decrease of {abs(mom.get('percent', 0))}%. Document what's working.",
            "action": "Share best practices across teams",
            "impact": "Sustain improvement trajectory",
            "owner": "All Teams",
        })
    # ── SLA compliance per business impact level ──
    sla_compliance = []
    for lvl in reversed(IMPACT_LEVELS):  # Critical first
        lvl_incidents = [i for i in incidents if i.get("business_impact") == lvl]
        if not lvl_incidents:
            continue
        target_hrs = SLA_TARGETS.get(lvl, 8)
        within = sum(1 for i in lvl_incidents if i.get("resolution_hours", 0) <= target_hrs)
        breached = len(lvl_incidents) - within
        avg_res = round(sum(i.get("resolution_hours", 0) for i in lvl_incidents) / len(lvl_incidents), 1)
        max_res = round(max(i.get("resolution_hours", 0) for i in lvl_incidents), 1)
        sla_compliance.append({
            "level": lvl,
            "sla_target_hours": target_hrs,
            "total": len(lvl_incidents),
            "within_sla": within,
            "breached": breached,
            "compliance_pct": round((within / len(lvl_incidents)) * 100, 1),
            "avg_resolution_hours": avg_res,
            "max_resolution_hours": max_res,
        })

    # ── Team contribution percentages ──
    team_counter = Counter(i.get("app_team", "Unknown") for i in incidents)
    team_contribution = []
    for team_name, count in team_counter.most_common():
        team_contribution.append({
            "team": team_name,
            "count": count,
            "percentage": round((count / max(total, 1)) * 100, 1),
        })
    # ── Incident Source Breakdown (DB vs App vs Infra) ──
    source_counter = Counter(i.get("incident_source", "Other") for i in incidents)
    source_breakdown = []
    for src in INCIDENT_SOURCES:
        cnt = source_counter.get(src, 0)
        # Top incident types within this source
        type_counts = Counter(
            i["incident_type"] for i in incidents if i.get("incident_source") == src
        )
        top_types = [{"type": t, "count": c} for t, c in type_counts.most_common(3)]
        source_breakdown.append({
            "source": src,
            "count": cnt,
            "percentage": round((cnt / max(total, 1)) * 100, 1),
            "top_types": top_types,
        })

    # ── Source Trend (monthly counts per source) ──
    source_by_month: dict[str, dict[str, int]] = defaultdict(lambda: {s: 0 for s in INCIDENT_SOURCES})
    for inc in incidents:
        mk = inc["occurred_at"][:7]  # "YYYY-MM"
        src = inc.get("incident_source", "Other")
        if src in INCIDENT_SOURCES:
            source_by_month[mk][src] += 1
    source_trend = []
    for month_key in sorted(source_by_month.keys()):
        entry = {"month": month_key}
        entry.update(source_by_month[month_key])
        source_trend.append(entry)

    # ── Team × Root Cause Heatmap ──
    team_source_map: dict[str, dict[str, int]] = defaultdict(lambda: {s: 0 for s in INCIDENT_SOURCES})
    for inc in incidents:
        team_name = inc.get("app_team", "Unknown")
        src = inc.get("incident_source", "Other")
        if src in INCIDENT_SOURCES:
            team_source_map[team_name][src] += 1
    team_source_heatmap = []
    for team_name in sorted(team_source_map.keys()):
        row = {"team": team_name}
        team_total = sum(team_source_map[team_name].values())
        for src in INCIDENT_SOURCES:
            cnt = team_source_map[team_name][src]
            row[src] = cnt
            row[f"{src}_pct"] = round((cnt / max(team_total, 1)) * 100, 1)
        row["total"] = team_total
        team_source_heatmap.append(row)

    return jsonify({
        "health_score": health_score,
        "health_label": health_label,
        "total_incidents": total,
        "total_databases": len(set(i["db_name"] for i in incidents)),
        "selected_team": selected_team or None,
        "selected_impact": selected_impact or None,
        "available_teams": available_teams,
        "available_impacts": IMPACT_LEVELS,
        "impact_distribution": {lvl: impact_dist.get(lvl, 0) for lvl in IMPACT_LEVELS},
        "severity_distribution": {
            "Critical": critical_count,
            "High": high_count,
            "Medium": medium_count,
            "Low": low_count,
        },
        "mom_change": mom,
        "top_risk_areas": risk_areas[:3],
        "team_accountability": teams,
        "quarterly_trends": quarterly_sorted,
        "severity_heatmap": heatmap,
        "strategic_actions": strategic_actions,
        "sla_compliance": sla_compliance,
        "team_contribution": team_contribution,
        "source_breakdown": source_breakdown,
        "source_trend": source_trend,
        "team_source_heatmap": team_source_heatmap,
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)

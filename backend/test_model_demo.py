"""
Demo: Give a messy incident description → get:
  1. Classified root cause
  2. Extracted entities (database, host, duration, etc.)
  3. Clean, concise rewritten description with entities preserved

Uses all-MiniLM-L6-v2 from local cache (no internet).

Usage:
    source venv/bin/activate
    python test_model_demo.py
"""

import re
from sentence_transformers import SentenceTransformer, util

# ── Load model from local cache ──────────────────────────────
print("Loading model from cache …")
model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", local_files_only=True)
print("Model loaded ✓\n")

# ── Entity extraction ────────────────────────────────────────

# Patterns for hostnames like test1.aws.nonprod.com, db-prod.internal
HOST_RE = re.compile(r"(\b[\w-]+(?:\.[\w-]+){2,}\b)")

# Durations like 120ms, 5s, 2.5min, 300sec
DURATION_RE = re.compile(r"(\b\d+(?:\.\d+)?\s*(?:ms|sec|s|min|minutes?|hrs?|hours?)\b)", re.IGNORECASE)

# Percentages like 98%, 99.5%
PERCENT_RE = re.compile(r"(\b\d+(?:\.\d+)?%)")

# ORA errors like ORA-12541
ORA_RE = re.compile(r"(ORA-\d+)", re.IGNORECASE)

# Known environment keywords
ENV_RE = re.compile(r"\b(prod|nonprod|non-prod|staging|dev|uat|qa|preprod|pre-prod)\b", re.IGNORECASE)


def extract_entities(text: str) -> dict:
    """Pull out database name, host, duration, etc. from raw text."""
    entities = {}

    # Extract hostname and derive db name from first segment
    host_match = HOST_RE.search(text)
    if host_match:
        hostname = host_match.group(1)
        entities["host"] = hostname
        # First segment of hostname = database name (e.g. test1 from test1.aws.nonprod.com)
        db_name = hostname.split(".")[0]
        entities["database"] = db_name
        # Try to detect environment
        env_match = ENV_RE.search(hostname)
        if env_match:
            entities["environment"] = env_match.group(1).lower()

    # Also check for env keywords in full text if not found in hostname
    if "environment" not in entities:
        env_match = ENV_RE.search(text)
        if env_match:
            entities["environment"] = env_match.group(1).lower()

    # Duration
    dur_match = DURATION_RE.search(text)
    if dur_match:
        entities["duration"] = dur_match.group(1).strip()

    # Percentage
    pct_match = PERCENT_RE.search(text)
    if pct_match:
        entities["percent"] = pct_match.group(1)

    # ORA error
    ora_match = ORA_RE.search(text)
    if ora_match:
        entities["ora_error"] = ora_match.group(1)

    return entities


# ── Cause taxonomy + clean templates ─────────────────────────
# Templates use {database}, {host}, {duration}, {percent}, {environment}
# as optional placeholders that get filled from extracted entities.
CAUSES = {
    "Indexing issue": {
        "signals": "index, predicate, full table scan, cartesian",
        "clean_descriptions": [
            "Full table scan due to missing index on {database}",
            "Query performance degraded — no usable index found",
            "Cartesian join caused by missing WHERE predicate",
        ],
    },
    "Connection management": {
        "signals": "connection pool, connection leak, sessions, processes, blocking session, db_time",
        "clean_descriptions": [
            "Connection pool exhausted — all sessions in use on {database}",
            "Database session blocked for {duration} on {database} ({environment})",
            "Connection leak detected — sessions not being released on {database}",
            "Maximum processes limit reached on {database}",
        ],
    },
    "Execution plan regression": {
        "signals": "execution plan, optimizer, plan baseline, dbms_xplan",
        "clean_descriptions": [
            "Execution plan regressed after optimizer stats refresh on {database}",
            "SQL plan baseline invalidated — suboptimal plan on {database}",
        ],
    },
    "Lock/contention pressure": {
        "signals": "lock contention, concurrent dml, contention, enqueue, wait",
        "clean_descriptions": [
            "Row-level lock contention from concurrent DML on {database}",
            "Enqueue wait blocking transactions on {database}",
        ],
    },
    "Storage/I/O limits": {
        "signals": "iops, throughput, storage, redo, ebs, disk, latency",
        "clean_descriptions": [
            "Storage IOPS limit reached on {database} — operations stalling",
            "High I/O latency on EBS volume under load",
            "Redo log write bottleneck causing commit delays on {database}",
        ],
    },
    "Capacity saturation": {
        "signals": "cpu, undersized, burst credit, throttle, memory, db_time, high utilization",
        "clean_descriptions": [
            "CPU at {percent} on {database} — queries queuing",
            "Instance undersized for current workload on {database}",
            "Burst credits depleted — performance throttled on {database}",
        ],
    },
    "Backup/recovery pipeline": {
        "signals": "backup, rman, fra, archivelog, restore",
        "clean_descriptions": [
            "RMAN backup failed — insufficient FRA space on {database}",
            "Archivelog destination full — log shipping blocked",
        ],
    },
    "Replication/transport lag": {
        "signals": "replica, replication, standby, dataguard, apply lag",
        "clean_descriptions": [
            "Standby apply lag increasing on {database} — replication falling behind",
            "Data Guard transport lag due to network limits",
        ],
    },
    "Network/dependency": {
        "signals": "network, timeout, dns, upstream, connectivity",
        "clean_descriptions": [
            "Network timeout connecting to {host}",
            "DNS resolution failure causing connection drops",
            "Upstream dependency unavailable — requests timing out",
        ],
    },
    "Credential/access": {
        "signals": "iam, credential, auth, permission, expired",
        "clean_descriptions": [
            "IAM credentials expired on {database} — authentication failing",
            "Database access denied — permission misconfiguration on {database}",
        ],
    },
}

# ── Pre-compute embeddings ───────────────────────────────────
label_names = list(CAUSES.keys())
label_texts = [f"{name}. signals: {info['signals']}" for name, info in CAUSES.items()]
label_embs = model.encode(label_texts, convert_to_tensor=True, normalize_embeddings=True)

# Store clean templates with their raw text (placeholders stripped for embedding)
all_templates = []
template_cause = []
for cause_name, info in CAUSES.items():
    for tmpl in info["clean_descriptions"]:
        all_templates.append(tmpl)
        template_cause.append(cause_name)

# Embed the templates with placeholders replaced by generic words
embed_texts = [
    re.sub(r"\{(\w+)\}", r"\1", t)  # {database} → database, for embedding
    for t in all_templates
]
clean_embs = model.encode(embed_texts, convert_to_tensor=True, normalize_embeddings=True)


def fill_template(template: str, entities: dict) -> str:
    """Fill placeholders in a template with extracted entities."""
    result = template
    for key, value in entities.items():
        result = result.replace(f"{{{key}}}", value)
    # Remove any unfilled placeholders (and surrounding parens/prepositions)
    result = re.sub(r"\s*\(?{[\w]+}\)?\s*", " ", result)
    # Remove trailing prepositions left behind by removed placeholders
    result = re.sub(r"\s+(on|for|at|from|in)\s*$", "", result)
    result = re.sub(r"\s+(on|for|at|from|in)\s*([—–-])", r" \2", result)
    # Clean up double spaces and trailing dashes/separators
    result = re.sub(r"\s+", " ", result).strip()
    result = re.sub(r"\s*[—–-]\s*$", "", result).strip()
    return result


def process(description: str) -> dict:
    """Classify, extract entities, and rewrite a messy description."""
    # 1. Extract entities
    entities = extract_entities(description)

    # 2. Classify cause
    query_emb = model.encode(description, convert_to_tensor=True, normalize_embeddings=True)
    cause_scores = util.cos_sim(query_emb, label_embs)[0]
    best_cause_idx = int(cause_scores.argmax())
    cause = label_names[best_cause_idx]
    confidence = round(float(cause_scores[best_cause_idx]), 3)

    # 3. Find best matching clean template
    clean_scores = util.cos_sim(query_emb, clean_embs)[0]
    best_clean_idx = int(clean_scores.argmax())
    template = all_templates[best_clean_idx]

    # 4. Fill template with extracted entities
    clean_desc = fill_template(template, entities)

    return {
        "input":       description,
        "cause":       cause,
        "confidence":  confidence,
        "entities":    entities,
        "clean_desc":  clean_desc,
    }


# ── Sample messy descriptions ───────────────────────────────
samples = [
    "Missing index on the orders table causing full table scan",
    "Connection pool exhausted, all sessions busy",
    "Execution plan changed after optimizer stats refresh",
    "EBS volume hit IOPS limit, database reads stalling",
    "CPU at 98% due to undersized instance",
    "RMAN backup failed because FRA space is full",
    "Standby replication lag growing, apply rate too low",
    "DNS timeout connecting to upstream payment service",
    "IAM credential expired, database authentication failing",
    "Lock contention from concurrent DML on accounts table",
    "db_time blocking session for 120ms for test1.aws.nonprod.com",
    "high cpu 95% on prod-db1.us-east.prod.aws.com for last 30min",
    "ORA-12541 listener down on oradb.infra.staging.internal",
]

# ── Run ──────────────────────────────────────────────────────
if __name__ == "__main__":
    for desc in samples:
        r = process(desc)
        print(f"  INPUT  : {r['input']}")
        print(f"  CAUSE  : {r['cause']} (confidence: {r['confidence']})")
        if r["entities"]:
            parts = [f"{k}={v}" for k, v in r["entities"].items()]
            print(f"  ENTITIES: {', '.join(parts)}")
        print(f"  CLEAN  : {r['clean_desc']}")
        print()

"""
Tests for sentence-transformers/all-MiniLM-L6-v2 model integration.

Verifies model loading, embedding generation, cosine similarity,
cause classification, sentence selection, and semantic clustering.

Usage:
    source venv/bin/activate
    pip install sentence-transformers pytest
    pytest test_model.py -v
"""

from __future__ import annotations

import pytest
import numpy as np

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def model():
    """Load the MiniLM model once for the entire test session."""
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


@pytest.fixture(scope="session")
def cos_sim():
    """Provide the sentence-transformers cosine-similarity helper."""
    from sentence_transformers import util

    return util.cos_sim


# ---------------------------------------------------------------------------
# 1. Model Loading & Basic Properties
# ---------------------------------------------------------------------------

class TestModelLoading:
    def test_model_loads_successfully(self, model):
        assert model is not None

    def test_embedding_dimension_is_384(self, model):
        emb = model.encode("hello world")
        assert emb.shape == (384,)

    def test_batch_encoding_shape(self, model):
        texts = ["first", "second", "third"]
        embs = model.encode(texts)
        assert embs.shape == (3, 384)

    def test_normalized_embeddings_have_unit_norm(self, model):
        emb = model.encode("test sentence", normalize_embeddings=True)
        norm = float(np.linalg.norm(emb))
        assert abs(norm - 1.0) < 1e-4, f"Expected unit norm, got {norm}"


# ---------------------------------------------------------------------------
# 2. Cosine Similarity Sanity Checks
# ---------------------------------------------------------------------------

class TestCosineSimilarity:
    def test_identical_texts_have_similarity_near_one(self, model, cos_sim):
        emb = model.encode("database connection pool exhausted", convert_to_tensor=True)
        score = float(cos_sim(emb, emb)[0][0])
        assert score > 0.99

    def test_similar_texts_score_higher_than_unrelated(self, model, cos_sim):
        a = model.encode("missing index on large table", convert_to_tensor=True)
        b = model.encode("full table scan due to no index", convert_to_tensor=True)
        c = model.encode("chocolate cake recipe instructions", convert_to_tensor=True)
        sim_ab = float(cos_sim(a, b)[0][0])
        sim_ac = float(cos_sim(a, c)[0][0])
        assert sim_ab > sim_ac, (
            f"Related pair ({sim_ab:.3f}) should score higher than unrelated ({sim_ac:.3f})"
        )

    def test_symmetric_similarity(self, model, cos_sim):
        a = model.encode("backup failure", convert_to_tensor=True)
        b = model.encode("RMAN restore failed", convert_to_tensor=True)
        assert abs(float(cos_sim(a, b)[0][0]) - float(cos_sim(b, a)[0][0])) < 1e-5


# ---------------------------------------------------------------------------
# 3. Cause Classification (mirrors _classify_cause_with_model logic)
# ---------------------------------------------------------------------------

# Taxonomy from app.py
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

MIN_CONFIDENCE = 0.36


def classify_cause(model, cos_sim_fn, cause_text: str) -> tuple[str | None, float]:
    """Reproduce the classification logic from app.py for testing."""
    label_texts = [
        f"{label}. signals: {', '.join(kw)}"
        for label, kw in CAUSE_TAXONOMY_RULES
    ]
    label_embs = model.encode(label_texts, convert_to_tensor=True, normalize_embeddings=True)
    query_emb = model.encode(cause_text, convert_to_tensor=True, normalize_embeddings=True)
    sims = cos_sim_fn(query_emb, label_embs)[0]
    best_idx = int(sims.argmax().item())
    best_score = float(sims[best_idx].item())
    if best_score < MIN_CONFIDENCE:
        return None, best_score
    return CAUSE_TAXONOMY_RULES[best_idx][0], best_score


class TestCauseClassification:
    """Verify the model maps free-text causes to the right taxonomy label."""

    @pytest.mark.parametrize("cause_text, expected_label", [
        ("Missing index on the orders table causing full table scan", "Indexing issue"),
        ("Connection pool exhausted, all sessions busy", "Connection management"),
        ("Execution plan changed after stats refresh", "Execution plan regression"),
        ("Lock contention from concurrent DML on accounts table", "Lock/contention pressure"),
        ("EBS volume hit IOPS limit, reads stalling", "Storage/I/O limits"),
        ("CPU at 98% due to undersized instance", "Capacity saturation"),
        ("RMAN backup failed, FRA space full", "Backup/recovery pipeline"),
        ("Standby replication lag growing, apply rate too low", "Replication/transport lag"),
        ("DNS timeout connecting to upstream service", "Network/dependency"),
        ("IAM credential expired, authentication failing", "Credential/access"),
    ])
    def test_known_causes_classify_correctly(self, model, cos_sim, cause_text, expected_label):
        label, score = classify_cause(model, cos_sim, cause_text)
        assert label == expected_label, (
            f"Expected '{expected_label}', got '{label}' (score={score:.3f}) "
            f"for: '{cause_text}'"
        )

    def test_confidence_above_threshold_for_clear_causes(self, model, cos_sim):
        _, score = classify_cause(model, cos_sim, "full table scan no index available")
        assert score >= MIN_CONFIDENCE, f"Score {score:.3f} below threshold {MIN_CONFIDENCE}"

    def test_ambiguous_text_has_lower_confidence(self, model, cos_sim):
        _, clear_score = classify_cause(model, cos_sim, "RMAN backup to S3 failed with timeout")
        _, vague_score = classify_cause(model, cos_sim, "something went wrong")
        assert clear_score > vague_score, (
            f"Clear cause ({clear_score:.3f}) should score higher than vague ({vague_score:.3f})"
        )


# ---------------------------------------------------------------------------
# 4. Sentence Selection (mirrors _select_summary_sentences_with_model)
# ---------------------------------------------------------------------------

def select_summary_sentences(
    model, cos_sim_fn, sentences: list[str], query: str, max_sentences: int = 2
) -> str:
    """Reproduce sentence-selection logic from app.py."""
    cleaned = [s.strip() for s in sentences if s and s.strip()]
    sent_embs = model.encode(cleaned, convert_to_tensor=True, normalize_embeddings=True)
    q_emb = model.encode(query, convert_to_tensor=True, normalize_embeddings=True)
    sims = cos_sim_fn(q_emb, sent_embs)[0]
    ranked = sorted(range(len(cleaned)), key=lambda i: float(sims[i].item()), reverse=True)
    top = sorted(ranked[:max_sentences])
    return " ".join(cleaned[i] for i in top)


class TestSentenceSelection:
    SENTENCES = [
        "Analyzed 200 incidents in the last 90 days for all incident types ",
        "Primary common cause is Indexing issue at 35% of matched incidents.",
        "No strong secondary contributor was detected.",
        "Priority action is: Prioritize index review and query plan validation.",
        "db_time blocking session for 120ms for test1.aws.nonprod.com",
    ]

    def test_returns_correct_number_of_sentences(self, model, cos_sim):
        result = select_summary_sentences(
            model, cos_sim, self.SENTENCES,
            query="summarize risk and priority action", max_sentences=2,
        )
        # Should contain exactly 2 of the 4 sentences
        count = sum(1 for s in self.SENTENCES if s in result)
        assert count == 2, f"Expected 2 sentences in result, got {count}"

    def test_relevant_sentences_are_selected(self, model, cos_sim):
        result = select_summary_sentences(
            model, cos_sim, self.SENTENCES,
            query="what is the priority action to take", max_sentences=1,
        )
        assert "Priority action" in result

    def test_preserves_original_order(self, model, cos_sim):
        result = select_summary_sentences(
            model, cos_sim, self.SENTENCES,
            query="summarize incident causes and actions", max_sentences=3,
        )
        # Selected sentences should appear in their original order
        positions = [self.SENTENCES.index(s) for s in self.SENTENCES if s in result]
        assert positions == sorted(positions), "Selected sentences not in original order"


# ---------------------------------------------------------------------------
# 5. Semantic Clustering (embedding quality for HDBSCAN input)
# ---------------------------------------------------------------------------

class TestSemanticClustering:
    """Verify embeddings produce meaningful clusters for similar causes."""

    def test_similar_causes_cluster_closer(self, model):
        index_causes = [
            "missing index on orders table",
            "full table scan due to no index",
            "cartesian join missing WHERE clause",
        ]
        backup_causes = [
            "RMAN backup failed overnight",
            "FRA space full backup aborted",
            "archivelog destination is full",
        ]
        idx_embs = model.encode(index_causes, normalize_embeddings=True)
        bak_embs = model.encode(backup_causes, normalize_embeddings=True)

        # Intra-group similarity should exceed inter-group similarity
        intra_idx = float(np.mean(np.dot(idx_embs, idx_embs.T)))
        intra_bak = float(np.mean(np.dot(bak_embs, bak_embs.T)))
        inter = float(np.mean(np.dot(idx_embs, bak_embs.T)))

        assert intra_idx > inter, "Index causes should be more similar to each other"
        assert intra_bak > inter, "Backup causes should be more similar to each other"

    def test_embeddings_are_deterministic(self, model):
        text = "connection pool leak detected"
        emb1 = model.encode(text, normalize_embeddings=True)
        emb2 = model.encode(text, normalize_embeddings=True)
        assert np.allclose(emb1, emb2, atol=1e-6), "Same input should produce same embeddings"


# ---------------------------------------------------------------------------
# 6. Edge Cases & Robustness
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_empty_string_returns_valid_embedding(self, model):
        emb = model.encode("")
        assert emb.shape == (384,)

    def test_very_long_text_returns_valid_embedding(self, model):
        long_text = "database performance issue " * 200  # ~5 400 chars
        emb = model.encode(long_text)
        assert emb.shape == (384,)

    def test_special_characters_handled(self, model):
        emb = model.encode("ORA-12541: TNS:no listener 🔥 <script>alert(1)</script>")
        assert emb.shape == (384,)

    def test_classification_with_empty_input(self, model, cos_sim):
        label, score = classify_cause(model, cos_sim, "")
        # Should still return a result (possibly low confidence)
        assert isinstance(score, float)

"""Review evidence relation reasoner for a reliable literature-review multi-agent system.

This is a reusable, standard-library-only module, NOT a dataset-specific Datalog
interpreter. It accepts upstream agent outputs (document scores, feature facts,
cluster assignments, and optionally cluster-level semantic relations), then
returns ONE relation and ONE action per cluster.

The fallback relation rules are structural heuristics, not a verification that
scientific claims are supported. For literature reviews, prefer a relation
supplied by a separate evidence-analysis agent and retain source metadata.

Integration example::

    from review_reasoner import run_reasoning

    upstream_output = {
        "documents": [
            {
                "id": "paper_A",
                "score": 0.95,
                "cluster": "theme_1",
                "features": [
                    {"attribute": "trait", "value": "drought tolerance"},
                    {"attribute": "gene", "value": "G1"},
                ],
                "metadata": {"doi": "10.example/a"},
            },
            {
                "id": "paper_B",
                "score": 0.93,
                "cluster": "theme_1",
                "features": [["trait", "drought tolerance"]],
            },
        ],
        "cluster_relations": {"theme_1": "convergence"},
    }
    output = run_reasoning(upstream_output)
    # output["results"][0]["action"] == "action_convergence"

CLI::

    python review_reasoner.py input.json --output results.json

Python >= 3.9. No third-party dependencies.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

__all__ = [
    "ReviewReasoner",
    "ReviewReasonerError",
    "run_reasoning",
    "RELATION_ACTIONS",
    "DEFAULT_RELATION_PRIORITY",
]

RELATION_ACTIONS = {
    "convergence": "action_convergence",
    "composition": "action_composite",
    "interleaved": "action_interleaved",
    "atomic": "action_atomic",
    "missing": "action_missing",
}

# Only used if an evidence-analysis agent has not assigned a relation.
DEFAULT_RELATION_PRIORITY = (
    "convergence",
    "composition",
    "interleaved",
    "atomic",
)


class ReviewReasonerError(ValueError):
    """Invalid input to the review reasoning module."""


def _require_string(value: Any, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ReviewReasonerError(f"{context} must be a nonempty string")
    return value.strip()


def _check_json_serializable(value: Any, context: str) -> None:
    try:
        json.dumps(value, allow_nan=False, ensure_ascii=False)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ReviewReasonerError(
            f"{context} must contain JSON-serializable values"
        ) from exc


def _normalize_features(raw: Any, context: str) -> List[Dict[str, Any]]:
    """Accept mapping, [attribute, value] pairs, or feature objects."""
    if raw is None:
        return []

    if isinstance(raw, Mapping):
        items = list(raw.items())
    elif isinstance(raw, list):
        items = []
        for index, entry in enumerate(raw):
            if isinstance(entry, Mapping):
                if "attribute" not in entry or "value" not in entry:
                    raise ReviewReasonerError(
                        f"{context}[{index}] needs 'attribute' and 'value'"
                    )
                items.append((entry["attribute"], entry["value"]))
            elif isinstance(entry, (list, tuple)) and len(entry) == 2:
                items.append((entry[0], entry[1]))
            else:
                raise ReviewReasonerError(
                    f"{context}[{index}] must be a feature object or pair"
                )
    else:
        raise ReviewReasonerError(f"{context} must be a list or mapping")

    normalized = []
    for index, (attr, value) in enumerate(items):
        attr = _require_string(attr, f"{context}[{index}].attribute")
        _check_json_serializable(value, f"{context}[{index}].value")
        normalized.append({"attribute": attr, "value": value})
    return normalized


def _normalize_relation(value: Any, context: str) -> str:
    relation = _require_string(value, context).lower()
    # Support the action's spelling without changing the canonical relation.
    if relation == "composite":
        relation = "composition"
    if relation not in RELATION_ACTIONS:
        raise ReviewReasonerError(
            f"{context} must be one of: {', '.join(RELATION_ACTIONS)}"
        )
    return relation


def _validate_documents(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        raise ReviewReasonerError("'documents' must be a list")

    documents: List[Dict[str, Any]] = []
    identifiers = set()
    for index, item in enumerate(raw):
        context = f"documents[{index}]"
        if not isinstance(item, Mapping):
            raise ReviewReasonerError(f"{context} must be an object")

        doc_id = _require_string(item.get("id"), f"{context}.id")
        if doc_id in identifiers:
            raise ReviewReasonerError(f"Duplicate document id: {doc_id!r}")
        identifiers.add(doc_id)

        score = item.get("score")
        if (isinstance(score, bool) or not isinstance(score, (int, float))
                or not math.isfinite(score) or not 0 <= score <= 1):
            raise ReviewReasonerError(
                f"{context}.score must be a finite number between 0 and 1"
            )

        cluster = _require_string(item.get("cluster"), f"{context}.cluster")
        features = _normalize_features(item.get("features", []), f"{context}.features")
        metadata = item.get("metadata", {})
        if not isinstance(metadata, Mapping):
            raise ReviewReasonerError(f"{context}.metadata must be an object")
        _check_json_serializable(metadata, f"{context}.metadata")

        documents.append({
            "id": doc_id,
            "score": float(score),
            "cluster": cluster,
            "features": features,
            "metadata": dict(metadata),
        })
    return documents


def _compare_values(first: Any, second: Any) -> bool:
    # Equality also works for JSON arrays and objects, unlike a set-based check.
    return first == second


def _detected_relations(documents: Sequence[Mapping[str, Any]]) -> Dict[str, bool]:
    """Replicate the four structural predicates in the supplied Meta-Prompt."""
    pairs = combinations(documents, 2)
    convergence = False
    interleaved = False

    for first, second in pairs:
        for f1 in first["features"]:
            for f2 in second["features"]:
                if _compare_values(f1["value"], f2["value"]):
                    convergence = True
                else:
                    interleaved = True
        if convergence and interleaved:
            break

    composition = any(
        left["attribute"] != right["attribute"]
        for document in documents
        for left, right in combinations(document["features"], 2)
    )
    return {
        "convergence": convergence,
        "composition": composition,
        "interleaved": interleaved,
        "atomic": bool(documents),
    }


class ReviewReasoner:
    """Callable reasoning component usable by any agent orchestrator.

    Args:
        threshold: Keep a document when score >= threshold AND features exist.
        relation_priority: Deterministic fallback priority when no upstream
            relation is supplied. Contains each non-missing relation once.

    Upstream input shape::

        {
          "query": "Optional natural-language research question",
          "documents": [
            {"id": "unique-id", "score": 0.95, "cluster": "theme-id",
             "features": [["attribute", "value"], ...],
             "metadata": {"doi": "...", "title": "..."}}
          ],
          "cluster_relations": {"theme-id": "convergence"},  # optional
          "expected_clusters": ["theme-id", "other-theme"]  # optional
        }

    Each cluster produces exactly one result. Empty clusters, including those
    emptied by filtering, produce 'action_missing'. The optional relation
    supplied by the upstream semantic agent takes precedence over fallback
    rules. The query is context for upstream agents; this module does not
    calculate similarity scores or infer clusters from unstructured text.
    """

    def __init__(
        self,
        threshold: float = 0.90,
        relation_priority: Optional[Sequence[str]] = None,
    ) -> None:
        if (isinstance(threshold, bool)
                or not isinstance(threshold, (int, float))
                or not math.isfinite(threshold)
                or not 0 <= threshold <= 1):
            raise ReviewReasonerError("threshold must be between 0 and 1")
        self.threshold = float(threshold)

        priority = (DEFAULT_RELATION_PRIORITY if relation_priority is None
                    else tuple(relation_priority))
        priority = tuple(
            _normalize_relation(item, "relation_priority")
            for item in priority
        )
        if set(priority) != set(DEFAULT_RELATION_PRIORITY) or len(priority) != 4:
            raise ReviewReasonerError(
                "relation_priority must contain convergence, composition, "
                "interleaved and atomic exactly once"
            )
        self.relation_priority = priority

    def run(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ReviewReasonerError("Input payload must be a JSON object")
        documents = _validate_documents(payload.get("documents", []))

        raw_relations = payload.get("cluster_relations", {})
        if not isinstance(raw_relations, Mapping):
            raise ReviewReasonerError("cluster_relations must be an object")
        assigned = {
            _require_string(cluster, "cluster_relations key"):
                _normalize_relation(rel, f"cluster_relations[{cluster!r}]")
            for cluster, rel in raw_relations.items()
        }

        raw_expected = payload.get("expected_clusters", [])
        if not isinstance(raw_expected, list):
            raise ReviewReasonerError("expected_clusters must be a list")
        expected = [
            _require_string(cluster, "expected_clusters item")
            for cluster in raw_expected
        ]

        # Preserve original order of encountered/declared cluster IDs.
        cluster_ids = list(dict.fromkeys(
            [d["cluster"] for d in documents] + expected + list(assigned)
        ))
        kept: List[Dict[str, Any]] = []
        discarded: List[str] = []
        discard_reasons: Dict[str, str] = {}
        for doc in documents:
            if doc["score"] < self.threshold:
                discarded.append(doc["id"])
                discard_reasons[doc["id"]] = "below_threshold"
            elif not doc["features"]:
                discarded.append(doc["id"])
                discard_reasons[doc["id"]] = "no_features"
            else:
                kept.append(doc)

        clusters: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for doc in kept:
            clusters[doc["cluster"]].append(doc)

        if not cluster_ids:
            cluster_ids = [None]  # A global missing result if no input exists.

        results = []
        for cluster_id in cluster_ids:
            group = clusters.get(cluster_id, [])
            flags = _detected_relations(group)

            if not group:
                relation, selected_by = "missing", "empty_cluster"
            elif cluster_id in assigned:
                relation, selected_by = assigned[cluster_id], "upstream_agent"
                if relation == "missing":
                    raise ReviewReasonerError(
                        f"Cluster {cluster_id!r} is nonempty, "
                        "so its relation cannot be missing"
                    )
            else:
                relation = next(rel for rel in self.relation_priority if flags[rel])
                selected_by = "structural_rules"

            result: Dict[str, Any] = {
                "cluster": cluster_id,
                "relation": relation,
                "action": RELATION_ACTIONS[relation],
                "documents": [doc["id"] for doc in group],
                "features": {doc["id"]: doc["features"] for doc in group},
                "selected_by": selected_by,
            }
            # Carry provenance into downstream writing/citation agents.
            sources = {doc["id"]: doc["metadata"] for doc in group if doc["metadata"]}
            if sources:
                result["sources"] = sources
            results.append(result)

        return {
            "threshold": self.threshold,
            "kept": [d["id"] for d in kept],
            "discarded": discarded,
            "discard_reasons": discard_reasons,
            "results": results,
        }

    def __call__(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        """Allow ``reasoner(agent_output)`` inside an agent tool wrapper."""
        return self.run(payload)


def run_reasoning(
    payload: Mapping[str, Any],
    *,
    threshold: float = 0.90,
    relation_priority: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """Single-call API: accept agent-produced JSON-like dict, return JSON dict."""
    return ReviewReasoner(threshold, relation_priority).run(payload)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", help="JSON input produced by upstream agents")
    parser.add_argument("--output", "-o", help="Output JSON path (default: stdout)")
    parser.add_argument("--threshold", type=float, default=0.90)
    parser.add_argument(
        "--priority", default=",".join(DEFAULT_RELATION_PRIORITY),
        help="Comma-separated fallback order, e.g. convergence,interleaved,composition,atomic",
    )
    args = parser.parse_args(argv)

    try:
        with Path(args.input).open("r", encoding="utf-8") as stream:
            payload = json.load(stream)
        priority = [part.strip() for part in args.priority.split(",")]
        output = run_reasoning(
            payload, threshold=args.threshold, relation_priority=priority
        )
        result_json = json.dumps(output, indent=2, ensure_ascii=False, allow_nan=False)
        if args.output:
            Path(args.output).write_text(result_json + "\n", encoding="utf-8")
        else:
            print(result_json)
        return 0
    except (ReviewReasonerError, json.JSONDecodeError, OSError) as exc:
        parser.exit(2, f"review_reasoner: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())

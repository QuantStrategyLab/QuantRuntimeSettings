"""Independently validate and project development review messages in QRS."""

from __future__ import annotations

import argparse
import copy
import fcntl
import hashlib
import json
import math
import os
import re
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping


SCHEMA = "qsl.development_research_review.v1"
STATE_SCHEMA = "qsl.development_research_review_state.v1"
SOURCE_SUMMARY_SHA256 = "7c4a2dcf03c2becb19c012e015f86c5a1f5b6f845afd7d88516a2c515462da91"
A_UPSTREAM_INPUT_INDEX_SHA256 = "c2bf94e786c2674bebcc893e0a054a1f15dd7a40b0749aaf4ca6ca755e3322e4"
A_NORMALIZED_RESULT_SHA256 = "6db9f5fa6faed193b03fd6d053e7ad378754310b4d59e74d68dddd55d8528be2"
A_STRATEGY_REVISION_SHA256 = "9d23d3ccc8e15cbdb0d5e42fdcc2232b76899f9f269ba0442a33120660919599"
A_RUNNER_SHA256 = "0d05facfa7f35b53b95eee1e580204ece00c226c84ea13fa990c9e20a8a818c3"
A_POLICY_ID = "post_r9_active_capital_boundary_v1"
A_POLICY_SHA256 = "59a70fefa6c4714206f73945c02bc153c2c1c6d7a52adefaa9574bed30359a01"
A_SETTLEMENT_POLICY_ID = "post_r9_us_equity_dtc_standard_settlement_v1"
A_SETTLEMENT_POLICY_SHA256 = "c135c023ee7329ad6103021ffbb79d4cdfea01e903ac331865c157a6a1246853"
CANDIDATE_ID = "r8_finite_action_joint_account_60session_b0_startup_development_v2"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_IDENTITY = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
_FORBIDDEN_KEY = re.compile(r"(?:^|_)(?:uri|path|raw|account|credential|personal)(?:_|$)", re.IGNORECASE)
_AUTHORITY = {
    "review_disposition": "advisory",
    "mode": "read_only",
    "no_order": True,
    "adoption": False,
    "codegen": False,
    "experiment": False,
    "notification": False,
    "trade": False,
}
_INPUT_NAMES = {
    "source_manifest", "r6_manifest", "r6_materialized_file", "future_manifest",
    "future_page_boxx_actions_1", "future_page_boxx_bars_1",
    "future_page_qqq_actions_1", "future_page_qqq_bars_1",
    "future_page_qqqm_actions_1", "future_page_qqqm_bars_1",
    "future_page_soxl_actions_1", "future_page_soxl_bars_1",
    "future_page_soxx_actions_1", "future_page_soxx_bars_1",
    "future_page_tqqq_actions_1", "future_page_tqqq_bars_1",
    "license_basis_record", "r7_engine", "r7_policy", "r8_engine", "r8_policy",
    "capital_policy", "settlement_policy", "research_runner", "tqqq_contract",
}
_METRICS = {"cagr_252_sessions", "cumulative_return", "max_drawdown", "total_fees_usd"}
_SCALES = ("1000", "10000", "100000")
_VARIANTS = ("C0", "C1", "C2")


class DevelopmentResearchReviewError(ValueError):
    """Raised for invalid, unsafe, or conflicting development review data."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def canonical_json(value: object) -> str:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise DevelopmentResearchReviewError("invalid_json_value") from exc


def digest(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _finite(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _forbidden_key(value: object) -> bool:
    if isinstance(value, Mapping):
        return any(_FORBIDDEN_KEY.search(str(key)) or _forbidden_key(nested) for key, nested in value.items())
    if isinstance(value, list):
        return any(_forbidden_key(item) for item in value)
    return False


def _check_digest(value: object, code: str) -> str:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise DevelopmentResearchReviewError(code)
    return value


def _check_identity(value: object, code: str) -> str:
    if not isinstance(value, str) or _IDENTITY.fullmatch(value) is None:
        raise DevelopmentResearchReviewError(code)
    return value


def _check_result(value: object) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != {"session_count", "scales_usd", "variants", "paths", "comparisons"}:
        raise DevelopmentResearchReviewError("invalid_result")
    if value["session_count"] != 856 or value["scales_usd"] != [1000, 10000, 100000] or value["variants"] != list(_VARIANTS):
        raise DevelopmentResearchReviewError("invalid_result")
    paths, comparisons = value["paths"], value["comparisons"]
    if not isinstance(paths, Mapping) or set(paths) != set(_SCALES):
        raise DevelopmentResearchReviewError("invalid_result")
    if not isinstance(comparisons, Mapping) or set(comparisons) != set(_SCALES):
        raise DevelopmentResearchReviewError("invalid_result")
    for scale in _SCALES:
        scale_paths = paths[scale]
        if not isinstance(scale_paths, Mapping) or set(scale_paths) != set(_VARIANTS):
            raise DevelopmentResearchReviewError("invalid_result")
        for variant in _VARIANTS:
            metrics = scale_paths[variant]
            if not isinstance(metrics, Mapping) or set(metrics) != _METRICS or not all(_finite(item) for item in metrics.values()):
                raise DevelopmentResearchReviewError("invalid_result")
        scale_comparisons = comparisons[scale]
        if not isinstance(scale_comparisons, Mapping) or set(scale_comparisons) != {"C1_minus_C0", "C2_minus_C1"}:
            raise DevelopmentResearchReviewError("invalid_result")
        if any(not isinstance(item, Mapping) or not item or not all(_finite(number) for number in item.values())
               for item in scale_comparisons.values()):
            raise DevelopmentResearchReviewError("invalid_result")
    return copy.deepcopy(dict(value))


def _economic_identity(message: Mapping[str, Any]) -> dict[str, Any]:
    identities = message["identities"]
    return {
        "schema": message["schema"],
        "identities": identities,
        "upstream_input_index_sha256": digest(message["upstream_input_index"]),
        "policy_id": identities["policy_id"],
        "policy_sha256": identities["policy_sha256"],
        "settlement_policy_id": identities["settlement_policy_id"],
        "settlement_policy_sha256": identities["settlement_policy_sha256"],
        "cost_id": identities["cost_id"],
        "message_version": message["message_version"],
    }


def validate_development_research_review(payload: object) -> dict[str, Any]:
    """Validate the independent QRS view of the new message contract."""
    if not isinstance(payload, Mapping):
        raise DevelopmentResearchReviewError("invalid_message")
    if _forbidden_key(payload):
        raise DevelopmentResearchReviewError("forbidden_field")
    expected_fields = {
        "schema", "evidence_kind", "message_version", "created_at", "identities", "provenance",
        "upstream_input_index", "source_extension_window", "session_count", "capital_scales_usd",
        "result", "result_digest", "completion", "research_stage", "source_assurance",
        "strict_point_in_time_certified", "limitations", "authority", "duplicate_key", "message_sha256",
    }
    if set(payload) != expected_fields:
        raise DevelopmentResearchReviewError("unexpected_or_missing_field")
    message = copy.deepcopy(dict(payload))
    if message["schema"] != SCHEMA or message["evidence_kind"] != "development_research_review" or message["message_version"] != 1:
        raise DevelopmentResearchReviewError("unsupported_review_schema")
    if message["research_stage"] != "development":
        raise DevelopmentResearchReviewError("research_stage_upgrade")
    if message["source_assurance"] != "single_source_structural_only_no_cross_provider_verification":
        raise DevelopmentResearchReviewError("source_assurance_upgrade")
    if message["strict_point_in_time_certified"] is not False:
        raise DevelopmentResearchReviewError("pit_upgrade")
    if message["authority"] != _AUTHORITY:
        raise DevelopmentResearchReviewError("permission_upgrade")
    if message["completion"] != {"status": "complete", "aggregate_recovery": "matched"}:
        raise DevelopmentResearchReviewError("incomplete_aggregate")
    expected_limitations = [
        "single_source_structural_only_no_cross_provider_verification",
        "corporate_action_process_date_is_a_retrospective_proxy",
        "capital_curve_is_pre_specified_not_optimized",
        "no_paper_shadow_live_deployment_account_or_trading_authority",
    ]
    if message["limitations"] != expected_limitations:
        raise DevelopmentResearchReviewError("limitations_mismatch")
    if message["session_count"] != 856 or message["capital_scales_usd"] != [1000, 10000, 100000]:
        raise DevelopmentResearchReviewError("incomplete_aggregate")

    provenance = message["provenance"]
    if not isinstance(provenance, Mapping) or set(provenance) != {
        "source_summary_schema", "source_summary_bytes_sha256", "upstream_input_index_sha256", "normalized_result_sha256"
    }:
        raise DevelopmentResearchReviewError("invalid_provenance")
    if provenance["source_summary_schema"] != "qsl.research.post_r9_capital_study.v1":
        raise DevelopmentResearchReviewError("unsupported_source_summary")
    if _check_digest(provenance["source_summary_bytes_sha256"], "source_summary_digest_mismatch") != SOURCE_SUMMARY_SHA256:
        raise DevelopmentResearchReviewError("source_summary_digest_mismatch")

    index = message["upstream_input_index"]
    if not isinstance(index, list) or len(index) != len(_INPUT_NAMES):
        raise DevelopmentResearchReviewError("missing_upstream_input")
    normalized_index: list[dict[str, str]] = []
    for entry in index:
        if not isinstance(entry, Mapping) or set(entry) != {"name", "sha256"}:
            raise DevelopmentResearchReviewError("invalid_upstream_input")
        name = _check_identity(entry["name"], "invalid_upstream_input")
        value = _check_digest(entry["sha256"], "invalid_upstream_input")
        normalized_index.append({"name": name, "sha256": value})
    names = [entry["name"] for entry in normalized_index]
    if len(set(names)) != len(names) or set(names) != _INPUT_NAMES:
        raise DevelopmentResearchReviewError("missing_upstream_input")
    if provenance["upstream_input_index_sha256"] != digest(normalized_index):
        raise DevelopmentResearchReviewError("input_index_digest_mismatch")
    if provenance["upstream_input_index_sha256"] != A_UPSTREAM_INPUT_INDEX_SHA256:
        raise DevelopmentResearchReviewError("input_index_anchor_mismatch")

    identities = message["identities"]
    identity_fields = {
        "study_id", "candidate_id", "portfolio_id", "strategy_id", "strategy_revision_sha256",
        "producer_id", "producer_revision_sha256", "runner_id", "policy_id", "policy_sha256",
        "settlement_policy_id", "settlement_policy_sha256", "cost_id", "cost_bps",
    }
    if not isinstance(identities, Mapping) or set(identities) != identity_fields:
        raise DevelopmentResearchReviewError("invalid_identity")
    if identities["study_id"] != "post_r9_capital_study" or identities["candidate_id"] != CANDIDATE_ID:
        raise DevelopmentResearchReviewError("candidate_identity_mismatch")
    if identities["portfolio_id"] != CANDIDATE_ID or identities["strategy_id"] != CANDIDATE_ID:
        raise DevelopmentResearchReviewError("candidate_identity_mismatch")
    if identities["producer_id"] != "aiauditbridge":
        raise DevelopmentResearchReviewError("producer_identity_mismatch")
    for key in ("strategy_revision_sha256", "producer_revision_sha256", "runner_id", "policy_sha256", "settlement_policy_sha256"):
        _check_digest(identities[key], "invalid_identity")
    for key in ("policy_id", "settlement_policy_id", "cost_id"):
        _check_identity(identities[key], "invalid_identity")
    if identities["cost_bps"] != 10 or identities["cost_id"] != "flat_10bps":
        raise DevelopmentResearchReviewError("cost_identity_mismatch")
    input_digests = {entry["name"]: entry["sha256"] for entry in normalized_index}
    if identities["policy_id"] != A_POLICY_ID or identities["policy_sha256"] != A_POLICY_SHA256:
        raise DevelopmentResearchReviewError("policy_anchor_mismatch")
    if identities["settlement_policy_id"] != A_SETTLEMENT_POLICY_ID or identities["settlement_policy_sha256"] != A_SETTLEMENT_POLICY_SHA256:
        raise DevelopmentResearchReviewError("settlement_anchor_mismatch")
    if identities["strategy_revision_sha256"] != A_STRATEGY_REVISION_SHA256 or input_digests.get("r8_engine") != A_STRATEGY_REVISION_SHA256:
        raise DevelopmentResearchReviewError("strategy_anchor_mismatch")
    if identities["runner_id"] != A_RUNNER_SHA256 or input_digests.get("research_runner") != A_RUNNER_SHA256:
        raise DevelopmentResearchReviewError("runner_anchor_mismatch")
    if input_digests.get("capital_policy") != A_POLICY_SHA256 or input_digests.get("settlement_policy") != A_SETTLEMENT_POLICY_SHA256:
        raise DevelopmentResearchReviewError("policy_input_anchor_mismatch")
    if not isinstance(message["created_at"], str) or re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", message["created_at"]) is None:
        raise DevelopmentResearchReviewError("invalid_created_at")
    try:
        datetime.fromisoformat(message["created_at"].replace("Z", "+00:00"))
    except ValueError as exc:
        raise DevelopmentResearchReviewError("invalid_created_at") from exc

    result = _check_result(message["result"])
    result_digest = _check_digest(message["result_digest"], "result_digest_mismatch")
    if digest(result) != result_digest or provenance["normalized_result_sha256"] != result_digest:
        raise DevelopmentResearchReviewError("result_digest_mismatch")
    if result_digest != A_NORMALIZED_RESULT_SHA256:
        raise DevelopmentResearchReviewError("result_anchor_mismatch")
    window = message["source_extension_window"]
    if not isinstance(window, Mapping) or set(window) != {"first_session", "last_session", "future_session_count"}:
        raise DevelopmentResearchReviewError("invalid_window")
    if window["first_session"] != "2025-01-02" or window["last_session"] != "2026-08-25" or window["future_session_count"] != 412:
        raise DevelopmentResearchReviewError("invalid_window")
    if result["session_count"] != message["session_count"] or result["scales_usd"] != message["capital_scales_usd"]:
        raise DevelopmentResearchReviewError("result_identity_mismatch")

    duplicate_key = _check_digest(message["duplicate_key"], "duplicate_key_mismatch")
    if duplicate_key != digest(_economic_identity(message)):
        raise DevelopmentResearchReviewError("duplicate_key_mismatch")
    expected_message_digest = _check_digest(message["message_sha256"], "message_digest_mismatch")
    digest_body = dict(message)
    digest_body.pop("message_sha256")
    if digest(digest_body) != expected_message_digest:
        raise DevelopmentResearchReviewError("message_digest_mismatch")
    return message


def _project(message: Mapping[str, Any]) -> dict[str, Any]:
    state: dict[str, Any] = {
        "schema": STATE_SCHEMA,
        "status": "reviewable",
        "review_disposition": "advisory",
        "research_stage": "development",
        "identities": copy.deepcopy(dict(message["identities"])),
        "provenance": {
            "source_summary_bytes_sha256": message["provenance"]["source_summary_bytes_sha256"],
            "upstream_input_index_sha256": message["provenance"]["upstream_input_index_sha256"],
            "result_digest": message["result_digest"],
        },
        "source_extension_window": copy.deepcopy(dict(message["source_extension_window"])),
        "session_count": message["session_count"],
        "capital_scales_usd": list(message["capital_scales_usd"]),
        "result": copy.deepcopy(dict(message["result"])),
        "source_assurance": message["source_assurance"],
        "strict_point_in_time_certified": False,
        "limitations": list(message["limitations"]),
        "authority": dict(_AUTHORITY),
        "duplicate_key": message["duplicate_key"],
    }
    state["state_identity"] = digest(state)
    return state


class DuplicateReviewRegistry:
    """Detect duplicate economic identities in an in-process local read."""

    def __init__(self) -> None:
        self._seen: dict[str, str] = {}

    def record(self, payload: object) -> dict[str, str]:
        message = validate_development_research_review(payload)
        key, result_digest = message["duplicate_key"], message["result_digest"]
        previous = self._seen.get(key)
        if previous is not None and previous != result_digest:
            raise DevelopmentResearchReviewError("duplicate_key_conflict")
        self._seen[key] = result_digest
        return {"duplicate_key": key, "result_digest": result_digest,
                "status": "duplicate" if previous else "accepted"}


def consume_development_research_review(payload: object, *, registry: DuplicateReviewRegistry | None = None) -> dict[str, Any]:
    message = validate_development_research_review(payload)
    if registry is not None:
        registry.record(message)
    return _project(message)


def producer_revision_from_manifest(payload: object) -> str:
    """Read the expected AAB producer source revision from a local integration manifest."""
    if not isinstance(payload, Mapping):
        raise DevelopmentResearchReviewError("invalid_integration_manifest")
    found: list[str] = []
    direct = payload.get("producer_revision_sha256")
    if isinstance(direct, str):
        found.append(direct)
    for key in ("aab", "producer"):
        nested = payload.get(key)
        if isinstance(nested, Mapping) and isinstance(nested.get("producer_revision_sha256"), str):
            found.append(nested["producer_revision_sha256"])
    unique = list(dict.fromkeys(found))
    if len(unique) != 1:
        raise DevelopmentResearchReviewError("invalid_integration_manifest")
    return _check_digest(unique[0], "invalid_producer_revision")


def resolve_expected_producer_revision(cli_value: str | None, manifest: object | None) -> str:
    """Bind one expected producer revision from the CLI option, the manifest, or both when equal."""
    expected = _check_digest(cli_value, "invalid_producer_revision") if cli_value is not None else None
    from_manifest = producer_revision_from_manifest(manifest) if manifest is not None else None
    if expected is None and from_manifest is None:
        raise DevelopmentResearchReviewError("producer_revision_unbound")
    if expected is not None and from_manifest is not None and expected != from_manifest:
        raise DevelopmentResearchReviewError("producer_revision_binding_conflict")
    resolved = expected if expected is not None else from_manifest
    if resolved is None:
        raise DevelopmentResearchReviewError("producer_revision_unbound")
    return resolved


def _atomic_write(path: Path, text: str) -> None:
    directory = path.parent
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=directory)
    tmp_path = Path(tmp_name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    os.chmod(path, 0o600)


def _checked_receipt(duplicate_key: str, result_digest: str, record: Mapping[str, Any]) -> dict[str, Any]:
    receipt = record.get("receipt")
    if not isinstance(receipt, Mapping):
        raise DevelopmentResearchReviewError("invalid_receipt_store")
    if receipt.get("duplicate_key") != duplicate_key:
        raise DevelopmentResearchReviewError("invalid_receipt_store")
    provenance = receipt.get("provenance")
    if not isinstance(provenance, Mapping) or provenance.get("result_digest") != result_digest:
        raise DevelopmentResearchReviewError("invalid_receipt_store")
    body = dict(receipt)
    identity = body.pop("state_identity", None)
    if identity != digest(body):
        raise DevelopmentResearchReviewError("invalid_receipt_store")
    body["state_identity"] = identity
    return body


class LocalReceiptStore:
    """Persist one review receipt per economic duplicate key across processes."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def consume(self, message: Mapping[str, Any]) -> dict[str, Any]:
        if self.path.is_symlink():
            raise DevelopmentResearchReviewError("invalid_receipt_store")
        key, result_digest = message["duplicate_key"], message["result_digest"]
        self.path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        lock_path = self.path.with_name(f".{self.path.name}.lock")
        if lock_path.is_symlink():
            raise DevelopmentResearchReviewError("invalid_receipt_store")
        lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            os.fchmod(lock_fd, 0o600)
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
            records = self._load_records()
            current = records.get(key)
            if current is not None:
                if not isinstance(current, Mapping) or current.get("result_digest") != result_digest:
                    raise DevelopmentResearchReviewError("duplicate_key_conflict")
                return _checked_receipt(key, result_digest, current)
            receipt = _project(message)
            records[key] = {"result_digest": result_digest, "receipt": receipt}
            _atomic_write(self.path, canonical_json({"receipts": records}) + "\n")
            return receipt
        finally:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            os.close(lock_fd)

    def _load_records(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise DevelopmentResearchReviewError("invalid_receipt_store") from exc
        receipts = payload.get("receipts") if isinstance(payload, Mapping) else None
        if not isinstance(payload, Mapping) or set(payload) != {"receipts"} or not isinstance(receipts, dict):
            raise DevelopmentResearchReviewError("invalid_receipt_store")
        for key, record in receipts.items():
            if not isinstance(key, str) or not isinstance(record, Mapping):
                raise DevelopmentResearchReviewError("invalid_receipt_store")
            result_digest = record.get("result_digest")
            _check_digest(result_digest, "invalid_receipt_store")
            _checked_receipt(key, result_digest, record)
        return dict(receipts)


def consume_bound_review(
    payload: object,
    *,
    state_path: Path,
    expected_producer_revision: str,
) -> dict[str, Any]:
    """Validate one message, pin the D1 producer revision, and persist its receipt."""
    message = validate_development_research_review(payload)
    if message["identities"]["producer_revision_sha256"] != expected_producer_revision:
        raise DevelopmentResearchReviewError("producer_revision_mismatch")
    return LocalReceiptStore(state_path).consume(message)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="AIAuditBridge v1 JSON message")
    parser.add_argument("--state", required=True, type=Path, help="local receipt file for cross-process dedup")
    parser.add_argument("--expected-producer-revision", help="required AAB producer source SHA-256")
    parser.add_argument("--integration-manifest", type=Path, help="JSON manifest containing producer_revision_sha256")
    args = parser.parse_args()
    try:
        manifest = None
        if args.integration_manifest is not None:
            manifest = json.loads(args.integration_manifest.read_text(encoding="utf-8"))
        expected = resolve_expected_producer_revision(args.expected_producer_revision, manifest)
        message = json.loads(args.input.read_text(encoding="utf-8"))
        state = consume_bound_review(
            message,
            state_path=args.state,
            expected_producer_revision=expected,
        )
    except (OSError, json.JSONDecodeError) as exc:
        print(f"development review rejected: invalid_input ({type(exc).__name__})", file=sys.stderr)
        return 2
    except DevelopmentResearchReviewError as exc:
        print(f"development review rejected: {exc.code}", file=sys.stderr)
        return 2
    print(canonical_json(state))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

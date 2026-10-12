"""Durable, create-only consumption ledger for Promotion Manifest single_use_id.

Store choice: an annotated Git tag ``qsl-promotion-consumed/<single_use_id>``
in QuantRuntimeSettings, created through the GitHub REST API.

* Atomic create-if-absent: ``POST /git/refs`` returns 422 when the ref already
  exists, so two concurrent runs cannot both consume one id.
* Durable and auditable: the tag object records promotion_sha256, signature
  digest, run id and workflow SHA; nothing secret or account-identifying.
* Tamper resistance: an owner-configured tag ruleset on
  ``refs/tags/qsl-promotion-consumed/**`` must block deletion and update, so a
  consumed id cannot be "un-consumed". ``require_protected_ledger`` checks that
  the ruleset is active before consuming and fails closed otherwise.
* No new cloud infrastructure or credentials beyond the switch token.

Consumption happens BEFORE any variable write. A failure after consumption
burns the id (fail-closed); a new manifest must be issued, never a retry.
"""
from __future__ import annotations

import json
import re
import subprocess
from typing import Any, Callable, Mapping

LEDGER_REF_PREFIX = "qsl-promotion-consumed/"
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_SHA1 = re.compile(r"^[a-f0-9]{40}$")

Runner = Callable[..., subprocess.CompletedProcess]


class PromotionLedgerError(ValueError):
    pass


def _gh_api(run: Runner, args: list[str], payload: Mapping[str, Any] | None = None) -> tuple[int, Any]:
    command = ["gh", "api", "-H", "Accept: application/vnd.github+json", "-i", *args]
    if payload is not None:
        command += ["--input", "-"]
    try:
        result = run(command, input=json.dumps(payload) if payload is not None else None,
                     text=True, capture_output=True, timeout=60, check=False)
    except (OSError, subprocess.SubprocessError):
        raise PromotionLedgerError("ledger_outcome_unverified") from None
    head, _, body = (result.stdout or "").partition("\r\n\r\n")
    if not body:
        head, _, body = (result.stdout or "").partition("\n\n")
    match = re.match(r"HTTP/\S+\s+(\d{3})", head)
    if not match:
        raise PromotionLedgerError("ledger_outcome_unverified")
    try:
        parsed = json.loads(body) if body.strip() else None
    except json.JSONDecodeError:
        parsed = None
    return int(match.group(1)), parsed


LEDGER_REF_PATTERN = f"refs/tags/{LEDGER_REF_PREFIX}**"
_LEDGER_FULL_PREFIX = f"refs/tags/{LEDGER_REF_PREFIX}"
# fnmatch / File.fnmatch metacharacters (incl. brace expansion and escapes).
_GLOB_META = re.compile(r"[*?\[\]{}\\!]")


def _string_list(value: Any) -> list[str] | None:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        return None
    return value


def _exclude_may_cover_ledger(pattern: str) -> bool:
    """Conservative: True unless ``pattern`` provably cannot match any ledger ref.

    A pattern is provably disjoint only when it is a fully qualified ``refs/...``
    pattern with no whitespace whose literal prefix (text before the first glob
    metacharacter) already diverges from ``refs/tags/qsl-promotion-consumed/``
    (case-insensitively). ``~ALL``/``~DEFAULT_BRANCH``, unqualified patterns and
    anything ambiguous are treated as covering the ledger.
    """
    if not pattern.startswith("refs/") or any(ch.isspace() for ch in pattern):
        return True
    meta = _GLOB_META.search(pattern)
    literal = (pattern[:meta.start()] if meta else pattern).lower()
    ledger = _LEDGER_FULL_PREFIX.lower()
    return ledger.startswith(literal) or literal.startswith(ledger)


def _ruleset_protects_ledger(summary_id: int, detail: Any) -> bool:
    if not isinstance(detail, Mapping) or detail.get("id") != summary_id:
        return False
    if detail.get("target") != "tag" or detail.get("enforcement") != "active":
        return False
    conditions = detail.get("conditions")
    # Only a pure ref_name condition is understood; any other condition type
    # (repository_name, repository_property, ...) could narrow applicability.
    if not isinstance(conditions, Mapping) or set(conditions) != {"ref_name"}:
        return False
    ref_name = conditions["ref_name"]
    if not isinstance(ref_name, Mapping) or set(ref_name) != {"include", "exclude"}:
        return False
    include = _string_list(ref_name["include"])
    exclude = _string_list(ref_name["exclude"])
    if include is None or exclude is None or LEDGER_REF_PATTERN not in include:
        return False
    if any(_exclude_may_cover_ledger(pattern) for pattern in exclude):
        return False
    rules = detail.get("rules")
    if not isinstance(rules, list):
        return False
    types = {rule.get("type") for rule in rules if isinstance(rule, Mapping)}
    if not {"deletion", "update"} <= types:
        return False
    # bypass_actors can be hidden from non-admin tokens (key absent); when it is
    # present it must be an empty list. Independently, the ledger token itself
    # must never be able to bypass the ruleset.
    if "bypass_actors" in detail and detail["bypass_actors"] != []:
        return False
    return detail.get("current_user_can_bypass") == "never"


def require_protected_ledger(repository: str, *, run: Runner = subprocess.run) -> None:
    """Fail closed unless one active tag ruleset provably protects every ledger ref.

    GitHub rulesets layer: rules from every applicable ruleset aggregate, so an
    exclude in an unrelated ruleset cannot remove protection granted by another.
    One fully qualifying ruleset is therefore sufficient; a ruleset whose
    ref_name.exclude may match any ``refs/tags/qsl-promotion-consumed/*`` ref,
    or whose shape is not fully understood, never qualifies.
    """
    status, rulesets = _gh_api(run, [f"repos/{repository}/rulesets?targets=tag&includes_parents=true"])
    if status != 200 or not isinstance(rulesets, list):
        raise PromotionLedgerError("ledger_protection_unverified")
    for summary in rulesets:
        if not isinstance(summary, Mapping) or summary.get("enforcement") != "active":
            continue
        summary_id = summary.get("id")
        if not isinstance(summary_id, int) or isinstance(summary_id, bool) or summary_id <= 0:
            continue
        status, detail = _gh_api(run, [f"repos/{repository}/rulesets/{summary_id}"])
        if status == 200 and _ruleset_protects_ledger(summary_id, detail):
            return
    raise PromotionLedgerError("ledger_protection_missing")


def consume(repository: str, *, single_use_id: str, promotion_sha256: str, signature_sha256: str,
            commit_sha: str, run_id: str, run: Runner = subprocess.run) -> dict[str, str]:
    if not _ID.fullmatch(str(single_use_id)):
        raise PromotionLedgerError("single_use_id_invalid")
    if not _SHA256.fullmatch(str(promotion_sha256)) or not _SHA256.fullmatch(str(signature_sha256)):
        raise PromotionLedgerError("ledger_digest_invalid")
    if not _SHA1.fullmatch(str(commit_sha)) or not str(run_id).isdigit():
        raise PromotionLedgerError("ledger_context_invalid")
    require_protected_ledger(repository, run=run)
    tag = f"{LEDGER_REF_PREFIX}{single_use_id}"
    ref = f"refs/tags/{tag}"
    status, _ = _gh_api(run, [f"repos/{repository}/git/ref/tags/{tag}"])
    if status == 200:
        raise PromotionLedgerError("single_use_id_already_consumed")
    if status != 404:
        raise PromotionLedgerError("ledger_outcome_unverified")
    record = {"schema": "qsl.promotion_consumption.v1", "single_use_id": single_use_id,
              "promotion_sha256": promotion_sha256, "signature_sha256": signature_sha256,
              "run_id": str(run_id), "workflow_sha": commit_sha}
    status, tag_object = _gh_api(run, [f"repos/{repository}/git/tags", "-X", "POST"], {
        "tag": tag, "message": json.dumps(record, sort_keys=True), "object": commit_sha, "type": "commit",
    })
    if status != 201 or not isinstance(tag_object, Mapping) or not _SHA1.fullmatch(str(tag_object.get("sha", ""))):
        raise PromotionLedgerError("ledger_outcome_unverified")
    status, _ = _gh_api(run, [f"repos/{repository}/git/refs", "-X", "POST"], {"ref": ref, "sha": tag_object["sha"]})
    if status == 422:
        raise PromotionLedgerError("single_use_id_already_consumed")
    if status != 201:
        raise PromotionLedgerError("ledger_outcome_unverified")
    status, readback = _gh_api(run, [f"repos/{repository}/git/ref/tags/{tag}"])
    if (status != 200 or not isinstance(readback, Mapping)
            or (readback.get("object") or {}).get("sha") != tag_object["sha"]):
        raise PromotionLedgerError("ledger_readback_unverified")
    return {"ledger_ref": ref, "consumed": "true"}


def main() -> int:
    import os
    import sys
    try:
        result = consume(
            os.environ["GITHUB_REPOSITORY"],
            single_use_id=os.environ["PROMOTION_SINGLE_USE_ID"],
            promotion_sha256=os.environ["PROMOTION_SHA256"],
            signature_sha256=os.environ["PROMOTION_SIGNATURE_SHA256"],
            commit_sha=os.environ["GITHUB_SHA"],
            run_id=os.environ["GITHUB_RUN_ID"],
        )
    except (KeyError, PromotionLedgerError) as exc:
        print(f"promotion_not_consumed: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

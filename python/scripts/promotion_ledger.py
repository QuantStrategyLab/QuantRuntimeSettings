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


def require_protected_ledger(repository: str, *, run: Runner = subprocess.run) -> None:
    status, rulesets = _gh_api(run, [f"repos/{repository}/rulesets?targets=tag&includes_parents=true"])
    if status != 200 or not isinstance(rulesets, list):
        raise PromotionLedgerError("ledger_protection_unverified")
    for summary in rulesets:
        if not isinstance(summary, Mapping) or summary.get("enforcement") != "active":
            continue
        status, detail = _gh_api(run, [f"repos/{repository}/rulesets/{summary.get('id')}"])
        if status != 200 or not isinstance(detail, Mapping) or detail.get("target") != "tag":
            continue
        include = ((detail.get("conditions") or {}).get("ref_name") or {}).get("include") or []
        rules = {rule.get("type") for rule in detail.get("rules") or [] if isinstance(rule, Mapping)}
        bypass = detail.get("bypass_actors") or []
        # bypass_actors can be hidden from non-admin tokens; also require that
        # the ledger token itself can never bypass the ruleset.
        if (f"refs/tags/{LEDGER_REF_PREFIX}**" in include and {"deletion", "update"} <= rules and not bypass
                and detail.get("current_user_can_bypass") == "never"):
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

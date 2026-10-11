"""Run exact upstream projections offline; stdout contains synthetic data only."""
from __future__ import annotations

import argparse
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
from unittest.mock import patch

FIXTURES = Path(__file__).parent / "fixtures" / "producer_contract"


def load_source(platform, root):
    provenance = json.loads((FIXTURES / f"{platform}-source.json").read_text())
    head = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    if head != provenance["revision"]:
        raise ValueError(f"{platform}: checkout is not the pinned revision")
    source = root / provenance["path"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != provenance["sha256"]:
        raise ValueError(f"{platform}: projection source differs from pinned bytes")
    return source, provenance


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


def generate(platform, source, now):
    spec = importlib.util.spec_from_file_location(f"contract_{platform}", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    template = json.loads((FIXTURES / f"{platform}-report.json").read_text())
    slot = "account_facts" if platform == "ibkr" else "account_observation"

    def project(report, observed):
        report["started_at"] = iso(observed - timedelta(seconds=1))
        report["finished_at"] = iso(observed + timedelta(seconds=1))
        report["run_id"] = (observed - timedelta(seconds=1)).strftime("%Y%m%dT%H%M%SZ")
        report["summary"][slot]["observed_at"] = iso(observed)
        if platform == "ibkr":
            return module.project_ibkr_account_facts_history(
                report, target_id="synthetic-target",
                expected_report_prefix="gs://example-bucket/ibkr",
                source_report_uri="gs://example-bucket/ibkr/synthetic.json",
                expected_project_id="example-project", expected_service_name="synthetic-service",
                expected_runtime_revision="synthetic-00001-abc",
                expected_account_scope="live-synthetic", expected_account_selector=["U00000001"],
                expected_deployment_selector="synthetic-deployment",
            )
        prefix = "gs://example-bucket/execution-reports/charles_schwab/soxl_soxx_trend_income/"
        return module.project_schwab_account_facts_history(
            report, source_report_uri=prefix + report["started_at"][:7] + "/" + report["run_id"] + ".json",
            report_prefix=prefix, expected_service_name="synthetic-service",
            expected_runtime_revision="synthetic-00001-abc", expected_target_id="synthetic-target", now=now,
        )

    expanded = project(deepcopy(template), now - timedelta(hours=24, minutes=1))
    current = project(deepcopy(template), now - timedelta(minutes=1))
    assert "broker_reported_positions" in expanded, expanded
    assert "broker_reported_positions" in current, current
    result = {"archive_future_contract": expanded,
              "published_current_contract": module.strip_archive_only_keys(
                  project(deepcopy(template), now - timedelta(hours=25))),
              "published_newer_contract": module.strip_archive_only_keys(current)}
    # Producer omission is not a fabricated zero-holdings statement.
    for label, change in (("missing", None), ("empty", []), ("invalid", [{"symbol": "SOXL", "quantity": "NaN"}])):
        report = deepcopy(template)
        if change is None:
            del report["summary"][slot]["broker_reported_positions"]
            del report["summary"][slot]["broker_reported_positions_scope"]
        else:
            report["summary"][slot]["broker_reported_positions"] = change
        body = project(report, now - timedelta(minutes=1))
        assert "schema_version" in body, body
        assert "broker_reported_positions" not in body
        assert "broker_reported_positions_scope" not in body
        result[label] = body
    wrong_identity = deepcopy(template)
    wrong_identity["service_name"] = "wrong-service"
    rejected = project(wrong_identity, now - timedelta(minutes=1))
    assert rejected["status"] == "skipped", rejected
    result["producer_identity_rejection"] = rejected
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ibkr", type=Path, required=True)
    parser.add_argument("--schwab", type=Path, required=True)
    parser.add_argument("--now", default="2026-10-01T12:00:00Z")
    args = parser.parse_args()
    now = datetime.fromisoformat(args.now.replace("Z", "+00:00")).astimezone(timezone.utc).replace(microsecond=0)
    sources = {key: load_source(key, getattr(args, key)) for key in ("ibkr", "schwab")}
    # Install before importing upstream modules. No broker SDK, cloud CLI, HTTP,
    # subprocess, credentials or IO mocks that manufacture projection output.
    with ExitStack() as stack:
        stack.enter_context(patch.dict("os.environ", {}, clear=True))
        guards = [stack.enter_context(patch(target, side_effect=AssertionError("offline boundary attempted")))
                  for target in ("socket.socket.connect", "socket.create_connection", "subprocess.Popen",
                                 "urllib.request.urlopen", "urllib.request.build_opener")]
        output = {key: {"provenance": provenance, **generate(key, source, now)}
                  for key, (source, provenance) in sources.items()}
        for guard in guards:
            guard.assert_not_called()
    print(json.dumps(output, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()

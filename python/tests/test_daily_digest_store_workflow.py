from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "python/scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
import daily_digest_aggregator as aggregator


def workflow_body(name):
    lines = (ROOT / ".github/workflows/daily-digest-notify.yml").read_text().splitlines()
    start = lines.index("      - name: " + name)
    run = next(i for i in range(start + 1, len(lines)) if lines[i] == "        run: |")
    body = []
    for line in lines[run + 1:]:
        if line and not line.startswith("          "):
            break
        body.append(line[10:] if line else "")
    return "\n".join(body) + "\n"


class DailyDigestStoreWorkflowTests(unittest.TestCase):
    def execute_opts(self, root, **overrides):
        env = {
            "PATH": os.environ["PATH"], "GITHUB_ENV": str(root / "github-env"),
            "GITHUB_OUTPUT": str(root / "github-output"), "INPUT_EVENT_NAME": "workflow_dispatch",
            "INPUT_REF": "refs/heads/main", "INPUT_DRY_RUN": "true",
            "INPUT_PREFLIGHT_PRIVATE_STORE": "true", "INPUT_BUSINESS_DAY": "2026-10-12",
            "INPUT_LOCALE": "zh", "INPUT_LAYOUT": "sections_v2", "INPUT_INCLUDE_GITHUB": "false",
            **overrides,
        }
        body = workflow_body("Resolve dry-run and business day").replace("${{ github.event_name }}", env["INPUT_EVENT_NAME"])
        result = subprocess.run(["bash", "-c", body],
                                cwd=root, env=env, capture_output=True, text=True, timeout=15)
        def emitted(path):
            return dict(line.split("=", 1) for line in path.read_text().splitlines()) if path.exists() else {}
        outputs = emitted(root / "github-output")
        updates = emitted(root / "github-env")
        return result, {**env, **updates}, outputs, updates

    def test_private_store_preflight_main_dry_run_fills_only_empty_runner_uri(self):
        for uri in [None, ""]:
            with self.subTest(uri=uri), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                overrides = {} if uri is None else {"DIGEST_CANDIDATES_GCS_URI": uri}
                result, env, outputs, updates = self.execute_opts(root, **overrides)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(updates, {
                    "DIGEST_CANDIDATES_GCS_URI": "gs://qsl-runtime-logs-shared/digest-candidates",
                })
                self.assertEqual(env["DIGEST_CANDIDATES_GCS_URI"], updates["DIGEST_CANDIDATES_GCS_URI"])
                self.assertEqual(outputs["preflight_private_store"], "true")
                self.assertEqual(outputs["dry_run"], "true")
                self.assertEqual(outputs["layout"], "sections_v2")
                self.assertTrue((root / "data/input/daily-digest").is_dir())

    def test_private_store_preflight_preserves_configured_uri_and_legacy_candidates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "legacy.json"
            legacy.write_text('{"runs":[]}')
            existing = {
                "DIGEST_CANDIDATES_GCS_URI": "gs://synthetic-private/existing-candidates",
                "DIGEST_CANDIDATES_PATH": str(legacy), "DIGEST_CANDIDATES_JSON": '{"runs":[]}',
                "DIGEST_CANDIDATES_READER_WIF_PROVIDER": "synthetic-existing-provider",
                "DIGEST_CANDIDATES_READER_SERVICE_ACCOUNT": "synthetic-existing-reader",
            }
            result, env, outputs, updates = self.execute_opts(root, **existing)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(updates, {})
            self.assertEqual(outputs["preflight_private_store"], "true")
            for key, value in existing.items():
                self.assertEqual(env[key], value)
                self.assertNotIn(value, result.stdout + result.stderr)
            self.assertEqual(legacy.read_text(), '{"runs":[]}')

    def test_private_store_preflight_rejects_nonmanual_nondry_or_nonmain_before_materializing(self):
        rejected = [
            {"INPUT_DRY_RUN": value} for value in ["false", "", "TRUE", "1", "invalid"]
        ] + [
            {"INPUT_EVENT_NAME": event} for event in ["schedule", "push", "pull_request"]
        ] + [
            {"INPUT_REF": ref} for ref in ["refs/heads/topic", "refs/pull/1/merge", "refs/tags/main", ""]
        ]
        for overrides in rejected:
            with self.subTest(overrides=overrides), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                result, _, outputs, updates = self.execute_opts(root, **overrides)
                self.assertEqual(result.returncode, 2)
                self.assertIn("candidate_store_preflight_requires_manual_main_dry_run", result.stderr)
                self.assertEqual(outputs, {})
                self.assertEqual(updates, {})
                self.assertFalse((root / "data").exists())

    def test_invalid_private_store_preflight_flag_is_rejected_before_materializing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result, _, outputs, updates = self.execute_opts(root, INPUT_PREFLIGHT_PRIVATE_STORE="invalid")
            self.assertEqual(result.returncode, 2)
            self.assertIn("candidate_store_preflight_input_invalid", result.stderr)
            self.assertEqual(outputs, {})
            self.assertEqual(updates, {})
            self.assertFalse((root / "data").exists())

    def test_disabled_private_store_preflight_preserves_existing_options_and_legacy(self):
        for event in ["workflow_dispatch", "schedule", "push", "pull_request"]:
            for dry_run in ["true", "false", "invalid"]:
                for flag in ["false", ""]:
                    with self.subTest(event=event, dry_run=dry_run, flag=flag), tempfile.TemporaryDirectory() as tmp:
                        root = Path(tmp)
                        legacy = root / "legacy.json"
                        legacy.write_text('{"runs":[]}')
                        result, env, outputs, updates = self.execute_opts(
                            root, INPUT_PREFLIGHT_PRIVATE_STORE=flag, INPUT_EVENT_NAME=event,
                            INPUT_DRY_RUN=dry_run, INPUT_REF="refs/heads/topic",
                            DIGEST_CANDIDATES_PATH=str(legacy), DIGEST_CANDIDATES_JSON='{"runs":[]}',
                            DIGEST_CANDIDATES_GCS_URI="",
                        )
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertEqual(outputs, {
                            "preflight_private_store": "false",
                            "dry_run": "true" if event != "schedule" and dry_run == "true" else "false",
                            "business_day": "2026-10-12", "locale": "zh",
                            "layout": "v1" if event == "schedule" else "sections_v2",
                            "include_github": "false",
                        })
                        self.assertEqual(updates, {})
                        self.assertEqual(env["DIGEST_CANDIDATES_GCS_URI"], "")
                        self.assertEqual(env["DIGEST_CANDIDATES_PATH"], str(legacy))
                        self.assertEqual(env["DIGEST_CANDIDATES_JSON"], '{"runs":[]}')
                        self.assertEqual(legacy.read_text(), '{"runs":[]}')

    def execute_fetch(self, root, failure="", old_candidate=False, objects=True, initial_env=None):
        fake_bin = root / "bin"
        fake_bin.mkdir()
        fake_gcloud = fake_bin / "gcloud"
        fake_gcloud.write_text(
            "#!" + sys.executable + "\n"
            "import json, os, pathlib, sys\n"
            "stage = sys.argv[2]\n"
            "if os.environ.get('FAIL_STAGE') == stage:\n"
            "    print('private-target-account-path', file=sys.stderr)\n"
            "    sys.exit(1)\n"
            "if stage == 'ls':\n"
            "    if os.environ.get('OBJECTS') == 'true':\n"
            "        print(os.environ['DIGEST_CANDIDATES_GCS_URI'] + '/schwab/2026-10-12/private-target-account.json')\n"
            "elif stage == 'cp':\n"
            "    pathlib.Path(sys.argv[4]).write_text(os.environ['CANDIDATE_JSON'])\n"
            "else:\n"
            "    raise SystemExit(99)\n"
        )
        fake_gcloud.chmod(0o755)
        (root / "python").symlink_to(ROOT / "python", target_is_directory=True)
        candidate = {
            "platform_id": "schwab", "strategy_profile": "soxl_soxx_trend_income",
            "opaque_account_uid": "synthetic-account", "target_id": "schwab/private-target-account",
            "business_day": "2026-10-12", "actually_ran": True,
            "fill_count": 0, "order_count": 0, "cycle_count": 1,
            "equity": 123456.78,
        }
        env = {**(initial_env or {}), "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"], "RUNNER_TEMP": str(root),
               "GITHUB_ENV": str(root / "github-env"), "INPUT_BUSINESS_DAY": "2026-10-12",
               "AUTH_OUTCOME": "failure" if failure == "auth" else "success",
               "FAIL_STAGE": failure, "OBJECTS": "true" if objects else "false",
               "DIGEST_CANDIDATES_GCS_URI": (initial_env or {}).get(
                   "DIGEST_CANDIDATES_GCS_URI", "gs://synthetic-private/digest-candidates"),
               "CANDIDATE_JSON": "{broken" if failure == "merge" else json.dumps({"runs": [candidate]})}
        if old_candidate:
            base = root / "legacy.json"
            base.write_text("{invalid legacy JSON" if old_candidate == "malformed" else json.dumps({"runs": [candidate]}))
            env["DIGEST_CANDIDATES_PATH"] = str(base)
        result = subprocess.run(["bash", "-c", workflow_body("Fetch producer candidates from private store (optional)")],
                                cwd=root, env=env, capture_output=True, text=True, timeout=15)
        emitted = dict(line.split("=", 1) for line in (root / "github-env").read_text().splitlines())
        if emitted.get("DIGEST_CANDIDATES_PATH"):
            emitted["DIGEST_CANDIDATES_PATH"] = str(root / emitted["DIGEST_CANDIDATES_PATH"])
        self.assertNotIn("private-target-account", result.stdout + result.stderr)
        return result, {**env, **emitted}

    def digest_receipt(self, env, layout="sections_v2"):
        with mock.patch.dict(os.environ, env, clear=True):
            payload, text, collected = aggregator.build_digest_payload(
                business_day="2026-10-12", include_github=False, layout=layout,
            )
        return aggregator.build_receipt(payload, collected, message_chars=len(text)), text

    def test_auth_list_copy_merge_failures_record_failed_intake_and_allow_legacy_facts(self):
        for failure in ["auth", "ls", "cp", "merge"]:
            for old in [False, True]:
                with self.subTest(failure=failure, old=old), tempfile.TemporaryDirectory() as tmp:
                    result, env = self.execute_fetch(Path(tmp), failure, old_candidate=old)
                    self.assertNotEqual(result.returncode, 0)
                    expected = {"auth": "auth", "ls": "list", "cp": "copy", "merge": "merge"}[failure]
                    self.assertEqual(env["DIGEST_CANDIDATES_STORE_STATUS"], "failed")
                    self.assertEqual(env["DIGEST_CANDIDATES_STORE_REASON"], f"candidate_store_{expected}_failed")
                    for layout in ["v1", "sections_v2"]:
                        receipt, text = self.digest_receipt(env, layout)
                        self.assertTrue(receipt["source_coverage"]["has_source_failures"])
                        self.assertFalse(receipt["source_coverage"]["is_complete_for_verified_idle"])
                        self.assertEqual(receipt["source_coverage"]["github_failures"], [])
                        self.assertEqual(receipt["failures"][0]["reason_code"], f"candidate_store_{expected}_failed")
                        self.assertIsNone(receipt["total_fills"])
                        self.assertEqual(receipt["total_fills_status"], "unknown")
                        self.assertEqual(receipt["delivery_axes"]["evidence_delivery_status"], "intake_degraded")
                        self.assertIn("候选读取失败", text)
                        self.assertNotIn("已验证零成交", text)
                        if old:
                            self.assertEqual(receipt["run_count"], 1)
                            self.assertEqual(receipt["runs"][0]["fill_count"], 0)
                        else:
                            self.assertEqual(receipt["evidence_status"], "evidence_unknown")

    def test_complete_successful_list_preserves_empty_and_known_run_semantics(self):
        for objects in [False, True]:
            with self.subTest(objects=objects), tempfile.TemporaryDirectory() as tmp:
                result, env = self.execute_fetch(Path(tmp), objects=objects)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(env["DIGEST_CANDIDATES_STORE_STATUS"], "loaded")
                receipt, _ = self.digest_receipt(env)
                self.assertFalse(receipt["source_coverage"]["has_source_failures"])
                self.assertEqual(receipt["total_fills"], 0)
                self.assertEqual(receipt["total_fills_status"], "known")
                self.assertEqual(receipt["evidence_status"], "has_runs" if objects else "verified_idle")

    def test_configured_store_without_valid_outcome_cannot_claim_complete_coverage(self):
        for state in ["", "disabled", "private-target-invalid"]:
            with self.subTest(state=state), mock.patch.dict(os.environ, {
                "DIGEST_CANDIDATES_GCS_URI": "gs://synthetic-private/digest-candidates",
                "DIGEST_CANDIDATES_STORE_STATUS": state,
                "DIGEST_CANDIDATES_STORE_REASON": "private-target-secret",
            }, clear=True):
                payload, text, collected = aggregator.build_digest_payload(
                    business_day="2026-10-12", include_github=False)
                receipt = aggregator.build_receipt(payload, collected, message_chars=len(text))
                self.assertTrue(receipt["source_coverage"]["has_source_failures"])
                self.assertNotIn("private-target", json.dumps(receipt))

    def test_disabled_store_preserves_default_unknown_and_legacy_idle(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            payload, text, collected = aggregator.build_digest_payload(business_day="2026-10-12", include_github=False)
        self.assertFalse(collected.coverage.has_source_failures)
        self.assertEqual(payload.evidence_status, "evidence_unknown")
        self.assertIn("证据未知", text)
        with tempfile.TemporaryDirectory() as tmp:
            empty = Path(tmp) / "empty.json"
            empty.write_text('{"runs":[]}')
            receipt, _ = self.digest_receipt({"DIGEST_CANDIDATES_PATH": str(empty), "DIGEST_CANDIDATES_STORE_STATUS": "disabled"})
            self.assertEqual(receipt["evidence_status"], "verified_idle")

    def test_unmarked_bad_candidate_input_remains_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "bad.json"
            bad.write_text("{invalid legacy JSON")
            for state in ["", "disabled", "loaded"]:
                with self.subTest(state=state), self.assertRaises(json.JSONDecodeError):
                    self.digest_receipt({"DIGEST_CANDIDATES_PATH": str(bad), "DIGEST_CANDIDATES_STORE_STATUS": state})

    def test_required_row_fields_reject_invalid_source_without_registry_allowlist(self):
        valid = {"platform_id": "synthetic-platform", "strategy_profile": "synthetic-strategy",
                 "business_day": "2026-10-12", "actually_ran": True, "fill_count": 0}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "candidates.json"
            for field in ["platform_id", "strategy_profile", "actually_ran"]:
                path.write_text(json.dumps({"runs": [{key: value for key, value in valid.items() if key != field}]}))
                with self.subTest(missing=field), self.assertRaises(ValueError):
                    self.digest_receipt({"DIGEST_CANDIDATES_PATH": str(path)})
                with self.subTest(failed_missing=field):
                    receipt, text = self.digest_receipt({
                        "DIGEST_CANDIDATES_PATH": str(path), "DIGEST_CANDIDATES_STORE_STATUS": "failed",
                        "DIGEST_CANDIDATES_STORE_REASON": "candidate_store_merge_failed",
                    })
                    self.assertEqual(receipt["evidence_status"], "evidence_unknown")
                    self.assertIsNone(receipt["total_fills"])
                    self.assertFalse(receipt["source_coverage"]["candidates_loaded"])
                    self.assertIn("候选读取失败", text)
            for actually_ran in [True, False]:
                path.write_text(json.dumps({"runs": [{**valid, "actually_ran": actually_ran}]}))
                receipt, _ = self.digest_receipt({"DIGEST_CANDIDATES_PATH": str(path)})
                self.assertEqual(receipt["evidence_status"], "has_runs" if actually_ran else "verified_idle")
                self.assertEqual(receipt["total_fills"], 0)
                self.assertFalse(receipt["source_coverage"]["has_source_failures"])

    def test_final_workflow_forms_private_and_public_receipts_before_failure_gate(self):
        for failure, old_candidate in [("auth", True), ("", True), ("", "malformed")]:
            with self.subTest(failure=failure, old_candidate=old_candidate), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                _, env = self.execute_fetch(root, failure, old_candidate=old_candidate)
                env.update({"DIGEST_BUSINESS_DAY": "2026-10-12", "SOURCE_SHA": "a" * 40,
                            "GITHUB_STEP_SUMMARY": str(root / "step-summary")})
                send = workflow_body("Aggregate, render, and send daily digest")
                for key, value in {"layout": "v1", "locale": "zh", "include_github": "false", "dry_run": "true"}.items():
                    send = send.replace("${{ steps.opts.outputs." + key + " }}", value)
                result = subprocess.run(["bash", "-c", send], cwd=root, env=env,
                                        capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn("123456.78", result.stdout + result.stderr)
                self.assertNotIn("private-target-account", result.stdout + result.stderr)
                private_path = root / "data/output/daily-digest/receipt.json"
                private = json.loads(private_path.read_text())
                self.assertEqual(private["status"], "dry_run")
                if old_candidate != "malformed":
                    self.assertIn("private-target-account", json.dumps(private))
                    self.assertIn("123,456.78", (root / "digest-message-private.log").read_text())
                else:
                    self.assertEqual(private["evidence_status"], "evidence_unknown")
                    self.assertIn("候选读取失败", (root / "digest-message-private.log").read_text())
                self.assertEqual(private_path.stat().st_mode & 0o077, 0)
                for step in ["Prepare public receipt summary", "Summarize (no secrets)"]:
                    result = subprocess.run(["bash", "-c", workflow_body(step)], cwd=root, env=env,
                                            capture_output=True, text=True, timeout=15)
                    self.assertEqual(result.returncode, 0, result.stderr)
                public_text = (root / "data/output/daily-digest/receipt-public.json").read_text()
                summary_text = (root / "step-summary").read_text()
                for text in [public_text, summary_text]:
                    self.assertNotIn("private-target-account", text)
                    self.assertNotIn("123456.78", text)
                public = json.loads(public_text)
                self.assertEqual(public["source_sha"], "a" * 40)
                if env["DIGEST_CANDIDATES_STORE_STATUS"] == "failed":
                    self.assertIsNone(private["total_fills"])
                    self.assertIsNone(public["total_fills"])
                    self.assertIn(env["DIGEST_CANDIDATES_STORE_REASON"], public_text)
                    gate = subprocess.run(["bash", "-c", workflow_body("Require complete private candidate intake")],
                                          cwd=root, env=env, capture_output=True, text=True, timeout=15)
                    self.assertEqual(gate.returncode, 1)
                else:
                    self.assertEqual(public["total_fills"], 0)
                    self.assertEqual(public["total_fills_status"], "known")
        workflow = (ROOT / ".github/workflows/daily-digest-notify.yml").read_text()
        self.assertIn("always() && env.DIGEST_CANDIDATES_STORE_STATUS == 'failed'", workflow)
        self.assertIn("path: data/output/daily-digest/receipt-public.json", workflow)
        self.assertNotIn("path: data/output/daily-digest/receipt.json", workflow)

    def test_preflight_success_and_failure_use_existing_dry_run_receipt_and_gate(self):
        for failure in ["", "auth"]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                opts_result, opts_env, outputs, _ = self.execute_opts(root)
                self.assertEqual(opts_result.returncode, 0, opts_result.stderr)
                fetch_result, env = self.execute_fetch(root, failure, old_candidate=True, initial_env=opts_env)
                self.assertEqual(fetch_result.returncode, 0 if not failure else 1)
                env.update({"SOURCE_SHA": "a" * 40, "GITHUB_STEP_SUMMARY": str(root / "step-summary"),
                            "DIGEST_BUSINESS_DAY": outputs["business_day"], "DIGEST_DRY_RUN": outputs["dry_run"]})
                send = workflow_body("Aggregate, render, and send daily digest")
                for key in ["layout", "locale", "include_github", "dry_run"]:
                    send = send.replace("${{ steps.opts.outputs." + key + " }}", outputs[key])
                result = subprocess.run(["bash", "-c", send], cwd=root, env=env,
                                        capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                private = json.loads((root / "data/output/daily-digest/receipt.json").read_text())
                self.assertEqual(private["status"], "dry_run")
                self.assertTrue(private["dry_run"])
                self.assertFalse(private["delivered"])
                for step in ["Prepare public receipt summary", "Summarize (no secrets)"]:
                    result = subprocess.run(["bash", "-c", workflow_body(step)], cwd=root, env=env,
                                            capture_output=True, text=True, timeout=15)
                    self.assertEqual(result.returncode, 0, result.stderr)
                public_text = (root / "data/output/daily-digest/receipt-public.json").read_text()
                self.assertNotIn("private-target-account", public_text)
                self.assertNotIn("123456.78", public_text)
                self.assertNotIn(env["DIGEST_CANDIDATES_GCS_URI"], public_text)
                public = json.loads(public_text)
                self.assertEqual(public["source_sha"], "a" * 40)
                self.assertEqual(public["layout"], "sections_v2")
                self.assertEqual(public["total_fills"], None if failure else 0)
                self.assertEqual(public["total_fills_status"], "unknown" if failure else "known")
                if failure:
                    gate = subprocess.run(["bash", "-c", workflow_body("Require complete private candidate intake")],
                                          cwd=root, env=env, capture_output=True, text=True, timeout=15)
                    self.assertEqual(gate.returncode, 1)
                else:
                    # The workflow's failure-only if condition skips this step on loaded intake.
                    self.assertEqual(env["DIGEST_CANDIDATES_STORE_STATUS"], "loaded")
                    workflow = (ROOT / ".github/workflows/daily-digest-notify.yml").read_text()
                    self.assertIn("always() && env.DIGEST_CANDIDATES_STORE_STATUS == 'failed'", workflow)


if __name__ == "__main__":
    unittest.main()

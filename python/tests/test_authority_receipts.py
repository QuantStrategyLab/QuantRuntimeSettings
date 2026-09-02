from __future__ import annotations

import hashlib
import json
import re
import tomllib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RECEIPT_ROOT = ROOT / "authority" / "receipts"
EVIDENCE_ROOT = ROOT / "authority" / "evidence"
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
EXPECTED_RECEIPT_SHA256 = {
    "ai-provenance-and-evaluation-v3.json": "5a403948e027db50f0cbf2baa9a9e75abc51198d1475aad38a1c622972b406b1",
    "qsl-dependency-cohort-2026.09.0-canonical-promotion.json": "a71c78aa2a6b7477cd3065f7eabc2a2696fd45ae8e3fc0232b1d1d9a51affe44",
    "qsl-dependency-cohort-2026.09.0.json": "ec0e49c503e5ad309e11714f2d994cfecbaf95bd968c1afb80fa27426a1a4a81",
    "tqqq-conservative-research-v1.json": "c0c5020fbe64057b735f987b3bcc490dfe708304b58f01d57cd581344afb44c8",
}


def _load_receipt(name: str) -> dict[str, object]:
    path = RECEIPT_ROOT / name
    raw = path.read_bytes()
    payload = json.loads(raw)
    canonical = (json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()
    if raw != canonical:
        raise AssertionError(f"receipt is not canonical JSON: {path}")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != EXPECTED_RECEIPT_SHA256[name]:
        raise AssertionError(f"receipt bytes changed without an explicit contract update: {path}")
    expected_sidecar = f"{digest}  {path.name}\n"
    if path.with_suffix(path.suffix + ".sha256").read_text() != expected_sidecar:
        raise AssertionError(f"receipt digest sidecar mismatch: {path}")
    return payload


class HumanAuthorityReceiptTest(unittest.TestCase):
    def test_dependency_candidate_receipt_freezes_approved_refs_and_fail_closed_promotion(self) -> None:
        receipt = _load_receipt("qsl-dependency-cohort-2026.09.0.json")

        self.assertEqual(receipt["schema_version"], "qsl.human-authority-receipt.v1")
        self.assertEqual(receipt["authority_role"], "dependency-authority")
        self.assertEqual(receipt["decision"], "CANDIDATE_APPROVED")
        self.assertFalse(receipt["canonical_promotion_authorized"])
        self.assertTrue(receipt["no_live_execution"])
        selected_refs = receipt["selected_refs"]
        self.assertEqual(
            selected_refs,
            {
                "CnEquityStrategies": "aa2af9c56cc6600159a2bf83f2181ef721e14511",
                "CryptoStrategies": "0301b7852f013fb1090497b60dfad6e86801403d",
                "HkEquityStrategies": "6284d95fbf40895cc1b415444d686774f1cfdfb1",
                "MarketSignalSources": "9b3a0d13d29b807ac3fe5de962c37c5e798e322b",
                "QuantPlatformKit": "08eed913248953986224e09ea3a8dd9f5ebedc4e",
                "QuantStrategyPlugins": "a261447bad9bb13525692d41348c98df4f67766c",
                "UsEquityStrategies": "d72fdc9feaa6a9bfe3d91cad240b54c19556d5f1",
            },
        )
        self.assertTrue(all(FULL_SHA.fullmatch(value) for value in selected_refs.values()))
        self.assertEqual(
            receipt["promotion_requires"],
            [
                "all_consumer_pins_converged",
                "all_required_checks_success",
                "qsl_check_all_strict_success",
                "qsl_generate_matrix_check_strict_success",
                "consumer_gate_artifact_digests_recorded",
                "separate_canonical_promotion_receipt",
            ],
        )
        self.assertEqual(
            receipt["prohibited"],
            [
                "main_or_latest_dependency_refs",
                "open_pr_heads_as_authority",
                "lowering_enforce_bundle",
                "provider_or_replay",
                "deployment",
                "paper_or_live_activation",
            ],
        )

    def test_risk_receipt_freezes_conservative_research_only_policy(self) -> None:
        receipt = _load_receipt("tqqq-conservative-research-v1.json")

        self.assertEqual(receipt["authority_role"], "risk-authority")
        self.assertEqual(receipt["decision"], "APPROVE")
        self.assertEqual(receipt["policy_bundle"], "CONSERVATIVE_RESEARCH_V1")
        self.assertEqual(receipt["authority_scope"], "RESEARCH_ONLY")
        self.assertEqual(receipt["allowed_tradable_assets"], ["BOXX", "QQQM", "TQQQ"])
        self.assertEqual(receipt["benchmark_only_assets"], ["QQQ"])
        self.assertEqual(receipt["leverage_factors"], {"BOXX": "1", "QQQM": "1", "TQQQ": "3"})
        self.assertEqual(receipt["total_effective_exposure_cap"], "0.50")
        self.assertEqual(receipt["nominal_product_caps"], {"BOXX": "0.50", "QQQM": "0.50", "TQQQ": "0.15"})
        self.assertEqual(receipt["effective_product_caps"], {"BOXX": "0.50", "QQQM": "0.50", "TQQQ": "0.45"})
        self.assertEqual(receipt["loss_budget_fraction"], "0.01")
        self.assertEqual(receipt["loss_budget_equity_reference"], "completed_session_equity")
        self.assertEqual(
            receipt["drawdown_scalars"],
            [
                {"lower_exclusive": None, "scalar": "1.0", "upper_inclusive": "0.05"},
                {"lower_exclusive": "0.05", "scalar": "0.5", "upper_inclusive": "0.10"},
                {"lower_exclusive": "0.10", "outcome": "PARK", "scalar": "0.0", "upper_inclusive": None},
            ],
        )
        self.assertTrue(receipt["single_consumption"])
        self.assertEqual(receipt["mandate_validity_seconds"], 300)
        self.assertEqual(receipt["snapshot_max_age_seconds"], 300)
        self.assertEqual(receipt["max_nonzero_assets"], 3)
        self.assertEqual(
            receipt["modeled_stress_loss_distance"],
            {"BOXX": "0.05", "QQQM": "0.05", "TQQQ": "0.05"},
        )
        self.assertTrue(receipt["modeled_stress_is_not_stop_order"])
        self.assertEqual(receipt["capital_scope"], "allocated_sleeve")
        self.assertEqual(receipt["valuation_basis"], "allocated_sleeve_ledger")
        self.assertFalse(receipt["fx_conversion_allowed"])
        self.assertEqual(
            receipt["execution_constraints"],
            {
                "no_live": True,
                "no_order": True,
                "no_paper": True,
                "no_promotion_authority": True,
                "no_shadow": True,
            },
        )
        self.assertFalse(receipt["runner_is_authority"])
        self.assertIsNone(receipt["signature"])
        self.assertEqual(
            receipt["prohibited"],
            [
                "runner_or_workflow_self_signature",
                "legacy_p1_p3_mandate_reuse",
                "provider_or_replay_reacquisition",
                "cloud_write",
                "paper_or_live_execution",
            ],
        )

    def test_model_risk_receipt_limits_ai_to_unsigned_offline_evidence(self) -> None:
        receipt = _load_receipt("ai-provenance-and-evaluation-v3.json")

        self.assertEqual(receipt["authority_role"], "model-risk-authority")
        self.assertEqual(receipt["decision"], "APPROVE")
        self.assertEqual(receipt["provenance_schema"], "qsl.ai-artifact-provenance.v3")
        self.assertEqual(receipt["canonical_contract_owner"], "QuantPlatformKit")
        self.assertEqual(receipt["gateway_metadata_owner"], "AIAuditBridge")
        self.assertEqual(receipt["model_risk_owner"], "QuantRuntimeSettings model-risk authority")
        self.assertEqual(
            receipt["immutable_ref_policy"],
            "full_40_char_commit_sha_or_sha256_content_addressed_object_only",
        )
        self.assertEqual(receipt["mutable_refs_forbidden"], ["HEAD", "floating_tag", "latest", "main", "short_sha"])
        self.assertEqual(receipt["missing_closed_label_behavior"], "not_evaluable")
        self.assertEqual(receipt["signature_policy"], "unsigned_integrity_only")
        self.assertIsNone(receipt["signature"])
        self.assertFalse(receipt["signature_verification_enabled"])
        self.assertEqual(receipt["allowed_authority"], ["advisory", "review_evidence", "shadow"])
        self.assertTrue(receipt["review_evidence_is_non_authoritative"])
        self.assertEqual(
            receipt["reason_code_vocabulary"],
            [
                "ai_provenance_authority_forbidden",
                "ai_provenance_digest_mismatch",
                "ai_provenance_lineage_incomplete",
                "ai_provenance_model_unbound",
                "ai_provenance_run_not_succeeded",
                "ai_provenance_schema_invalid",
                "ai_provenance_signature_invalid",
                "ai_provenance_source_untrusted",
                "ai_provenance_time_invalid",
            ],
        )
        self.assertFalse(receipt["provider_network_allowed_in_ci"])
        self.assertFalse(receipt["secret_input_allowed_in_ci"])
        self.assertFalse(receipt["promotion_authority"])
        self.assertFalse(receipt["paper_or_live_authority"])
        self.assertEqual(
            receipt["prohibited"],
            [
                "provider_direct_fallback",
                "raw_provider_output_or_exception_in_logs",
                "ai_generated_order_allocation_or_execution_authority",
                "unsigned_producer_authenticity_claim",
                "paper_or_live_activation",
            ],
        )

    def test_2026_09_0_candidate_matches_dependency_receipt_and_promoted_bytes(self) -> None:
        receipt = _load_receipt("qsl-dependency-cohort-2026.09.0.json")
        candidate_path = ROOT / "authority" / "candidates" / "2026.09.0.toml"
        canonical_path = ROOT / "compat" / "bundles" / "2026.09.0.toml"
        with candidate_path.open("rb") as handle:
            bundle = tomllib.load(handle)

        self.assertEqual(bundle["name"], "2026.09.0")
        self.assertEqual(bundle["repos"], receipt["selected_refs"])
        self.assertEqual(canonical_path.read_bytes(), candidate_path.read_bytes())

    def test_dependency_canonical_promotion_receipt_freezes_gate_evidence(self) -> None:
        receipt = _load_receipt("qsl-dependency-cohort-2026.09.0-canonical-promotion.json")
        evidence_path = EVIDENCE_ROOT / "qsl-dependency-cohort-2026.09.0-prepared-convergence.json"
        evidence_raw = evidence_path.read_bytes()
        evidence = json.loads(evidence_raw)
        evidence_sha256 = hashlib.sha256(evidence_raw).hexdigest()
        candidate_path = ROOT / "authority" / "candidates" / "2026.09.0.toml"
        canonical_path = ROOT / "compat" / "bundles" / "2026.09.0.toml"
        matrix_path = ROOT / "internal_dependency_matrix.json"
        strict_path = ROOT / evidence["prepared_workspace"]["artifact_path"]
        matrix_evidence_path = ROOT / evidence["dependency_matrix"]["artifact_path"]
        strict_raw = strict_path.read_bytes()
        matrix_evidence_raw = matrix_evidence_path.read_bytes()
        strict_evidence = json.loads(strict_raw)
        matrix_evidence = json.loads(matrix_evidence_raw)
        expected_pull_requests = {
            "AlpacaPlatform": 10,
            "BinancePlatform": 190,
            "CharlesSchwabPlatform": 350,
            "CnEquitySnapshotPipelines": 33,
            "CnEquityStrategies": 226,
            "CryptoLivePoolPipelines": 165,
            "CryptoStrategies": 208,
            "FirstradePlatform": 293,
            "HkEquitySnapshotPipelines": 68,
            "HkEquityStrategies": 212,
            "InteractiveBrokersPlatform": 450,
            "LongBridgePlatform": 418,
            "QmtPlatform": 44,
            "UsEquitySnapshotPipelines": 462,
            "UsEquityStrategies": 443,
        }

        self.assertEqual(receipt["schema_version"], "qsl.human-authority-receipt.v1")
        self.assertEqual(receipt["authority_role"], "dependency-authority")
        self.assertEqual(receipt["decision"], "CANONICAL_APPROVED")
        self.assertTrue(receipt["canonical_promotion_authorized"])
        self.assertTrue(receipt["consumer_main_converged"])
        self.assertEqual(receipt["bundle"], "2026.09.0")
        self.assertEqual(receipt["candidate_receipt_sha256"], EXPECTED_RECEIPT_SHA256["qsl-dependency-cohort-2026.09.0.json"])
        self.assertEqual(receipt["candidate_manifest_sha256"], hashlib.sha256(candidate_path.read_bytes()).hexdigest())
        self.assertEqual(receipt["canonical_bundle_sha256"], hashlib.sha256(canonical_path.read_bytes()).hexdigest())
        self.assertEqual(receipt["canonical_bundle_sha256"], receipt["candidate_manifest_sha256"])
        self.assertEqual(receipt["consumer_gate_evidence_path"], str(evidence_path.relative_to(ROOT)))
        self.assertEqual(receipt["consumer_gate_evidence_sha256"], evidence_sha256)
        self.assertEqual(
            evidence_raw,
            (json.dumps(evidence, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode(),
        )
        self.assertNotIn("/Users/", evidence_raw.decode())
        for artifact_path, artifact_raw, artifact in (
            (strict_path, strict_raw, strict_evidence),
            (matrix_evidence_path, matrix_evidence_raw, matrix_evidence),
        ):
            artifact_sha256 = hashlib.sha256(artifact_raw).hexdigest()
            self.assertEqual(
                artifact_raw,
                (json.dumps(artifact, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode(),
            )
            self.assertNotIn("/Users/", artifact_raw.decode())
            self.assertEqual(
                artifact_path.with_suffix(artifact_path.suffix + ".sha256").read_text(),
                f"{artifact_sha256}  {artifact_path.name}\n",
            )
        self.assertEqual(
            evidence_path.with_suffix(evidence_path.suffix + ".sha256").read_text(),
            f"{evidence_sha256}  {evidence_path.name}\n",
        )
        self.assertEqual(evidence["prepared_workspace"]["total_repositories"], 25)
        self.assertEqual(evidence["prepared_workspace"]["failed_repositories"], 0)
        self.assertEqual(evidence["prepared_workspace"]["issue_count"], 0)
        self.assertEqual(evidence["prepared_workspace"]["warning_count"], 0)
        self.assertEqual(
            evidence["prepared_workspace"]["artifact_sha256"],
            hashlib.sha256(strict_raw).hexdigest(),
        )
        self.assertEqual(strict_evidence["schema_version"], "qsl.check-all-strict-evidence.v1")
        self.assertEqual(strict_evidence["command_contract"]["action"], "check-all")
        self.assertTrue(strict_evidence["command_contract"]["strict"])
        self.assertEqual(strict_evidence["exit_code"], 0)
        self.assertEqual(strict_evidence["summary"], {
            key: evidence["prepared_workspace"][key]
            for key in (
                "failed_repositories",
                "issue_count",
                "total_repositories",
                "warning_count",
                "warning_repositories",
            )
        })
        self.assertEqual(len(strict_evidence["repositories"]), 25)
        self.assertEqual(len({repo["repository"] for repo in strict_evidence["repositories"]}), 25)
        self.assertTrue(all(FULL_SHA.fullmatch(repo["revision"]) for repo in strict_evidence["repositories"]))
        self.assertTrue(
            all(repo["ok"] and not repo["issues"] and not repo["warnings"] for repo in strict_evidence["repositories"])
        )
        self.assertEqual(
            strict_evidence["promotion_inputs"]["candidate_manifest_sha256"],
            hashlib.sha256(candidate_path.read_bytes()).hexdigest(),
        )
        self.assertEqual(
            strict_evidence["promotion_inputs"]["canonical_bundle_sha256"],
            hashlib.sha256(canonical_path.read_bytes()).hexdigest(),
        )
        self.assertEqual(
            strict_evidence["promotion_inputs"]["dependency_matrix_sha256"],
            hashlib.sha256(matrix_path.read_bytes()).hexdigest(),
        )
        self.assertEqual(
            strict_evidence["promotion_inputs"]["quant_runtime_settings_qsl_sha256"],
            hashlib.sha256((ROOT / "qsl.toml").read_bytes()).hexdigest(),
        )
        qrs_evidence = next(
            repo for repo in strict_evidence["repositories"]
            if repo["repository"] == "QuantRuntimeSettings"
        )
        self.assertEqual(qrs_evidence["source_control_state"], "promotion_worktree_base")
        self.assertEqual(
            qrs_evidence["qsl_metadata_sha256"],
            hashlib.sha256((ROOT / "qsl.toml").read_bytes()).hexdigest(),
        )
        self.assertTrue(
            all(
                repo["source_control_state"] == "origin_main"
                for repo in strict_evidence["repositories"]
                if repo["repository"] != "QuantRuntimeSettings"
            )
        )
        self.assertEqual(evidence["dependency_matrix"]["generated_dependency_count"], 52)
        self.assertTrue(evidence["dependency_matrix"]["ok"])
        self.assertEqual(
            evidence["dependency_matrix"]["artifact_sha256"],
            hashlib.sha256(matrix_evidence_raw).hexdigest(),
        )
        self.assertEqual(
            evidence["dependency_matrix"]["matrix_sha256"],
            hashlib.sha256(matrix_path.read_bytes()).hexdigest(),
        )
        self.assertEqual(matrix_evidence["schema_version"], "qsl.dependency-matrix-strict-evidence.v1")
        self.assertTrue(matrix_evidence["qsl_generate_matrix_check"]["command_contract"]["strict"])
        self.assertTrue(matrix_evidence["qsl_generate_matrix_check"]["command_contract"]["check"])
        self.assertEqual(matrix_evidence["qsl_generate_matrix_check"]["exit_code"], 0)
        self.assertTrue(matrix_evidence["qsl_generate_matrix_check"]["ok"])
        self.assertEqual(matrix_evidence["qsl_generate_matrix_check"]["generated_dependency_count"], 52)
        self.assertTrue(matrix_evidence["dependency_ledger_check"]["command_contract"]["strict"])
        self.assertTrue(matrix_evidence["dependency_ledger_check"]["command_contract"]["require_consumer_files"])
        self.assertEqual(matrix_evidence["dependency_ledger_check"]["exit_code"], 0)
        self.assertTrue(matrix_evidence["dependency_ledger_check"]["ok"])
        self.assertEqual(matrix_evidence["dependency_ledger_check"]["issue_count"], 0)
        self.assertEqual(matrix_evidence["dependency_ledger_check"]["missing_file_count"], 0)
        self.assertEqual(matrix_evidence["matrix_sha256"], hashlib.sha256(matrix_path.read_bytes()).hexdigest())
        self.assertEqual(
            matrix_evidence["repository_revisions"],
            {repo["repository"]: repo["revision"] for repo in strict_evidence["repositories"]},
        )
        self.assertEqual(len(evidence["consumer_pull_requests"]), 15)
        self.assertEqual(
            {pull_request["repository"]: pull_request["number"] for pull_request in evidence["consumer_pull_requests"]},
            expected_pull_requests,
        )
        self.assertTrue(all(pull_request["state"] == "MERGED" for pull_request in evidence["consumer_pull_requests"]))
        self.assertTrue(
            all(pull_request["unresolved_review_threads"] == 0 for pull_request in evidence["consumer_pull_requests"])
        )
        self.assertTrue(all(pull_request["checks"] for pull_request in evidence["consumer_pull_requests"]))
        strict_revisions = {
            repo["repository"]: repo["revision"]
            for repo in strict_evidence["repositories"]
        }
        self.assertTrue(
            all(
                FULL_SHA.fullmatch(pull_request["head_commit"])
                and FULL_SHA.fullmatch(pull_request["merge_commit"])
                and strict_revisions[pull_request["repository"]] == pull_request["merge_commit"]
                for pull_request in evidence["consumer_pull_requests"]
            )
        )
        self.assertTrue(
            all(
                check["status"] == "COMPLETED" and check["conclusion"] == "SUCCESS"
                for pull_request in evidence["consumer_pull_requests"]
                for check in pull_request["checks"]
            )
        )
        self.assertTrue(all(pull_request["post_merge_checks"] for pull_request in evidence["consumer_pull_requests"]))
        self.assertTrue(
            all(
                check["status"] == "COMPLETED" and check["conclusion"] == "SUCCESS"
                for pull_request in evidence["consumer_pull_requests"]
                for check in pull_request["post_merge_checks"]
            )
        )
        self.assertFalse(receipt["runtime_activation_authorized"])
        self.assertFalse(receipt["provider_or_replay_authorized"])
        self.assertFalse(receipt["deployment_authorized"])
        self.assertFalse(receipt["paper_or_live_authorized"])
        self.assertTrue(receipt["no_live_execution"])
        self.assertIsNone(receipt["signature"])


if __name__ == "__main__":
    unittest.main()

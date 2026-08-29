from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "publish-m0-research-ledger.yml"


class ManualM0ResearchPublisherWorkflowTest(unittest.TestCase):
    def test_workflow_is_manual_and_binds_one_explicit_successful_qar_artifact(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("workflow_dispatch:", workflow)
        self.assertNotRegex(workflow, r"(?m)^  (?:push|pull_request|schedule|repository_dispatch):")
        self.assertRegex(
            workflow,
            r"(?s)qar_run_id:\n.*?required: true\n.*?type: string",
        )
        self.assertIn("never selects the latest run", workflow)
        self.assertNotIn("gh run list", workflow)
        self.assertNotIn("actions/runs?", workflow)
        self.assertIn("QAR_REPOSITORY: QuantStrategyLab/QuantAdvisorResearch", workflow)
        self.assertIn('QAR_WEEKLY_WORKFLOW_ID: "285971223"', workflow)
        self.assertIn("QAR_WEEKLY_ARTIFACT_NAME: weekly-model-recommendations", workflow)
        self.assertIn('"repos/${QAR_REPOSITORY}/actions/runs/${QAR_RUN_ID}"', workflow)
        self.assertIn("QAR run must already be completed successfully", workflow)
        self.assertIn("QAR run is not the fixed Weekly Intelligent Advisory Review workflow", workflow)
        self.assertIn("QAR artifact workflow-run binding mismatch", workflow)
        self.assertIn("QAR artifact must contain exactly one dated M0 source snapshot", workflow)
        self.assertIn("m0_research_source_snapshot_[0-9]{4}-[0-9]{2}-[0-9]{2}", workflow)
        self.assertIn("M0_SOURCE_SNAPSHOT_SHA256", workflow)
        self.assertIn('> "${artifact_zip}"', workflow)
        self.assertNotIn("--output \"${artifact_zip}\"", workflow)
        self.assertIn("--source-artifact-revision \"${QAR_SOURCE_REVISION}\"", workflow)
        self.assertIn("--source-artifact-run-id \"${QAR_RUN_ID}\"", workflow)
        self.assertIn("--source-artifact-id \"${QAR_ARTIFACT_ID}\"", workflow)
        self.assertIn("--source-artifact-sha256 \"${M0_SOURCE_SNAPSHOT_SHA256}\"", workflow)

    def test_workflow_uses_only_dedicated_read_and_publish_credentials(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("QAR_ARTIFACT_READ_TOKEN: ${{ secrets.QAR_ARTIFACT_READ_TOKEN }}", workflow)
        self.assertIn("GH_TOKEN=\"${QAR_ARTIFACT_READ_TOKEN}\" gh api", workflow)
        self.assertIn(
            "QSL_M0_RESEARCH_LEDGER_PUBLISH_URL: ${{ vars.M0_RESEARCH_SYNC_URL }}",
            workflow,
        )
        self.assertIn(
            "QSL_M0_RESEARCH_LEDGER_PUBLISH_TOKEN: ${{ secrets.M0_RESEARCH_SYNC_TOKEN }}",
            workflow,
        )
        self.assertIn("build_m0_research_publisher_envelope.py", workflow)
        self.assertIn("--publish", workflow)
        self.assertNotIn("gh workflow run", workflow)
        self.assertNotIn("runtime_settings.py", workflow)
        self.assertNotIn("platform-config", workflow)
        self.assertNotIn("manual-strategy-switch", workflow)
        self.assertNotIn("broker", workflow.lower())
        self.assertNotIn("selector", workflow.lower())
        self.assertNotIn("${QSL_M0_RESEARCH_LEDGER_PUBLISH_URL}", workflow)
        self.assertNotIn("${QSL_M0_RESEARCH_LEDGER_PUBLISH_TOKEN}", workflow)

        read_token_steps = workflow.count("QAR_ARTIFACT_READ_TOKEN: ${{ secrets.QAR_ARTIFACT_READ_TOKEN }}")
        self.assertEqual(read_token_steps, 3)
        self.assertEqual(workflow.count("QSL_M0_RESEARCH_LEDGER_PUBLISH_URL: ${{ vars.M0_RESEARCH_SYNC_URL }}"), 1)
        self.assertEqual(workflow.count("QSL_M0_RESEARCH_LEDGER_PUBLISH_TOKEN: ${{ secrets.M0_RESEARCH_SYNC_TOKEN }}"), 1)
        build_step = workflow.split("- name: Build and publish verified no-order M0 ledger", maxsplit=1)[1]
        self.assertNotIn("QAR_ARTIFACT_READ_TOKEN", build_step)

    def test_sensitive_values_are_not_emitted_by_workflow_commands(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")

        for line in workflow.splitlines():
            self.assertFalse(
                re.search(
                    r"\b(?:echo|printf)\b.*\$\{?(?:QAR_ARTIFACT_READ_TOKEN|QSL_M0_RESEARCH_LEDGER_PUBLISH_(?:URL|TOKEN))",
                    line,
                ),
                line,
            )


if __name__ == "__main__":
    unittest.main()

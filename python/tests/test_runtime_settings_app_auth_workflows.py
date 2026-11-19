from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
PINNED_APP_TOKEN_ACTION = (
    "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1"
)
MANUAL_STRATEGY_SWITCH = ".github/workflows/manual-strategy-switch.yml"
UPGRADED_WORKFLOWS = (
    ".github/workflows/bootstrap-binance-account-facts.yml",
    ".github/workflows/configure-ibkr-period-return.yml",
    ".github/workflows/configure-ibkr-primary-daily-once.yml",
    ".github/workflows/manual-binance-resume.yml",
    ".github/workflows/manual-longbridge-resume.yml",
    ".github/workflows/manual-runtime-stop.yml",
    MANUAL_STRATEGY_SWITCH,
    ".github/workflows/sync-schwab-account-facts-binding.yml",
)


class RuntimeSettingsAppAuthWorkflowTests(unittest.TestCase):
    def test_control_plane_workflows_pin_github_app_token_with_pat_fallback(self):
        for rel_path in UPGRADED_WORKFLOWS:
            with self.subTest(workflow=rel_path):
                text = (ROOT / rel_path).read_text(encoding="utf-8")
                self.assertIn(PINNED_APP_TOKEN_ACTION, text)
                self.assertIn("vars.RUNTIME_SETTINGS_APP_CLIENT_ID", text)
                self.assertIn("secrets.RUNTIME_SETTINGS_APP_PRIVATE_KEY", text)
                self.assertIn("secrets.RUNTIME_SETTINGS_GH_TOKEN", text)
                expected_write_grants = 1 if rel_path == MANUAL_STRATEGY_SWITCH else 0
                self.assertEqual(text.count("permission-contents: write"), expected_write_grants)

    def test_promotion_ledger_uses_a_separate_apply_only_repository_token(self):
        text = (ROOT / MANUAL_STRATEGY_SWITCH).read_text(encoding="utf-8")
        before, ledger_steps = text.split(
            "      - name: Mint repository-scoped promotion ledger token\n", 1
        )
        mint, consume = ledger_steps.split(
            "      - name: Consume single_use_id in the durable ledger\n", 1
        )
        consume, after = consume.split("      - name: Apply GitHub variable updates\n", 1)
        self.assertIn("id: promotion_signature", before)
        self.assertIn("if: env.APPLY_SWITCH == 'true'", mint)
        self.assertIn(PINNED_APP_TOKEN_ACTION, mint)
        self.assertIn("vars.QSL_PROMOTION_LEDGER_APP_CLIENT_ID", mint)
        self.assertIn("secrets.QSL_PROMOTION_LEDGER_APP_PRIVATE_KEY", mint)
        self.assertIn("permission-contents: write", mint)
        self.assertIn("permission-metadata: read", mint)
        self.assertNotIn("owner:", mint)
        self.assertNotIn("repositories:", mint)
        self.assertIn("GH_TOKEN: ${{ steps.promotion-ledger-token.outputs.token }}", consume)
        self.assertNotIn("steps.promotion-ledger-token.outputs.token", before + after)
        self.assertNotIn("secrets.QSL_PROMOTION_LEDGER_TOKEN", text)

    def test_app_auth_check_workflow_is_main_only_and_read_only(self):
        text = (
            ROOT / ".github/workflows/runtime-settings-app-auth-check.yml"
        ).read_text(encoding="utf-8")
        self.assertIn(PINNED_APP_TOKEN_ACTION, text)
        self.assertIn(
            "github.repository == 'QuantStrategyLab/QuantRuntimeSettings' && github.ref == 'refs/heads/main'",
            text,
        )
        self.assertIn("environment: runtime-strategy-switch", text)
        self.assertIn("permissions: {}", text)
        self.assertIn("permission-secrets: ${{ matrix.write-capability }}", text)
        self.assertIn("/actions/secrets/public-key", text)
        self.assertNotIn("gh variable set", text)
        self.assertNotIn("gh secret set", text)


if __name__ == "__main__":
    unittest.main()

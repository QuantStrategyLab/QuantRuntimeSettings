from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
PINNED_APP_TOKEN_ACTION = (
    "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1"
)
UPGRADED_WORKFLOWS = (
    ".github/workflows/bootstrap-binance-account-facts.yml",
    ".github/workflows/configure-ibkr-period-return.yml",
    ".github/workflows/configure-ibkr-primary-daily-once.yml",
    ".github/workflows/manual-binance-resume.yml",
    ".github/workflows/manual-longbridge-resume.yml",
    ".github/workflows/manual-runtime-stop.yml",
    ".github/workflows/manual-strategy-switch.yml",
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
                self.assertNotIn("permission-contents: write", text)

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

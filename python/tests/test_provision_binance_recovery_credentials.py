import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/provision_binance_recovery_credentials.sh"


class CredentialProvisioningTests(unittest.TestCase):
    def run_script(self, *, ref="refs/heads/main", policy="main", fail_write=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gh = root / "gh"
            gh.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
if args[0]=='api':
    if args[-1].endswith('deployment-branch-policies'):
        print(json.dumps({'branch_policies':[{'name':os.environ['TEST_POLICY'],'type':'branch'}]}))
    else:
        print(json.dumps({'deployment_branch_policy':{'protected_branches':False,'custom_branch_policies':True}}))
else:
    with Path(os.environ['TEST_CALLS']).open('a') as out:
        out.write(json.dumps({'args':args,'stdin':sys.stdin.read()})+'\\n')
    sys.exit(1 if os.environ['TEST_FAIL']=='true' else 0)
""")
            gh.chmod(0o700)
            calls = root / "calls.jsonl"
            env = {**os.environ, "PATH": str(root) + os.pathsep + os.environ["PATH"],
                   "GITHUB_REPOSITORY": "QuantStrategyLab/QuantRuntimeSettings", "GITHUB_REF": ref,
                   "GH_TOKEN": "fake-management-token", "RECONCILIATION_RECOVERY_SYNC_TOKEN": "fake-sync-value",
                   "RECONCILIATION_RECOVERY_CONTROLLER_TOKEN": "fake-controller-value", "TEST_POLICY": policy,
                   "TEST_FAIL": str(fail_write).lower(), "TEST_CALLS": str(calls)}
            result = subprocess.run(["bash", str(SCRIPT)], env=env, text=True, capture_output=True)
            records = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
            self.assertNotIn("fake-sync-value", result.stdout + result.stderr)
            self.assertNotIn("fake-controller-value", result.stdout + result.stderr)
            self.assertNotIn("fake-management-token", result.stdout + result.stderr)
            return result, records

    def test_only_two_fixed_environment_secrets_via_stdin(self):
        result, calls = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 2)
        for call, suffix, value in zip(calls, ["SYNC", "CONTROLLER"], ["fake-sync-value", "fake-controller-value"]):
            self.assertEqual(call['args'], ['secret','set',f'RECONCILIATION_RECOVERY_{suffix}_TOKEN',
                                           '--repo','QuantStrategyLab/BinancePlatform','--env','binance-runtime'])
            self.assertEqual(call['stdin'], value)

    def test_feature_branch_never_writes(self):
        result, calls = self.run_script(ref="refs/heads/feature")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_main_tag_never_writes(self):
        result, calls = self.run_script(ref="refs/tags/main")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_widened_destination_policy_never_writes(self):
        result, calls = self.run_script(policy="*")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_first_write_failure_stops_without_retry(self):
        result, calls = self.run_script(fail_write=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()

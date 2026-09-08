#!/usr/bin/env bash
# Operator-dispatched delivery of two existing recovery credentials. No reads
# of broker credentials, credential files, rotation, or arbitrary destinations.
set -euo pipefail
set +x

if [[ "${GITHUB_REPOSITORY:-}" != "QuantStrategyLab/QuantRuntimeSettings" || "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  echo "Recovery credential delivery requires the designated repository main branch." >&2
  exit 2
fi
for name in GH_TOKEN RECONCILIATION_RECOVERY_SYNC_TOKEN RECONCILIATION_RECOVERY_CONTROLLER_TOKEN; do
  if [[ -z "${!name:-}" ]]; then
    echo "Required recovery credential configuration is unavailable." >&2
    exit 2
  fi
done
if [[ "$RECONCILIATION_RECOVERY_SYNC_TOKEN" == "$RECONCILIATION_RECOVERY_CONTROLLER_TOKEN" ]]; then
  echo "Recovery publication and confirmation credentials must be distinct." >&2
  exit 2
fi

# Recheck the actual destination policy immediately before delivery. The
# metadata contains no credential values. Any read error stops both writes.
destination="repos/QuantStrategyLab/BinancePlatform/environments/binance-runtime"
environment_json="$(gh api "$destination")"
policy_json="$(gh api "$destination/deployment-branch-policies")"
export environment_json policy_json
python3 - <<'PY'
import json, os, sys
environment = json.loads(os.environ['environment_json'])
policies = json.loads(os.environ['policy_json'])
valid = environment.get('deployment_branch_policy') == {
    'protected_branches': False, 'custom_branch_policies': True,
} and [(p.get('name'), p.get('type')) for p in policies.get('branch_policies', [])] == [('main', 'branch')]
if not valid:
    print('Destination must allow only the main branch, without tags or wildcards.', file=sys.stderr)
    sys.exit(2)
PY
unset environment_json policy_json

for name in RECONCILIATION_RECOVERY_SYNC_TOKEN RECONCILIATION_RECOVERY_CONTROLLER_TOKEN; do
  if ! printf '%s' "${!name}" | gh secret set "$name" --repo QuantStrategyLab/BinancePlatform --env binance-runtime; then
    echo "Recovery credential delivery failed; stop and inspect destination metadata before further action." >&2
    exit 2
  fi
  echo "Stored $name in the designated main-only environment."
done

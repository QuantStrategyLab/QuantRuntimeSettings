"""Deliver one existing research-review credential to one main-only environment.

Manual QRT/main execution only. No token rotation, trading call, model call,
research ticket creation or arbitrary destination is supported.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import urllib.error
import urllib.request

DESTINATION = "repos/QuantStrategyLab/UsEquitySnapshotPipelines/environments/market-data-nonlive"
SECRET = "RESEARCH_PROMOTION_SYNC_TOKEN"
PROBE_URL = (
    "https://qsl-strategy-switch-console.pigbibi.workers.dev"
    "/api/internal/research-promotion-ticket?ticket_id=soxl-v7-credential-binding-check"
)


def provision(*, env, run=subprocess.run, opener=urllib.request.urlopen, apply=False):
    print("V7_BINDING_CHECK source_context", flush=True)
    if env.get("GITHUB_REPOSITORY") != "QuantStrategyLab/QuantRuntimeSettings" or env.get("GITHUB_REF") != "refs/heads/main":
        raise ValueError("designated main branch required")
    token = env.get(SECRET, "")
    if not token or not env.get("GH_TOKEN") or "\n" in token or "\r" in token:
        raise ValueError("required credential unavailable")

    def gh(*args, input=None):
        try:
            return run(["gh", *args], input=input, capture_output=True, text=True,
                       check=True, timeout=30, env=dict(env)).stdout
        except subprocess.CalledProcessError as error:
            # Only a numeric status is safe; stderr may contain credentials.
            status = re.search(r"\(HTTP ([1-5][0-9]{2})\)", error.stderr or "")
            print("V7_BINDING_GITHUB_STATUS " + (status.group(1) if status else "unavailable"), flush=True)
            raise

    print("V7_BINDING_CHECK destination_environment", flush=True)
    destination = json.loads(gh("api", DESTINATION))
    print("V7_BINDING_CHECK destination_branch_policy", flush=True)
    policies = json.loads(gh("api", DESTINATION + "/deployment-branch-policies"))
    if destination.get("deployment_branch_policy") != {"protected_branches": False, "custom_branch_policies": True} or [
        (policy.get("name"), policy.get("type")) for policy in policies.get("branch_policies", [])
    ] != [("main", "branch")]:
        raise ValueError("destination must permit only main, without tags or wildcards")
    # Only this authenticated, application-specific 404 verifies the existing
    # credential. No real ticket is created or human decision submitted.
    print("V7_BINDING_CHECK console_credential", flush=True)
    request = urllib.request.Request(PROBE_URL, headers={"Authorization": "Bearer " + token, "Accept": "application/json"})
    try:
        with opener(request, timeout=15) as response:
            response.read()
        raise ValueError("unexpected existing probe ticket")
    except urllib.error.HTTPError as error:
        print(f"V7_BINDING_HTTP_STATUS {error.code}", flush=True)
        if error.code != 404 or json.loads(error.read()) != {"ok": False, "error": "research promotion ticket not found"}:
            raise ValueError("console credential verification failed") from None
    if not apply:
        return
    # gh encrypts for the fixed destination; the plaintext travels via stdin,
    # never arguments, output, files or artifacts. Unknown writes are not retried.
    print("V7_BINDING_CHECK destination_secret_write", flush=True)
    gh("secret", "set", SECRET, "--repo", "QuantStrategyLab/UsEquitySnapshotPipelines", "--env", "market-data-nonlive", input=token)
    print("V7_BINDING_CHECK destination_secret_readback", flush=True)
    stored = json.loads(gh("api", DESTINATION + "/secrets/" + SECRET))
    if stored.get("name") != SECRET:
        raise ValueError("destination metadata readback failed")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Explicitly write after successful read-only checks")
    args = parser.parse_args(argv)
    try:
        provision(env=os.environ, apply=args.apply)
    except Exception:
        print("PARKED_V7_CREDENTIAL_BINDING; inspect metadata before any further write")
        return 2
    if args.apply:
        print("V7_REVIEW_CREDENTIAL_BOUND; source credential verified by read-only GET; no ticket or trading action")
    else:
        print("V7_REVIEW_CREDENTIAL_CHECKED; read-only; no secret write or ticket or trading action")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

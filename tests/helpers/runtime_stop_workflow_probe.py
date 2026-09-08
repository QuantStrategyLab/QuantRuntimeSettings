"""Consume a synthetic Worker dispatch through the real workflow shell/CLI.

GitHub is a local executable substitute. No credentials or network are used.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap


ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    dispatch = json.load(sys.stdin)
    inputs = dispatch["inputs"]
    request = json.loads(inputs["stop_request"])
    identity = request["runtime_target"]
    assert identity["platform_id"] == "ibkr"
    assert all("synthetic" in str(value) for key, value in identity.items() if key != "platform_id")
    runtime = {**identity, "strategy_profile": "retired-synthetic-profile", "execution_mode": "live",
               "dry_run_only": False, "overrides": {"risk_limit": 0.01}}
    inventory = {"targets": [
        {"service": identity["service_name"], "runtime_target": runtime, "RUNTIME_TARGET_ENABLED": "true"},
        {"service": "synthetic-sibling", "RUNTIME_TARGET_ENABLED": "true"},
    ], "defaults": {"synthetic_keep": True}}
    repository = {"CLOUD_RUN_SERVICE_TARGETS_JSON": json.dumps(inventory)}
    environment = {"RUNTIME_TARGET_JSON": json.dumps(runtime), "CLOUD_RUN_SERVICE": identity["service_name"]}
    with tempfile.TemporaryDirectory(prefix="qsl-stop-workflow-") as directory:
        temp = Path(directory)
        state = temp / "state.json"
        event = temp / "event.json"
        event.write_text(json.dumps({"inputs": inputs}))
        state.write_text(json.dumps({"repository": repository, "environment": environment, "writes": 0}))
        gh = temp / "gh"
        gh.write_text(f"#!{sys.executable}\n" + textwrap.dedent('''\
            import json, os, sys
            from pathlib import Path
            path = Path(os.environ["SYNTHETIC_GH_STATE"])
            state = json.loads(path.read_text())
            args = sys.argv[1:]
            if args[:1] == ["api"]:
                assert args[args.index("--method") + 1] == "GET"
                assert args[-1].endswith("/variables?per_page=100")
                scope = "environment" if "/environments/" in args[-1] else "repository"
                items = [{"name": name, "value": value} for name, value in state[scope].items()]
                print(json.dumps([{"total_count": len(items), "variables": items}]))
            elif args[:2] == ["variable", "set"]:
                assert "--body" not in args
                scope = "environment" if "--env" in args else "repository"
                assert args[2] == "CLOUD_RUN_SERVICE_TARGETS_JSON"
                state[scope][args[2]] = sys.stdin.read()
                state["writes"] += 1
                path.write_text(json.dumps(state))
            else:
                raise SystemExit("unexpected synthetic command")
        '''))
        gh.chmod(0o700)
        workflow = (ROOT / ".github/workflows/manual-runtime-stop.yml").read_text()
        step = workflow.split("      - name: Save and verify only the stop setting\n", 1)[1]
        shell = textwrap.dedent(step.split("        run: |\n", 1)[1].split("      - name:", 1)[0])
        env = {
            "PATH": f"{temp}:{Path(sys.executable).parent}:/usr/bin:/bin",
            "HOME": directory, "PYTHONDONTWRITEBYTECODE": "1",
            "SYNTHETIC_GH_STATE": str(state), "GITHUB_EVENT_PATH": str(event),
            "APPLY_STOP": inputs["apply"], "CONFIRM_STOP": inputs["confirm"],
        }
        assert "GH_TOKEN" not in env and "GITHUB_TOKEN" not in env
        result = subprocess.run(["/bin/bash", "-c", shell], cwd=ROOT, env=env,
                                capture_output=True, text=True, timeout=20)
        assert result.returncode == 0, "synthetic workflow did not finish successfully"
        assert json.loads(result.stdout) == {"configured": True, "platform_applied": False, "preview": False}
        after = json.loads(state.read_text())
        inventory["targets"][0]["RUNTIME_TARGET_ENABLED"] = "false"
        assert json.loads(after["repository"]["CLOUD_RUN_SERVICE_TARGETS_JSON"]) == inventory
        assert after["environment"] == environment
        assert after["writes"] == 1
        assert after.get("dispatches", 0) == 0
    print("Worker -> workflow -> CLI -> synthetic GitHub readback: PASS; configuration only, no platform dispatch")


if __name__ == "__main__":
    main()

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/deploy-strategy-switch-console.yml", import.meta.url), "utf8");
const triggers = workflow.slice(workflow.indexOf("\non:\n"), workflow.indexOf("\npermissions:"));
assert.deepEqual([...triggers.matchAll(/^  (\w+):/gm)].map(match => match[1]), ["workflow_dispatch"], "merges must not deploy");
for (const input of ["sync_secrets", "sync_strategy_profiles"]) {
  const block = triggers.match(new RegExp(`      ${input}:\\n([\\s\\S]*?)(?=\\n      \\w+:|$)`))?.[1];
  assert.ok(block, input);
  assert.match(block, /type: boolean/);
  assert.match(block, /default: false/);
}
const steps = workflow.split(/\n      - name: /).slice(1);
const writers = steps.filter(step => /\bsecret put\b|\/api\/internal\/sync-strategy-profiles/.test(step));
assert.equal(writers.length, 16, "inspect every secret and profile writer");
for (const step of writers) {
  const name = step.split("\n")[0];
  const gate = step.match(/^        if: (.+)$/m)?.[1];
  assert.ok(gate, `${name} requires a gate`);
  assert.match(gate, /github\.event_name == 'workflow_dispatch'/, name);
  const input = step.includes("secret put") ? "sync_secrets" : "sync_strategy_profiles";
  assert.match(gate, new RegExp(`inputs\\.${input}\\b`), name);
  for (const event of ["push", "workflow_dispatch"]) {
    for (const optedIn of [false, true]) {
      const expression = gate.replaceAll("github.event_name", JSON.stringify(event))
        .replaceAll(`inputs.${input}`, String(optedIn))
        .replace(/env\.[A-Z0-9_]+/g, "'github_actions'");
      assert.match(expression, /^[\w\s'"=!&|().-]+$/, "only the known gate grammar is evaluated");
      assert.equal(Function(`return (${expression})`)(), event === "workflow_dispatch" && optedIn, `${name}: ${event}, ${input}=${optedIn}`);
    }
  }
}
assert.doesNotMatch(workflow, /catalog-change|steps\.catalog/);
console.log("console_deploy_safety_validation: PASS (manual-only; 16 write gates default off)");

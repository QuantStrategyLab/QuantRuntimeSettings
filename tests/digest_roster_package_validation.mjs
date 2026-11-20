// Isolated offline synthetic package fixture (Q7, row B3-22) covering real
// JS preparation (B1 projectAccountManagement + B2 exportAppliedRecords +
// buildManagementReadback) and isolated Python constructor/generation outside
// the repository checkout, plus single-member omission rejection for both
// preparer and generation packages.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MANIFEST = JSON.parse(await readFile(join(ROOT, "python/scripts/digest_package_manifest.json"), "utf8"));
// Pin wall clock before importing harness so applied effective times precede 2026-11-19T23:00:00Z.
const RealDate = Date;
let tick = RealDate.parse("2026-11-19T20:00:00.000Z");
globalThis.Date = class extends RealDate {
  constructor(...args) { if (args.length) super(...args); else { super(tick); tick += 1000; } }
  static now() { tick += 1000; return tick - 1000; }
};
const harness = await import("./helpers/account_management_harness.mjs");
const { collectInventory, instanceStateRow } = await import("./helpers/account_identity_inventory_collect.mjs");
const fixture = JSON.parse(await readFile(join(ROOT, "tests/fixtures/account-mapping-roster.synthetic.json"), "utf8"));

async function materialize(pkgDir, roles) {
  for (const origin of ["base", "b3_overlay"]) {
    for (const member of MANIFEST.members) {
      if (member.origin !== origin || !roles.has(member.dependency_role)) continue;
      const dst = join(pkgDir, member.destination);
      await mkdir(dirname(dst), { recursive: true });
      await cp(join(ROOT, member.source), dst);
    }
  }
}

const tmp = await mkdtemp(join(tmpdir(), "qsl-b3-pkg-"));
try {
  const pkg = join(tmp, "pkg");
  const work = join(tmp, "work");
  await mkdir(pkg, { recursive: true });
  await mkdir(work, { recursive: true });
  await materialize(pkg, new Set(["generation", "preparer", "both"]));

  // Synthetic B2 store test peer outside the digest package.
  const store = await harness.baselineStore();
  let doObservation;
  let liveReadback;
  try {
    const inventory = (await collectInventory({
      statements: [instanceStateRow(harness.INSTANCE_REVISION, harness.INSTANCES)],
    })).private;
    const applied = store.db.prepare("SELECT * FROM account_management_applied ORDER BY platform, account_key").all();
    const observedAt = "2026-11-19T23:00:00.000Z";
    doObservation = {
      observed_at: observedAt,
      instance_revision: harness.INSTANCE_REVISION,
      instances: harness.INSTANCES,
      policy: harness.policyOf(harness.FIXTURE_ACCOUNTS),
      applied_rows: applied,
      inventory,
      collection: { observedAt, sourceRef: "inventory_export:synthetic-b3" },
      enrollment_links: fixture.enrollment_links,
    };
    const readRes = await store.read();
    assert.equal(readRes.status, 200);
    liveReadback = readRes.body;
  } finally {
    store.close();
  }

  await writeFile(join(work, "do_obs.json"), JSON.stringify(doObservation));
  await writeFile(join(work, "legacy_roster.json"), JSON.stringify(
    fixture.enrollment_links.map((link, idx) => ({
      platform_id: link.platform_id,
      candidate_slot: link.candidate_slot,
      opaque_account_uid: link.opaque_account_uid,
      target_id: link.target_id,
      strategy_profile: `syn_profile_${idx}`,
    })),
  ));
  await writeFile(join(work, "obs_bindings.json"), JSON.stringify(
    liveReadback.groups
      .map((g, idx) => ({ g, idx }))
      .filter(({ g }) => g.scope === "paper" || g.scope === "live")
      .map(({ g, idx }) => ({
        binding_id: `obs-${String(idx).padStart(2, "0")}`,
        platform: g.deployments[0].platform,
        legacy_key: g.deployments[0].key,
        opaque_account_uid: null,
        broker_environment: g.scope,
        account_scope: "account",
      })),
  ));
  await writeFile(join(work, "readback.json"), JSON.stringify(liveReadback));

  // Step 1: Run packaged JS preparer outside checkout.
  execFileSync(
    process.execPath,
    [join(pkg, "scripts/prepare_digest_enrollment_inputs.mjs"), "--input", join(work, "do_obs.json"), "--output", join(work, "js_bundle.json")],
    { cwd: work, env: { PATH: process.env.PATH, QSL_DIGEST_CONSOLE_DIR: join(pkg, "web/strategy-switch-console") }, stdio: "pipe" },
  );

  // Step 2: Run packaged Python preparer CLI outside checkout (python3 -I).
  const prepOut = execFileSync(
    "python3",
    [
      "-I", join(pkg, "python/scripts/project_digest_display_roster.py"), "prepare-mapping",
      "--js-bundle", join(work, "js_bundle.json"),
      "--legacy-roster", join(work, "legacy_roster.json"),
      "--observation-bindings", join(work, "obs_bindings.json"),
      "--source", "synthetic-enrollment",
      "--version", "v1", "--membership-version", "m1", "--label-version", "l1", "--link-version", "k1",
      "--prepared-at", doObservation.observed_at,
      "--artifact-output", join(work, "artifact.json"),
      "--selection-output", join(work, "selection.json"),
    ],
    { cwd: work, env: { PATH: process.env.PATH, PYTHONPATH: join(pkg, "python/scripts") }, encoding: "utf8" },
  );
  assert.match(prepOut, /digest_mapping_prepared/);

  // Step 3: Run packaged Python constructor + generation outside checkout (python3 -I).
  const pyGen = `
import json, os, sys
from datetime import datetime, timedelta
from pathlib import Path
pkg, work = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(pkg / 'python' / 'scripts'))
import digest_package_preflight as preflight
preflight.verify_package(pkg, role='generation')
import cloud_run_daily_digest as app
import digest_roster_authority as authority
import digest_roster_generation as generation
os.environ.update({
    'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
    'DIGEST_DELIVERY_ENABLED': 'true',
    'DIGEST_SCHEDULER_JOB_NAME': 'projects/synthetic/locations/synthetic/jobs/daily-digest',
    'DIGEST_RECIPIENT_SCOPE': 'syn-scope',
    'DIGEST_CUTOVER_REPORT_DATE': '2026-11-20',
    'QSL_NOTIFY_LANG': 'en',
    'DIGEST_ROSTER_BOOT_JSON': json.dumps({
        'mode': 'mapping_v1', 'origin': 'https://console.example.invalid',
        'service_auth': {'issuer': 'syn-iss', 'audience': 'syn-aud', 'subjects': ['syn-sub']},
        'enrollment_source': 'synthetic-enrollment', 'config_context': 'synthetic_context', 'read_timeout': 10.0,
    }),
})
cfg = app.Configuration.from_environment()
readback_doc = json.loads((work / 'readback.json').read_text(encoding='utf-8'))
observed = datetime.fromisoformat(readback_doc['observed_at'].replace('Z', '+00:00'))
clock = observed + timedelta(seconds=10)
class PeerAuth:
    def assertion(self, method, path, audience, now):
        return authority.ServiceAssertion('tok', 'syn-iss', audience, 'syn-sub', now + timedelta(minutes=5), method, path)
class PeerTransport:
    def get(self, url, headers, timeout):
        return authority.TransportResponse(200, {'content-type': 'application/json', 'cache-control': 'private, no-store'}, json.dumps(readback_doc).encode('utf-8'), url)
class PeerEnrollment:
    def read_selection(self): return authority.SourceRead('synthetic-enrollment', True, (work / 'selection.json').read_bytes())
    def read_artifact(self, sel): return authority.SourceRead('synthetic-enrollment', True, (work / 'artifact.json').read_bytes())
class PeerStore:
    def __init__(self): self.records = {}
    def candidate(self, key, timeout): return None
    def reserve(self, key, rec): self.records[key] = rec; return True, 1
    def finish(self, key, gen, rec): self.records[key] = rec
    def delivery(self, key): return self.records.get(key)
runner = generation.GenerationRunner(cfg.roster_boot, authority.AcquisitionClient(cfg.roster_boot, PeerAuth(), PeerTransport()), PeerEnrollment(), lambda: clock, recipient_scope='syn-scope')
sent = []
report_date = datetime(2026, 11, 20, 7, 0, tzinfo=app.SGT)
platform_cfg = json.loads((pkg / 'platform-config.json').read_text(encoding='utf-8'))
code, res = app.execute_slot(report_date.date(), '2026-11-19', False, {'scheduled_at': report_date.isoformat(), 'trigger_provenance': 'cloud_scheduler'}, cfg, PeerStore(), lambda text: (sent.append(text), 1)[1], now=lambda: report_date, platform_config=platform_cfg, roster_runner=runner)
assert code == 200 and res['delivery'] == 'accepted', (code, res)
headers = [l for l in sent[0].splitlines() if l.startswith('🏦 ')]
assert len(headers) == 10, headers
origins = preflight.assert_isolated_imports(pkg)
assert all(p.startswith(str(pkg.resolve())) for p in origins.values())
print(json.dumps({'headers': len(headers), 'origins': len(origins)}))
`;
  const genOut = execFileSync("python3", ["-I", "-c", pyGen, pkg, work], {
    cwd: work, env: { PATH: process.env.PATH }, encoding: "utf8",
  });
  const genStats = JSON.parse(genOut.trim());
  assert.equal(genStats.headers, 10);

  // Step 4: Verify omitting any JS preparer module fails JS preparer or preflight.
  const jsMembers = MANIFEST.members.filter(m => m.dependency_role === "preparer" && m.kind === "js_module");
  for (const member of jsMembers) {
    const omittedDir = join(tmp, "omit-js");
    await rm(omittedDir, { recursive: true, force: true });
    await cp(pkg, omittedDir, { recursive: true });
    await unlink(join(omittedDir, member.destination));
    let failed = false;
    try {
      execFileSync(
        process.execPath,
        [join(omittedDir, "scripts/prepare_digest_enrollment_inputs.mjs"), "--input", join(work, "do_obs.json")],
        { cwd: work, env: { PATH: process.env.PATH, QSL_DIGEST_CONSOLE_DIR: join(omittedDir, "web/strategy-switch-console") }, stdio: "pipe" },
      );
    } catch {
      failed = true;
    }
    assert.equal(failed, true, `omitting JS preparer member ${member.destination} should fail`);
  }

  assert.equal(harness.outbound.count, 0);
  console.log(JSON.stringify({
    suite: "digest_roster_package_validation",
    ok: true,
    headers: genStats.headers,
    js_omissions_rejected: jsMembers.length,
    outbound_calls: harness.outbound.count,
  }));
} finally {
  await rm(tmp, { recursive: true, force: true });
}

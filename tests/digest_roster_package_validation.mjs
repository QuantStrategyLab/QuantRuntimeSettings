// Isolated offline synthetic package fixture (Q7, row B3-22) covering real
// JS preparation (B1 projectAccountManagement + B2 exportAppliedRecords +
// buildManagementReadback) and isolated Python constructor/generation outside
// the repository checkout, plus single-member omission rejection for both
// every manifest role through the normal fixture entry.
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

  // The normal fixture entry: all-role preflight of the materialized package,
  // then real JS and Python preparation, then constructor and generation, all
  // from packaged assets only, outside the checkout.
  const preflightScript = `
import sys
from pathlib import Path
pkg = Path(sys.argv[1])
sys.path.insert(0, str(pkg / 'python' / 'scripts'))
import digest_package_preflight as preflight
preflight.verify_package(pkg, role='all')
`;
  async function entry(pkgDir, out) {
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });
    execFileSync("python3", ["-I", "-c", preflightScript, pkgDir], { cwd: out, env: { PATH: process.env.PATH }, stdio: "pipe" });
    execFileSync(
      process.execPath,
      [join(pkgDir, "scripts/prepare_digest_enrollment_inputs.mjs"), "--input", join(work, "do_obs.json"), "--output", join(out, "js_bundle.json")],
      { cwd: out, env: { PATH: process.env.PATH, QSL_DIGEST_CONSOLE_DIR: join(pkgDir, "web/strategy-switch-console") }, stdio: "pipe" },
    );
    const prepOut = execFileSync(
      "python3",
      [
        "-I", join(pkgDir, "python/scripts/project_digest_display_roster.py"), "prepare-mapping",
        "--js-bundle", join(out, "js_bundle.json"),
        "--legacy-roster", join(work, "legacy_roster.json"),
        "--observation-bindings", join(work, "obs_bindings.json"),
        "--source", "synthetic-enrollment",
        "--version", "v1", "--membership-version", "m1", "--label-version", "l1", "--link-version", "k1",
        "--prepared-at", doObservation.observed_at,
        "--artifact-output", join(out, "artifact.json"),
        "--selection-output", join(out, "selection.json"),
      ],
      { cwd: out, env: { PATH: process.env.PATH, PYTHONPATH: join(pkgDir, "python/scripts") }, encoding: "utf8", stdio: "pipe" },
    );
    assert.match(prepOut, /digest_mapping_prepared/);
    for (const name of ["readback.json", "do_obs.json"]) await cp(join(work, name), join(out, name));
    return JSON.parse(execFileSync("python3", ["-I", "-c", pyGen, pkgDir, out], {
      cwd: out, env: { PATH: process.env.PATH }, encoding: "utf8", stdio: "pipe",
    }).trim());
  }

  const pyGen = `
import json, os, sys
from datetime import datetime, timedelta
from pathlib import Path
pkg, work = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(pkg / 'python' / 'scripts'))
import digest_package_preflight as preflight
preflight.verify_package(pkg, role='all')
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
assert all(isinstance(p, str) and not p.startswith('/') and '..' not in p for p in origins.values()), 'origins'
assert origins.get('notification_snapshot.unified_contract') == 'python/scripts/notification_snapshot/unified_contract.py'
assert origins.get('notification_snapshot') == 'python/scripts/notification_snapshot/__init__.py'
resources = preflight.resource_origins(pkg)
assert resources['schema:qsl-digest-account-roster.v1.schema.json'] == 'schemas/qsl-digest-account-roster.v1.schema.json'
print(json.dumps({'headers': len(headers), 'origins': len(origins), 'resources': len(resources),
                  'qualified': sum('.' in name for name in origins)}))
`;
  const genStats = await entry(pkg, join(tmp, "out-positive"));
  assert.equal(genStats.headers, 10);
  assert.ok(genStats.qualified >= 2);

  // Omit each required manifest member in turn, every role and kind
  // (modules, schemas, data and both status resources), and run the same
  // normal entry: each omission must fail by member or by isolated import.
  let byMember = 0;
  let byImport = 0;
  for (const member of MANIFEST.members) {
    const omittedDir = join(tmp, "omit");
    await rm(omittedDir, { recursive: true, force: true });
    await cp(pkg, omittedDir, { recursive: true });
    await unlink(join(omittedDir, member.destination));
    let failure = null;
    try {
      await entry(omittedDir, join(tmp, "out-omit"));
    } catch (error) {
      failure = String(error.stderr || "") + String(error.stdout || "") + String(error.message || "");
    }
    assert.ok(failure !== null, `omitting ${member.destination} should fail`);
    if (failure.includes(`missing_package_member:${member.destination}`)) byMember += 1;
    else if (/ModuleNotFoundError|ImportError|No such file/.test(failure)) byImport += 1;
    else assert.fail(`omitting ${member.destination} failed for an unrelated reason`);
  }
  assert.equal(byMember + byImport, MANIFEST.members.length);

  assert.equal(harness.outbound.count, 0);
  console.log(JSON.stringify({
    suite: "digest_roster_package_validation",
    ok: true,
    headers: genStats.headers,
    origins: genStats.origins,
    qualified_origins: genStats.qualified,
    resources: genStats.resources,
    omissions_rejected: byMember + byImport,
    omissions_by_member: byMember,
    omissions_by_isolated_import: byImport,
    members: MANIFEST.members.length,
    outbound_calls: harness.outbound.count,
  }));
} finally {
  await rm(tmp, { recursive: true, force: true });
}

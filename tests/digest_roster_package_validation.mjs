// Isolated offline synthetic PKG & PREP §11 item 7 validation (B3-A slice 7).
// Materializes digest_package_manifest.json outside the checkout, runs
// package-relative JS + Python preparation, packaged constructor + three digest
// files + conditional publication + RESCOPE §7 GenerationContext provider surface,
// single-member omissions for every manifest member, and PREP inventory checks.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MANIFEST = JSON.parse(await readFile(join(ROOT, "python/scripts/digest_package_manifest.json"), "utf8"));

const RealDate = Date;
let tick = RealDate.parse("2026-11-19T20:00:00.000Z");
globalThis.Date = class extends RealDate {
  constructor(...args) { if (args.length) super(...args); else { super(tick); tick += 1000; } }
  static now() { tick += 1000; return tick - 1000; }
};
const harness = await import("./helpers/account_management_harness.mjs");
const { collectInventory, instanceStateRow } = await import("./helpers/account_identity_inventory_collect.mjs");
const fixture = JSON.parse(await readFile(join(ROOT, "tests/fixtures/account-mapping-roster.synthetic.json"), "utf8"));

async function materialize(pkgDir) {
  for (const origin of ["base", "b3_overlay"]) {
    for (const member of MANIFEST.members) {
      if (member.origin !== origin) continue;
      const dst = join(pkgDir, member.destination);
      await mkdir(dirname(dst), { recursive: true });
      await cp(join(ROOT, member.source), dst);
    }
  }
}

const tmp = await mkdtemp(join(tmpdir(), "qsl-b3a-pkg-"));
try {
  const pkg = join(tmp, "pkg");
  const work = join(tmp, "work");
  const out = join(tmp, "out");
  await mkdir(pkg, { recursive: true });
  await mkdir(work, { recursive: true });
  await mkdir(out, { recursive: true });
  await materialize(pkg);

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

  // 1. Package-relative JS preparer (unset QSL_DIGEST_CONSOLE_DIR) + explicit QSL_DIGEST_CONSOLE_DIR.
  execFileSync(
    process.execPath,
    [join(pkg, "scripts/prepare_digest_enrollment_inputs.mjs"), "--input", join(work, "do_obs.json"), "--output", join(out, "js_bundle_rel.json")],
    { cwd: out, env: { PATH: process.env.PATH }, stdio: "pipe" },
  );
  execFileSync(
    process.execPath,
    [join(pkg, "scripts/prepare_digest_enrollment_inputs.mjs"), "--input", join(work, "do_obs.json"), "--output", join(out, "js_bundle_env.json")],
    { cwd: out, env: { PATH: process.env.PATH, QSL_DIGEST_CONSOLE_DIR: join(pkg, "web/strategy-switch-console") }, stdio: "pipe" },
  );
  assert.equal(
    await readFile(join(out, "js_bundle_rel.json"), "utf8"),
    await readFile(join(out, "js_bundle_env.json"), "utf8"),
  );

  // 2. Packaged Python preparer invoking packaged JS preparer package-relatively.
  const prepOut = execFileSync(
    "python3",
    [
      "-I", join(pkg, "python/scripts/project_digest_display_roster.py"), "prepare-mapping",
      "--do-observation", join(work, "do_obs.json"),
      "--legacy-roster", join(work, "legacy_roster.json"),
      "--observation-bindings", join(work, "obs_bindings.json"),
      "--source", "synthetic-enrollment",
      "--version", "v1", "--membership-version", "m1", "--label-version", "l1", "--link-version", "k1",
      "--prepared-at", doObservation.observed_at,
      "--artifact-output", join(out, "artifact.json"),
      "--selection-output", join(out, "selection.json"),
      "--raw-identifiers-output", join(out, "raw_ids.json"),
    ],
    { cwd: out, env: { PATH: process.env.PATH, PYTHONPATH: join(pkg, "python/scripts") }, encoding: "utf8", stdio: "pipe" },
  );
  assert.match(prepOut, /digest_mapping_prepared/);

  // 3. Isolated Python preflight, §11 item 7 PREP inventory, 3 digest files, constructor, publication, provider surface.
  const pyCheck = `
import json, os, sys
from copy import deepcopy
from datetime import timedelta
from pathlib import Path

pkg, work, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
sys.path.insert(0, str(pkg / 'python' / 'scripts'))

import digest_package_preflight as preflight
checked = preflight.verify_package(pkg, role='all')
manifest = preflight.load_manifest(pkg / preflight.MANIFEST_DESTINATION)
exercised = {
    'web/strategy-switch-console/application/runtime_instances/account_management.js',
    'web/strategy-switch-console/application/runtime_instances/account_management_readback.js',
    'web/strategy-switch-console/application/account_mapping/inventory_adapter.js',
    'web/strategy-switch-console/application/runtime_instances/mapping_projection.js',
    'schemas/qsl-digest-account-roster.v1.schema.json',
    'schemas/qsl-digest-enrollment-selection.v1.schema.json',
    'schemas/qsl-digest-enrollment-artifact.v1.schema.json',
}
inv_summary = {}
for entry, roles in (
    ('js_preparer', {'preparer', 'both'}),
    ('python_preparer', {'preparer', 'both'}),
    ('preflight', {'preparer', 'both'}),
    ('provider', {'generation', 'both'}),
    ('producer_publication', {'generation', 'both'}),
):
    res = preflight.verify_entry_inventory(pkg, manifest, entry, allowed_roles=roles, exercised_nonliteral=exercised)
    inv_summary[entry] = {'members': len(res['members']), 'edges': len(res['edges'])}

# Delete one edge declaration per shipped edge class while keeping both endpoints installed.
for edge_class, entry, src_dest, removed_imp in (
    ('python_static_import', 'python_preparer', 'python/scripts/project_digest_display_roster.py', 'digest_roster_authority'),
    ('js_static_import', 'js_preparer', 'web/strategy-switch-console/application/account_mapping/inventory_adapter.js', 'web/strategy-switch-console/application/account_mapping/policy.js'),
    ('js_mapped_dynamic_import', 'js_preparer', 'scripts/prepare_digest_enrollment_inputs.mjs', 'web/strategy-switch-console/application/runtime_instances/mapping_projection.js'),
    ('data_load', 'python_preparer', 'python/scripts/display_names.py', 'python/scripts/display_names.json'),
    ('schema_load', 'python_preparer', 'python/scripts/digest_roster_validator.py', 'schemas/qsl-digest-account-roster.v1.schema.json'),
    ('status_load', 'preflight', 'python/scripts/digest_package_preflight.py', 'web/strategy-switch-console/application/runtime_instances/account_management_text.js'),
):
    mut = deepcopy(manifest)
    next(m for m in mut['members'] if m['destination'] == src_dest)['imports'].remove(removed_imp)
    try:
        preflight.verify_entry_inventory(pkg, mut, entry)
        raise AssertionError(f'expected undeclared_package_edge for {edge_class}')
    except ValueError as err:
        assert str(err).startswith('undeclared_package_edge:'), str(err)

import account_daily_digest as digest_render
import account_daily_facts as digest_facts
import cloud_run_daily_digest as app
import daily_digest_aggregator as aggregator
import digest_roster_authority as authority
import digest_roster_provider as provider
import digest_roster_publication as publication
import digest_roster_validator as validator

assert callable(digest_render.render_account_daily) and callable(digest_facts.collect_account_facts)
assert 'platforms' in aggregator.load_platform_config()
os.environ.update({
    'QRS_UNIFIED_NOTIFICATION_ENABLED': 'true',
    'DIGEST_DELIVERY_ENABLED': 'false',
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
observed = validator.parse_instant(readback_doc['observed_at'])
clock = observed + timedelta(seconds=10)
class PeerAuth:
    def assertion(self, method, path, audience, now):
        return authority.ServiceAssertion('tok', 'syn-iss', audience, 'syn-sub', now + timedelta(minutes=5), method, path)
class PeerTransport:
    def get(self, url, headers, timeout):
        return authority.TransportResponse(200, {'content-type': 'application/json', 'cache-control': 'private, no-store'}, json.dumps(readback_doc).encode('utf-8'), url)
class PeerEnrollment:
    def read_selection(self): return authority.SourceRead('synthetic-enrollment', True, (out / 'selection.json').read_bytes())
    def read_artifact(self, sel): return authority.SourceRead('synthetic-enrollment', True, (out / 'artifact.json').read_bytes())

store = publication.InMemoryConditionalRosterStore()
pub = publication.ConditionalRosterPublisher(
    cfg.roster_boot, authority.AcquisitionClient(cfg.roster_boot, PeerAuth(), PeerTransport()),
    PeerEnrollment(), store, lambda: clock, 'syn-scope',
)
outcome = pub.publish_generation(
    report_date='2026-11-20', original_slot='07:00',
    generation_window={'business_day': '2026-11-19', 'start': '2026-11-18T22:00:00Z', 'end': '2026-11-19T22:00:00Z', 'deadline_at': '2026-11-19T23:30:00Z'},
    deadline=clock + timedelta(minutes=5), generation_id='gen-js-pkg-01',
)
assert outcome.status == 'available' and outcome.committed
ctx = publication.provide_generation_context(outcome, clock=clock)
assert ctx.authoritative and len(ctx.groups) == 10
assert ctx.acquisition.verify_freshness(observed + timedelta(seconds=300))
assert not ctx.acquisition.verify_freshness(observed + timedelta(seconds=300, milliseconds=1))

origins = preflight.assert_isolated_imports(pkg)
assert all(isinstance(v, str) and not v.startswith('/') and '..' not in v for v in origins.values())
resources = preflight.resource_origins(pkg, role='all')
print(json.dumps({
    'checked': len(checked),
    'inventory': inv_summary,
    'groups': len(ctx.groups),
    'origins': len(origins),
    'resources': len(resources),
}))
`;
  const stats = JSON.parse(execFileSync("python3", ["-I", "-c", pyCheck, pkg, work, out], {
    cwd: out, env: { PATH: process.env.PATH }, encoding: "utf8", stdio: "pipe",
  }).trim());
  assert.equal(stats.checked, MANIFEST.members.length);
  assert.equal(stats.groups, 10);

  // 4. One-file-at-a-time omission for EVERY manifest member (reuse pkg in place and restore each file).
  const omitScript = `
import sys
from pathlib import Path
pkg = Path(sys.argv[1])
sys.path.insert(0, str(pkg / 'python' / 'scripts'))
import digest_package_preflight as preflight
preflight.verify_package(pkg, role='all')
`;
  let rejected = 0;
  for (const member of MANIFEST.members) {
    const target = join(pkg, member.destination);
    const saved = await readFile(target);
    await unlink(target);
    let failure = null;
    try {
      execFileSync("python3", ["-I", "-c", omitScript, pkg], { cwd: out, env: { PATH: process.env.PATH }, stdio: "pipe" });
    } catch (error) {
      failure = String(error.stderr || "") + String(error.stdout || "");
    } finally {
      await writeFile(target, saved);
    }
    assert.ok(failure !== null, `omitting ${member.destination} must fail`);
    if (member.destination === "python/scripts/digest_package_preflight.py") {
      assert.match(failure, /ModuleNotFoundError/);
    } else {
      assert.ok(failure.includes(`missing_package_member:${member.destination}`), failure);
    }
    rejected += 1;
  }
  assert.equal(rejected, MANIFEST.members.length);
  assert.equal(harness.outbound.count, 0);
  console.log(JSON.stringify({
    suite: "digest_roster_package_validation",
    ok: true,
    members: MANIFEST.members.length,
    omissions_rejected: rejected,
    ...stats,
    outbound_calls: harness.outbound.count,
  }));
} finally {
  await rm(tmp, { recursive: true, force: true });
}

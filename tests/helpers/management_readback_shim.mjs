// Test-only stand-in for the object's management readback, for suites that
// exercise a Worker over a stubbed or unenrolled object and are not about
// management. It answers the fixed management read path with a synthetic
// readback in which every listed account is a known, managed, eligible
// physical group of one deployment; every other request passes through to the
// wrapped namespace unchanged. The real readback, its gates and its cohort
// effects are proven in the READ, STORE and GATES suites.
const READ_PATH = "/internal/account-management-read";

export function syntheticReadback(accounts, { status = "managed", evidence = "known" } = {}) {
  const groups = accounts.map(({ platform, key, environment = null }) => ({
    management_class: "eligible", management_status: status, evidence_state: evidence, reasons: [],
    scope: environment === "paper" || environment === "live" ? environment : "unknown", processing_eligible: status === "managed" && evidence === "known",
    processing_denial: null, applied: { management_enabled: status === "managed", revision: 1, effective_at: "2026-01-01T00:00:00.000Z" },
    deployments: [{ platform, key, present: true }],
  }));
  return { ok: true, format: "qsl_account_management_readback.v1", evidence_scope: "runtime_instances_sqlite", status: "available", reasons: [],
    observed_at: "2026-01-01T00:00:00.000Z", instance_revision: 1, policy_revision: 1, policy_status: "available", physical_grouping_complete: true,
    counts: { physical_accounts: groups.length, display_deployments: groups.length, uncovered_deployments: 0, managed: groups.length, management_disabled: 0, not_under_management: 0, unknown: 0 },
    groups, uncovered_deployments: [], effective_export: { format: "qsl_account_management_effective_export.v1", instance_revision: 1, policy_revision: 1, records: [] } };
}

// `accounts()` resolves the current list of { platform, key, environment }.
export function withManagedReadback(namespace, accounts, options) {
  return {
    idFromName: name => namespace.idFromName(name),
    get(id) {
      const stub = namespace.get(id);
      return {
        async fetch(url, init) {
          if (new URL(String(url)).pathname === READ_PATH) return Response.json(syntheticReadback(await accounts(), options));
          return stub.fetch(url, init);
        },
      };
    },
  };
}

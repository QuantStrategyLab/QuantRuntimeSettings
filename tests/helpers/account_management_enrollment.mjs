// Synthetic management enrollment for Worker-level fixtures. Processing
// admission now needs a provisioned policy and an applied management state,
// so a fixture that exercises admission first classifies each current
// existing deployment as its own eligible physical account and explicitly
// initializes it as managed, through the Durable Object's own commands.
// Synthetic fixture state only; never inferred production state.
const CONSOLE = new URL("../../web/strategy-switch-console/", import.meta.url);
const { accountSettingsIdentity } = await import(new URL("application/account_settings/helpers.js", CONSOLE));

let keys = 0;
const requestKey = () => `00000000-0000-4000-9000-${String(++keys).padStart(12, "0")}`;

// `send(command)` posts one command to the RuntimeInstances object and
// resolves `{ status, body }`; `read()` resolves its GET state.
export async function enrollSyntheticManagement({ send, read }, { policyRevision = 1, expectedPolicyRevision = policyRevision - 1, classes = {}, enabled = {} } = {}) {
  const state = await read();
  const existing = state.instances.filter(item => item.kind === "existing" && (item.retirement_status ?? "none") === "none");
  const policy = { format: "qsl_account_mapping_policy.v1", policy_revision: policyRevision, accounts: existing.map(item => ({
    management_class: classes[`${item.platform}/${item.key}`] || "eligible",
    deployments: [{ platform: item.platform, legacy_key: item.key, identity: accountSettingsIdentity(item) }],
  })) };
  const provisioned = await send({ action: "account_mapping_policy_replace", actor: "account-mapping-policy-provisioner", expected_policy_revision: expectedPolicyRevision, policy });
  if (provisioned.status !== 200) throw new Error(`synthetic policy provisioning failed: ${provisioned.body?.error}`);
  const skipped = [];
  for (const item of existing) {
    const id = `${item.platform}/${item.key}`;
    if ((classes[id] || "eligible") !== "eligible") continue;
    const base = { actor: "synthetic-enrollment", platform: item.platform, key: item.key, identity: accountSettingsIdentity(item),
      expected_instance_revision: state.revision, expected_policy_revision: policyRevision, expected_management_draft_revision: 0, expected_management_revision: 0 };
    const saved = await send({ ...base, action: "account_management_draft_save", request_key: requestKey(), management_enabled: enabled[id] ?? true });
    if (saved.status === 409 && saved.body?.error === "management_applied_revision_conflict") continue;
    // A deployment the live resolver cannot certify (for example a legacy
    // key shared across platforms) stays unenrolled and fails closed.
    if (saved.status === 409 && ["management_membership_conflict", "management_identity_conflict"].includes(saved.body?.error)) { skipped.push(id); continue; }
    if (saved.status !== 200) throw new Error(`synthetic management draft failed: ${saved.body?.error}`);
    const applied = await send({ ...base, action: "account_management_apply", request_key: requestKey(), expected_management_draft_revision: saved.body.management_draft_revision });
    if (applied.status !== 200) throw new Error(`synthetic management apply failed: ${applied.body?.error}`);
  }
  return { policy_revision: policyRevision, deployments: existing.length, skipped };
}

// The send/read pair over a Miniflare instance's RuntimeInstances namespace.
export async function miniflareRuntimeInstances(mf, binding = "STRATEGY_SWITCH_RUNTIME_INSTANCES") {
  const namespace = await mf.getDurableObjectNamespace(binding);
  const stub = namespace.get(namespace.idFromName("runtime-instances"));
  const parse = async response => { const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null }; };
  return {
    send: async command => parse(await stub.fetch("https://runtime-instances/", { method: "POST", body: JSON.stringify(command) })),
    read: async () => (await parse(await stub.fetch("https://runtime-instances/"))).body,
  };
}

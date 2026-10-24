import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { normalizeAccountFactsBindings } from "./account_facts.js";

const ORIGIN = "https://api.cloudflare.com/client/v4";
const BINDINGS_KEY = "account_facts_bindings";
const sha = value => createHash("sha256").update(value, "utf8").digest("hex");
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
class BackupError extends Error {}

export function backupContext(env) {
  if (env.BINDING_PLATFORM !== "ibkr" || env.INPUT_EVENT_NAME !== "workflow_dispatch"
      || env.INPUT_REF !== "refs/heads/main" || env.BACKUP_PRIMARY_IBKR_BINDING !== "true"
      || ["INSPECT_IBKR_BINDINGS", "INSPECT_IBKR_LIFECYCLE", "INITIALIZE_IBKR_BINDINGS",
        "APPLY_INITIAL_IBKR_BINDINGS", "PREVIEW_IBKR_SOURCE_ROTATION"].some(key => env[key] === "true")) {
    throw new BackupError("backup_mode_invalid");
  }
  let hashes;
  try { hashes = JSON.parse(env.IBKR_PRIMARY_BACKUP_HASHES); } catch { throw new BackupError("backup_context_invalid"); }
  const fields = ["target_id_sha256", "configured_source_binding_id_sha256", "candidate_source_binding_id_sha256"].sort();
  if (!hashes || Array.isArray(hashes) || Object.keys(hashes).sort().join() !== fields.join()
      || Object.values(hashes).some(value => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
      || hashes.configured_source_binding_id_sha256 === hashes.candidate_source_binding_id_sha256) {
    throw new BackupError("backup_context_invalid");
  }
  return hashes;
}

export function prepareBackup(raw, hashes) {
  let bindings;
  try { bindings = normalizeAccountFactsBindings(raw).bindings; }
  catch { throw new BackupError("binding_invalid"); }
  const matches = bindings.filter(row => row.platform === "ibkr" && sha(row.target_id) === hashes.target_id_sha256);
  if (matches.length !== 1 || sha(matches[0].source_binding.id) !== hashes.configured_source_binding_id_sha256) {
    throw new BackupError("backup_comparison_changed");
  }
  // Store the exact original row, preserving every private field for restoration.
  const binding = raw.bindings.find(row => row.platform === "ibkr" && row.target_id === matches[0].target_id);
  const body = JSON.stringify({ schema_version: "qsl.ibkr_primary_binding_backup.v1",
    comparison_sha256: sha(canonical(hashes)), comparison_hashes: hashes, binding });
  return { body, key: `account_facts_primary_backup:${sha(body)}`, binding };
}

export async function backupPrimaryBinding(env, fetchImpl = fetch) {
  const hashes = backupContext(env);
  if (!env.CLOUDFLARE_API_TOKEN || !/^[a-f0-9]{32}$/i.test(env.STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID || "")) {
    throw new BackupError("cloudflare_credentials_missing");
  }
  const request = async (url, method = "GET", body) => {
    try {
      const response = await fetchImpl(url, { method, body, redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
      if (method === "GET" && response.status === 404) return null;
      if (!response.ok) throw new Error();
      const text = await response.text();
      if (Buffer.byteLength(text) > 1024 * 1024) throw new Error();
      return text;
    } catch { throw new BackupError("backup_remote_read_failed"); }
  };
  let account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!account) {
    let listing;
    try { listing = JSON.parse(await request(`${ORIGIN}/accounts?page=1&per_page=5`)); }
    catch { throw new BackupError("account_context_unavailable"); }
    if (listing.success !== true || listing.result?.length !== 1 || listing.result_info?.total_count !== 1) {
      throw new BackupError("account_context_unavailable");
    }
    account = listing.result[0].id;
  }
  if (!/^[a-f0-9]{32}$/i.test(account)) throw new BackupError("account_context_unavailable");
  const root = `${ORIGIN}/accounts/${account}/storage/kv/namespaces/${env.STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID}/values/`;
  const readBindings = async () => {
    try { return JSON.parse(await request(`${root}${BINDINGS_KEY}`)); }
    catch { throw new BackupError("binding_read_failed"); }
  };
  const backup = prepareBackup(await readBindings(), hashes);
  const url = `${root}${encodeURIComponent(backup.key)}`;
  const previous = await request(url);
  if (previous !== null && previous !== backup.body) throw new BackupError("backup_content_conflict");
  if (previous === null) {
    // Content-addressed key, one PUT, no retry and no write to the binding key.
    try { await request(url, "PUT", backup.body); } catch { /* resolve only by readback */ }
  }
  let readback;
  try { readback = await request(url); } catch { throw new BackupError("backup_readback_unknown"); }
  if (readback !== backup.body) throw new BackupError("backup_readback_unknown");
  const current = prepareBackup(await readBindings(), hashes);
  if (current.body !== backup.body) throw new BackupError("backup_comparison_changed");
  return { schema_version: "qsl.ibkr_primary_binding_backup_result.v1", status: "backup_verified",
    comparison_sha256: sha(canonical(hashes)), backup_reference_sha256: sha(backup.key),
    backup_object_sha256: sha(backup.body), publication_authority_granted: false };
}

export async function main(env = process.env, fetchImpl = fetch) {
  try {
    const result = await backupPrimaryBinding(env, fetchImpl);
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    const reason = error instanceof BackupError ? error.message : "backup_failed";
    console.log(JSON.stringify({ status: reason === "backup_readback_unknown" ? "unknown" : "blocked", reason }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();

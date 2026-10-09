import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeAccountOptionsPayload } from "./account_options_schema.js";
import {
  accountFactsOptionMatchesBinding,
  normalizeAccountFactsBindings,
} from "./account_facts.js";

const IBKR_REPO = "QuantStrategyLab/InteractiveBrokersPlatform";
const SETTINGS = [
  "IBKR_PERIOD_RETURN_TARGET_ID",
  "IBKR_PERIOD_RETURN_SOURCE_BINDING_ID",
  "IBKR_PERIOD_RETURN_ACCOUNT_SCOPE",
  "IBKR_PERIOD_RETURN_ACCOUNT_KEY",
  "IBKR_FLEX_EXPECTED_ACCOUNT_IDS_JSON",
];
const TARGET_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const fail = (reason) => { throw new Error(reason); };

function protectedCommand(args, input, env) {
  const result = spawnSync("gh", args, {
    input, env, encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail("protected_configuration_write_failed_or_unknown");
  return result.stdout;
}

function matchedIbkrBindings(optionsRaw, bindingsRaw) {
  const options = normalizeAccountOptionsPayload(optionsRaw).ibkr;
  const bindings = normalizeAccountFactsBindings(bindingsRaw).bindings
    .filter((item) => item.platform === "ibkr");
  if (!Array.isArray(options) || options.length === 0 || bindings.length === 0) {
    fail("configuration_missing");
  }
  const matched = [];
  for (const binding of bindings) {
    const optionsForKey = options.filter((option) => option.key === binding.account_key);
    if (optionsForKey.length !== 1 || !accountFactsOptionMatchesBinding(optionsForKey[0], binding)) {
      fail("option_binding_mismatch");
    }
    if (typeof binding.account_selector !== "string"
        || !/^(?:U|DU)[0-9]+$/.test(binding.account_selector)
        || typeof binding.source_binding?.id !== "string"
        || !/^[a-f0-9]{64}$/.test(binding.source_binding.id)
        || typeof binding.target_id !== "string"
        || !TARGET_ID_RE.test(binding.target_id)
        || typeof binding.account_scope !== "string"
        || typeof binding.account_key !== "string") {
      fail("binding_identity_invalid");
    }
    matched.push(binding);
  }
  return matched;
}

/** Safe catalog line: target_id, account_scope, account_key only (no native account id). */
export function listIbkrPeriodReturnTargets(optionsRaw, bindingsRaw) {
  const matched = matchedIbkrBindings(optionsRaw, bindingsRaw);
  const catalog = matched
    .map((binding) => `${binding.target_id}|${binding.account_scope}|${binding.account_key}`)
    .sort()
    .join(";");
  return {
    ok: true,
    reason: "none",
    count: matched.length,
    catalog,
  };
}

export function applyIbkrPeriodReturnSettings(optionsRaw, bindingsRaw, targetId, {
  env = process.env, command = protectedCommand, overwrite = false,
} = {}) {
  if (!env.GH_TOKEN) fail("protected_configuration_unavailable");
  if (typeof targetId !== "string" || !TARGET_ID_RE.test(targetId)) fail("target_id_invalid");
  const matched = matchedIbkrBindings(optionsRaw, bindingsRaw);
  const candidates = matched.filter((binding) => binding.target_id === targetId);
  if (candidates.length !== 1) fail("target_match_invalid");
  const binding = candidates[0];

  let metadata;
  try {
    metadata = JSON.parse(command(
      ["api", `repos/${IBKR_REPO}/actions/secrets?per_page=100`], undefined, env,
    ));
  } catch { fail("protected_configuration_metadata_unavailable"); }
  if (!Array.isArray(metadata?.secrets)
      || metadata.total_count !== metadata.secrets.length
      || metadata.secrets.some((item) => typeof item?.name !== "string")) {
    fail("protected_configuration_metadata_invalid");
  }
  const names = new Set(metadata.secrets.map((item) => item.name));
  if (!overwrite && SETTINGS.some((name) => names.has(name))) {
    fail("period_return_settings_already_present");
  }
  if (!names.has("IBKR_ACCOUNT_FACTS_SYNC_TOKEN")) {
    fail("ibkr_account_facts_sync_token_missing");
  }

  const values = {
    IBKR_PERIOD_RETURN_TARGET_ID: binding.target_id,
    IBKR_PERIOD_RETURN_SOURCE_BINDING_ID: binding.source_binding.id,
    IBKR_PERIOD_RETURN_ACCOUNT_SCOPE: binding.account_scope,
    IBKR_PERIOD_RETURN_ACCOUNT_KEY: binding.account_key,
    IBKR_FLEX_EXPECTED_ACCOUNT_IDS_JSON: JSON.stringify([binding.account_selector]),
  };
  for (const name of SETTINGS) {
    command(["secret", "set", name, "--repo", IBKR_REPO], values[name], env);
  }

  try {
    const secrets = JSON.parse(command(
      ["api", `repos/${IBKR_REPO}/actions/secrets?per_page=100`], undefined, env,
    ));
    const readNames = new Set(secrets.secrets.map((item) => item.name));
    if (!SETTINGS.every((name) => readNames.has(name))) fail("readback_mismatch");
  } catch { fail("period_return_configuration_readback_failed"); }

  return {
    secret_writes: SETTINGS.length,
    target_id: binding.target_id,
    account_scope: binding.account_scope,
    account_key: binding.account_key,
    // Native account id stays out of stdout; only confirm shape.
    expected_account_ids_count: 1,
  };
}

function main(argv) {
  if (argv.length < 3 || !["list", "apply"].includes(argv[0])) {
    process.stdout.write("status=blocked reason=request_invalid\n");
    return 1;
  }
  const mode = argv[0];
  let optionsRaw;
  let bindingsRaw;
  try {
    optionsRaw = JSON.parse(readFileSync(argv[1], "utf8"));
    bindingsRaw = JSON.parse(readFileSync(argv[2], "utf8"));
  } catch {
    process.stdout.write("status=blocked reason=configuration_unavailable\n");
    return 1;
  }

  try {
    if (mode === "list") {
      const listed = listIbkrPeriodReturnTargets(optionsRaw, bindingsRaw);
      process.stdout.write(
        `status=ok reason=none count=${listed.count} catalog=${listed.catalog}\n`,
      );
      return 0;
    }
    const targetId = argv[3] || "";
    const overwrite = argv[4] === "overwrite";
    const applied = applyIbkrPeriodReturnSettings(
      optionsRaw, bindingsRaw, targetId, { overwrite },
    );
    process.stdout.write(
      `status=applied reason=none secret_writes=${applied.secret_writes}`
        + ` target_id=${applied.target_id} account_scope=${applied.account_scope}`
        + ` account_key=${applied.account_key}`
        + ` expected_account_ids_count=${applied.expected_account_ids_count}\n`,
    );
    return 0;
  } catch (error) {
    const reason = typeof error?.message === "string" && /^[a-z0-9_]+$/.test(error.message)
      ? error.message : "configuration_failed";
    process.stdout.write(`status=blocked reason=${reason}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}

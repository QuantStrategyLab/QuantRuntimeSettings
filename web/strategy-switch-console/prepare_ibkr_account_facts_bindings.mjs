import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { normalizeAccountOptionsPayload } from "./account_options_schema.js";
import {
  ACCOUNT_FACTS_BINDINGS_SCHEMA,
  IBKR_ACCOUNT_FACTS_SOURCE_KIND,
  normalizeAccountFactsBindings,
} from "./account_facts.js";

const REQUEST_FIELDS = [
  "account_scope", "account_selector", "service_name", "deployment_selector",
  "target_id", "source_binding",
];
const PHYSICAL_FIELDS = ["account_scope", "account_selector", "service_name", "deployment_selector"];
const emptyCounts = () => ({ request_count: 0, matched_target_count: 0, existing_binding_count: 0, added_count: 0 });

function stop(reason, counts = emptyCounts()) {
  return { ok: false, reason, counts };
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function validRequest(value) {
  if (!exactKeys(value, REQUEST_FIELDS)
      || !exactKeys(value.source_binding, ["id", "kind"])
      || value.source_binding.kind !== IBKR_ACCOUNT_FACTS_SOURCE_KIND
      || typeof value.source_binding.id !== "string"
      || !/^[a-f0-9]{64}$/.test(value.source_binding.id)) return false;
  return PHYSICAL_FIELDS.every((field) => typeof value[field] === "string" && value[field].length > 0)
    && typeof value.target_id === "string" && value.target_id.length > 0;
}

export function prepareIbkrAccountFactsBindings(optionsRaw, existingRaw, requestsRaw, { apply = false } = {}) {
  let options;
  let existing;
  try {
    options = normalizeAccountOptionsPayload(optionsRaw).ibkr;
    existing = normalizeAccountFactsBindings(existingRaw);
  } catch {
    return stop("configuration_invalid");
  }
  if (!Array.isArray(options) || !Array.isArray(requestsRaw) || requestsRaw.length !== 3
      || !requestsRaw.every(validRequest)) return stop("request_invalid");

  const counts = {
    ...emptyCounts(),
    request_count: requestsRaw.length,
    existing_binding_count: existing.bindings.length,
  };
  const matches = [];
  const matchedOptionIndexes = new Set();
  for (const request of requestsRaw) {
    const candidates = options.map((option, index) => ({ option, index })).filter(({ option }) =>
      PHYSICAL_FIELDS.every((field) => option[field] === request[field]));
    if (candidates.length !== 1 || matchedOptionIndexes.has(candidates[0]?.index)) {
      counts.matched_target_count = matches.length;
      return stop("target_match_invalid", counts);
    }
    const { option, index } = candidates[0];
    matchedOptionIndexes.add(index);
    matches.push({ request, option });
    counts.matched_target_count = matches.length;
  }

  const newBindings = [];
  for (const { request, option } of matches) {
    const binding = {
      platform: "ibkr",
      account_key: option.key,
      account_scope: request.account_scope,
      target_name: option.target_name,
      service_name: request.service_name,
      deployment_selector: request.deployment_selector,
      account_selector: request.account_selector,
      target_id: request.target_id,
      source_binding: request.source_binding,
    };
    if (existing.bindings.some((item) => item.platform === "ibkr" && item.account_key === binding.account_key)
        || existing.bindings.some((item) => item.platform === "ibkr"
          && item.account_selector === binding.account_selector)
        || existing.bindings.some((item) => item.target_id === binding.target_id)
        || existing.bindings.some((item) => item.source_binding.id === binding.source_binding.id)
        || newBindings.some((item) => item.account_key === binding.account_key
          || item.account_selector === binding.account_selector
          || item.target_id === binding.target_id
          || item.source_binding.id === binding.source_binding.id)) {
      return stop("existing_binding_conflict", counts);
    }
    newBindings.push(binding);
  }

  let proposed;
  try {
    proposed = normalizeAccountFactsBindings({
      schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA,
      bindings: [...existing.bindings, ...newBindings],
    });
  } catch {
    return stop("updated_bindings_invalid", counts);
  }
  counts.added_count = newBindings.length;
  return {
    ok: true,
    reason: "none",
    status: apply ? "prepared" : "preview",
    counts,
    proposed: {
      schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA,
      bindings: proposed.bindings,
    },
  };
}

export function verifyIbkrAccountFactsBindings(expectedRaw, actualRaw) {
  try {
    const expected = normalizeAccountFactsBindings(expectedRaw);
    const actual = normalizeAccountFactsBindings(actualRaw);
    return isDeepStrictEqual(actual, expected) ? { ok: true } : { ok: false, reason: "readback_mismatch" };
  } catch {
    return { ok: false, reason: "readback_mismatch" };
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(argv) {
  if (argv[0] === "--verify" && argv.length === 3) {
    let result;
    try {
      result = verifyIbkrAccountFactsBindings(readJson(argv[1]), readJson(argv[2]));
    } catch {
      result = { ok: false, reason: "readback_mismatch" };
    }
    process.stdout.write(result.ok ? "status=applied\n" : `status=blocked reason=${result.reason}\n`);
    return result.ok ? 0 : 1;
  }
  if (argv.length !== 4 || !["true", "false"].includes(argv[3])) {
    process.stdout.write("status=blocked reason=request_invalid request_count=0 matched_target_count=0 existing_binding_count=0 added_count=0\n");
    return 1;
  }
  let result;
  try {
    result = prepareIbkrAccountFactsBindings(
      readJson(argv[0]),
      readJson(argv[1]),
      JSON.parse(process.env.IBKR_ACCOUNT_FACTS_INITIAL_BINDINGS_JSON || ""),
      { apply: argv[3] === "true" },
    );
  } catch {
    result = stop("request_invalid");
  }
  const { counts } = result;
  if (result.ok && argv[3] === "true") {
    try {
      writeFileSync(argv[2], JSON.stringify(result.proposed), { mode: 0o600, flag: "wx" });
    } catch {
      result = stop("output_unavailable", counts);
    }
  }
  process.stdout.write(
    `status=${result.ok ? result.status : "blocked"} reason=${result.reason}`
      + ` request_count=${counts.request_count} matched_target_count=${counts.matched_target_count}`
      + ` existing_binding_count=${counts.existing_binding_count} added_count=${counts.added_count}\n`,
  );
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}

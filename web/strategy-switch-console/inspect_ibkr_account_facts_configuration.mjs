import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeAccountOptionsPayload } from "./account_options_schema.js";
import {
  accountFactsOptionMatchesBinding,
  normalizeAccountFactsBindings,
} from "./account_facts.js";

const emptyCounts = () => ({
  option_count: 0,
  binding_count: 0,
  matched_count: 0,
  unmatched_option_count: 0,
  unmatched_binding_count: 0,
  identity_complete_count: 0,
  identity_incomplete_count: 0,
});

const PHYSICAL_IDENTITY_FIELDS = ["account_scope", "service_name", "deployment_selector", "account_selector"];

export function inspectIbkrAccountFactsConfiguration(optionsRaw, bindingsRaw) {
  let options;
  let bindings;
  try {
    const normalizedOptions = normalizeAccountOptionsPayload(optionsRaw);
    const normalizedBindings = normalizeAccountFactsBindings(bindingsRaw);
    options = normalizedOptions.ibkr;
    bindings = normalizedBindings.bindings.filter((item) => item.platform === "ibkr");
    if (!Array.isArray(options)) throw new Error("invalid configuration");
  } catch {
    return { ok: false, reason: "configuration_invalid", counts: emptyCounts() };
  }

  const counts = {
    ...emptyCounts(),
    option_count: options.length,
    binding_count: bindings.length,
  };
  if (options.length === 0 || bindings.length === 0) {
    counts.unmatched_option_count = options.length;
    counts.unmatched_binding_count = bindings.length;
    return { ok: false, reason: "configuration_missing", counts };
  }

  const optionsByKey = new Map();
  for (const option of options) {
    const rows = optionsByKey.get(option.key) || [];
    rows.push(option);
    optionsByKey.set(option.key, rows);
  }
  const bindingsByKey = new Map(bindings.map((binding) => [binding.account_key, binding]));
  const matchedBindings = new Set();
  for (const option of options) {
    const binding = bindingsByKey.get(option.key);
    if (optionsByKey.get(option.key)?.length === 1
        && binding
        && accountFactsOptionMatchesBinding(option, binding)) {
      counts.matched_count += 1;
      // The existing matcher verifies equality for these four explicit fields;
      // key and display-only target_name/label do not establish completeness.
      counts.identity_complete_count += 1;
      matchedBindings.add(binding.account_key);
    } else {
      counts.unmatched_option_count += 1;
      if (binding && PHYSICAL_IDENTITY_FIELDS.some((field) =>
        typeof option?.[field] !== "string" || option[field].length === 0)) {
        counts.identity_incomplete_count += 1;
      }
    }
  }
  counts.unmatched_binding_count = bindings.filter(
    (binding) => !matchedBindings.has(binding.account_key),
  ).length;

  const ok = counts.option_count === counts.binding_count
    && counts.matched_count === counts.option_count
    && counts.unmatched_option_count === 0
    && counts.unmatched_binding_count === 0;
  return {
    ok,
    reason: ok ? "none" : counts.identity_incomplete_count > 0 ? "identity_incomplete" : "option_binding_mismatch",
    counts,
  };
}

function main(argv) {
  if (argv.length !== 2) {
    process.stdout.write("status=blocked reason=configuration_invalid option_count=0 binding_count=0 matched_count=0 unmatched_option_count=0 unmatched_binding_count=0 identity_complete_count=0 identity_incomplete_count=0\n");
    return 1;
  }

  let summary;
  try {
    const options = JSON.parse(readFileSync(argv[0], "utf8"));
    const bindings = JSON.parse(readFileSync(argv[1], "utf8"));
    summary = inspectIbkrAccountFactsConfiguration(options, bindings);
  } catch {
    summary = { ok: false, reason: "configuration_unavailable", counts: emptyCounts() };
  }
  const { counts } = summary;
  process.stdout.write(
    `status=${summary.ok ? "ok" : "blocked"} reason=${summary.reason}`
      + ` option_count=${counts.option_count} binding_count=${counts.binding_count}`
      + ` matched_count=${counts.matched_count} unmatched_option_count=${counts.unmatched_option_count}`
      + ` unmatched_binding_count=${counts.unmatched_binding_count}`
      + ` identity_complete_count=${counts.identity_complete_count}`
      + ` identity_incomplete_count=${counts.identity_incomplete_count}\n`,
  );
  return summary.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}

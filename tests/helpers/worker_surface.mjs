import { readFile } from "node:fs/promises";

const ROOT = new URL("../../web/strategy-switch-console/", import.meta.url);

/**
 * Load the Worker + runtime_support (+ optional DO) surface used by contract scans.
 * Prefer symbol/route coverage over exact relative import strings.
 *
 * @param {{
 *   includeDurableObject?: boolean,
 *   applicationModules?: string[],
 * }} [options]
 * `applicationModules` are paths under strategy-switch-console/ (e.g.
 * `application/account_diagnosis/http.js`) appended into wiredSource so
 * Strangler extracts remain visible to contract scans.
 */
export async function loadWorkerSurface({
  includeDurableObject = false,
  applicationModules = [],
} = {}) {
  const workerSource = await readFile(new URL("worker.js", ROOT), "utf8");
  const supportSource = await readFile(new URL("application/worker/runtime_support.js", ROOT), "utf8");
  const durableSource = includeDurableObject
    ? await readFile(new URL("application/runtime_instances/durable_object.js", ROOT), "utf8")
    : "";
  const moduleSources = [];
  for (const rel of applicationModules) {
    moduleSources.push(await readFile(new URL(rel, ROOT), "utf8"));
  }
  return {
    workerSource,
    supportSource,
    durableSource,
    moduleSources,
    wiredSource: `${workerSource}\n${supportSource}\n${durableSource}\n${moduleSources.join("\n")}`,
  };
}

/** True if worker or runtime_support imports a module whose path ends with `modulePathSuffix`. */
export function surfaceImportsModule(surface, modulePathSuffix) {
  const needle = modulePathSuffix.replace(/\\/g, "/");
  const patterns = [
    new RegExp(`from\\s+["'][^"']*${escapeRegExp(needle)}["']`),
    new RegExp(`import\\s+\\([^)]*["'][^"']*${escapeRegExp(needle)}["']`),
  ];
  return patterns.some((re) => re.test(surface.workerSource) || re.test(surface.supportSource));
}

export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

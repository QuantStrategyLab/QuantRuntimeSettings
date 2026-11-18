import { directoryList as defaultDirectoryList } from "../../kv_directory.js";
import { json } from "../http_response.js";
import {
  RUNTIME_DAILY_HISTORY_MAX_PAGES,
  RUNTIME_DAILY_HISTORY_PAGE,
  RUNTIME_DAILY_KEY_PREFIX,
} from "./constants.js";
import { runtimeDailyCalendarDate } from "./helpers.js";

export function runtimeDailyDisabledResponse() {
  return json({ ok: false, error: "runtime_daily_disabled" }, 404);
}

export function runtimeDailyUnattributedResponse() {
  return json({ ok: false, error: "runtime_daily_account_unattributed" }, 409);
}

export async function runtimeDailyHistory(env, target, deps = {}) {
  const listDirectory = deps.directoryList || defaultDirectoryList;
  const prefix = `${RUNTIME_DAILY_KEY_PREFIX}${target.target_key}:`;
  try {
    const listing = await listDirectory(env, prefix, RUNTIME_DAILY_HISTORY_PAGE * RUNTIME_DAILY_HISTORY_MAX_PAGES);
    const dates = listing.keys.map((entry) => runtimeDailyCalendarDate(entry.name.slice(prefix.length))).filter(Boolean).sort();
    return {
      available_from: dates[0] || null,
      available_through: dates.at(-1) || null,
      stored_days: dates.length,
      truncated: false,
    };
  } catch {
    return null;
  }
}

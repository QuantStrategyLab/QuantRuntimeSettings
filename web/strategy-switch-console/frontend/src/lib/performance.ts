import type { AssetsResponse } from "../api/contracts";
import { renderableStatus } from "./status.ts";

/** Use the latest balance observation; never substitute interval P&L or an older valid point. */
export function latestAssetBalance(data: AssetsResponse): number | null {
  if (!renderableStatus(data.status) || data.unavailable_reason === "mixed_currency" || !data.currency) return null;
  const latest = data.points.reduce<AssetsResponse["points"][number] | null>(
    (last, point) => !last || point.date >= last.date ? point : last, null,
  );
  return latest && Number.isFinite(latest.value) ? latest.value : null;
}

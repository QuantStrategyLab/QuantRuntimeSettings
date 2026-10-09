// Presentation-only: maps an existing status label to a visual tone so the UI can pair colour with a shape marker.
export type StatusTone = "ok" | "warn" | "block" | "neutral";

const OK = new Set(["健康", "监测正常", "已启用", "无交易", "已成交", "券商已确认"]);
const WARN = new Set(["已停用", "尚未到检查时间", "暂未取得状态", "待确认", "结果待确认", "部分成交", "—"]);
const BLOCK = new Set(["异常", "已阻断"]);

export function statusTone(label: string | null | undefined): StatusTone {
  if (!label) return "neutral";
  if (OK.has(label)) return "ok";
  if (BLOCK.has(label)) return "block";
  if (WARN.has(label)) return "warn";
  return "neutral";
}

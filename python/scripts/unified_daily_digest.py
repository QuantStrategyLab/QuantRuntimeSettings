"""Compact bilingual digest. Pure rendering; never split one digest into sends."""
from __future__ import annotations

import os
from daily_digest_notify import DailyDigestInput


def enabled() -> bool:
    return os.environ.get("QSL_ROUTINE_NOTIFICATION_MODE", "immediate") == "daily_digest"


def _units(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def render(payload: DailyDigestInput, *, max_units: int = 3900) -> str:
    if max_units < 256:
        raise ValueError("digest_budget_too_small")
    trades, problems = [], []
    for row in payload.runs:
        label = " / ".join(" ".join(str(v).split())[:70] for v in
                           (row.platform_id, row.strategy_label or row.strategy_profile))
        known_orders = row.order_count is not None and row.order_count_status == "known"
        known_fills = row.fill_count is not None and row.fill_count_status == "known"
        if (known_orders and row.order_count > 0) or (known_fills and row.fill_count > 0):
            orders = str(row.order_count) if known_orders else "?"
            completion = row.execution_status in {"executed", "completed"}
            fill_text = f"成交 Fills {row.fill_count}" if known_fills else ("已完成 / Completed" if completion else "成交数量未知 / Fill count unknown")
            trades.append(f"• {label}：订单 Orders {orders} · {fill_text}")
        complete_orders = known_orders and row.order_count > 0 and row.execution_status in {"executed", "completed"}
        if row.status == "alert" or not known_orders or (not known_fills and not complete_orders):
            # Do not expose producer prose, raw exceptions or private identities.
            reason = "执行异常 / Execution issue" if row.status == "alert" and known_orders and known_fills else "执行证据不完整 / Incomplete execution evidence"
            problems.append(f"• {label}：{reason}")
    coverage = payload.evidence_coverage
    if coverage:
        for count, text in (
            (len(coverage.github_failures) + len(coverage.candidate_failures), "来源读取失败 / Source read failure"),
            (len(coverage.stale_candidates), "候选过期 / Stale candidates"),
            (len(coverage.missing_targets), "缺少目标报告 / Target report missing"),
        ):
            if count:
                problems.append(f"• {text} ({count})")
        if not payload.runs and not coverage.is_complete_for_verified_idle and not problems:
            problems.append("• 缺少执行证据 / Execution evidence unavailable")
    elif not payload.runs:
        problems.append("• 缺少执行证据 / Execution evidence unavailable")
    if not trades and not problems:
        return ""
    header = f"每日交易摘要 / Daily trading digest · {payload.business_day}"
    rows = (["需关注 / Diagnostics"] + problems if problems else []) + (["交易 / Trading"] + trades if trades else [])
    lines = [header]
    for i, row in enumerate(rows):
        suffix = f"\n其余 {len(rows) - i} 项已省略 / {len(rows) - i} more items omitted"
        if _units("\n".join(lines + [row]) + suffix) > max_units:
            lines.append(suffix.strip())
            break
        lines.append(row)
    return "\n".join(lines)

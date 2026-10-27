"""Compact bilingual digest. Pure rendering; never split one digest into sends."""
from __future__ import annotations

import re
from notification_mode import consolidation_enabled, routine_mode
from display_names import display_name
from daily_digest_notify import DailyDigestInput, _trade_counts, block_reason_text, counts_not_connected, is_blocked, normalize_locale, routine_decision_text


def enabled() -> bool:
    return routine_mode() == "daily_digest"


def _units(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def render(payload: DailyDigestInput, *, max_units: int = 3900) -> str:
    if max_units < 256:
        raise ValueError("digest_budget_too_small")
    if consolidation_enabled():
        return _render_consolidated(payload, max_units=max_units)
    trades, problems = [], []
    for row in payload.runs:
        label = " / ".join(" ".join(str(v).split())[:70] for v in
                           (display_name("platforms", row.platform_id), display_name("accounts", row.account_hint or row.account_scope or row.execution_mode, platform=row.platform_id), display_name("strategies", row.strategy_profile, "zh", fallback=row.strategy_label or row.strategy_profile) + " / " + display_name("strategies", row.strategy_profile, "en", fallback=row.strategy_label or row.strategy_profile)))
        known_orders = row.order_count is not None and row.order_count_status == "known"
        known_fills = row.fill_count is not None and row.fill_count_status == "known"
        if (known_orders and row.order_count > 0) or (known_fills and row.fill_count > 0):
            orders = str(row.order_count) if known_orders else ("未接入统计 / not connected" if counts_not_connected(row) else "?")
            completion = row.execution_status in {"executed", "completed"}
            fill_text = f"成交 Fills {row.fill_count}" if known_fills else (
                "成交未接入统计 / Fill counting not connected" if counts_not_connected(row) else
                "已完成 / Completed" if completion else "成交数量未知 / Fill count unknown"
            )
            trades.append(f"• {label}：订单 Orders {orders} · {fill_text}")
        complete_orders = known_orders and row.order_count > 0 and row.execution_status in {"executed", "completed"}
        if row.status == "alert" or is_blocked(row) or not known_orders or (not known_fills and not complete_orders):
            # Do not expose producer prose, raw exceptions or private identities.
            reason = "执行异常 / Execution issue" if row.status == "alert" and known_orders and known_fills else "执行证据不完整 / Incomplete execution evidence"
            if is_blocked(row):
                reason = "已拦截 / Blocked"
                detail = block_reason_text(row)
                if detail:
                    reason += f" · {detail}"
            if counts_not_connected(row):
                counts = f"{_trade_counts(row, 'zh')} / {_trade_counts(row, 'en')}"
                reason = f"{reason} · {counts}" if is_blocked(row) else counts
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


def _safe_display_text(value: object) -> str:
    """Only display labels; never fall back to broker, storage or binding IDs."""
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    if (not text.isprintable() or "://" in text
            or re.search(r"[Dd]?[Uu][0-9]{5,}", text)
            or text.isdecimal()
            or re.fullmatch(r"[0-9a-fA-F-]{12,}", text)):
        return ""
    return text[:70]


def _run_display_labels(rows, locale):
    """Resolve names with existing mappings; ordinals distinguish collisions."""
    missing = "\0"
    parts, accounts = [], {}
    for index, row in enumerate(rows):
        # A canonical display alias must hit this platform's trusted mapping.
        # Neither the alias nor its identity/binding keys are display fallbacks.
        account = _safe_display_text(display_name("accounts", row.account_alias, locale,
                    fallback=missing, platform=row.platform_id)) if row.account_alias else ""
        for key in dict.fromkeys((row.account_hint, row.account_scope, row.execution_mode)):
            if account:
                break
            if not key:
                continue
            fallback = display_name("account_aliases", key, locale, fallback=missing)
            candidate = display_name("accounts", key, locale, fallback=fallback, platform=row.platform_id)
            account = _safe_display_text(candidate)
            if account:
                break
        account = account or ("账户" if locale == "zh" else "Account")
        # These protected keys stay internal; display ordinals never replace them.
        identity = row.opaque_account_uid or row.target_id or row.account_hint or ("row", index)
        group = (row.platform_id, account)
        identities = accounts.setdefault(group, [])
        if identity not in identities:
            identities.append(identity)
        platform = _safe_display_text(display_name("platforms", row.platform_id, locale,
            fallback="未知平台" if locale == "zh" else "Unknown platform"))
        fallback = "未命名策略" if locale == "zh" else "Unnamed strategy"
        strategy = _safe_display_text(display_name("strategies", row.strategy_profile, locale, fallback=fallback)) or fallback
        parts.append((platform or ("未知平台" if locale == "zh" else "Unknown platform"), account, strategy, group, identity))
    # Reserve configured names first so a generated ordinal cannot hide one.
    reserved, resolved = {}, {}
    for platform, account in accounts:
        reserved.setdefault(platform, set()).add(account)
    for group, identities in accounts.items():
        platform, account = group
        ordinal = 1
        for identity in identities:
            candidate = account
            if len(identities) > 1:
                while f"{account} {ordinal}" in reserved[platform]:
                    ordinal += 1
                candidate = f"{account} {ordinal}"
                reserved[platform].add(candidate)
                ordinal += 1
            resolved[group, identity] = candidate
    return [" / ".join((platform, resolved[group, identity], strategy))
            for platform, account, strategy, group, identity in parts]


def _known_count(row, name):
    value = getattr(row, name + "_count")
    return type(value) is int and value >= 0 and getattr(row, name + "_count_status") == "known"


def _render_consolidated(payload: DailyDigestInput, *, max_units: int) -> str:
    """One selected language and one message, including healthy zero-order runs."""
    if not payload.runs:
        return ""
    locale = normalize_locale(payload.locale)
    zh = locale == "zh"
    summary = payload.notification_summary or {}
    coverage = payload.evidence_coverage
    complete = bool(coverage and coverage.is_complete_for_verified_idle and not summary.get("counts_scope_unknown", summary.get("counts_unknown")))
    lines = [f"每日交易摘要 · {payload.business_day}" if zh else f"Daily trading digest · {payload.business_day}"]
    lines.append(("窗口内运行次数未知" if zh else "Run count in window unknown") if summary.get("run_count_unknown") else
                 f"已收录运行 {len(payload.runs)} 次" if zh else f"Observed runs in window: {len(payload.runs)}")
    counts = []
    for name, label in (("order", "订单" if zh else "Orders"), ("fill", "成交" if zh else "Fills")):
        values = [getattr(row, name + "_count") for row in payload.runs]
        known = complete and all(_known_count(row, name) for row in payload.runs)
        value = str(sum(values)) if known else ("全窗口统计未知" if zh else "whole-window count unknown")
        counts.append(f"{label}：{value}" if zh else f"{label}: {value}")
    lines.append(" · ".join(counts))
    if complete and all(_known_count(row, "order") and row.order_count == 0 for row in payload.runs):
        lines.append(("本轮 0 单" if len(payload.runs) == 1 else "窗口内各轮均为 0 单") if zh else
                     ("0 orders this run" if len(payload.runs) == 1 else "0 orders in every observed run"))
    for platform, source in summary.get("source_inventory", {}).items():
        label = display_name("platforms", platform, "zh" if zh else "en")
        expected, covered, runs = source["expected_targets"], source["covered_targets"], source["runs"]
        runs = runs if runs is not None else ("未知" if zh else "unknown")
        state = f"{covered}/{expected}" if expected else ("未配置" if zh else "not configured")
        lines.append(f"{label}：运行 {runs} 次，覆盖 {state}" if zh else f"{label}: {runs} runs, coverage {state}")
    immediate = summary.get("immediate_events", 0)
    if immediate:
        lines.append(f"即时事件 {immediate} 项（仅记录）" if zh else f"Immediate events: {immediate} (record only)")
    attention_lines, healthy_lines, routine_lines, seen = [], [], [], set()
    for row, label in zip(payload.runs, _run_display_labels(payload.runs, locale)):
        decision = routine_decision_text(row, locale)
        if decision:
            routine_lines.extend(f"• {label}：{line}" if zh else f"• {label}: {line}"
                                 for line in decision.splitlines())
        if not is_blocked(row):
            detail = ("需核对" if zh else "Needs review") if row.status == "alert" else ("已运行" if zh else "Observed run")
            if counts_not_connected(row):
                detail += "，统计未接入" if zh else "; counting not connected"
            elif not all(_known_count(row, name) for name in ("order", "fill")):
                detail += "，统计未知" if zh else "; counts unknown"
            else:
                detail += (f"，本轮 {row.order_count} 单，成交 {row.fill_count}" if zh else
                           f"; this run: {row.order_count} orders, {row.fill_count} fills")
            line = f"• {label}：{detail}" if zh else f"• {label}: {detail}"
            if line not in seen:
                (attention_lines if row.status == "alert" else healthy_lines).append(line)
                seen.add(line)
            continue
        from notification_approved_gates import render_reasons
        detail = render_reasons(row.approved_gate_reasons, locale) or block_reason_text(row, locale)
        detail = detail or ("已拦截，具体原因未知" if zh else "Blocked; specific reason unknown")
        lines.append(f"• {label}：{detail}" if zh else f"• {label}: {detail}")
    # Risk and attention details precede repeated healthy context under the budget.
    lines.extend(attention_lines)
    lines.extend(healthy_lines)
    lines.extend(routine_lines)
    if not complete:
        lines.append("覆盖不完整，缺失统计保留未知" if zh else "Coverage incomplete; missing counts remain unknown")
    result = [lines[0]]
    for index, line in enumerate(lines[1:], 1):
        remaining = len(lines) - index
        suffix = f"其余 {remaining} 项已省略" if zh else f"{remaining} more items omitted"
        if _units("\n".join(result + [line, suffix])) > max_units:
            result.append(suffix)
            break
        result.append(line)
    return "\n".join(result)

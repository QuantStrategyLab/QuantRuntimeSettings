"""Compact bilingual digest. Pure rendering; never split one digest into sends."""
from __future__ import annotations

import math
import re
from datetime import date, datetime, time, timedelta
from notification_mode import consolidation_enabled, routine_mode
from notification_snapshot.unified_contract import SGT, sgt_business_window
from display_names import broker_account_identity, display_name, runtime_account_names, safe_display_text as _safe_display_text
from daily_digest_notify import DailyDigestInput, _presentation_needs_attention, _trade_counts, block_reason_text, counts_not_connected, is_blocked, normalize_locale, routine_decision_text, routine_observation_text


def enabled() -> bool:
    return routine_mode() == "daily_digest"


def _units(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def _window_text(business_day: str, locale: str) -> str:
    window = sgt_business_window(datetime.combine(date.fromisoformat(business_day), time(6), SGT))
    interval = f"{window.start:%Y-%m-%d %H:%M} – {window.end:%Y-%m-%d %H:%M} (UTC+8)"
    if locale == "bilingual":
        return f"统计区间 / Reporting window: {interval}"
    return f"统计区间：{interval}" if locale == "zh" else f"Reporting window: {interval}"


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
            fill_text = f"成交 Fills {row.fill_count}" if known_fills else (
                "成交未接入统计 / Fill counting not connected" if counts_not_connected(row) else
                "成交数量未知 / Fill count unknown"
            )
            confirmation = " · 最终状态待确认 / Final state unconfirmed" if _execution_unconfirmed(row) else ""
            trades.append(f"• {label}：订单 Orders {orders} · {fill_text}{confirmation}")
        if row.status == "alert" or _execution_blocked(row) or _execution_unconfirmed(row) or not known_orders or not known_fills:
            # Do not expose producer prose, raw exceptions or private identities.
            reason = "执行异常 / Execution issue" if row.status == "alert" and known_orders and known_fills else "执行证据不完整 / Incomplete execution evidence"
            if _execution_blocked(row):
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
    lines = [header, _window_text(payload.business_day, "bilingual")]
    for i, row in enumerate(rows):
        suffix = f"\n其余 {len(rows) - i} 项已省略 / {len(rows) - i} more items omitted"
        if _units("\n".join(lines + [row]) + suffix) > max_units:
            lines.append(suffix.strip())
            break
        lines.append(row)
    return "\n".join(lines)


def _run_display_contexts(rows, locale, *, runtime_accounts=False):
    """Resolve names with existing mappings; ordinals distinguish collisions."""
    parts, accounts = [], {}
    for index, row in enumerate(rows):
        account = _account_identity_label(row, locale) if runtime_accounts else _legacy_account_label(row, locale)
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
    return [(platform, resolved[group, identity], strategy)
            for platform, account, strategy, group, identity in parts]


def _account_identity_label(row, locale):
    label = row.account_label
    if isinstance(label, str) and len(label) <= 70 and label.isprintable():
        safe = _safe_display_text(label)
        if safe:
            return safe
    # Opaque keys are lookup keys only, never labels. Only the runtime override
    # may translate one to a full broker identity; generated lane aliases cannot.
    keys = (row.opaque_account_uid, row.target_id, row.account_alias,
            row.account_hint, row.account_scope, row.execution_mode)
    for value in runtime_account_names(keys, platform=row.platform_id, locale=locale):
        account = broker_account_identity(row.platform_id, value)
        if account:
            return account
    # A producer hint is not authorization to display the full identity.
    # Keep at most two trailing characters when no private mapping resolves it.
    if row.platform_id in {"ibkr", "schwab", "firstrade"}:
        account = broker_account_identity(row.platform_id, row.account_hint)
        if account:
            return "***" + account[-2:]
    return ""


def _run_display_labels(rows, locale):
    return [" / ".join(context) for context in _run_display_contexts(rows, locale)]


def _legacy_account_label(row, locale):
    """Retain the existing masked-label contract for non-digest notifications."""
    missing = "\0"
    account = _safe_display_text(display_name("accounts", row.account_alias, locale,
        fallback=missing, platform=row.platform_id)) if row.account_alias else ""
    for key in dict.fromkeys((row.account_hint, row.account_scope, row.execution_mode)):
        if account:
            break
        if key:
            fallback = display_name("account_aliases", key, locale, fallback=missing)
            account = _safe_display_text(display_name("accounts", key, locale,
                fallback=fallback, platform=row.platform_id))
    return account


def _known_count(row, name):
    value = getattr(row, name + "_count")
    return type(value) is int and value >= 0 and getattr(row, name + "_count_status") == "known"


def _has_activity(row):
    return any(_known_count(row, name) and getattr(row, name + "_count") > 0 for name in ("order", "fill"))


def _verified_no_trade(row):
    return (row.status == "ok" and not _execution_blocked(row) and not _execution_unconfirmed(row)
            and not _presentation_needs_attention(row)
            and all(_known_count(row, name) and getattr(row, name + "_count") == 0 for name in ("order", "fill")))


def _execution_unconfirmed(row):
    # A run-level block does not establish finality of submitted orders.
    status = row.execution_status.strip().lower()
    return status not in {
        "", "executed", "completed", "no_action", "no_op", "no_signal", "no_rebalance", "ok_no_order",
        "blocked", "strategy_risk_rejected",
    } and not status.endswith("_blocked")


def _execution_blocked(row):
    status = row.execution_status.strip().lower()
    return is_blocked(row) or status in {"blocked", "strategy_risk_rejected"} or status.endswith("_blocked")


def _finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _evidence_attention_text(row, locale):
    """Describe evidence axes without changing execution facts or delivery routing."""
    zh = locale == "zh"
    parts = []
    persistence = row.evidence_persistence_status
    if persistence not in {"", "persisted"}:
        labels = {
            "persistence_failed": ("证据留存失败", "Evidence persistence failed"),
            "unknown": ("证据留存状态未知", "Evidence persistence status unknown"),
        }
        parts.append(labels.get(persistence, ("证据留存状态需核对", "Evidence persistence needs review"))[0 if zh else 1])
    delivery = row.evidence_delivery_status
    if delivery not in {"", "delivered_to_central", "delivered_idle"}:
        labels = {
            "delivery_failed": ("证据传递失败", "Evidence delivery failed"),
            "pending_central": ("证据待中央汇总", "Evidence pending central aggregation"),
            "unknown": ("证据传递状态未知", "Evidence delivery status unknown"),
        }
        parts.append(labels.get(delivery, ("证据传递状态需核对", "Evidence delivery needs review"))[0 if zh else 1])
    return ("，" if zh else "; ").join(parts)


def _account_holdings(row, locale):
    from daily_digest_notify import _format_money, _format_qty, _holdings_header
    holdings = sorted(row.holdings, key=lambda item: item.market_value if _finite_number(item.market_value) else -1, reverse=True)
    rendered = []
    for holding in holdings[:5]:
        # Numeric exchange tickers are symbols, not account-label fallbacks.
        symbol = holding.symbol if re.fullmatch(r"\d{5,6}", holding.symbol) else _safe_display_text(holding.symbol)
        if not symbol:
            continue
        parts = [symbol]
        if _finite_number(holding.quantity):
            parts.append(_format_qty(holding.quantity, locale=locale) + ("股" if locale == "zh" else " shares"))
        if _finite_number(holding.market_value) and re.fullmatch(r"[A-Z]{3,5}", holding.currency):
            parts.append(_format_money(holding.market_value, currency=holding.currency, locale=locale))
        rendered.append(" ".join(parts))
    if not rendered:
        return []
    header = _holdings_header(row.holdings_scope, locale)
    count = (f"（共{len(holdings)}项）" if locale == "zh" else f" ({len(holdings)} total)") if len(holdings) > 5 else ""
    return [header + count] + [" · ".join(rendered[index:index + 2]) for index in range(0, len(rendered), 2)]


def _account_observations(rows, locale):
    """Keep distinct producer snapshots without inferring their chronology."""
    snapshots, seen = [], []
    for row in rows:
        key = (row.equity, row.equity_currency, row.holdings, row.holdings_scope)
        if (row.equity is not None or row.holdings) and key not in seen:
            snapshots.append(row)
            seen.append(key)
    lines = []
    for index, row in enumerate(snapshots, 1):
        observation = []
        if _finite_number(row.equity) and re.fullmatch(r"[A-Z]{3,5}", row.equity_currency):
            observation.append("💰 " + ("总资产 " if locale == "zh" else "Total assets ") + f"{row.equity_currency} {row.equity:,.2f}")
        observation.extend(_account_holdings(row, locale))
        if observation and len(snapshots) > 1:
            observation.insert(0, f"运行快照 {index}" if locale == "zh" else f"Run snapshot {index}")
        lines.extend(observation)
    return lines


def _render_consolidated(payload: DailyDigestInput, *, max_units: int) -> str:
    """One fixed report for idle, active, partial and unavailable windows."""
    locale = normalize_locale(payload.locale)
    zh = locale == "zh"
    summary = payload.notification_summary or {}
    coverage = payload.evidence_coverage
    complete = bool(coverage and coverage.is_complete_for_verified_idle and not summary.get("counts_scope_unknown", summary.get("counts_unknown")))
    report_date = date.fromisoformat(payload.business_day) + timedelta(days=1)
    lines = [f"【资产管理日报｜{report_date}】" if zh else f"[Asset management daily report | {report_date}]"]
    lines.append(_window_text(payload.business_day, locale))
    fully_known = complete and not summary.get("counts_unknown") and all(
        _known_count(row, name) for row in payload.runs for name in ("order", "fill", "cycle"))
    coverage_state = ("完整" if fully_known else "部分" if payload.runs else "无法核实") if zh else (
        "complete" if fully_known else "partial" if payload.runs else "unverified")
    lines.append((f"完整性：{coverage_state}" if zh else f"Completeness: {coverage_state}") + " · " + (
        ("运行次数：不适用" if zh else "Runs: not applicable") if summary.get("counts_not_applicable") else
        ("窗口内运行次数未知" if zh else "Run count in window unknown") if summary.get("run_count_unknown") or not coverage else
        f"已收录运行 {len(payload.runs)} 次" if zh else f"Observed runs in window: {len(payload.runs)}"))
    counts = []
    for name, label in (("order", "订单" if zh else "Orders"), ("fill", "成交" if zh else "Fills")):
        values = [getattr(row, name + "_count") for row in payload.runs]
        known = complete and all(_known_count(row, name) for row in payload.runs)
        value = ("不适用" if zh else "not applicable") if summary.get("counts_not_applicable") else (
            str(sum(values)) if known else ("全窗口统计未知" if zh else "whole-window count unknown"))
        counts.append(f"{label}：{value}" if zh else f"{label}: {value}")
    confirmation = (" · 最终状态待确认" if zh else " · final state unconfirmed") if any(
        _execution_unconfirmed(row) for row in payload.runs) else ""
    lines.append(" · ".join(counts) + confirmation)
    inventory = []
    for platform, source in summary.get("source_inventory", {}).items():
        fallback = ("管理站" if zh else "Management console") if platform == "qrs" else ""
        label = display_name("platforms", platform, locale, fallback=fallback)
        if source.get("state") == "disabled":
            inventory.append(f"{label}：已停用；运行、订单和成交：不适用" if zh else
                             f"{label}: disabled; runs, orders and fills: not applicable")
            continue
        expected, covered, runs = source["expected_targets"], source["covered_targets"], source["runs"]
        if not expected:
            inventory.append(f"{label}：未纳入本期汇总，运行状态未知" if zh else
                         f"{label}: not included in this digest; run state unknown")
            continue
        # Inventory counts describe included evidence, not every actual run.
        observed = (("已收录运行次数未知" if zh else "Included run count unknown") if runs is None else
                    f"已收录 {runs} 次运行" if zh else f"Included runs: {runs}")
        state = f"{covered}/{expected}"
        if source.get("disabled_targets"):
            observed += (f"；另有 {source['disabled_targets']} 个停用目标" if zh else
                         f"; disabled targets: {source['disabled_targets']}")
        inventory.append(f"{label}：{observed}，目标覆盖 {state}" if zh else
                     f"{label}: {observed}; expected target coverage {state}")
    immediate = summary.get("immediate_events", 0)
    if immediate:
        lines.append(f"紧急事项 {immediate} 项（日报留档）" if zh else f"Urgent items: {immediate} (daily record)")
    accounts = {}
    for index, (row, (platform, account, strategy)) in enumerate(zip(payload.runs, _run_display_contexts(payload.runs, locale, runtime_accounts=True))):
        header = f"{platform}·{account}"
        identity = row.opaque_account_uid or row.target_id or row.account_hint or ("row", index)
        accounts.setdefault((row.platform_id, identity), []).append((row, header, strategy))
    blocks, diagnostics, diagnostic_observations, observations = [], [], [], []
    for entries in accounts.values():
        rows = [row for row, _, _ in entries]
        header = entries[0][1]
        needs_attention = any(row.status == "alert" or _execution_blocked(row) or _execution_unconfirmed(row) or _presentation_needs_attention(row)
                              or not all(_known_count(row, name) for name in ("order", "fill")) for row in rows)
        block = ["🏦 " + header]
        missing_strategy = "未命名策略" if zh else "Unnamed strategy"
        strategies = list(dict.fromkeys(strategy for _, _, strategy in entries if strategy != missing_strategy))
        values = {}
        for name in ("order", "fill"):
            values[name] = (str(sum(getattr(row, name + "_count") for row in rows))
                            if all(_known_count(row, name) for row in rows) else "未知" if zh else "unknown")
        confirmation = (" · 最终状态待确认" if zh else " · final state unconfirmed") if any(
            _execution_unconfirmed(row) for row in rows) else ""
        details, pending = [], []
        for row in rows:
            if _execution_unconfirmed(row):
                if row.execution_status == "order_submitted":
                    pending.append("订单已提交，成交待确认；最终状态待确认" if zh else
                                   "Orders submitted; fill confirmation pending; final state unconfirmed")
                else:
                    pending.append("订单最终状态待确认" if zh else "Final order state unconfirmed")
            if row.status == "alert":
                details.append("执行异常，需核对" if zh else "Execution issue; needs review")
            if _execution_blocked(row):
                from notification_approved_gates import render_reasons
                detail = render_reasons(row.approved_gate_reasons, locale) or block_reason_text(row, locale)
                details.append(detail or ("已拦截，具体原因未知" if zh else "Blocked; specific reason unknown"))
            evidence = _evidence_attention_text(row, locale)
            if evidence:
                details.append(evidence)
            if counts_not_connected(row):
                details.append("统计未接入" if zh else "Counting not connected")
        # Reserve failure diagnostics before repeated counts, strategy context
        # and pending-order prose. Separate lines retain each fitting diagnostic.
        block.extend(dict.fromkeys(details))
        if strategies:
            block.append("🎯 " + ("策略：" if zh else "Strategy: ") + " / ".join(strategies))
        block.append("📝 " + (f"提交{values['order']}笔/成交{values['fill']}笔" if zh else
                     f"Submitted {values['order']}/Filled {values['fill']}") + confirmation)
        if needs_attention:
            block.append("需核对" if zh else "Needs review")
        block.extend(dict.fromkeys(pending))
        details.extend(pending)
        optional = list(dict.fromkeys(text for row in rows for text in
                        (routine_decision_text(row, locale), routine_observation_text(row, locale)) if text))
        if all(_verified_no_trade(row) for row in rows):
            block.append("已核实无交易" if zh else "Verified no trades")
        if any(_has_activity(row) for row in rows) or all(_verified_no_trade(row) for row in rows):
            if any(row.equity is not None or row.holdings for row in rows):
                observations.extend(["观察 / " + header if zh else "Observation / " + header] + _account_observations(rows, locale))
            blocks.append((needs_attention, block, optional))
        else:
            diagnostic_observations.extend(optional)
        if needs_attention:
            diagnostics.extend(details or ["执行证据不完整" if zh else "Incomplete execution evidence"])
    # Sections are invariant; evidence gaps are reserved before optional observations.
    attention = list(dict.fromkeys(diagnostics))
    lines.extend(["", "需关注" if zh else "Attention"] + (attention or ["无" if zh else "None"]))
    lines.extend(["", "运行与交易" if zh else "Runs and trades"])
    blocks.sort(key=lambda item: not item[0])
    required = inventory + [line for _, block, _ in blocks for line in block]
    optional = diagnostic_observations + [line for _, _, extra in blocks for line in extra]
    coverage_gaps = []
    if coverage:
        for count, label in (
            (len(coverage.github_failures) + len(coverage.candidate_failures), "来源读取失败" if zh else "Source read failure"),
            (len(coverage.stale_candidates), "候选过期" if zh else "Stale candidates"),
            (len(coverage.missing_targets), "缺少目标报告" if zh else "Target report missing"),
        ):
            if count:
                coverage_gaps.append(f"{label} ({count})")
    if not complete:
        coverage_gaps.append("覆盖不完整，缺失统计保留未知" if zh else "Coverage incomplete; missing counts remain unknown")
    # There is no validated URL/timestamp/cash/reconciliation field in this pin.
    # Never manufacture a run link, current observation or reconciled status.
    gaps = coverage_gaps + ["运行链接不可用" if zh else "Run link unavailable"]
    observations += ["现金、观察时间、对账：未知（未核实）" if zh else "Cash, observation time, reconciliation: unverified"]
    sections = [
        (lines, required),
        (["", "账户观察" if zh else "Account observations"], observations),
        (["", "证据与缺口" if zh else "Evidence and gaps"], gaps),
    ]
    # Keep the fixed skeleton and all gap categories even under a small budget.
    # Excess detail is counted explicitly; never split into multiple messages.
    skeleton = lines + ["账户观察" if zh else "Account observations", "证据与缺口" if zh else "Evidence and gaps"] + gaps
    if _units("\n".join(skeleton)) + 48 > max_units:
        compact = {
            "Orders submitted; fill confirmation pending; final state unconfirmed": "Final state unconfirmed",
            "订单已提交，成交待确认；最终状态待确认": "订单最终状态待确认",
            "Blocked; specific reason unknown": "Blocked; reason unknown",
            "Execution issue; needs review": "Execution issue",
        }
        attention = [compact.get(text, text) for text in attention]
        lines = [lines[0], "统计未知" if zh else "Counts unknown", "需关注" if zh else "Attention"] + attention + [
            "运行与交易" if zh else "Runs and trades"]
        sections[0] = (lines, required)
    result = [line for header, _ in sections for line in header] + gaps
    reserved = _units("\n".join(result)) + 48
    selected = [[], [], []]
    omitted = 0
    # Gaps are never displaced by normal observations or repeated context.
    selected[2] = gaps
    for index, values in ((0, required), (0, optional), (1, observations)):
        for value in values:
            cost = _units(value) + 1
            if reserved + cost <= max_units:
                selected[index].append(value)
                reserved += cost
            else:
                omitted += 1
    result = [line for index, (header, _) in enumerate(sections) for line in header + selected[index]]
    if omitted:
        result.append(f"其余 {omitted} 项已省略" if zh else f"{omitted} more items omitted")
    text = "\n".join(result)
    if _units(text) > max_units:
        raise ValueError("digest_required_evidence_exceeds_budget")
    return text

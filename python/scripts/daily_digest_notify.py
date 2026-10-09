#!/usr/bin/env python3
"""QuantSentinel daily digest message contract (zh/en).

Pure formatter: no Telegram I/O, no secret reads. Aggregators collect
which platforms/strategies actually ran (plus optional observation
fields when producers supply them), then call ``render_daily_digest``
and send via the unified bot secret ``quant-sentinel-telegram-bot-token``.

Observation fields (equity, holdings, signal, rebalance) are rendered
only when present on the evidence row — never invented.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Sequence

DigestLocale = Literal["zh", "en"]
RebalanceKind = Literal[
    "",
    "no_rebalance",
    "rebalance",
    "no_order",
    "pending",
]

_TEXTS: dict[str, dict[str, str]] = {
    "zh": {
        "daily_digest_title": "📡 量化哨兵 · 收盘日报",
        "daily_digest_heartbeat_title": "📡 量化哨兵 · 心跳",
        "date_label": "业务日",
        "window_label": "窗口",
        "ran_section": "【当日已运行】",
        "fills_label": "成交",
        "orders_label": "订单",
        "cycles_label": "周期",
        "no_fill": "无成交",
        "status_ok": "正常",
        "status_alert": "异常",
        "heartbeat_no_run": "今日无平台/策略实际运行。监测链路心跳正常。",
        "heartbeat_no_fill": "今日有运行但无成交。监测链路心跳正常。",
        "footer": "通道：QuantSentinel（统一 bot）· 仅含当日实际运行项",
        "platform_line": "· {platform} / {strategy} · {detail}",
        "block_heartbeat": "💓 【心跳检测】",
        "block_rebalance": "🔔 【调仓指令】",
        "block_no_order": "⚠️ 【未下单】",
        "block_pending": "⏳ 【待确认】",
        "strategy_label": "🧭 策略",
        "equity_label": "💰 账户总权益",
        "holdings_label": "💼 持仓",
        "signal_prefix": "🎯 信号",
        "shares_unit": "股",
        "tip_prefix": "小账户提示",
        "conclusion_no_rebalance": "✅ 无需调仓",
        "conclusion_no_order_prefix": "未下单",
        "platform_tag": "平台",
    },
    "en": {
        "daily_digest_title": "📡 QuantSentinel · Daily digest",
        "daily_digest_heartbeat_title": "📡 QuantSentinel · Heartbeat",
        "date_label": "Business day",
        "window_label": "Window",
        "ran_section": "[Ran today]",
        "fills_label": "fills",
        "orders_label": "orders",
        "cycles_label": "cycles",
        "no_fill": "no fills",
        "status_ok": "ok",
        "status_alert": "alert",
        "heartbeat_no_run": "No platform/strategy actually ran today. Monitoring heartbeat only.",
        "heartbeat_no_fill": "Runs completed with no fills today. Monitoring heartbeat only.",
        "footer": "Channel: QuantSentinel (unified bot) · only entries that actually ran",
        "platform_line": "· {platform} / {strategy} · {detail}",
        "block_heartbeat": "💓 [Heartbeat]",
        "block_rebalance": "🔔 [Rebalance]",
        "block_no_order": "⚠️ [No order]",
        "block_pending": "⏳ [Pending]",
        "strategy_label": "🧭 Strategy",
        "equity_label": "💰 Account equity",
        "holdings_label": "💼 Holdings",
        "signal_prefix": "🎯 Signal",
        "shares_unit": "sh",
        "tip_prefix": "Small-account note",
        "conclusion_no_rebalance": "✅ No rebalance needed",
        "conclusion_no_order_prefix": "No order",
        "platform_tag": "Platform",
    },
}


def normalize_locale(raw: str | None) -> DigestLocale:
    value = (raw or "zh").strip().lower()
    return "en" if value.startswith("en") else "zh"


def _t(locale: DigestLocale, key: str) -> str:
    return _TEXTS[locale][key]


def _optional_float(raw: Any) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"expected numeric value, got {raw!r}") from exc


def _format_qty(qty: float | None) -> str | None:
    if qty is None:
        return None
    if float(qty).is_integer():
        return str(int(qty))
    text = f"{qty:.6f}".rstrip("0").rstrip(".")
    return text or "0"


def _format_money(value: float, *, currency: str = "USD") -> str:
    code = (currency or "USD").strip().upper() or "USD"
    amount = f"{value:,.2f}"
    if code == "USD":
        return f"${amount}"
    return f"{code} {amount}"


def _format_equity(value: float, *, currency: str = "USD") -> str:
    code = (currency or "USD").strip().upper() or "USD"
    amount = f"{value:,.2f}"
    return f"{code} {amount}"


@dataclass(frozen=True)
class DigestHolding:
    """One holding line when a producer supplies position evidence."""

    symbol: str
    market_value: float | None = None
    quantity: float | None = None
    currency: str = "USD"

    def __post_init__(self) -> None:
        if not str(self.symbol).strip():
            raise ValueError("holding.symbol required")
        if self.market_value is not None and self.market_value < 0:
            raise ValueError("holding.market_value must be non-negative")
        if self.quantity is not None and self.quantity < 0:
            raise ValueError("holding.quantity must be non-negative")


@dataclass(frozen=True)
class DigestRunEntry:
    """One platform/strategy that actually ran in the digest window.

    Optional observation fields are schema-ready for producer evidence.
    Render omits any field that is empty/None — never invents numbers.
    """

    platform_id: str
    strategy_profile: str
    fill_count: int = 0
    order_count: int = 0
    cycle_count: int = 0
    status: Literal["ok", "alert"] = "ok"
    note: str = ""
    strategy_label: str = ""
    equity: float | None = None
    equity_currency: str = "USD"
    holdings: tuple[DigestHolding, ...] = ()
    signal_summary: str = ""
    rebalance_kind: RebalanceKind = ""
    rebalance_conclusion: str = ""
    tips: tuple[str, ...] = ()
    account_hint: str = ""

    def __post_init__(self) -> None:
        if not str(self.platform_id).strip():
            raise ValueError("platform_id required")
        if not str(self.strategy_profile).strip():
            raise ValueError("strategy_profile required")
        if min(self.fill_count, self.order_count, self.cycle_count) < 0:
            raise ValueError("counts must be non-negative")
        if self.equity is not None and self.equity < 0:
            raise ValueError("equity must be non-negative")
        kind = str(self.rebalance_kind or "")
        allowed = {"", "no_rebalance", "rebalance", "no_order", "pending"}
        if kind not in allowed:
            raise ValueError(f"rebalance_kind must be one of {sorted(allowed)}")


@dataclass(frozen=True)
class DailyDigestInput:
    business_day: str
    window_label: str = ""
    locale: DigestLocale | str = "zh"
    runs: Sequence[DigestRunEntry] = field(default_factory=tuple)


def total_fills(runs: Sequence[DigestRunEntry]) -> int:
    return sum(entry.fill_count for entry in runs)


def has_observation(entry: DigestRunEntry) -> bool:
    """True when producer evidence includes displayable observation fields."""

    return bool(
        entry.equity is not None
        or entry.holdings
        or entry.signal_summary.strip()
        or entry.rebalance_conclusion.strip()
        or entry.rebalance_kind
        or entry.tips
    )


def observation_score(row: Mapping[str, Any]) -> int:
    """Rank evidence richness for merge (counts + optional observation)."""

    score = (
        int(row.get("fill_count", 0) or 0)
        + int(row.get("order_count", 0) or 0)
        + int(row.get("cycle_count", 0) or 0)
    )
    if row.get("equity") is not None and row.get("equity") != "":
        score += 10
    holdings = row.get("holdings") or row.get("positions") or ()
    if isinstance(holdings, (list, tuple)):
        score += min(len(holdings), 8)
    if str(row.get("signal_summary") or "").strip():
        score += 5
    if str(row.get("rebalance_conclusion") or "").strip() or str(
        row.get("rebalance_kind") or ""
    ).strip():
        score += 5
    if str(row.get("strategy_label") or "").strip():
        score += 1
    return score


def _detail_for(entry: DigestRunEntry, locale: DigestLocale) -> str:
    parts: list[str] = []
    if entry.cycle_count:
        parts.append(f"{_t(locale, 'cycles_label')} {entry.cycle_count}")
    if entry.order_count:
        parts.append(f"{_t(locale, 'orders_label')} {entry.order_count}")
    if entry.fill_count:
        parts.append(f"{_t(locale, 'fills_label')} {entry.fill_count}")
    else:
        parts.append(_t(locale, "no_fill"))
    parts.append(_t(locale, "status_ok" if entry.status == "ok" else "status_alert"))
    if entry.note.strip():
        parts.append(entry.note.strip())
    return " · ".join(parts)


def _block_title(entry: DigestRunEntry, locale: DigestLocale) -> str:
    kind = entry.rebalance_kind or ""
    if kind == "rebalance":
        return _t(locale, "block_rebalance")
    if kind == "no_order":
        return _t(locale, "block_no_order")
    if kind == "pending":
        return _t(locale, "block_pending")
    if kind == "no_rebalance":
        return _t(locale, "block_heartbeat")
    if entry.fill_count > 0 or entry.order_count > 0:
        return _t(locale, "block_rebalance")
    return _t(locale, "block_heartbeat")


def _display_strategy(entry: DigestRunEntry) -> str:
    label = entry.strategy_label.strip()
    return label or entry.strategy_profile


def _holding_line(holding: DigestHolding, locale: DigestLocale) -> str:
    symbol = holding.symbol.strip()
    pieces: list[str] = []
    if holding.market_value is not None:
        pieces.append(
            _format_money(holding.market_value, currency=holding.currency)
        )
    qty = _format_qty(holding.quantity)
    if qty is not None:
        pieces.append(f"{qty}{_t(locale, 'shares_unit')}")
    if pieces:
        return f"- {symbol}: {' / '.join(pieces)}"
    return f"- {symbol}"


def _default_conclusion(entry: DigestRunEntry, locale: DigestLocale) -> str:
    if entry.rebalance_conclusion.strip():
        return entry.rebalance_conclusion.strip()
    kind = entry.rebalance_kind or ""
    if kind == "no_rebalance":
        return _t(locale, "conclusion_no_rebalance")
    return ""


def _render_observation_block(entry: DigestRunEntry, locale: DigestLocale) -> list[str]:
    lines: list[str] = []
    title = _block_title(entry, locale)
    hint = entry.account_hint.strip()
    if hint:
        lines.append(f"[{hint}] {title}")
    else:
        lines.append(title)
    lines.append(f"{_t(locale, 'strategy_label')}: {_display_strategy(entry)}")
    if entry.equity is not None:
        lines.append(
            f"{_t(locale, 'equity_label')}: "
            f"{_format_equity(entry.equity, currency=entry.equity_currency)}"
        )
    if entry.holdings:
        lines.append(_t(locale, "holdings_label"))
        for holding in entry.holdings:
            lines.append(_holding_line(holding, locale))
    if entry.signal_summary.strip():
        lines.append(
            f"- {_t(locale, 'signal_prefix')}: {entry.signal_summary.strip()}"
        )
    for tip in entry.tips:
        tip_text = str(tip).strip()
        if tip_text:
            lines.append(f"- {_t(locale, 'tip_prefix')}: {tip_text}")
    conclusion = _default_conclusion(entry, locale)
    if conclusion:
        lines.append(conclusion)
    lines.append(f"{_t(locale, 'platform_tag')}: {entry.platform_id}")
    return lines


def _render_run_line(entry: DigestRunEntry, locale: DigestLocale) -> list[str]:
    if has_observation(entry):
        return _render_observation_block(entry, locale)
    return [
        _t(locale, "platform_line").format(
            platform=entry.platform_id,
            strategy=_display_strategy(entry),
            detail=_detail_for(entry, locale),
        )
    ]


def render_daily_digest(payload: DailyDigestInput) -> str:
    """Render one Telegram message body (never includes tokens or chat ids)."""

    locale = normalize_locale(str(payload.locale))
    runs = tuple(payload.runs)
    lines: list[str] = []
    rich = any(has_observation(entry) for entry in runs)

    if not runs:
        lines.append(_t(locale, "daily_digest_heartbeat_title"))
        lines.append(f"{_t(locale, 'date_label')}: {payload.business_day}")
        if payload.window_label.strip():
            lines.append(f"{_t(locale, 'window_label')}: {payload.window_label.strip()}")
        lines.append(_t(locale, "heartbeat_no_run"))
        lines.append(_t(locale, "footer"))
        return "\n".join(lines)

    if total_fills(runs) == 0:
        lines.append(_t(locale, "daily_digest_heartbeat_title"))
    else:
        lines.append(_t(locale, "daily_digest_title"))
    lines.append(f"{_t(locale, 'date_label')}: {payload.business_day}")
    if payload.window_label.strip():
        lines.append(f"{_t(locale, 'window_label')}: {payload.window_label.strip()}")
    if total_fills(runs) == 0 and not rich:
        lines.append(_t(locale, "heartbeat_no_fill"))
        lines.append(_t(locale, "ran_section"))
    elif total_fills(runs) > 0 and not rich:
        lines.append(_t(locale, "ran_section"))

    for index, entry in enumerate(runs):
        block = _render_run_line(entry, locale)
        if index > 0 and (has_observation(entry) or has_observation(runs[index - 1])):
            lines.append("")
        lines.extend(block)
    lines.append(_t(locale, "footer"))
    return "\n".join(lines)


def _parse_holdings(raw: Any) -> tuple[DigestHolding, ...]:
    if raw is None or raw == "":
        return ()
    if not isinstance(raw, (list, tuple)):
        raise ValueError("holdings must be a list")
    out: list[DigestHolding] = []
    for item in raw:
        if not isinstance(item, Mapping):
            raise ValueError("each holding must be an object")
        symbol = str(item.get("symbol") or "").strip()
        if not symbol:
            continue
        currency = str(item.get("currency") or item.get("ccy") or "USD").strip() or "USD"
        qty_raw = item.get("quantity", item.get("qty", item.get("shares")))
        value_raw = item.get(
            "market_value", item.get("value", item.get("market_value_usd"))
        )
        out.append(
            DigestHolding(
                symbol=symbol,
                market_value=_optional_float(value_raw),
                quantity=_optional_float(qty_raw),
                currency=currency,
            )
        )
    return tuple(out)


def _parse_tips(raw: Any) -> tuple[str, ...]:
    if raw is None or raw == "":
        return ()
    if isinstance(raw, str):
        text = raw.strip()
        return (text,) if text else ()
    if isinstance(raw, (list, tuple)):
        tips = [str(item).strip() for item in raw if str(item).strip()]
        return tuple(tips)
    raise ValueError("tips must be a string or list")


def _parse_rebalance_kind(raw: Any) -> RebalanceKind:
    value = str(raw or "").strip().lower()
    if not value:
        return ""
    aliases = {
        "no_rebalance": "no_rebalance",
        "none": "no_rebalance",
        "heartbeat": "no_rebalance",
        "rebalance": "rebalance",
        "order": "rebalance",
        "no_order": "no_order",
        "skipped": "no_order",
        "pending": "pending",
        "pending_submit": "pending",
    }
    kind = aliases.get(value, value)
    allowed: set[str] = {"", "no_rebalance", "rebalance", "no_order", "pending"}
    if kind not in allowed:
        raise ValueError(f"unsupported rebalance_kind: {raw!r}")
    return kind  # type: ignore[return-value]


def filter_runs_for_digest(
    candidates: Sequence[Mapping[str, object]],
) -> list[DigestRunEntry]:
    """Keep only rows marked ``actually_ran`` (default True if key absent).

    Upstream decides inclusion: crypto hourly only if a cycle ran; monthly DCA
    only on run days; idle platforms omitted. Optional observation keys are
    copied when present and never fabricated here.
    """

    out: list[DigestRunEntry] = []
    for raw in candidates:
        if not bool(raw.get("actually_ran", True)):
            continue
        holdings_raw = raw.get("holdings", raw.get("positions"))
        out.append(
            DigestRunEntry(
                platform_id=str(raw["platform_id"]),
                strategy_profile=str(raw["strategy_profile"]),
                fill_count=int(raw.get("fill_count", 0) or 0),
                order_count=int(raw.get("order_count", 0) or 0),
                cycle_count=int(raw.get("cycle_count", 0) or 0),
                status="alert" if str(raw.get("status", "ok")) == "alert" else "ok",
                note=str(raw.get("note", "") or ""),
                strategy_label=str(raw.get("strategy_label") or "").strip(),
                equity=_optional_float(raw.get("equity", raw.get("equity_usd"))),
                equity_currency=str(
                    raw.get("equity_currency") or raw.get("currency") or "USD"
                ).strip()
                or "USD",
                holdings=_parse_holdings(holdings_raw),
                signal_summary=str(raw.get("signal_summary") or "").strip(),
                rebalance_kind=_parse_rebalance_kind(raw.get("rebalance_kind")),
                rebalance_conclusion=str(raw.get("rebalance_conclusion") or "").strip(),
                tips=_parse_tips(raw.get("tips") or raw.get("tip")),
                account_hint=str(raw.get("account_hint") or "").strip(),
            )
        )
    return out


__all__ = [
    "DailyDigestInput",
    "DigestHolding",
    "DigestRunEntry",
    "filter_runs_for_digest",
    "has_observation",
    "normalize_locale",
    "observation_score",
    "render_daily_digest",
    "total_fills",
]

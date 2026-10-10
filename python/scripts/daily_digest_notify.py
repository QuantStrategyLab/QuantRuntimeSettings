#!/usr/bin/env python3
"""QuantSentinel daily digest message contract (zh/en).

Pure formatter: no Telegram I/O, no secret reads. Aggregators collect
which platforms/strategies actually ran (plus optional observation
fields when producers supply them), then call ``render_daily_digest``
and send via the unified bot secret ``quant-sentinel-telegram-bot-token``.

Observation fields (equity, holdings, signal, rebalance) are rendered
only when present on the evidence row — never invented.

Count semantics:
  - int 0 with known status / legacy producer row → verified zero（无成交）
  - None / field_status counts_unknown → unknown（未知）, never rendered as 0
"""

from __future__ import annotations

import re

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
EvidenceStatus = Literal[
    "verified_idle",
    "evidence_unknown",
    "has_runs",
]
CountFieldStatus = Literal["known", "unknown", ""]

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
        "counts_unknown": "未知",
        "status_ok": "正常",
        "status_alert": "异常",
        "heartbeat_no_run_verified": "今日已验证无平台/策略实际运行。",
        "heartbeat_evidence_unknown": (
            "今日运行证据未知或读取失败，不能判定为链路正常。"
        ),
        "heartbeat_no_fill_verified": "今日有运行且已验证零成交。",
        "heartbeat_fills_unknown": "今日有运行，成交数未知（证据未覆盖）。",
        # Legacy keys kept for callers/tests that still reference them.
        "heartbeat_no_run": "今日已验证无平台/策略实际运行。",
        "heartbeat_no_fill": "今日有运行且已验证零成交。",
        "footer": "通道：QuantSentinel（统一 bot）· 仅含当日实际运行项",
        "platform_line": "· {platform} / {strategy} · {detail}",
        "block_heartbeat": "💓 【心跳检测】",
        "block_rebalance": "🔔 【调仓指令】",
        "block_no_order": "⚠️ 【未下单】",
        "block_pending": "⏳ 【待确认】",
        "strategy_label": "🧭 策略",
        "equity_label": "💰 账户总权益",
        "holdings_label": "💼 持仓",
        "holdings_scope_strategy_symbols_only": "仅策略标的",
        "holdings_scope_stocks_only": "仅股票",
        "signal_prefix": "🎯 信号",
        "shares_unit": "股",
        "tip_prefix": "小账户提示",
        "conclusion_no_rebalance": "✅ 无需调仓",
        "conclusion_fills": "✅ 成交 {count}",
        "conclusion_no_order_prefix": "未下单",
        "platform_tag": "平台",
        "identity_tag": "身份",
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
        "counts_unknown": "unknown",
        "status_ok": "ok",
        "status_alert": "alert",
        "heartbeat_no_run_verified": (
            "Verified: no platform/strategy actually ran today."
        ),
        "heartbeat_evidence_unknown": (
            "Run evidence is unknown or a source read failed; "
            "monitoring link health is not confirmed."
        ),
        "heartbeat_no_fill_verified": (
            "Runs completed with verified zero fills today."
        ),
        "heartbeat_fills_unknown": (
            "Runs completed but fill counts are unknown (evidence uncovered)."
        ),
        "heartbeat_no_run": (
            "Verified: no platform/strategy actually ran today."
        ),
        "heartbeat_no_fill": "Runs completed with verified zero fills today.",
        "footer": "Channel: QuantSentinel (unified bot) · only entries that actually ran",
        "platform_line": "· {platform} / {strategy} · {detail}",
        "block_heartbeat": "💓 [Heartbeat]",
        "block_rebalance": "🔔 [Rebalance]",
        "block_no_order": "⚠️ [No order]",
        "block_pending": "⏳ [Pending]",
        "strategy_label": "🧭 Strategy",
        "equity_label": "💰 Account equity",
        "holdings_label": "💼 Holdings",
        "holdings_scope_strategy_symbols_only": "strategy symbols only",
        "holdings_scope_stocks_only": "stocks only",
        "signal_prefix": "🎯 Signal",
        "shares_unit": "sh",
        "tip_prefix": "Small-account note",
        "conclusion_no_rebalance": "✅ No rebalance needed",
        "conclusion_fills": "✅ fills {count}",
        "conclusion_no_order_prefix": "No order",
        "platform_tag": "Platform",
        "identity_tag": "Identity",
    },
}

UNKNOWN_ACCOUNT_UID = "unknown"
UNKNOWN_TARGET_ID = "unknown"

# Producer machine tokens (snake_case) → locale UI labels.
# Free-form Chinese/English prose is never rewritten — only exact whole-string tokens.
_SIGNAL_TOKEN_DISPLAY: dict[str, dict[str, str]] = {
    "zh": {
        "no_action": "无需操作",
        "no_signal": "无信号",
        "no_rebalance": "无需调仓",
        "no_submission": "未提交",
        "not_due": "未到执行时点",
        "hold": "持有",
        "order_submitted": "订单已提交",
        "order_acknowledged": "券商已确认",
        "partially_filled": "部分成交",
        "filled": "已成交",
        "previewed": "仅预览",
        "blocked": "已拦截",
        "failed": "失败",
        "unknown": "未知",
        "reconciliation_required": "需对账",
        "risk_blocked": "风控拦截",
    },
    "en": {
        "no_action": "No action",
        "no_signal": "No signal",
        "no_rebalance": "No rebalance",
        "no_submission": "No submission",
        "not_due": "Not due",
        "hold": "Hold",
        "order_submitted": "Order submitted",
        "order_acknowledged": "Broker acknowledged",
        "partially_filled": "Partially filled",
        "filled": "Filled",
        "previewed": "Preview only",
        "blocked": "Blocked",
        "failed": "Failed",
        "unknown": "Unknown",
        "reconciliation_required": "Reconciliation required",
        "risk_blocked": "Risk blocked",
    },
}

# Bare conclusion tokens. Empty string → omit line (block title already covers it).
_CONCLUSION_TOKEN_DISPLAY: dict[str, dict[str, str]] = {
    "zh": {
        "no_order": "",
        "no_rebalance": "✅ 无需调仓",
        "pending": "⏳ 待确认",
        "rebalance": "🔔 调仓",
        "filled": "✅ 已成交",
        "partially_filled": "✅ 部分成交",
        "submitted": "已提交",
        "broker_acknowledged": "券商已确认",
        "previewed": "仅预览",
        "blocked": "已拦截",
        "failed": "失败",
        "unknown": "未知",
        "reconciliation_required": "需对账",
        "not_due": "未到执行时点",
        "no_action": "无需操作",
        "no_signal": "无信号",
        "no_submission": "未提交",
    },
    "en": {
        "no_order": "",
        "no_rebalance": "✅ No rebalance needed",
        "pending": "⏳ Pending",
        "rebalance": "🔔 Rebalance",
        "filled": "✅ Filled",
        "partially_filled": "✅ Partially filled",
        "submitted": "Submitted",
        "broker_acknowledged": "Broker acknowledged",
        "previewed": "Preview only",
        "blocked": "Blocked",
        "failed": "Failed",
        "unknown": "Unknown",
        "reconciliation_required": "Reconciliation required",
        "not_due": "Not due",
        "no_action": "No action",
        "no_signal": "No signal",
        "no_submission": "No submission",
    },
}


def _localize_producer_token(
    locale: DigestLocale, raw: str, table: Mapping[str, Mapping[str, str]]
) -> str | None:
    """If ``raw`` is exactly a known machine token, return its locale label.

    Returns ``None`` when ``raw`` is free-form prose (caller keeps original).
    A mapped empty string means \"omit this line\".
    """

    text = str(raw or "").strip()
    if not text:
        return ""
    key = text.lower()
    locale_map = table.get(locale) or table.get("zh") or {}
    if key in locale_map:
        return locale_map[key]
    # Also accept when en table defines the token but zh missed it (defensive).
    if key in (table.get("en") or {}) or key in (table.get("zh") or {}):
        return (table.get(locale) or {}).get(key, text)
    return None


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


def _optional_nonneg_int(raw: Any) -> int | None:
    """Parse an optional non-negative int; None stays unknown."""

    if raw is None or raw == "":
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"expected integer count, got {raw!r}") from exc
    if value < 0:
        raise ValueError("counts must be non-negative")
    return value


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


def _field_status_map(raw: Mapping[str, Any] | None) -> dict[str, str]:
    if not isinstance(raw, Mapping):
        return {}
    out: dict[str, str] = {}
    for key, value in raw.items():
        status = str(value or "").strip().lower()
        if status:
            out[str(key)] = status
    return out


def count_is_unknown(
    raw: Mapping[str, Any],
    field_name: str,
    *,
    parsed: int | None,
) -> bool:
    """True when producer/stub marks the count unknown (not verified zero)."""

    status_map = _field_status_map(
        raw.get("field_status") if isinstance(raw.get("field_status"), Mapping) else None
    )
    status = status_map.get(field_name, "")
    if status in {"unknown", "counts_unknown", "unverified"}:
        return True
    reason = str(raw.get("reason_code") or "").strip().lower()
    if reason in {"counts_unknown", "github_workflow_existence_only"} and field_name in {
        "fill_count",
        "order_count",
    }:
        # Existence-only stubs never assert verified zero fills/orders.
        if field_name not in raw or raw.get(field_name) is None:
            return True
        if status in {"unknown", "counts_unknown", "unverified"}:
            return True
    if field_name not in raw and parsed is None:
        # Absent key with no legacy int → unknown (new producers).
        # Legacy rows that omit the key but lack reason_code are treated as
        # explicit 0 only when filter supplies default via present int.
        return True
    return parsed is None


def resolve_count_field(
    raw: Mapping[str, Any],
    field_name: str,
    *,
    legacy_default_zero: bool = False,
) -> tuple[int | None, CountFieldStatus]:
    """Return (value, status). Legacy int 0 without field_status → known zero."""

    status_map = _field_status_map(
        raw.get("field_status") if isinstance(raw.get("field_status"), Mapping) else None
    )
    status_hint = status_map.get(field_name, "")
    if status_hint in {"unknown", "counts_unknown", "unverified"}:
        return None, "unknown"

    if field_name not in raw:
        reason = str(raw.get("reason_code") or "").strip().lower()
        if reason in {"counts_unknown", "github_workflow_existence_only"}:
            return None, "unknown"
        if legacy_default_zero:
            # Backward compat: old candidates omitting the key meant 0.
            return 0, "known"
        return None, "unknown"

    value = _optional_nonneg_int(raw.get(field_name))
    if value is None:
        return None, "unknown"
    return value, "known"


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

    Counts may be None (= unknown). Verified zero is int 0 with known status.
    """

    platform_id: str
    strategy_profile: str
    fill_count: int | None = 0
    order_count: int | None = 0
    cycle_count: int | None = 0
    status: Literal["ok", "alert"] = "ok"
    note: str = ""
    strategy_label: str = ""
    equity: float | None = None
    equity_currency: str = "USD"
    holdings: tuple[DigestHolding, ...] = ()
    # Optional coverage label for holdings (strategy_symbols_only | stocks_only).
    holdings_scope: str = ""
    signal_summary: str = ""
    rebalance_kind: RebalanceKind = ""
    rebalance_conclusion: str = ""
    tips: tuple[str, ...] = ()
    account_hint: str = ""
    opaque_account_uid: str = ""
    target_id: str = ""
    account_scope: str = ""
    execution_mode: str = ""
    fill_count_status: CountFieldStatus = "known"
    order_count_status: CountFieldStatus = "known"
    cycle_count_status: CountFieldStatus = "known"
    reason_code: str = ""
    evidence_provenance: str = ""
    # B11 optional producer axes (pass-through; central projects when empty).
    execution_status: str = ""
    evidence_persistence_status: str = ""
    evidence_delivery_status: str = ""

    def __post_init__(self) -> None:
        if not str(self.platform_id).strip():
            raise ValueError("platform_id required")
        if not str(self.strategy_profile).strip():
            raise ValueError("strategy_profile required")
        for name, value in (
            ("fill_count", self.fill_count),
            ("order_count", self.order_count),
            ("cycle_count", self.cycle_count),
        ):
            if value is not None and value < 0:
                raise ValueError(f"{name} must be non-negative")
        if self.equity is not None and self.equity < 0:
            raise ValueError("equity must be non-negative")
        kind = str(self.rebalance_kind or "")
        allowed = {"", "no_rebalance", "rebalance", "no_order", "pending"}
        if kind not in allowed:
            raise ValueError(f"rebalance_kind must be one of {sorted(allowed)}")


@dataclass(frozen=True)
class EvidenceCoverage:
    """Source coverage for distinguishing verified idle vs read failure."""

    candidates_configured: bool = False
    candidates_loaded: bool = False
    candidates_count: int = 0
    github_enabled: bool = False
    github_sources_queried: int = 0
    github_sources_matched: int = 0
    github_failures: tuple[dict[str, Any], ...] = ()

    @property
    def has_source_failures(self) -> bool:
        return bool(self.github_failures)

    @property
    def is_complete_for_verified_idle(self) -> bool:
        """True only when configured sources were consulted without failure."""

        if self.has_source_failures:
            return False
        if self.github_enabled and self.github_sources_queried <= 0:
            return False
        if self.candidates_loaded or (
            self.github_enabled and self.github_sources_queried > 0
        ):
            return True
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "candidates_configured": self.candidates_configured,
            "candidates_loaded": self.candidates_loaded,
            "candidates_count": self.candidates_count,
            "github_enabled": self.github_enabled,
            "github_sources_queried": self.github_sources_queried,
            "github_sources_matched": self.github_sources_matched,
            "github_failures": list(self.github_failures),
            "has_source_failures": self.has_source_failures,
            "is_complete_for_verified_idle": self.is_complete_for_verified_idle,
        }


@dataclass(frozen=True)
class DailyDigestInput:
    business_day: str
    window_label: str = ""
    locale: DigestLocale | str = "zh"
    runs: Sequence[DigestRunEntry] = field(default_factory=tuple)
    evidence_coverage: EvidenceCoverage | None = None
    evidence_status: EvidenceStatus | str = ""


def total_fills(runs: Sequence[DigestRunEntry]) -> int | None:
    """Sum known fills. Returns None when any run has unknown fill_count."""

    total = 0
    saw_known = False
    for entry in runs:
        if entry.fill_count is None or entry.fill_count_status == "unknown":
            return None
        saw_known = True
        total += entry.fill_count
    return total if saw_known or not runs else 0


def fills_are_verified_zero(runs: Sequence[DigestRunEntry]) -> bool:
    if not runs:
        return False
    for entry in runs:
        if entry.fill_count is None or entry.fill_count_status == "unknown":
            return False
        if entry.fill_count != 0:
            return False
    return True


def has_known_positive_fills(runs: Sequence[DigestRunEntry]) -> bool:
    """True when any run reports a known fill_count > 0.

    Used for digest title selection so a successful-trade block is not
    hidden behind the heartbeat title when another run's fills are unknown.
    """

    for entry in runs:
        if (
            entry.fill_count is not None
            and entry.fill_count_status != "unknown"
            and entry.fill_count > 0
        ):
            return True
    return False


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
    """Rank evidence richness for merge (known counts + optional observation)."""

    score = 0
    for field_name in ("fill_count", "order_count", "cycle_count"):
        value, status = resolve_count_field(row, field_name, legacy_default_zero=False)
        if status == "known" and value is not None:
            score += value
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
    # Prefer producer rows over github existence stubs.
    provenance = str(row.get("evidence_provenance") or "").strip().lower()
    if provenance in {"candidates", "producer"}:
        score += 20
    if provenance in {"github_workflow_stub", "github_stub"}:
        score -= 5
    return score


def identity_key(row: Mapping[str, Any]) -> tuple[str, str, str, str]:
    """Aggregation identity: platform + strategy + account/target.

    Missing account/target use explicit sentinels. Callers must not freely
    cross-fill observation fields across unknown-identity rows.
    """

    platform_id = str(row.get("platform_id") or "").strip()
    strategy = str(row.get("strategy_profile") or "").strip()
    account_uid = str(row.get("opaque_account_uid") or "").strip()
    target = str(row.get("target_id") or "").strip()
    return (
        platform_id,
        strategy,
        account_uid or UNKNOWN_ACCOUNT_UID,
        target or UNKNOWN_TARGET_ID,
    )


def identity_is_unknown(row: Mapping[str, Any]) -> bool:
    account_uid = str(row.get("opaque_account_uid") or "").strip()
    target = str(row.get("target_id") or "").strip()
    return not account_uid and not target


def _format_count_part(
    locale: DigestLocale,
    *,
    label_key: str,
    value: int | None,
    status: CountFieldStatus,
) -> str | None:
    if status == "unknown" or value is None:
        if label_key == "fills_label":
            return f"{_t(locale, 'fills_label')} {_t(locale, 'counts_unknown')}"
        return f"{_t(locale, label_key)} {_t(locale, 'counts_unknown')}"
    if label_key == "fills_label" and value == 0:
        return _t(locale, "no_fill")
    if value == 0 and label_key != "fills_label":
        return None
    return f"{_t(locale, label_key)} {value}"


def _detail_for(entry: DigestRunEntry, locale: DigestLocale) -> str:
    parts: list[str] = []
    cycle_part = _format_count_part(
        locale,
        label_key="cycles_label",
        value=entry.cycle_count,
        status=entry.cycle_count_status,
    )
    if cycle_part and not (
        entry.cycle_count_status == "known"
        and entry.cycle_count == 0
    ):
        if entry.cycle_count_status == "unknown" or (
            entry.cycle_count is not None and entry.cycle_count > 0
        ):
            parts.append(cycle_part)

    order_part = _format_count_part(
        locale,
        label_key="orders_label",
        value=entry.order_count,
        status=entry.order_count_status,
    )
    if order_part and (
        entry.order_count_status == "unknown"
        or (entry.order_count is not None and entry.order_count > 0)
    ):
        parts.append(order_part)

    fill_part = _format_count_part(
        locale,
        label_key="fills_label",
        value=entry.fill_count,
        status=entry.fill_count_status,
    )
    if fill_part:
        parts.append(fill_part)

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
    fill = entry.fill_count if entry.fill_count_status != "unknown" else None
    order = entry.order_count if entry.order_count_status != "unknown" else None
    if (fill is not None and fill > 0) or (order is not None and order > 0):
        return _t(locale, "block_rebalance")
    return _t(locale, "block_heartbeat")


_SCOPE_TAG_ALLOWED = frozenset({"live", "paper", "shadow", "research"})
_HEX_HINT_RE = re.compile(r"^[0-9a-fA-F]{12,}$")
# Broker account ids like IBKR ``U15998061`` / ``u15998061``.
_BROKER_ACCOUNT_ID_RE = re.compile(r"^[Uu]\d{5,}$")
# Scope forms that embed the broker id: ``live-u15998061``, ``paper_U16608560``.
_SCOPE_EMBEDDED_ACCOUNT_RE = re.compile(
    r"^(?:live|paper|shadow|research)[_-]([Uu]\d{5,})$",
    re.IGNORECASE,
)


def _normalize_scope_tag(raw: str) -> str:
    """Return lowercase live/paper/shadow/research when value looks like a mode."""

    value = str(raw or "").strip().lower()
    if not value:
        return ""
    # Accept plain mode or prefixed forms like live_us / paper-us.
    if value in _SCOPE_TAG_ALLOWED:
        return value
    for mode in _SCOPE_TAG_ALLOWED:
        if value == mode or value.startswith(f"{mode}_") or value.startswith(f"{mode}-"):
            return mode
    return ""


def _normalize_broker_account_id(raw: str) -> str:
    """Return ``U######`` when ``raw`` is a broker account id (IBKR-style).

    Existing ops config uses uppercase ``U``; lowercase input is normalized.
    """

    value = str(raw or "").strip()
    if not value:
        return ""
    if _BROKER_ACCOUNT_ID_RE.fullmatch(value):
        return "U" + value[1:]
    match = _SCOPE_EMBEDDED_ACCOUNT_RE.fullmatch(value)
    if match:
        acc = match.group(1)
        return "U" + acc[1:]
    return ""


def _human_account_hint(raw: str) -> str:
    """Return account_hint when it is already a good human label.

    Reject empty values and opaque hex hashes (those are not display tags).
    IBKR-style ids such as ``U16608560`` are kept (normalized to ``U######``).
    """

    hint = str(raw or "").strip()
    if not hint:
        return ""
    if _HEX_HINT_RE.fullmatch(hint):
        return ""
    broker = _normalize_broker_account_id(hint)
    if broker:
        return broker
    return hint


def _account_label(entry: DigestRunEntry) -> str:
    """Resolve the account half of ``[{platform_id} {account_label}]``.

    Preference (universal):
      1. human ``account_hint`` / broker id (e.g. IBKR ``U15998061``)
      2. broker id embedded in ``account_scope`` (``live-u15998061``)
      3. broker id on ``opaque_account_uid`` when it is already ``U######``
      4. normalized scope ``live|paper|shadow|research``
      5. short ``opaque_account_uid`` / ``target_id`` last resorts
    """

    hint = _human_account_hint(entry.account_hint)
    if hint:
        return hint
    for raw in (entry.account_scope, entry.execution_mode, entry.opaque_account_uid):
        broker = _normalize_broker_account_id(raw)
        if broker:
            return broker
    for raw in (entry.account_scope, entry.execution_mode):
        scope = _normalize_scope_tag(raw)
        if scope:
            return scope
    uid = str(entry.opaque_account_uid or "").strip()
    if uid and uid.lower() != UNKNOWN_ACCOUNT_UID:
        if len(uid) > 12:
            return uid[:8]
        return uid
    target = str(entry.target_id or "").strip()
    if target and target.lower() != UNKNOWN_TARGET_ID:
        return target
    return ""


def account_block_tag(entry: DigestRunEntry) -> str:
    """Account tag body for ``[tag]`` block titles.

    Universal form: ``{platform_id} {account_label}`` — e.g. ``ibkr U15998061``,
    ``schwab live``, ``firstrade paper``. Never hard-code a single venue.
    Returns empty string when nothing usable is present.
    """

    platform = str(entry.platform_id or "").strip()
    label = _account_label(entry)
    if not label:
        return ""
    if not platform:
        return label
    # Avoid ``ibkr ibkr U…`` if label already carries the platform prefix.
    prefix = platform.lower() + " "
    if label.lower().startswith(prefix):
        return label
    return f"{platform} {label}"


def _display_strategy(entry: DigestRunEntry) -> str:
    label = entry.strategy_label.strip()
    return label or entry.strategy_profile


_HOLDINGS_SCOPES = frozenset({"strategy_symbols_only", "stocks_only"})


def _parse_holdings_scope(raw: Any) -> str:
    """Accept only known coverage tokens; anything else renders without a label."""

    text = str(raw or "").strip()
    return text if text in _HOLDINGS_SCOPES else ""


def _holdings_header(scope: str, locale: DigestLocale) -> str:
    label = _t(locale, "holdings_label")
    if scope in _HOLDINGS_SCOPES:
        scope_text = _t(locale, f"holdings_scope_{scope}")
        if locale == "en":
            return f"{label} ({scope_text})"
        return f"{label}（{scope_text}）"
    return label


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
    raw = entry.rebalance_conclusion.strip()
    if raw:
        localized = _localize_producer_token(locale, raw, _CONCLUSION_TOKEN_DISPLAY)
        if localized is not None:
            # Bare machine token: use mapped label (may be "" to omit).
            if localized:
                return localized
            # Empty mapping → fall through to kind-based defaults.
        else:
            # Free-form producer prose (often already zh) — keep as-is.
            return raw
    kind = entry.rebalance_kind or ""
    if kind == "no_rebalance":
        return _t(locale, "conclusion_no_rebalance")
    # Trade-success fallback when producer left conclusion empty but counts known.
    fill = entry.fill_count if entry.fill_count_status != "unknown" else None
    if fill is not None and fill > 0:
        return _t(locale, "conclusion_fills").format(count=fill)
    return ""


def _render_observation_block(entry: DigestRunEntry, locale: DigestLocale) -> list[str]:
    lines: list[str] = []
    title = _block_title(entry, locale)
    tag = account_block_tag(entry)
    if tag:
        lines.append(f"[{tag}] {title}")
    else:
        lines.append(title)
    lines.append(f"{_t(locale, 'strategy_label')}: {_display_strategy(entry)}")
    if entry.equity is not None:
        lines.append(
            f"{_t(locale, 'equity_label')}: "
            f"{_format_equity(entry.equity, currency=entry.equity_currency)}"
        )
    if entry.holdings:
        lines.append(_holdings_header(entry.holdings_scope, locale))
        for holding in entry.holdings:
            lines.append(_holding_line(holding, locale))
    if entry.signal_summary.strip():
        signal_raw = entry.signal_summary.strip()
        signal_display = _localize_producer_token(
            locale, signal_raw, _SIGNAL_TOKEN_DISPLAY
        )
        if signal_display is None:
            signal_display = signal_raw
        if signal_display:
            lines.append(
                f"- {_t(locale, 'signal_prefix')}: {signal_display}"
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


def resolve_evidence_status(
    payload: DailyDigestInput,
) -> EvidenceStatus:
    if payload.evidence_status in {
        "verified_idle",
        "evidence_unknown",
        "has_runs",
    }:
        return payload.evidence_status  # type: ignore[return-value]
    runs = tuple(payload.runs)
    if runs:
        return "has_runs"
    coverage = payload.evidence_coverage
    if coverage is not None and coverage.is_complete_for_verified_idle:
        return "verified_idle"
    # Safer default: empty without proven coverage ≠ verified idle.
    return "evidence_unknown"


def render_daily_digest(payload: DailyDigestInput) -> str:
    """Render one Telegram message body (never includes tokens or chat ids).

    Omits schedule window and channel footer lines (product preference).
    Multiple observation blocks are separated by a blank line.
    """

    locale = normalize_locale(str(payload.locale))
    runs = tuple(payload.runs)
    lines: list[str] = []
    rich = any(has_observation(entry) for entry in runs)
    evidence_status = resolve_evidence_status(payload)
    known_fills = total_fills(runs)

    if not runs:
        lines.append(_t(locale, "daily_digest_heartbeat_title"))
        lines.append(f"{_t(locale, 'date_label')}: {payload.business_day}")
        if evidence_status == "verified_idle":
            lines.append(_t(locale, "heartbeat_no_run_verified"))
        else:
            lines.append(_t(locale, "heartbeat_evidence_unknown"))
        return "\n".join(lines)

    # Prefer 收盘日报 when any run has known fills > 0, even if other runs'
    # fill counts are unknown (mixed multi-platform digest).
    if has_known_positive_fills(runs) or (known_fills is not None and known_fills > 0):
        lines.append(_t(locale, "daily_digest_title"))
    else:
        lines.append(_t(locale, "daily_digest_heartbeat_title"))
    lines.append(f"{_t(locale, 'date_label')}: {payload.business_day}")
    if not rich:
        if known_fills is None:
            lines.append(_t(locale, "heartbeat_fills_unknown"))
            lines.append(_t(locale, "ran_section"))
        elif known_fills == 0:
            lines.append(_t(locale, "heartbeat_no_fill_verified"))
            lines.append(_t(locale, "ran_section"))
        else:
            lines.append(_t(locale, "ran_section"))

    for index, entry in enumerate(runs):
        block = _render_run_line(entry, locale)
        # Separate multi-platform / multi-run blocks for readability.
        # Observation blocks always get a blank line; thin list rows stay compact.
        if index > 0 and (
            has_observation(entry)
            or has_observation(runs[index - 1])
            or rich
        ):
            lines.append("")
        lines.extend(block)
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


def _parse_actually_ran(raw: Mapping[str, Any]) -> bool | None:
    """Return True/False when key present; None when absent (do not default True)."""

    if "actually_ran" not in raw:
        return None
    value = raw.get("actually_ran")
    if isinstance(value, bool):
        return value
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y"}:
        return True
    if text in {"0", "false", "no", "n"}:
        return False
    raise ValueError(f"unsupported actually_ran value: {value!r}")


def filter_runs_for_digest(
    candidates: Sequence[Mapping[str, object]],
) -> list[DigestRunEntry]:
    """Keep only rows with explicit ``actually_ran=True``.

    Absent ``actually_ran`` is treated as incomplete evidence and excluded
    (no longer defaults to True). Optional observation keys are copied when
    present and never fabricated here.

    Count compat: an explicit int 0 without field_status remains verified zero.
    New stubs must omit counts or set field_status/reason_code for unknown.
    """

    out: list[DigestRunEntry] = []
    for raw in candidates:
        ran = _parse_actually_ran(raw)
        if ran is not True:
            continue
        holdings_raw = raw.get("holdings", raw.get("positions"))
        # Legacy producer rows often omit field_status and may omit keys;
        # if fill_count key is present as int (incl. 0) → known.
        # If key absent and no unknown reason → legacy default 0 for counts
        # only when *any* count key is present OR evidence_provenance is
        # producer/candidates; github stubs must mark unknown explicitly.
        provenance = str(raw.get("evidence_provenance") or "").strip().lower()
        reason = str(raw.get("reason_code") or "").strip().lower()
        is_existence_stub = provenance in {
            "github_workflow_stub",
            "github_stub",
        } or reason in {"github_workflow_existence_only", "counts_unknown"}
        legacy_zero = not is_existence_stub

        fill_count, fill_status = resolve_count_field(
            raw, "fill_count", legacy_default_zero=legacy_zero
        )
        order_count, order_status = resolve_count_field(
            raw, "order_count", legacy_default_zero=legacy_zero
        )
        cycle_count, cycle_status = resolve_count_field(
            raw, "cycle_count", legacy_default_zero=legacy_zero
        )

        out.append(
            DigestRunEntry(
                platform_id=str(raw["platform_id"]),
                strategy_profile=str(raw["strategy_profile"]),
                fill_count=fill_count,
                order_count=order_count,
                cycle_count=cycle_count,
                status="alert" if str(raw.get("status", "ok")) == "alert" else "ok",
                note=str(raw.get("note", "") or ""),
                strategy_label=str(raw.get("strategy_label") or "").strip(),
                equity=_optional_float(raw.get("equity", raw.get("equity_usd"))),
                equity_currency=str(
                    raw.get("equity_currency") or raw.get("currency") or "USD"
                ).strip()
                or "USD",
                holdings=_parse_holdings(holdings_raw),
                holdings_scope=_parse_holdings_scope(raw.get("holdings_scope")),
                signal_summary=str(raw.get("signal_summary") or "").strip(),
                rebalance_kind=_parse_rebalance_kind(raw.get("rebalance_kind")),
                rebalance_conclusion=str(raw.get("rebalance_conclusion") or "").strip(),
                tips=_parse_tips(raw.get("tips") or raw.get("tip")),
                account_hint=str(raw.get("account_hint") or "").strip(),
                opaque_account_uid=str(raw.get("opaque_account_uid") or "").strip(),
                target_id=str(raw.get("target_id") or "").strip(),
                account_scope=str(
                    raw.get("account_scope") or raw.get("accountScope") or ""
                ).strip(),
                execution_mode=str(
                    raw.get("execution_mode") or raw.get("executionMode") or ""
                ).strip(),
                fill_count_status=fill_status,
                order_count_status=order_status,
                cycle_count_status=cycle_status,
                reason_code=str(raw.get("reason_code") or "").strip(),
                evidence_provenance=str(raw.get("evidence_provenance") or "").strip(),
                execution_status=str(raw.get("execution_status") or "").strip(),
                evidence_persistence_status=str(
                    raw.get("evidence_persistence_status") or ""
                ).strip(),
                evidence_delivery_status=str(
                    raw.get("evidence_delivery_status") or ""
                ).strip(),
            )
        )
    return out


__all__ = [
    "DailyDigestInput",
    "DigestHolding",
    "DigestRunEntry",
    "EvidenceCoverage",
    "UNKNOWN_ACCOUNT_UID",
    "UNKNOWN_TARGET_ID",
    "account_block_tag",
    "filter_runs_for_digest",
    "fills_are_verified_zero",
    "has_known_positive_fills",
    "has_observation",
    "identity_is_unknown",
    "identity_key",
    "normalize_locale",
    "observation_score",
    "render_daily_digest",
    "resolve_count_field",
    "resolve_evidence_status",
    "total_fills",
]

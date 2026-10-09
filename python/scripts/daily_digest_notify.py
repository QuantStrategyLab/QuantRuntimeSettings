#!/usr/bin/env python3
"""QuantSentinel daily digest message contract (zh/en).

Pure formatter: no Telegram I/O, no secret reads. Aggregators collect
which platforms/strategies actually ran, then call ``render_daily_digest``
and send via the unified bot secret ``quant-sentinel-telegram-bot-token``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Mapping, Sequence

DigestLocale = Literal["zh", "en"]

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
    },
}


def normalize_locale(raw: str | None) -> DigestLocale:
    value = (raw or "zh").strip().lower()
    return "en" if value.startswith("en") else "zh"


def _t(locale: DigestLocale, key: str) -> str:
    return _TEXTS[locale][key]


@dataclass(frozen=True)
class DigestRunEntry:
    """One platform/strategy that actually ran in the digest window."""

    platform_id: str
    strategy_profile: str
    fill_count: int = 0
    order_count: int = 0
    cycle_count: int = 0
    status: Literal["ok", "alert"] = "ok"
    note: str = ""

    def __post_init__(self) -> None:
        if not str(self.platform_id).strip():
            raise ValueError("platform_id required")
        if not str(self.strategy_profile).strip():
            raise ValueError("strategy_profile required")
        if min(self.fill_count, self.order_count, self.cycle_count) < 0:
            raise ValueError("counts must be non-negative")


@dataclass(frozen=True)
class DailyDigestInput:
    business_day: str
    window_label: str = ""
    locale: DigestLocale | str = "zh"
    runs: Sequence[DigestRunEntry] = field(default_factory=tuple)


def total_fills(runs: Sequence[DigestRunEntry]) -> int:
    return sum(entry.fill_count for entry in runs)


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


def render_daily_digest(payload: DailyDigestInput) -> str:
    """Render one Telegram message body (never includes tokens or chat ids)."""

    locale = normalize_locale(str(payload.locale))
    runs = tuple(payload.runs)
    lines: list[str] = []

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
        lines.append(f"{_t(locale, 'date_label')}: {payload.business_day}")
        if payload.window_label.strip():
            lines.append(f"{_t(locale, 'window_label')}: {payload.window_label.strip()}")
        lines.append(_t(locale, "heartbeat_no_fill"))
        lines.append(_t(locale, "ran_section"))
        for entry in runs:
            lines.append(
                _t(locale, "platform_line").format(
                    platform=entry.platform_id,
                    strategy=entry.strategy_profile,
                    detail=_detail_for(entry, locale),
                )
            )
        lines.append(_t(locale, "footer"))
        return "\n".join(lines)

    lines.append(_t(locale, "daily_digest_title"))
    lines.append(f"{_t(locale, 'date_label')}: {payload.business_day}")
    if payload.window_label.strip():
        lines.append(f"{_t(locale, 'window_label')}: {payload.window_label.strip()}")
    lines.append(_t(locale, "ran_section"))
    for entry in runs:
        lines.append(
            _t(locale, "platform_line").format(
                platform=entry.platform_id,
                strategy=entry.strategy_profile,
                detail=_detail_for(entry, locale),
            )
        )
    lines.append(_t(locale, "footer"))
    return "\n".join(lines)


def filter_runs_for_digest(
    candidates: Sequence[Mapping[str, object]],
) -> list[DigestRunEntry]:
    """Keep only rows marked ``actually_ran`` (default True if key absent).

    Upstream decides inclusion: crypto hourly only if a cycle ran; monthly DCA
    only on run days; idle platforms omitted.
    """

    out: list[DigestRunEntry] = []
    for raw in candidates:
        if not bool(raw.get("actually_ran", True)):
            continue
        out.append(
            DigestRunEntry(
                platform_id=str(raw["platform_id"]),
                strategy_profile=str(raw["strategy_profile"]),
                fill_count=int(raw.get("fill_count", 0) or 0),
                order_count=int(raw.get("order_count", 0) or 0),
                cycle_count=int(raw.get("cycle_count", 0) or 0),
                status="alert" if str(raw.get("status", "ok")) == "alert" else "ok",
                note=str(raw.get("note", "") or ""),
            )
        )
    return out


__all__ = [
    "DailyDigestInput",
    "DigestRunEntry",
    "filter_runs_for_digest",
    "normalize_locale",
    "render_daily_digest",
    "total_fills",
]

"""Shared display sections; no execution, routing, receipt or transport policy."""
from __future__ import annotations

from collections.abc import Sequence
from urllib.parse import urlsplit, urlunsplit

SECTION_NAMES = {
    "zh": ("结果", "范围", "证据", "覆盖", "下一步"),
    "en": ("Result", "Scope", "Evidence", "Coverage", "Next step"),
}


def safe_run_url(value: object) -> str | None:
    """Use only caller-supplied HTTPS links, dropping query and fragment."""
    if not isinstance(value, str) or any(c.isspace() or ord(c) < 32 for c in value):
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password:
            return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    except ValueError:
        pass
    return None


def next_step_text(locale: str, *, needs_review: bool) -> str:
    if locale == "zh":
        return ("核对该次运行、回执和缺失来源；保持现有执行限制。" if needs_review else
                "无需操作；等待下一统计窗口。")
    return ("Review the source run, receipt and missing sources; retain existing execution restrictions."
            if needs_review else "No action required; await the next reporting window.")


def render_operator_message(*, title: str, locale: str, result: Sequence[str],
                            scope: Sequence[str], evidence: Sequence[str], coverage: Sequence[str],
                            next_step: Sequence[str], max_units: int | None = None,
                            required_evidence: Sequence[str] = (),
                            optional_evidence: Sequence[Sequence[str]] = ()) -> str:
    """Keep result, scope, coverage and next step before optional evidence.

    Truncation is explicit and cannot remove a section or imply full coverage.
    Optional observations correspond to evidence entries in the same order.
    Callers put urgent evidence before optional observations. Financial facts
    must already have been validated by the producer; this helper infers none.
    """
    names = SECTION_NAMES["zh" if locale == "zh" else "en"]
    unknown = "未知" if locale == "zh" else "Unknown"
    groups = [[str(line) for line in group if line] or [unknown]
              for group in (result, scope, evidence, coverage, next_step)]

    def assemble():
        lines = [title]
        for name, group in zip(names, groups):
            lines.extend([f"【{name}】" if locale == "zh" else f"[{name}]", *group])
        return "\n".join(lines)

    contexts = groups[2]

    def observations(index):
        return optional_evidence[index] if index < len(optional_evidence) else ()

    groups[2] = [line for index, context in enumerate(contexts)
                 for line in (context, *observations(index))]
    if max_units is None:
        return assemble()
    if max_units < 256:
        raise ValueError("notification_budget_too_small")
    if len(assemble().encode("utf-16-le")) // 2 <= max_units:
        return assemble()
    original = contexts
    # Retain caller order and duplicate reasons belonging to distinct accounts.
    kept = {index for index, line in enumerate(original) if line in required_evidence}
    suffix = "部分证据已省略；请查看运行记录。" if locale == "zh" else "Some evidence omitted; inspect source run."

    def select_evidence():
        groups[2] = [line for index, line in enumerate(original) if index in kept] + [suffix]

    select_evidence()
    if len(assemble().encode("utf-16-le")) // 2 > max_units:
        raise ValueError("notification_required_fields_exceed_budget")
    for index in range(len(original)):
        if index in kept:
            continue
        kept.add(index)
        select_evidence()
        if len(assemble().encode("utf-16-le")) // 2 > max_units:
            kept.remove(index)
    # Add observations only after their retained account context, after all
    # account summaries have had a chance to fit.
    details = {}
    for index, context in enumerate(original):
        if index not in kept:
            continue
        for line in observations(index):
            details.setdefault(index, []).append(line)
            groups[2] = [item for i, entry in enumerate(original) if i in kept
                         for item in (entry, *details.get(i, ()))] + [suffix]
            if len(assemble().encode("utf-16-le")) // 2 > max_units:
                details[index].pop()
    groups[2] = [item for i, entry in enumerate(original) if i in kept
                 for item in (entry, *details.get(i, ()))] + [suffix]
    return assemble()

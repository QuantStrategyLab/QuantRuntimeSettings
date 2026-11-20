"""Pinned B2 account-management status and evidence copy table (zh-CN / en).

Must stay byte-identical to
`web/strategy-switch-console/application/runtime_instances/account_management_text.js`.
Producer-supplied labels, runtime lifecycle stages, plan statuses, and
account-specific overrides never substitute for this table.
"""
from __future__ import annotations

from daily_digest_notify import normalize_locale

MANAGEMENT_STATUS_TEXT = {
    'managed': {'zh-CN': '已纳入量化管理', 'en': 'Under quant management'},
    'management_disabled': {'zh-CN': '已停用量化管理', 'en': 'Quant management disabled'},
    'not_under_management': {'zh-CN': '不纳入量化管理', 'en': 'Outside quant management'},
    'unknown': {'zh-CN': '量化管理状态未知', 'en': 'Quant management status unknown'},
}

MANAGEMENT_EVIDENCE_TEXT = {
    'unknown': {'zh-CN': '证据未知', 'en': 'Evidence unknown'},
    'conflict': {'zh-CN': '证据冲突', 'en': 'Conflicting evidence'},
    'stale': {'zh-CN': '证据已过期', 'en': 'Stale evidence'},
}


def format_management_status(management_status, evidence_state, locale='en', *,
                             expected_enabled=None, observed_enabled=None):
    """Render one generic management status with optional evidence suffix and expectation mismatch."""
    if management_status not in MANAGEMENT_STATUS_TEXT:
        raise ValueError('management_status_invalid')
    if evidence_state not in {'known', *MANAGEMENT_EVIDENCE_TEXT}:
        raise ValueError('evidence_state_invalid')
    zh = normalize_locale(locale) == 'zh'
    lang = 'zh-CN' if zh else 'en'
    text = MANAGEMENT_STATUS_TEXT[management_status][lang]
    if evidence_state != 'known':
        suffix = MANAGEMENT_EVIDENCE_TEXT[evidence_state][lang]
        text += f'（{suffix}）' if zh else f' ({suffix})'
    if type(expected_enabled) is bool and type(observed_enabled) is bool and expected_enabled is not observed_enabled:
        text += '（与预期配置不一致）' if zh else ' (differs from expectation)'
    return text

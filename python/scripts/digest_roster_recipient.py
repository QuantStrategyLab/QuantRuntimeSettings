"""Shared role-compatible private recipient predicate leaf (FLAG-6).

Used by both the Cloud entry (`cloud_run_daily_digest`) and the authority
module (`digest_roster_authority`) without creating an authority -> Cloud edge.
Depends only on stdlib `json` and shared `display_names`.
"""
from __future__ import annotations

import json

from display_names import broker_account_identity

IBKR_TELEGRAM_BINDING = ('candidate_slot', 'opaque_account_uid', 'target_id')
AUTHORIZED_TRIGGER_PROVENANCE = 'azure_logic_sliding_window'


def authorized_ibkr_telegram_accounts(expected, raw, recipient):
    """Validate and resolve private IBKR account IDs for one authorized recipient.

    Any malformed JSON, wrong recipient, unenrolled binding, invalid IBKR
    account identity, or either direction of conflicting ownership empties the
    entire map fail-closed.
    """
    if not raw or not recipient:
        return {}
    try:
        value = json.loads(raw)
        if not isinstance(value, dict) or value.get('recipient_id') != recipient:
            return {}
        eligible = {
            tuple(row[key] for key in IBKR_TELEGRAM_BINDING)
            for row in expected
            if isinstance(row, dict) and row.get('platform_id') == 'ibkr'
        }
        accounts, owners = {}, {}
        for row in value['accounts']:
            if not isinstance(row, dict):
                return {}
            identity = tuple(row[key] for key in IBKR_TELEGRAM_BINDING)
            uid = row['opaque_account_uid']
            account = broker_account_identity('ibkr', row['account_id'])
            if (identity not in eligible or not account
                    or accounts.setdefault(uid, account) != account
                    or owners.setdefault(account, uid) != uid):
                return {}
        return accounts
    except (KeyError, TypeError, ValueError):
        return {}


def authorize_generation_recipient_accounts(
    bindings,
    raw,
    recipient,
    *,
    preview: bool = False,
    trigger_provenance: str | None = None,
):
    """Generation-path provenance + recipient gate: private broker IDs are
    authorized ONLY for non-preview delivery with authorized trigger provenance.
    """
    if preview or trigger_provenance != AUTHORIZED_TRIGGER_PROVENANCE:
        return {}
    return authorized_ibkr_telegram_accounts(bindings, raw, recipient)


__all__ = [
    'AUTHORIZED_TRIGGER_PROVENANCE',
    'IBKR_TELEGRAM_BINDING',
    'authorize_generation_recipient_accounts',
    'authorized_ibkr_telegram_accounts',
]

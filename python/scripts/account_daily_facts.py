"""Project bound candidate account observations without inferring coverage."""
from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime, time, timedelta, timezone
from math import isfinite

from notification_snapshot.unified_contract import SGT, sgt_business_window

SIMULATION_MODES = frozenset({'dry_run', 'paper', 'shadow', 'plan_only'})


def _text(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def _number(value, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value):
        return None
    if positive and value <= 0:
        return None
    return value


def _stamp(value):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result if result.tzinfo is not None and result.utcoffset() is not None else None
    except ValueError:
        return None


def _currency(value):
    value = _text(value)
    return value.upper() if value and len(value) == 3 and value.isascii() and value.isalpha() else None


def _execution(raw, row, kind, day):
    if not isinstance(raw, Mapping):
        return None
    stamp = _stamp(raw.get('occurred_at'))
    interval = None
    if stamp is None and raw.get('occurred_at') is not None:
        return None
    if stamp is None and kind == 'orders':
        start = _stamp(raw.get('submission_window_start'))
        finish = _stamp(raw.get('submission_window_end'))
        if (start is not None and finish is not None and start <= finish
                and sgt_business_window(start).business_day == day
                and sgt_business_window(finish).business_day == day):
            interval = (start, finish)
    if stamp is None and interval is None:
        return None
    if stamp is not None and sgt_business_window(stamp).business_day != day:
        return None
    identity = _text(raw.get('id'))
    if identity is None:
        return None
    result = {'id': identity}
    fields = ('symbol', 'side', 'strategy', 'asset_type', 'status') if kind == 'orders' else (
        'order_id', 'symbol', 'side', 'strategy', 'asset_type')
    for name in fields:
        if name in raw and raw[name] is not None:
            value = _text(raw[name])
            if value is None:
                return None
            result[name] = value.lower() if name == 'status' else value
        else:
            result[name] = None
    for name in (('quantity', 'filled_quantity', 'remaining_quantity', 'price', 'average_fill_price') if kind == 'orders'
                 else ('quantity', 'price')):
        if name in raw and raw[name] is not None:
            value = _number(raw[name])
            if value is None or value < 0 or (name == 'quantity' and value == 0):
                return None
            result[name] = value
        else:
            result[name] = None
    if raw.get('currency') is not None:
        result['currency'] = _currency(raw['currency'])
        if result['currency'] is None:
            return None
    else:
        result['currency'] = None
    if stamp is not None:
        result['occurred_at'] = stamp.astimezone(timezone.utc).isoformat()
    else:
        result['submission_window_start'] = interval[0].astimezone(timezone.utc).isoformat()
        result['submission_window_end'] = interval[1].astimezone(timezone.utc).isoformat()
    return result


def _snapshot(raw, end):
    if not isinstance(raw, Mapping):
        return None
    stamp = _stamp(raw.get('as_of'))
    if stamp is None or stamp > end:
        return None
    currency = _currency(raw.get('equity_currency'))
    equity = _number(raw.get('equity')) if raw.get('equity') is not None else None
    if currency is None:
        equity = None
    holdings = raw.get('holdings')
    complete = (isinstance(holdings, list) and raw.get('holdings_scope') == 'account'
                and raw.get('holdings_complete') is True)
    projected = []
    for item in holdings if isinstance(holdings, list) else ():
        if not isinstance(item, Mapping):
            complete = False
            continue
        symbol, asset = _text(item.get('symbol')), _text(item.get('asset_type'))
        quantity = _number(item.get('quantity'))
        if symbol is None or asset is None or quantity is None:
            complete = False
            continue
        projected.append({'symbol': symbol, 'quantity': quantity, 'asset_type': asset})
    if equity is None and not projected and not complete:
        return None
    projected.sort(key=lambda item: (item['symbol'], item['asset_type'], item['quantity']))
    return {'as_of': stamp.astimezone(timezone.utc).isoformat(), 'equity': equity, 'equity_currency': currency,
            'holdings': projected, 'holdings_complete': complete}


def _add_unique(records, conflicts, key, value):
    if key in conflicts:
        return
    prior = records.get(key)
    if prior and 'strategy' in value and {k: v for k, v in prior.items() if k != 'strategy'} == {
        k: v for k, v in value.items() if k != 'strategy'
    }:
        records[key] = {**prior, 'strategy': prior['strategy'] if prior['strategy'] == value['strategy'] else None}
    elif prior and prior != value:
        records.pop(key)
        conflicts.add(key)
    else:
        records[key] = value


def collect_account_facts(rows, expected, business_day):
    """Return verified observations for bound accounts, with unknown coverage.

    Current projection attests strategy observations only. Neither per-run
    counts nor a producer's boolean proves the entire broker account window.
    An empty list and false completeness flag do not assert zero activity.
    """
    day = date.fromisoformat(business_day)
    end = datetime.combine(day + timedelta(days=1), time(6), SGT)
    identity = ('platform_id', 'opaque_account_uid', 'target_id', 'strategy_profile')
    allowed = {tuple(binding[name] for name in identity) for binding in expected}
    accounts = {(binding['platform_id'], binding['opaque_account_uid']) for binding in expected}
    records = {key: {kind: {} for kind in ('orders', 'fills', 'snapshots')} for key in accounts}
    conflicts = {key: {kind: set() for kind in ('orders', 'fills', 'snapshots')} for key in accounts}
    current_fills = {key: {} for key in accounts}
    current_fill_conflicts = {key: set() for key in accounts}
    unverified_fill_windows = set()
    mixed_fill_windows = set()
    for row in rows:
        if not isinstance(row, Mapping) or tuple(row.get(name) for name in identity) not in allowed:
            continue
        if str(row.get('execution_mode') or '').strip().lower() in SIMULATION_MODES:
            continue
        try:
            row_day = date.fromisoformat(row.get('business_day', ''))
        except (TypeError, ValueError):
            continue
        if row_day > day:
            continue
        facts = row.get('account_daily_facts')
        if not isinstance(facts, Mapping):
            continue
        account = (row['platform_id'], row['opaque_account_uid'])
        if row_day == day and facts.get('fills_window_unknown') is True:
            unverified_fill_windows.add(account)
        if row_day == day and facts.get('fills_window_mixed') is True:
            mixed_fill_windows.add(account)
        # An already-read older run may contain a later, independently dated
        # fill. Its submission and run counts still belong to the older day.
        for kind in ('orders', 'fills') if row_day == day else ('fills',):
            source = facts.get(kind)
            if not isinstance(source, list):
                continue
            for raw in source:
                value = _execution(raw, row, kind, day)
                if value is not None:
                    _add_unique(records[account][kind], conflicts[account][kind], value['id'], value)
                    if kind == 'fills' and row_day == day:
                        _add_unique(current_fills[account], current_fill_conflicts[account], value['id'], value)
        source = facts.get('snapshots')
        if isinstance(source, list):
            for raw in source:
                value = _snapshot(raw, end)
                if value is not None and (row_day == day or _stamp(value['as_of']) < end - timedelta(days=1)):
                    key = _stamp(value['as_of']).timestamp()
                    _add_unique(records[account]['snapshots'], conflicts[account]['snapshots'], key, value)
    additional_fills = {account for account in accounts
                        if conflicts[account]['fills']
                        or any(current_fills[account].get(key) != value
                               for key, value in records[account]['fills'].items())}
    return {account: {**{kind: list(values.values()) for kind, values in data.items()},
                      'orders_complete': False, 'fills_complete': False,
                      'additional_fills': account in additional_fills,
                      'fills_window_unknown': account in unverified_fill_windows,
                      'fills_window_mixed': account in mixed_fill_windows}
            for account, data in records.items()}

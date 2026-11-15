"""Render a single, account-oriented daily digest from supplied observations."""
from __future__ import annotations

import math
import re
from collections.abc import Mapping
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from types import SimpleNamespace

from account_daily_facts import SIMULATION_MODES
from daily_digest_notify import block_reason_text, normalize_locale
from display_names import broker_account_identity, display_name, safe_display_text
from notification_approved_gates import render_reasons
from notification_snapshot.unified_contract import SGT, sgt_business_window
from unified_daily_digest import (
    _account_identity_label,
    _evidence_attention_text,
    _execution_blocked,
    _execution_unconfirmed,
    _known_count,
    _run_display_contexts,
    _units,
    _verified_no_trade,
    _window_text,
)


# Display order is independent of the storage roster and its read outcomes.
_PLATFORM_DISPLAY_ORDER = ('ibkr', 'firstrade', 'schwab', 'binance', 'longbridge')

_DEFAULT_PLATFORM_CAPABILITIES = {
    'hide_broker_account_identity': False,
    'replace_platform_named_label': False,
    'supports_wallet_valuation': False,
    'supports_settled_cash': False,
    'supports_no_stocks_flag': False,
    'supports_telegram_account_id': False,
    'normalize_stock_option_symbol': False,
    'snapshot_standby_when_not_run': False,
}

_BUILTIN_PLATFORM_CAPABILITIES = {
    'ibkr': {
        'supports_settled_cash': True,
        'supports_no_stocks_flag': True,
        'supports_telegram_account_id': True,
    },
    'firstrade': {},
    'schwab': {},
    'binance': {
        'hide_broker_account_identity': True,
        'replace_platform_named_label': True,
        'supports_wallet_valuation': True,
    },
    'longbridge': {
        'hide_broker_account_identity': True,
        'normalize_stock_option_symbol': True,
        'snapshot_standby_when_not_run': True,
    },
}


def _platform_capabilities(platform, known_platforms=None):
    caps = dict(_DEFAULT_PLATFORM_CAPABILITIES)
    caps.update(_BUILTIN_PLATFORM_CAPABILITIES.get(platform, ()))
    if isinstance(known_platforms, Mapping):
        meta = known_platforms.get(platform)
        if isinstance(meta, Mapping):
            raw_caps = meta.get('digest_capabilities') or meta.get('capabilities')
            if isinstance(raw_caps, Mapping):
                for key in _DEFAULT_PLATFORM_CAPABILITIES:
                    if isinstance(raw_caps.get(key), bool):
                        caps[key] = raw_caps[key]
    return caps


def _platform_hidden_unbound(meta):
    if not isinstance(meta, Mapping):
        return False
    deployment = meta.get('deployment')
    if not isinstance(deployment, Mapping):
        return False
    return deployment.get('runtime_model') == 'not_configured' or deployment.get('live_configured') is False


def _platform_display_rank(platform, known_platforms=None):
    if isinstance(known_platforms, Mapping):
        meta = known_platforms.get(platform)
        if isinstance(meta, Mapping):
            rank = meta.get('display_rank')
            if type(rank) is int:
                return rank
    if platform in _PLATFORM_DISPLAY_ORDER:
        return _PLATFORM_DISPLAY_ORDER.index(platform)
    return len(_PLATFORM_DISPLAY_ORDER)


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _value(value, unknown):
    if not _number(value):
        return unknown
    text = format(Decimal(str(value)), ',f')
    return text.rstrip('0').rstrip('.') if '.' in text else text


def _quantity(value, asset, zh, unknown):
    text = _value(value, unknown)
    unit = {'stock': ('股', ' shares'), 'equity': ('股', ' shares'), 'etf': ('股', ' shares'),
            'option': ('张', ' contracts'), 'future': ('张', ' contracts'),
            'bond': ('张', ' bonds')}.get(str(asset or '').lower(), ('', ''))[0 if zh else 1]
    return text + (unit if text != unknown else '')


def _format_money_amount(value, unknown):
    if isinstance(value, bool):
        return unknown
    try:
        text = str(value).strip() if isinstance(value, str) else str(value)
        amount = Decimal(text)
    except (InvalidOperation, ValueError):
        return unknown
    if not amount.is_finite():
        return unknown
    rounded = amount.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    if rounded == 0:
        rounded = Decimal('0.00')
    return f'{rounded:,f}'


def _money(value, currency, unknown):
    if not _number(value) or not isinstance(currency, str) or not re.fullmatch(r'[A-Z]{3}', currency):
        return unknown
    formatted = _format_money_amount(value, unknown)
    return f'{currency} {formatted}' if formatted != unknown else unknown


def valid_crypto_symbol(value):
    return (isinstance(value, str) and 1 <= len(value) <= 128
            and all(char.isalnum() and not ('a' <= char <= 'z') and char not in '\u115f\u1160\u3164\uffa0'
                    for char in value))


def _symbol(value, unknown, *, asset_type=None):
    if asset_type == 'crypto' and valid_crypto_symbol(value):
        return value
    value = str(value or '').strip()
    limit = 31 if asset_type == 'option' else 19
    return value if re.fullmatch(rf'[A-Za-z0-9][A-Za-z0-9.\-^/]{{0,{limit}}}', value) else unknown


def _account_label(row, bindings, locale, caps=None):
    caps = caps or _platform_capabilities(row.platform_id)
    private_keys = {row.opaque_account_uid, *(binding.get('target_id') for binding, _ in bindings),
                    *(binding.get('account_hint') for binding, _ in bindings)}
    for binding, _ in bindings:
        label = binding.get('account_label')
        if (isinstance(label, str) and len(label) <= 70 and label.isprintable()
                and safe_display_text(label) and label.strip() not in private_keys):
            return label
    account = _account_identity_label(row, locale)
    if account in private_keys:
        return ''
    if broker_account_identity(row.platform_id, account):
        return '' if caps.get('hide_broker_account_identity') else '***' + account[-2:]
    return account


def _order_status(order):
    return str(order.get('status') or '').strip().lower()


def _count_value(count, observed, zh):
    if count is not None:
        return f'{count}笔' if zh else str(count)
    if observed:
        return f'已见 {observed} 笔，总数未知' if zh else f'{observed} observed, total unknown'
    return '未知' if zh else 'unknown'


def _snapshot_label(stamp, window, zh):
    if stamp < window.start:
        prefix = '较早快照 ' if zh else 'Earlier snapshot '
    else:
        prefix = '快照 ' if zh else 'Snapshot '
    return prefix + stamp.astimezone(SGT).strftime('%Y-%m-%d %H:%M UTC+8')


def render_account_daily(payload, expected, outcomes, *, facts=None, known_platforms=(), max_units=3850,
                         telegram_ibkr_accounts=None):
    """Render supplied raw binding outcomes and optional per-account evidence.

    ``facts`` is keyed by (platform_id, opaque_account_uid). Order and fill IDs
    are never displayed; they are not needed to describe the supplied records.
    """
    if max_units < 256:
        raise ValueError('digest_budget_too_small')
    locale = normalize_locale(payload.locale)
    zh = locale == 'zh'
    unknown = '未知' if zh else 'unknown'
    window = sgt_business_window(datetime.combine(date.fromisoformat(payload.business_day), time(6), SGT))
    facts = facts or {}
    telegram_ibkr_accounts = telegram_ibkr_accounts or {}
    groups = {}
    indexed = sorted(enumerate(expected), key=lambda item: _platform_display_rank(item[1].get('platform_id'), known_platforms))
    for i, binding in indexed:
        key = (binding.get('platform_id', ''), binding.get('opaque_account_uid', ''))
        group = groups.setdefault(key, {'bindings': [], 'rows': []})
        group['bindings'].append((binding, outcomes[i] if i < len(outcomes) else 'missing'))
    for row in payload.runs:
        key = (row.platform_id, row.opaque_account_uid)
        if key in groups and any(row.target_id == b.get('target_id') and row.strategy_profile == b.get('strategy_profile')
                                 for b, _ in groups[key]['bindings']):
            groups[key]['rows'].append(row)

    representatives = []
    for (platform, uid), group in groups.items():
        if group['rows']:
            representatives.append(group['rows'][0])
        else:
            binding = group['bindings'][0][0]
            representatives.append(SimpleNamespace(platform_id=platform, opaque_account_uid=uid,
                target_id=binding.get('target_id', ''), strategy_profile=binding.get('strategy_profile', ''),
                account_label=binding.get('account_label', ''), account_alias=binding.get('account_alias', ''),
                account_hint=binding.get('account_hint', ''), account_scope=binding.get('account_scope', ''),
                execution_mode=binding.get('execution_mode', '')))
    caps_list = [_platform_capabilities(row.platform_id, known_platforms) for row in representatives]
    account_labels = [_account_label(row, group['bindings'], locale, caps)
                      for row, group, caps in zip(representatives, groups.values(), caps_list, strict=True)]
    account_labels = [
        ('账户' if zh else 'Account')
        if caps.get('replace_platform_named_label') and label.casefold() == row.platform_id.casefold() else label
        for row, label, caps in zip(representatives, account_labels, caps_list, strict=True)
    ]
    contexts = _run_display_contexts(representatives, locale, account_labels=account_labels)
    all_idle = bool(groups)
    summary_counts = {key: 0 for key in ('traded', 'pending', 'quiet', 'standby', 'snapshot', 'unconfirmed')}
    blocks = []
    outcome_text = {
        'missing': ('报告缺失', 'Report missing'),
        'stale': ('报告过期', 'Report stale'),
        'not_run': ('未运行', 'Not run'),
        'scheduled_idle': ('当日无排班，待机', 'Not scheduled today; standing by'),
        'market_closed': ('休市待机', 'Market closed; standing by'),
        'read_failed': ('报告读取失败', 'Report read failed'),
        'invalid': ('报告无效', 'Report invalid'),
    }
    for ((platform, uid), group), (platform_label, account, _), caps in zip(
            groups.items(), contexts, caps_list, strict=True):
        if caps.get('supports_telegram_account_id'):
            account = telegram_ibkr_accounts.get(uid, account)
        rows, bindings = group['rows'], group['bindings']
        actual_rows = [row for row in rows if row.execution_mode.strip().lower() not in SIMULATION_MODES]
        has_simulation = len(actual_rows) != len(rows)
        rows = actual_rows
        strategies = []
        for binding, _ in bindings:
            fallback = '未命名策略' if zh else 'Unnamed strategy'
            name = safe_display_text(display_name('strategies', binding.get('strategy_profile', ''), locale, fallback=fallback)) or fallback
            if name not in strategies:
                strategies.append(name)
        snapshot_only = all(outcome == 'snapshot_only' for _, outcome in bindings)
        strategy_label = ' / '.join(strategies)
        if snapshot_only:
            strategy_label = '账户快照' if zh else 'Account snapshot'
        header = '🏦 ' + ' · '.join((platform_label, account, strategy_label))
        details = []
        for binding, outcome in bindings:
            if outcome not in {'present', 'snapshot_only'} and not (
                    outcome in {'not_run', 'scheduled_idle', 'market_closed'} and len(bindings) == 1):
                fallback = '未命名策略' if zh else 'Unnamed strategy'
                strategy = safe_display_text(display_name('strategies', binding.get('strategy_profile', ''), locale, fallback=fallback)) or fallback
                text = outcome_text.get(outcome, ('状态未知', 'Status unknown'))[0 if zh else 1]
                details.append(f'{strategy}：{text}' if zh else f'{strategy}: {text}')
        account_fact = facts.get((platform, uid)) or {}
        unknown_fill_window = account_fact.get('fills_window_unknown') is True
        mixed_fill_window = account_fact.get('fills_window_mixed') is True
        legacy_fill_window_unreliable = unknown_fill_window or mixed_fill_window
        all_present = all(outcome == 'present' for _, outcome in bindings)
        receipt_candidates = any(binding.get('receipt_candidate') for binding, _ in bindings)
        bound_rows = all(any(r.target_id == b.get('target_id') and r.strategy_profile == b.get('strategy_profile') for r in rows)
                         for b, _ in bindings)
        verified_idle_rows = (not receipt_candidates and all_present and bound_rows and bool(rows) and not legacy_fill_window_unreliable
                              and not account_fact.get('additional_fills')
                              and all(_verified_no_trade(row) for row in rows))
        counts = {}
        count_lines = []
        for name, label in (('order', '提交订单' if zh else 'Orders submitted'), ('fill', '成交回报' if zh else 'Fill reports')):
            plural = name + 's'
            records = account_fact.get(plural) or []
            if account_fact.get(plural + '_complete') is True:
                count = len(records)
            elif verified_idle_rows and not records:
                count = 0
            elif (not receipt_candidates and all_present and bound_rows and len(rows) == 1 and _known_count(rows[0], name)
                  and getattr(rows[0], name + '_count') >= len(records)
                  and not (name == 'fill' and (legacy_fill_window_unreliable or account_fact.get('additional_fills') is True))):
                count = getattr(rows[0], name + '_count')
            else:
                count = None
            counts[name] = count
            observed = len(records)
            if count is None and not (name == 'fill' and legacy_fill_window_unreliable):
                # Counts from different runs may cover the same broker records.
                observed = max([observed, *(getattr(row, name + '_count') for row in rows if _known_count(row, name))])
            value = _count_value(count, observed, zh)
            count_lines.append(f'{label} {value}' if zh else f'{label}: {value}')
        quiet = sum(_verified_no_trade(row) for row in rows) if receipt_candidates else 0
        blocked = [row for row in rows if _execution_blocked(row)]
        for row in blocked:
            reason = (render_reasons(row.approved_gate_reasons, locale) if row.approved_gate_reasons
                      else block_reason_text(row, locale))
            reason = reason or ('执行已拦截' if zh else 'Execution blocked')
            if reason not in details:
                details.append(reason)
        execution_issue = any(row.status == 'alert' and row not in blocked and not row.approved_gate_reasons
                              and not _execution_unconfirmed(row) for row in rows)
        if execution_issue:
            details.append('执行异常' if zh else 'Execution issue')
        unconfirmed = [row for row in rows if _execution_unconfirmed(row)]
        order_states = {'order_submitted', 'submitted', 'broker_acknowledged', 'partially_filled'}
        def has_order_evidence(row):
            return (row.execution_status.strip().lower() in order_states
                    or (_known_count(row, 'order') and row.order_count > 0))

        unconfirmed_runs = any(not has_order_evidence(row) for row in unconfirmed)
        unconfirmed_orders = any(has_order_evidence(row) for row in unconfirmed)
        details.extend(dict.fromkeys(
            _evidence_attention_text(row, locale) for row in rows
            if row.evidence_persistence_status == 'persistence_failed' or row.evidence_delivery_status == 'delivery_failed'
        ))

        def strategy_for(record):
            value = record.get('strategy')
            fallback = '策略未知' if zh else 'strategy unknown'
            return safe_display_text(display_name('strategies', value, locale, fallback=fallback)) if value else fallback

        for order in account_fact.get('orders') or []:
            if not isinstance(order, dict):
                continue
            status = _order_status(order)
            statuses = {'open': ('未完成', 'open'), 'cancelled': ('已取消', 'cancelled'),
                        'canceled': ('已取消', 'cancelled'), 'rejected': ('已拒绝', 'rejected'),
                        'expired': ('已过期', 'expired'), 'filled': ('已成交', 'filled'),
                        'partially_filled': ('部分成交', 'partially filled'), 'pending': ('待确认', 'pending'),
                        'submitted': ('已提交', 'submitted')}
            status = statuses.get(status, (unknown, unknown))[0 if zh else 1]
            side = {'buy': ('买入', 'buy'), 'sell': ('卖出', 'sell')}.get(str(order.get('side') or '').lower(), (unknown, unknown))[0 if zh else 1]
            line = f"{'委托' if zh else 'Order'}: {side} {_symbol(order.get('symbol'), unknown)} {_quantity(order.get('quantity'), order.get('asset_type'), zh, unknown)} · {status}"
            for field, label in (('filled_quantity', '累计成交' if zh else 'filled to date'),
                                 ('remaining_quantity', '剩余' if zh else 'remaining')):
                if field in order:
                    line += f" · {label} {_quantity(order[field], order.get('asset_type'), zh, unknown)}"
            if order.get('price') is not None:
                line += f" · {_money(order['price'], order.get('currency'), unknown)}"
            if order.get('average_fill_price') is not None:
                price = _money(order['average_fill_price'], order.get('currency'), unknown)
                if price == unknown:
                    price = _value(order['average_fill_price'], unknown) + ('（币种未知）' if zh else ' (currency unknown)')
                line += (' · 成交均价 ' if zh else ' · average fill price ') + price
            details.append(line + ' · ' + strategy_for(order))
        for fill in account_fact.get('fills') or []:
            if not isinstance(fill, dict):
                continue
            side = {'buy': ('买入', 'buy'), 'sell': ('卖出', 'sell')}.get(str(fill.get('side') or '').lower(), (unknown, unknown))[0 if zh else 1]
            details.append(f"{side} {_symbol(fill.get('symbol'), unknown)} {_quantity(fill.get('quantity'), fill.get('asset_type'), zh, unknown)} @ {_money(fill.get('price'), fill.get('currency'), unknown)} · {strategy_for(fill)}")
        snapshots = []
        for item in account_fact.get('snapshots') or []:
            if not isinstance(item, dict):
                continue
            try:
                stamp = datetime.fromisoformat(str(item.get('as_of') or '').replace('Z', '+00:00'))
                if stamp.tzinfo is not None and stamp <= window.end:
                    snapshots.append((stamp, item))
            except ValueError:
                pass
        complete, holdings, equity = False, [], unknown
        no_stocks = False
        stamp_label, holding_stamp_label = '', ''
        if snapshots:
            snapshots.sort(key=lambda pair: pair[0], reverse=True)
            asset_stamp = None
            for stamp, snapshot in snapshots:
                equity = _money(snapshot.get('equity'), snapshot.get('equity_currency'), unknown)
                if equity != unknown:
                    asset_stamp = stamp
                    stamp_label = _snapshot_label(stamp, window, zh)
                    break
            for stamp, snapshot in snapshots:
                holdings = snapshot.get('holdings') or []
                complete = snapshot.get('holdings_complete') is True
                no_stocks = caps.get('supports_no_stocks_flag') and snapshot.get('no_stocks') is True
                if holdings or complete or no_stocks:
                    if stamp != asset_stamp:
                        holding_stamp_label = _snapshot_label(stamp, window, zh)
                    break
        else:
            observations = {(row.equity, row.equity_currency, row.holdings, row.holdings_scope)
                            for row in rows if row.equity is not None or row.holdings}
            if len(observations) == 1:
                observed_equity, currency, observed_holdings, scope = next(iter(observations))
                observed = _money(observed_equity, currency, unknown)
                if observed != unknown:
                    stamp_label = (f'来源报告 {observed}，快照时间未知' if zh else
                                   f'Source reported {observed}, snapshot time unknown')
                elif observed_holdings:
                    stamp_label = '持仓快照时间未知' if zh else 'Holding snapshot time unknown'
                holdings = [{'symbol': h.symbol, 'quantity': h.quantity,
                             'asset_type': 'stock' if scope == 'stocks_only' else None} for h in observed_holdings]
        asset_line = ('💰 总资产：' if zh else '💰 Total assets: ') + equity
        if stamp_label:
            asset_line += ' · ' + stamp_label
        wallet = account_fact.get('wallet_valuation') if caps.get('supports_wallet_valuation') else None
        if wallet:
            currency = str(wallet.get('currency') or 'USDT')
            formatted_wallet = _format_money_amount(wallet.get('amount'), unknown)
            amount = f'{currency} {formatted_wallet}' if formatted_wallet != unknown else unknown
            stamp = _snapshot_label(datetime.fromisoformat(wallet['as_of']), window, zh)
            label = '💰 钱包估值（券商返回范围）：' if zh else '💰 Wallet valuation (provider-reported scope): '
            asset_line = label + amount + ' · ' + stamp
        cash_lines = []
        if caps.get('supports_settled_cash') or account_fact.get('settled_cash'):
            cash = account_fact.get('settled_cash')
            value = unknown
            if cash:
                date_label = 'Flex 结单' if zh else 'Flex statement'
                cash_currency = str(cash.get('currency') or 'USD')
                formatted_cash = _format_money_amount(cash.get('amount'), unknown)
                value = (
                    f"{cash_currency} {formatted_cash} · {date_label} {cash['statement_date']}"
                    if formatted_cash != unknown else unknown
                )
            cash_lines.append(('期末已结算现金：' if zh else 'Period-end settled cash: ') + value)
        holding_label = '📦 持仓：' if zh else '📦 Holdings: '
        if not holdings:
            if complete:
                holding_label += '空仓' if zh else 'No holdings'
            elif no_stocks:
                holding_label += '已核实无股票持仓；其他资产未知' if zh else 'No stock positions verified; other assets unknown'
            else:
                holding_label += unknown
        elif not complete:
            holding_label += '仅列已核实持仓' if zh else 'Verified positions only'
        if holding_stamp_label:
            holding_label += (' · ' if not holdings or not complete else '') + holding_stamp_label
        elif holdings and complete and not zh:
            holding_label = '📦 Holdings:'
        raw_holding_lines = []
        is_crypto_only = bool(holdings)
        for holding in holdings:
            symbol, asset = holding.get('symbol'), holding.get('asset_type')
            # Older LongBridge snapshots tagged every position returned by the
            # stock-positions endpoint as stock, including US option contracts.
            if (caps.get('normalize_stock_option_symbol') and asset == 'stock'
                    and isinstance(symbol, str) and re.fullmatch(r'[A-Z0-9]{1,6}[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[CP][0-9]{4,8}\.US', symbol)):
                asset = 'option'
            if str(asset or '').lower() != 'crypto':
                is_crypto_only = False
            raw_holding_lines.append(
                f"{_symbol(symbol, unknown, asset_type=asset)} "
                f"{_quantity(holding.get('quantity'), asset, zh, unknown)}"
            )
        holding_lines = []
        if is_crypto_only and len(raw_holding_lines) > 6:
            for index in range(0, len(raw_holding_lines), 2):
                pair = raw_holding_lines[index:index + 2]
                holding_lines.append((' · '.join(pair), len(pair)))
        else:
            holding_lines = [(line, 1) for line in raw_holding_lines]
        # Every binding must have a matching run, not merely an outcome marker.
        orders, fills = account_fact.get('orders') or [], account_fact.get('fills') or []
        filled_order_ids = {fill['order_id'] for fill in fills if fill.get('order_id')}
        filled_order_count = None
        if counts['fill'] == 0:
            filled_order_count = 0
        elif account_fact.get('fills_complete') is True and all(fill.get('order_id') for fill in fills):
            filled_order_count = len(filled_order_ids)
        count_lines.append(('成交订单 ' if zh else 'Orders with fills: ') + _count_value(
            filled_order_count, len(filled_order_ids), zh))
        if counts['order'] is not None and counts['order'] > len(orders):
            details.append('部分委托明细未取得' if zh else 'Some order details are unavailable')
        if counts['fill'] is not None and counts['fill'] > len(fills):
            details.append('部分成交明细未取得' if zh else 'Some fill details are unavailable')
        account_idle = verified_idle_rows and not orders and not fills
        full_scope = all(account_fact.get(name + '_complete') is True for name in ('orders', 'fills'))
        all_idle = all_idle and account_idle and full_scope
        filled = bool(fills) or (not legacy_fill_window_unreliable
                                 and any(_known_count(row, 'fill') and row.fill_count > 0 for row in rows))
        pending = bool(orders) or any(_known_count(row, 'order') and row.order_count > 0 for row in rows)
        partial = any(_order_status(o) == 'partially_filled' or
                      (_number(o.get('filled_quantity')) and _number(o.get('quantity'))
                       and 0 < o['filled_quantity'] < o['quantity']) for o in orders)
        terminal = (bool(orders) and counts['order'] == len(orders)
                    and all(_order_status(o) in {'cancelled', 'canceled', 'rejected', 'expired'} for o in orders))
        if unknown_fill_window:
            details.append('结算含已确认成交，发生时段未核实' if zh else
                           'Settlement confirms fills; reporting window unverified')
        if mixed_fill_window:
            details.append('委托累计成交跨统计窗口；本期仅列实际发生的成交' if zh else
                           'Order fills span reporting windows; only fills in this window are listed')
        simulation_in_state = False
        uncertain_run_in_state = False
        uncertain_order_in_state = False
        if partial and filled and not legacy_fill_window_unreliable:
            state = '✅ 部分成交' if zh else '✅ Partially filled'
        elif filled:
            state = '✅ 有交易' if zh else '✅ Trades recorded'
        elif terminal:
            state = '委托已结束，详见状态' if zh else 'Orders closed; statuses below'
        elif pending:
            if unconfirmed_orders:
                uncertain_order_in_state = True
                state = '⏳ 已提交，订单最终状态待确认' if zh else '⏳ Submitted, final order status unconfirmed'
            else:
                state = '⏳ 已提交，成交待确认' if zh else '⏳ Submitted, fills unconfirmed'
        elif account_idle:
            state = '😴 无交易' if zh else '😴 No trades'
        elif receipt_candidates and rows:
            uncertain_run_in_state = True
            configured_runs = [
                binding.get('expected_runs')
                for binding, _ in bindings
                if type(binding.get('expected_runs')) is int and binding.get('expected_runs') > 0
            ]
            expected_total = max([len(rows), *configured_runs])
            state = (f'已核实 {quiet}/{expected_total} 轮无交易，全天交易未确认' if zh else
                     f'{quiet} of {expected_total} runs verified without trades. Daily activity unconfirmed.')
        elif blocked:
            state = '策略触发风控，全天交易未确认' if zh else 'Strategy runs blocked. Daily activity unconfirmed.'
        elif has_simulation and (unconfirmed_runs or not rows):
            simulation_in_state = True
            uncertain_run_in_state = True
            state = '实盘交易未确认（模拟记录已排除）' if zh else 'Live activity unconfirmed (simulated runs excluded)'
        elif unconfirmed_runs:
            uncertain_run_in_state = True
            state = '未能确认策略执行结果' if zh else 'Strategy execution unconfirmed'
        elif snapshot_only:
            state = '仅核实持仓快照，交易情况未知' if zh else 'Holdings snapshot verified, trading activity unknown'
            if equity != unknown or wallet:
                state = '仅核实账户快照，交易情况未知' if zh else 'Account snapshot verified, trading activity unknown'
        elif all(outcome == 'market_closed' for _, outcome in bindings):
            state = '⏸️ 休市待机' if zh else '⏸️ Market closed; standing by'
        elif all(outcome in {'scheduled_idle', 'market_closed'} for _, outcome in bindings):
            state = '⏸️ 当日无排班，待机' if zh else '⏸️ Not scheduled today; standing by'
        elif caps.get('snapshot_standby_when_not_run') and snapshots and all(outcome == 'not_run' for _, outcome in bindings):
            state = '仅核实持仓快照，交易情况未知' if zh else 'Holdings snapshot verified, trading activity unknown'
            if equity != unknown or wallet:
                state = '仅核实账户快照，交易情况未知' if zh else 'Account snapshot verified, trading activity unknown'
        elif all(outcome == 'not_run' for _, outcome in bindings):
            state = '策略未运行，账户交易未知' if zh else 'Strategy did not run; account trades unknown'
        else:
            state = '全天交易未确认' if zh else 'Daily activity unconfirmed'
        if unconfirmed_runs and not uncertain_run_in_state:
            details.append('有策略轮次执行结果未确认' if zh else 'Some strategy runs remain unconfirmed')
        if unconfirmed_orders and not uncertain_order_in_state:
            details.append('有订单的最终状态待确认' if zh else 'Some final order statuses are unconfirmed')
        if has_simulation and not simulation_in_state:
            details.append('模拟记录已排除' if zh else 'Simulated runs excluded')
        if not full_scope and any(count is not None for count in counts.values()):
            state += '（已核验策略范围）' if zh else ' (verified strategy scope)'
        all_counts_unknown = (
            all(c is None for c in (counts['order'], counts['fill'], filled_order_count))
            and not orders
            and not fills
            and not any((_known_count(r, 'order') and r.order_count > 0) or (_known_count(r, 'fill') and r.fill_count > 0) for r in rows)
        )
        standby_outcomes = all(outcome in {'scheduled_idle', 'market_closed', 'not_run', 'snapshot_only'} for _, outcome in bindings)
        clean_execution = not blocked and not execution_issue and not has_simulation and not unconfirmed_runs and not unconfirmed_orders
        if filled:
            summary_counts['traded'] += 1
        elif terminal or pending:
            summary_counts['pending'] += 1
        elif account_idle:
            summary_counts['quiet'] += 1
        elif all(outcome in {'scheduled_idle', 'market_closed'} for _, outcome in bindings) and clean_execution and not receipt_candidates:
            summary_counts['standby'] += 1
        elif (snapshot_only or (caps.get('snapshot_standby_when_not_run') and snapshots
                                and all(outcome == 'not_run' for _, outcome in bindings))) and clean_execution:
            summary_counts['snapshot'] += 1
        else:
            summary_counts['unconfirmed'] += 1
        show_counts = not (all_counts_unknown and clean_execution and ((receipt_candidates and bool(rows)) or snapshot_only or standby_outcomes))
        core_lines = [state]
        if show_counts:
            core_lines.append(('｜' if zh else ' | ').join(count_lines))
        core_lines.extend((asset_line, *cash_lines, holding_label))
        blocks.append((header, core_lines, [(d, 1) for d in details], holding_lines))
    lines = [('📊 昨日账户日报｜' if zh else '📊 Daily account report | ') + payload.business_day,
             '🕒 ' + _window_text(payload.business_day, locale)]
    if all_idle:
        lines.append('😴 全部已核验账户无交易（限已核验范围）' if zh else '😴 No trades in all verified accounts (within verified scope)')
    elif len(groups) >= 2:
        summary_labels = (
            ('traded', '有交易', 'traded'),
            ('pending', '委托待确认', 'pending'),
            ('quiet', '无交易', 'no trades'),
            ('standby', '待机', 'standing by'),
            ('snapshot', '仅快照', 'snapshot only'),
            ('unconfirmed', '待核实', 'unconfirmed'),
        )
        summary_parts = [f'{len(blocks)} 账户' if zh else f'{len(blocks)} accounts']
        for key, zh_label, en_label in summary_labels:
            if summary_counts[key]:
                summary_parts.append(f"{summary_counts[key]} {zh_label if zh else en_label}")
        summary_sep = '｜' if zh else ' | '
        summary_prefix = '📋 总览：' if zh else '📋 Summary: '
        lines.append(summary_prefix + summary_sep.join(summary_parts))
    if not groups:
        lines.append('已绑定账户未知' if zh else 'Bound accounts unknown')
    bound_platforms = {platform for platform, _ in groups}
    if isinstance(known_platforms, Mapping):
        candidate_platforms = [
            platform for platform, meta in known_platforms.items()
            if platform != 'qrs' and platform not in bound_platforms and not _platform_hidden_unbound(meta)
        ]
    else:
        candidate_platforms = [
            platform for platform in known_platforms
            if platform != 'qrs' and platform not in bound_platforms
        ]
    unbound = [display_name('platforms', platform, locale) for platform in candidate_platforms]
    if unbound:
        lines.append(('未接入日报来源：' + '、'.join(unbound)) if zh else
                     ('Platforms without a digest source: ' + ', '.join(unbound)))
    # Reserve space for each fitting account header before adding details.
    def suffix(n):
        return (f'另有 {n} 项省略（持仓展示 {n} 项、省略 {n} 项）' if zh else
                f'{n} items omitted (holdings: {n} shown, {n} omitted)')
    reserved, omitted, omitted_holdings = [], 0, 0
    total_holding_items = sum(item_count for _, _, _, h_items in blocks for _, item_count in h_items)
    upper_bound = sum(1 + len(core) + len(details) + sum(c for _, c in h_items) for _, core, details, h_items in blocks)
    for header, core, details, holdings in blocks:
        prior = [line for h, c, _, _ in reserved for line in ['', h, *c]]
        if _units('\n'.join(lines + prior + ['', header, *core, suffix(upper_bound)])) <= max_units:
            reserved.append((header, core, details, holdings))
        else:
            omitted += 1 + len(core) + len(details) + len(holdings)
            omitted_holdings += sum(c for _, c in holdings)
    for index, (header, core, details, holdings) in enumerate(reserved):
        head_count = 2 if len(core) >= 2 else len(core)
        lines.extend(('', header, *core[:head_count]))
        later = [line for h, c, _, _ in reserved[index + 1:] for line in ['', h, *c]]
        for group, is_holding in ((details, False), (holdings, True)):
            if is_holding:
                lines.extend(core[head_count:])
            for detail, item_count in group:
                remaining_core = [] if is_holding else core[head_count:]
                if _units('\n'.join(lines + [detail] + remaining_core + later + [suffix(upper_bound)])) <= max_units:
                    lines.append(detail)
                else:
                    omitted += 1
                    omitted_holdings += item_count if is_holding else 0
    if omitted:
        shown = total_holding_items - omitted_holdings
        ending = (f'（持仓展示 {shown} 项、省略 {omitted_holdings} 项）' if zh else
                  f' (holdings: {shown} shown, {omitted_holdings} omitted)') if omitted_holdings else ''
        lines.append((f'另有 {omitted} 项省略' if zh else f'{omitted} items omitted') + ending)
    return '\n'.join(lines)


def render_account_daily_unavailable(day, locale):
    zh = normalize_locale(locale) == 'zh'
    title = ('📊 昨日账户日报｜' if zh else '📊 Daily account report | ') + day
    detail = '交易、资产和持仓无法确认' if zh else 'Trades, assets and holdings could not be confirmed'
    return '\n'.join((title, '🕒 ' + _window_text(day, 'zh' if zh else 'en'), detail))

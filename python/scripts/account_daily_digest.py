"""Render a single, account-oriented daily digest from supplied observations."""
from __future__ import annotations

import math
import re
from datetime import date, datetime, time
from decimal import Decimal
from types import SimpleNamespace

from notification_snapshot.unified_contract import SGT, sgt_business_window
from account_daily_facts import SIMULATION_MODES
from daily_digest_notify import normalize_locale
from display_names import broker_account_identity, display_name, safe_display_text
from unified_daily_digest import (_execution_blocked, _execution_unconfirmed, _known_count,
                                  _run_display_contexts, _units, _verified_no_trade, _window_text)


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


def _money(value, currency, unknown):
    if not _number(value) or not isinstance(currency, str) or not re.fullmatch(r'[A-Z]{3}', currency):
        return unknown
    text = _value(value, unknown)
    if '.' not in text:
        text += '.00'
    elif len(text.rsplit('.', 1)[1]) == 1:
        text += '0'
    return f'{currency} {text}'


def _symbol(value, unknown):
    value = str(value or '').strip()
    return value if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.\-^/]{0,19}', value) else unknown


def render_account_daily(payload, expected, outcomes, *, facts=None, max_units=3850):
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
    groups = {}
    for i, binding in enumerate(expected):
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
    contexts = _run_display_contexts(representatives, locale, runtime_accounts=True)
    all_idle = bool(groups)
    blocks = []
    outcome_text = {
        'missing': ('报告缺失', 'Report missing'), 'stale': ('报告过期', 'Report stale'),
        'not_run': ('未运行', 'Not run'), 'read_failed': ('报告读取失败', 'Report read failed'),
        'invalid': ('报告无效', 'Report invalid'),
    }
    for ((platform, uid), group), (platform_label, account, _) in zip(groups.items(), contexts):
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
        explicit_label = next((b['account_label'] for b, _ in bindings if safe_display_text(b.get('account_label'))), '')
        if explicit_label and explicit_label not in {uid, *(b.get('account_hint') for b, _ in bindings),
                                                       *(b.get('target_id') for b, _ in bindings)}:
            account = explicit_label
        elif account in {uid, *(b.get('target_id') for b, _ in bindings)}:
            account = '账户' if zh else 'Account'
        elif broker_account_identity(platform, account):
            account = ('账户' if zh else 'Account') if platform in {'binance', 'longbridge'} else '***' + account[-2:]
        header = '🏦 ' + ' · '.join((platform_label, account, ' / '.join(strategies)))
        details = []
        for binding, outcome in bindings:
            if outcome != 'present' and not (outcome == 'not_run' and len(bindings) == 1):
                fallback = '未命名策略' if zh else 'Unnamed strategy'
                strategy = safe_display_text(display_name('strategies', binding.get('strategy_profile', ''), locale, fallback=fallback)) or fallback
                text = outcome_text.get(outcome, ('状态未知', 'Status unknown'))[0 if zh else 1]
                details.append(f'{strategy}：{text}' if zh else f'{strategy}: {text}')
        if has_simulation:
            details.append('模拟记录未计入实际交易' if zh else 'Simulated records excluded from actual trades')
        account_fact = facts.get((platform, uid)) or {}
        unknown_fill_window = account_fact.get('fills_window_unknown') is True
        mixed_fill_window = account_fact.get('fills_window_mixed') is True
        legacy_fill_window_unreliable = unknown_fill_window or mixed_fill_window
        all_present = all(outcome == 'present' for _, outcome in bindings)
        bound_rows = all(any(r.target_id == b.get('target_id') and r.strategy_profile == b.get('strategy_profile') for r in rows)
                         for b, _ in bindings)
        verified_idle_rows = (all_present and bound_rows and bool(rows) and not legacy_fill_window_unreliable
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
            elif (all_present and bound_rows and len(rows) == 1 and _known_count(rows[0], name)
                  and getattr(rows[0], name + '_count') >= len(records)
                  and not (name == 'fill' and (legacy_fill_window_unreliable or account_fact.get('additional_fills') is True))):
                count = getattr(rows[0], name + '_count')
            else:
                count = None
            counts[name] = count
            if count is None:
                value = (f'已见 {len(records)} 笔，总数未知' if zh else f'{len(records)} observed, total unknown') if records else unknown
            else:
                value = f'{count}笔' if zh else str(count)
            count_lines.append(f'{label} {value}' if zh else f'{label}: {value}')
        if any(_execution_blocked(row) for row in rows):
            details.append('执行已拦截' if zh else 'Execution blocked')
        if any(row.status == 'alert' for row in rows):
            details.append('执行异常' if zh else 'Execution issue')
        if any(_execution_unconfirmed(row) for row in rows):
            details.append('订单最终状态待确认' if zh else 'Final order state unconfirmed')
        def strategy_for(record):
            value = record.get('strategy')
            fallback = '策略未知' if zh else 'strategy unknown'
            return safe_display_text(display_name('strategies', value, locale, fallback=fallback)) if value else fallback

        for order in account_fact.get('orders') or []:
            if not isinstance(order, dict):
                continue
            status = str(order.get('status') or '').lower()
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
        complete, holdings, equity, stamp_label = False, [], unknown, ''
        if snapshots:
            stamp, snapshot = max(snapshots, key=lambda pair: pair[0])
            stamp_label = ('较早快照 ' if zh else 'Earlier snapshot ') if stamp < window.start else ('快照 ' if zh else 'Snapshot ')
            stamp_label += stamp.astimezone(SGT).strftime('%Y-%m-%d %H:%M UTC+8')
            equity = _money(snapshot.get('equity'), snapshot.get('equity_currency'), unknown)
            holdings = snapshot.get('holdings') or []
            complete = snapshot.get('holdings_complete') is True
        else:
            observations = {(row.equity, row.equity_currency, row.holdings, row.holdings_scope)
                            for row in rows if row.equity is not None or row.holdings}
            if len(observations) == 1:
                observed_equity, currency, observed_holdings, scope = next(iter(observations))
                observed = _money(observed_equity, currency, unknown)
                if observed != unknown:
                    stamp_label = f'已报告资产 {observed}，快照时间未知' if zh else f'Reported assets {observed}, snapshot time unknown'
                elif observed_holdings:
                    stamp_label = '持仓快照时间未知' if zh else 'Holding snapshot time unknown'
                holdings = [{'symbol': h.symbol, 'quantity': h.quantity,
                             'asset_type': 'stock' if scope == 'stocks_only' else None} for h in observed_holdings]
        asset_line = ('💰 总资产：' if zh else '💰 Total assets: ') + equity
        if stamp_label:
            asset_line += ' · ' + stamp_label
        holding_label = '📦 持仓：' if zh else '📦 Holdings: '
        if not holdings:
            holding_label += ('空仓' if zh else 'No holdings') if complete else unknown
        elif not complete:
            holding_label += '仅列已核实持仓' if zh else 'Verified positions only'
        holding_lines = [
            f"{_symbol(h.get('symbol'), unknown)} {_quantity(h.get('quantity'), h.get('asset_type'), zh, unknown)}"
            for h in holdings
        ]
        # Every binding must have a matching run, not merely an outcome marker.
        orders, fills = account_fact.get('orders') or [], account_fact.get('fills') or []
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
        partial = any(o.get('status') == 'partially_filled' or
                      (_number(o.get('filled_quantity')) and _number(o.get('quantity'))
                       and 0 < o['filled_quantity'] < o['quantity']) for o in orders)
        terminal = orders and all(o.get('status') in {'cancelled', 'canceled', 'rejected', 'expired'} for o in orders)
        if unknown_fill_window:
            details.append('结算含已确认成交，发生时段未核实' if zh else
                           'Settlement confirms fills; reporting window unverified')
        if mixed_fill_window:
            details.append('委托累计成交跨统计窗口；本期仅列实际发生的成交' if zh else
                           'Order fills span reporting windows; only fills in this window are listed')
        if partial and not legacy_fill_window_unreliable:
            state = '✅ 部分成交' if zh else '✅ Partially filled'
        elif filled:
            state = '✅ 有交易' if zh else '✅ Trades recorded'
        elif terminal:
            state = '委托已结束，详见状态' if zh else 'Orders closed; statuses below'
        elif pending:
            state = '⏳ 已提交，成交待确认' if zh else '⏳ Submitted, fills unconfirmed'
        elif account_idle:
            state = '😴 无交易' if zh else '😴 No trades'
        elif all(outcome == 'not_run' for _, outcome in bindings):
            state = '策略未运行，账户交易未知' if zh else 'Strategy did not run; account trades unknown'
        else:
            state = '⚠️ 昨日交易情况未确认' if zh else '⚠️ Trading activity unconfirmed'
        if not full_scope and any(count is not None for count in counts.values()):
            state += '（已核验策略范围）' if zh else ' (verified strategy scope)'
        blocks.append((header, [state, ('｜' if zh else ' | ').join(count_lines), asset_line, holding_label],
                       details, holding_lines))
    lines = [('📊 昨日账户日报｜' if zh else '📊 Daily account report | ') + payload.business_day,
             '🕒 ' + _window_text(payload.business_day, locale)]
    if all_idle:
        lines.append('😴 全部已核验账户无交易（限已核验范围）' if zh else '😴 No trades in all verified accounts (within verified scope)')
    if not groups:
        lines.append('已绑定账户未知' if zh else 'Bound accounts unknown')
    # Reserve space for each fitting account header before adding details.
    def suffix(n):
        return (f'另有 {n} 项省略（持仓展示 {n} 项、省略 {n} 项）' if zh else
                f'{n} items omitted (holdings: {n} shown, {n} omitted)')
    reserved, omitted, omitted_holdings = [], 0, 0
    upper_bound = sum(1 + len(core) + len(details) + len(holdings) for _, core, details, holdings in blocks)
    for header, core, details, holdings in blocks:
        prior = [line for h, c, _, _ in reserved for line in [h, *c]]
        if _units('\n'.join(lines + prior + [header, *core, suffix(upper_bound)])) <= max_units:
            reserved.append((header, core, details, holdings))
        else:
            omitted += 1 + len(core) + len(details) + len(holdings)
            omitted_holdings += len(holdings)
    for index, (header, core, details, holdings) in enumerate(reserved):
        lines.extend((header, *core[:2]))
        later = [line for h, c, _, _ in reserved[index + 1:] for line in [h, *c]]
        for group, is_holding in ((details, False), (holdings, True)):
            if is_holding:
                lines.extend(core[2:])
            for detail in group:
                remaining_core = [] if is_holding else core[2:]
                if _units('\n'.join(lines + [detail] + remaining_core + later + [suffix(upper_bound)])) <= max_units:
                    lines.append(detail)
                else:
                    omitted += 1
                    omitted_holdings += is_holding
    if omitted:
        shown = sum(len(holdings) for _, _, _, holdings in blocks) - omitted_holdings
        ending = (f'（持仓展示 {shown} 项、省略 {omitted_holdings} 项）' if zh else
                  f' (holdings: {shown} shown, {omitted_holdings} omitted)') if omitted_holdings else ''
        lines.append((f'另有 {omitted} 项省略' if zh else f'{omitted} items omitted') + ending)
    return '\n'.join(lines)


def render_account_daily_unavailable(day, locale):
    zh = normalize_locale(locale) == 'zh'
    title = ('📊 昨日账户日报｜' if zh else '📊 Daily account report | ') + day
    detail = '交易、资产和持仓无法确认' if zh else 'Trades, assets and holdings could not be confirmed'
    return '\n'.join((title, '🕒 ' + _window_text(day, 'zh' if zh else 'en'), detail))

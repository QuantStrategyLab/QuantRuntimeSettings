"""Render one authenticated scheduled report from archived observations."""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import tempfile
import time as clock
import urllib.parse
import urllib.request
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError
from uuid import uuid4
from zoneinfo import ZoneInfo

import daily_digest_aggregator as aggregator
import merge_digest_candidates as candidate_contract
import notification_candidate_adapter as adapter
from account_daily_digest import render_account_daily, render_account_daily_unavailable, valid_crypto_symbol
from account_daily_facts import collect_account_facts
from daily_digest_delivery_store import GCSDeliveryStore, StoreUnavailable, location
from display_names import broker_account_identity, configured_account_label, safe_display_text as _safe_display_text

SGT = ZoneInfo('Asia/Singapore')
IDENTITY = adapter.IDENTITY[:4]
SLOT = re.compile(r'[a-z0-9][a-z0-9_-]{0,40}')
BINANCE_SNAPSHOT_PATH = '/api/internal/binance-account-facts/digest'
IBKR_TELEGRAM_BINDING = ('candidate_slot', 'opaque_account_uid', 'target_id')


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def project_expected_target_label(binding, account_option):
    """Copy display fields from the selected config; never derive identity."""
    result = deepcopy(binding)
    result.pop('account_label', None)
    label = configured_account_label({key: account_option.get(key) for key in ('label', 'key', 'target_name')})
    if label:
        configured = account_option.get('label')
        result['account_label'] = (
            configured if isinstance(configured, str) and len(configured) <= 70
            and configured.isprintable() and _safe_display_text(configured) == label else label
        )
    return result


def _ibkr_telegram_accounts(expected, raw, recipient):
    if not raw or not recipient:
        return {}
    try:
        value = json.loads(raw)
        if value['recipient_id'] != recipient:
            return {}
        eligible = {tuple(row[key] for key in IBKR_TELEGRAM_BINDING)
                    for row in expected if row['platform_id'] == 'ibkr'}
        accounts, owners = {}, {}
        for row in value['accounts']:
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


@dataclass(frozen=True)
class Configuration:
    expected: list
    scheduler_job: str
    recipient_scope: str
    cutover_date: str
    enabled: bool = False
    locale: str = 'zh'
    candidate_uris: dict = field(default_factory=dict)
    binance_snapshot_endpoint: str = ''
    binance_snapshot_token: str = field(default='', repr=False)
    telegram_ibkr_accounts: dict = field(default_factory=dict, repr=False)

    def __post_init__(self):
        adapter.validate_expected(self.expected)
        expected = []
        for row in self.expected:
            if 'account_label' in row:
                value = row['account_label']
                if (not isinstance(value, str) or len(value) > 70
                        or (value and (not value.isprintable() or not _safe_display_text(value)))):
                    raise ValueError('digest_account_label_invalid')
            # Existing config generators can carry the selected option's fields
            # on the binding. Normalize them at the actual environment intake.
            projected = project_expected_target_label(row, row)
            if row.get('account_label'):
                projected['account_label'] = row['account_label']
            expected.append(projected)
        object.__setattr__(self, 'expected', expected)
        platforms = {row['platform_id'] for row in self.expected}
        if not isinstance(self.candidate_uris, dict) or any(
                platform not in platforms for platform in self.candidate_uris):
            raise ValueError('digest_candidate_sources_invalid')
        for uri in self.candidate_uris.values():
            try:
                if not isinstance(uri, str):
                    raise TypeError()
                location(uri)
            except (TypeError, ValueError):
                raise ValueError('digest_candidate_sources_invalid') from None
        identities, objects = set(), set()
        snapshot_bindings = 0
        for row in self.expected:
            if not SLOT.fullmatch(row.get('candidate_slot', '')):
                raise ValueError('digest_candidate_slot_required')
            identity = tuple(row[key] for key in IDENTITY)
            object_key = row['platform_id'], row['candidate_slot']
            if identity in identities or object_key in objects:
                raise ValueError('digest_duplicate_target_binding')
            identities.add(identity)
            objects.add(object_key)
            if 'snapshot_only' in row:
                if row['platform_id'] != 'binance' or row['snapshot_only'] is not True:
                    raise ValueError('digest_snapshot_binding_invalid')
                snapshot_bindings += 1
            if 'receipt_candidate' in row and (
                    row.get('snapshot_only') is not True or row['receipt_candidate'] is not True):
                raise ValueError('digest_receipt_binding_invalid')
        if snapshot_bindings > 1:
            raise ValueError('digest_snapshot_binding_invalid')
        date.fromisoformat(self.cutover_date)
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', self.recipient_scope):
            raise ValueError('digest_recipient_scope_invalid')
        if not re.fullmatch(r'projects/[^/]+/locations/[^/]+/jobs/[^/]+', self.scheduler_job):
            raise ValueError('digest_scheduler_job_required')
        if not isinstance(self.locale, str) or not re.fullmatch(
                r'(?:zh|en)(?:[-_][a-z0-9]{1,8})*', self.locale.strip().lower()):
            raise ValueError('digest_locale_invalid')
        object.__setattr__(self, 'locale', re.split('[-_]', self.locale.strip().lower())[0])

    @classmethod
    def from_environment(cls):
        if os.environ.get('QRS_UNIFIED_NOTIFICATION_ENABLED') != 'true':
            raise ValueError('digest_unified_mode_required')
        flag = os.environ.get('DIGEST_DELIVERY_ENABLED', 'false')
        if flag not in {'true', 'false'}:
            raise ValueError('digest_delivery_flag_invalid')
        try:
            candidate_uris = json.loads(os.environ.get('DIGEST_CANDIDATES_BY_PLATFORM_JSON', '{}'))
        except ValueError:
            raise ValueError('digest_candidate_sources_invalid') from None
        expected = json.loads(os.environ['DIGEST_EXPECTED_TARGETS_JSON'])
        return cls(expected,
                   os.environ['DIGEST_SCHEDULER_JOB_NAME'], os.environ['DIGEST_RECIPIENT_SCOPE'],
                   os.environ['DIGEST_CUTOVER_REPORT_DATE'], flag == 'true',
                   os.environ.get('QSL_NOTIFY_LANG', 'zh'), candidate_uris,
                   os.environ.get('DIGEST_BINANCE_SNAPSHOT_ENDPOINT', ''),
                   os.environ.get('DIGEST_BINANCE_SNAPSHOT_TOKEN', ''),
                   _ibkr_telegram_accounts(expected, os.environ.get('DIGEST_TELEGRAM_IBKR_ACCOUNT_IDS_JSON'),
                                           os.environ.get('QSL_GLOBAL_TELEGRAM_CHAT_ID')))


def utc_now():
    return datetime.now(UTC)


def business_slot(stamp):
    """Derive the digest operation from an already validated trigger time."""
    local = stamp.astimezone(SGT)
    report_date = local.date()
    return report_date, (report_date - timedelta(days=1)).isoformat(), local.minute == 30


def report_slot(headers, configuration, now):
    values = {key.lower(): value for key, value in headers.items()}
    job = values.get('x-cloudscheduler-jobname')
    if not job:
        raise ValueError('digest_scheduler_job_missing')
    # Cloud Run authenticates the invoker. Scheduler's job header may use the
    # configured resource's exact short name; unrelated full names still fail.
    if job not in {configuration.scheduler_job, configuration.scheduler_job.rsplit('/', 1)[-1]}:
        raise ValueError('digest_scheduler_job_mismatch')
    stamp = datetime.fromisoformat(values['x-cloudscheduler-scheduletime'])
    if stamp.tzinfo is None:
        raise ValueError('digest_schedule_timezone_required')
    local = stamp.astimezone(SGT)
    if (local.hour, local.minute) not in {(7, 0), (7, 30)} or stamp > now:
        raise ValueError('digest_schedule_slot_invalid')
    report_date, day, check = business_slot(stamp)
    return report_date, day, stamp, check


@dataclass(frozen=True)
class _BinanceWalletObservation:
    account_uid: str
    amount: str
    as_of: str


def _binance_snapshot(configuration, binding, day, timeout):
    endpoint = urllib.parse.urlsplit(configuration.binance_snapshot_endpoint)
    if (endpoint.scheme != 'https' or not endpoint.hostname or endpoint.netloc != endpoint.hostname
            or endpoint.path != BINANCE_SNAPSHOT_PATH or endpoint.query or endpoint.fragment
            or not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', configuration.binance_snapshot_token)):
        raise StoreUnavailable()
    query = urllib.parse.urlencode({'business_day': day, 'include_valuation': '1'})
    request = urllib.request.Request(configuration.binance_snapshot_endpoint + '?' + query,
                                     headers={'Authorization': 'Bearer ' + configuration.binance_snapshot_token,
                                              'Accept': 'application/json',
                                              'User-Agent': 'QSL-Daily-Digest/1.0'})
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=timeout) as response:
            body = response.read(256 * 1024 + 1)
    except HTTPError as error:
        if error.code == 404:
            return None, None
        raise StoreUnavailable() from None
    except (HTTPException, OSError):
        raise StoreUnavailable() from None
    if len(body) > 256 * 1024:
        raise ValueError('digest_snapshot_invalid')
    data = json.loads(body)
    if (set(data) - {'wallet_valuation'} != {'ok', 'business_day', 'account_key', 'target_id', 'as_of', 'holdings'}
            or data['ok'] is not True or data['business_day'] != day
            or data['account_key'] != binding['opaque_account_uid'] or data['target_id'] != binding['target_id']):
        raise ValueError('digest_snapshot_binding_mismatch')
    observed = datetime.fromisoformat(data['as_of'])
    start = datetime.combine(date.fromisoformat(day), time(6), SGT)
    if observed.tzinfo is None or not start <= observed < start + timedelta(days=1):
        raise ValueError('digest_snapshot_window_invalid')
    if not isinstance(data['holdings'], list):
        raise ValueError('digest_snapshot_invalid')
    holdings = []
    for item in data['holdings']:
        symbol, quantity = item['asset'], item['quantity']
        if not valid_crypto_symbol(symbol) or not isinstance(quantity, str):
            raise ValueError('digest_snapshot_invalid')
        amount = float(quantity)
        if not math.isfinite(amount) or amount < 0:
            raise ValueError('digest_snapshot_invalid')
        if amount:
            holdings.append({'symbol': symbol, 'quantity': amount, 'asset_type': 'crypto'})
    snapshot = {**{name: binding[name] for name in IDENTITY}, 'business_day': day, 'actually_ran': False,
                'account_daily_facts': {'snapshots': [{'as_of': data['as_of'], 'holdings': holdings}]}}
    wallet = None
    valuation = data.get('wallet_valuation')
    if (isinstance(valuation, dict) and set(valuation) == {'amount', 'currency', 'as_of'}
            and valuation['currency'] == 'USDT' and isinstance(valuation['amount'], str)
            and re.fullmatch(r'(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{0,29}[1-9])?', valuation['amount'])):
        try:
            priced = datetime.fromisoformat(valuation['as_of'])
        except (TypeError, ValueError):
            pass
        else:
            if priced.tzinfo is not None and start <= priced <= observed:
                wallet = _BinanceWalletObservation(binding['opaque_account_uid'], valuation['amount'], priced.isoformat())
    return snapshot, wallet


def _sources(configuration, store, day, end, *, now, monotonic):
    rows, outcomes, stale_observations = [], [], []
    budget_end = monotonic() + min(120, max(0, (end - now()).total_seconds()))
    for binding in configuration.expected:
        timeout = min(20, budget_end - monotonic(), (end - now()).total_seconds())
        outcome = 'read_failed'
        if timeout > 0:
            key = f"{binding['platform_id']}/{day}/{binding['candidate_slot']}.json"
            snapshot_outcome = None
            if binding.get('snapshot_only'):
                try:
                    snapshot, wallet = _binance_snapshot(configuration, binding, day, timeout)
                    if snapshot is not None:
                        rows.append(snapshot)
                    if wallet is not None:
                        stale_observations.append(wallet)
                    snapshot_outcome = 'snapshot_only' if snapshot is not None else 'missing'
                except StoreUnavailable:
                    snapshot_outcome = 'read_failed'
                except (ValueError, TypeError, KeyError, AttributeError):
                    snapshot_outcome = 'invalid'
                if not binding.get('receipt_candidate'):
                    outcomes.append(snapshot_outcome)
                    continue
                timeout = min(20, budget_end - monotonic(), (end - now()).total_seconds())
            try:
                if timeout <= 0:
                    raise StoreUnavailable()
                raw = store.candidate(key, timeout)
                if raw is None:
                    outcome = 'missing'
                else:
                    items = candidate_contract._rows(raw)
                    if any(tuple(item.get(name) for name in IDENTITY) != tuple(binding[name] for name in IDENTITY)
                           or item.get('legacy') is True for item in items):
                        raise ValueError('digest_candidate_binding_mismatch')
                    fresh, stale = adapter.partition(items, day)
                    if stale:
                        outcome = 'stale'
                        stale_observations.extend(stale)
                        rows.extend(fresh)
                    elif fresh:
                        outcome = 'present' if any(item['actually_ran'] for item in fresh) else 'not_run'
                        rows.extend(fresh)
                    else:
                        outcome = 'missing'
            except StoreUnavailable:
                outcome = 'read_failed'
            except (ValueError, TypeError, KeyError, AttributeError):
                outcome = 'invalid'
            if binding.get('receipt_candidate') and outcome != 'present' and snapshot_outcome == 'snapshot_only':
                outcome = 'snapshot_only'
        outcomes.append(outcome)
    for binding in configuration.expected:
        if binding['platform_id'] != 'ibkr':
            continue
        timeout = min(20, budget_end - monotonic(), (end - now()).total_seconds())
        if timeout <= 0:
            break
        try:
            cash = store.candidate(f"ibkr/flex-cash/{binding['candidate_slot']}.json", timeout)
            if cash is not None:
                stale_observations.append(_ibkr_settled_cash(cash, binding, day))
        except (StoreUnavailable, ValueError, TypeError, KeyError, AttributeError):
            continue
    return rows, outcomes, stale_observations


@dataclass(frozen=True)
class _SettledCashObservation:
    account_uid: str
    amount: str
    statement_date: str


def _ibkr_settled_cash(raw, binding, day):
    if (not isinstance(raw, dict)
            or set(raw) != {'schema_version', 'target_id', 'opaque_account_uid', 'statement_date', 'currency', 'amount'}
            or raw['schema_version'] != 'ibkr_digest_settled_cash.v1'
            or raw['currency'] != 'USD'
            or any(raw[name] != binding[name] for name in ('target_id', 'opaque_account_uid'))
            or not isinstance(raw['amount'], str) or len(raw['amount']) > 64
            or not re.fullmatch(r'-?[0-9]+(?:\.[0-9]+)?', raw['amount'])):
        raise ValueError('digest_ibkr_settled_cash_invalid')
    statement_day = date.fromisoformat(raw['statement_date']).isoformat()
    if statement_day != raw['statement_date'] or statement_day > day:
        raise ValueError('digest_ibkr_settled_cash_date_invalid')
    return _SettledCashObservation(binding['opaque_account_uid'], raw['amount'], statement_day)


def _report(configuration, rows, outcomes, day, platform_config, *, stale_observations=(),
            include_telegram_account_ids=False):
    config = deepcopy(platform_config or aggregator.load_platform_config())
    config['notifications']['quant_sentinel']['daily_digest'].setdefault('aggregator', {})['expected_targets'] = configuration.expected
    failure_reasons = {'read_failed': 'candidate_store_read_failed',
                       'invalid': 'candidate_input_unavailable_or_invalid'}
    failures = [{'source_kind': 'candidate_store', 'reason_code': failure_reasons[outcome]}
                for outcome in outcomes if outcome in failure_reasons]
    # Financial bodies are ephemeral inside the approved cloud runtime only.
    with tempfile.TemporaryDirectory(prefix='qsl-digest-') as directory:
        path = Path(directory) / 'candidates.json'
        path.write_text(json.dumps({'runs': rows}), encoding='utf-8')
        payload, _, _ = aggregator.build_digest_payload(
            business_day=day, locale=configuration.locale, candidates_path=path,
            include_github=False, config=config, candidate_failures=failures, render_text=False,
        )
    covered = sum(value in {'present', 'not_run', 'snapshot_only'} for value in outcomes)
    coverage = 'complete' if covered == len(outcomes) else 'partial' if covered else 'unavailable'
    facts = collect_account_facts([*rows, *(row for row in stale_observations if isinstance(row, dict))],
                                  configuration.expected, day)
    for observation in stale_observations:
        if isinstance(observation, _BinanceWalletObservation):
            facts['binance', observation.account_uid]['wallet_valuation'] = {
                'as_of': observation.as_of, 'amount': observation.amount,
            }
        elif isinstance(observation, _SettledCashObservation):
            facts['ibkr', observation.account_uid]['settled_cash'] = {
                'amount': observation.amount, 'statement_date': observation.statement_date,
            }
    if coverage == 'complete' and ((payload.notification_summary or {}).get('counts_unknown')
                                   or any(binding.get('receipt_candidate') for binding in configuration.expected)):
        coverage = 'partial'
    platforms = dict.fromkeys((*adapter.PLATFORMS, *config.get('platforms', {})))
    text = render_account_daily(payload, configuration.expected, outcomes, facts=facts, known_platforms=platforms,
                                telegram_ibkr_accounts=(configuration.telegram_ibkr_accounts
                                                        if include_telegram_account_ids else None))
    return text, coverage


def execute(headers, configuration, store, send, *, preview=False, now=utc_now,
            monotonic=clock.monotonic, platform_config=None):
    try:
        report_date, day, scheduled_at, check = report_slot(headers, configuration, now())
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        # Only fixed reasons leave this boundary, never header/exception values.
        known = {'digest_scheduler_job_missing', 'digest_scheduler_job_short_name',
                 'digest_scheduler_job_mismatch', 'digest_schedule_timezone_required',
                 'digest_schedule_slot_invalid'}
        reason = str(error) if isinstance(error, ValueError) and str(error) in known else (
            'digest_schedule_header_missing' if isinstance(error, KeyError) else 'digest_schedule_header_invalid')
        return 400, {'delivery': 'invalid_slot', 'reason_code': reason}
    return execute_slot(report_date, day, check, {'scheduled_at': scheduled_at.isoformat()},
                        configuration, store, send, preview=preview, now=now,
                        monotonic=monotonic, platform_config=platform_config)


def execute_slot(report_date, day, check, schedule_record, configuration, store, send, *,
                 preview=False, now=utc_now, monotonic=clock.monotonic, platform_config=None):
    """Run the unchanged business logic after the calling platform validates its trigger."""
    safe = {'report_date': report_date.isoformat(), 'business_day': day, 'delivery': 'not_attempted'}
    if not preview and now().astimezone(SGT).date() != report_date:
        return 200, {**safe, 'delivery': 'expired_slot'}
    if not preview and report_date < date.fromisoformat(configuration.cutover_date):
        return 200, {**safe, 'delivery': 'before_cutover'}
    if not preview and not configuration.enabled:
        return 200, {**safe, 'delivery': 'disabled'}
    if check:
        if preview:
            return 400, {**safe, 'delivery': 'invalid_slot'}
        try:
            record = store.delivery(f'{configuration.recipient_scope}/{report_date.isoformat()}.json')
        except StoreUnavailable:
            return 200, {**safe, 'delivery': 'receipt_unverified', 'phase': 'deadline_check'}
        matches = isinstance(record, dict) and all(record.get(key) == value for key, value in (
            ('report_date', report_date.isoformat()), ('business_day', day),
            ('recipient_scope', configuration.recipient_scope)))
        confirmed = matches and record.get('delivery') == 'accepted' and record.get('late') is False
        return 200, {**safe, 'delivery': 'confirmed' if confirmed else 'receipt_unverified', 'phase': 'deadline_check'}
    stop = datetime.combine(report_date, time(7, 20), SGT)
    deadline_at = datetime.combine(report_date, time(7, 30), SGT)
    late = now() + timedelta(seconds=30) >= deadline_at
    if late and not preview:
        text, coverage = '', 'unavailable'
    else:
        read_end = now() + timedelta(seconds=120) if preview else stop
        rows, outcomes, stale = _sources(
            configuration, store, day, read_end, now=now, monotonic=monotonic)
        text, coverage = _report(configuration, rows, outcomes, day, platform_config, stale_observations=stale,
                                 include_telegram_account_ids=(
                                     not preview and schedule_record.get('trigger_provenance') == 'azure_logic_sliding_window'))
    # Recheck after intake/rendering: wall-clock expiry cannot be extended by retries.
    late = late or now() + timedelta(seconds=30) >= deadline_at
    if late and not preview:
        text = render_account_daily_unavailable(day, configuration.locale)
    safe.update(coverage=coverage, late=late)
    if preview:
        return 200, {**safe, 'delivery': 'preview'}
    key = f'{configuration.recipient_scope}/{report_date.isoformat()}.json'
    record = {**safe, 'schema_version': 'qsl.daily_digest_delivery.v1', 'delivery': 'sending',
              'recipient_scope': configuration.recipient_scope, 'attempt_id': str(uuid4()),
              **schedule_record, 'message_sha256': hashlib.sha256(text.encode()).hexdigest()}
    try:
        created, generation = store.reserve(key, record)
    except StoreUnavailable:
        return 503, {**safe, 'delivery': 'reservation_unconfirmed'}
    if not created:
        existing = generation
        if (not isinstance(existing, dict) or existing.get('report_date') != safe['report_date']
                or existing.get('recipient_scope') != configuration.recipient_scope
                or existing.get('business_day') != day):
            return 503, {**safe, 'delivery': 'reservation_invalid'}
        return 200, {**safe, 'delivery': 'duplicate' if existing.get('delivery') == 'accepted' else 'unknown'}
    try:
        message_id = send(text)
        if type(message_id) is not int:
            raise ValueError('digest_ack_invalid')
        accepted_at = now()
        safe['late'] = late or accepted_at >= deadline_at
        record.update(delivery='accepted', accepted_at=accepted_at.isoformat(), message_id=message_id, late=safe['late'])
    except Exception:  # noqa: BLE001 -- Every uncertain transport result must retain its reservation.
        record.update(delivery='unknown')
    try:
        store.finish(key, generation, record)
    except StoreUnavailable:
        return 200, {**safe, 'delivery': 'unknown'}
    return 200, {**safe, 'delivery': record['delivery']}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def telegram_sender(token, recipient):
    if not token or not recipient:
        raise ValueError('digest_recipient_configuration_required')
    opener = urllib.request.build_opener(NoRedirect())
    def send(text):
        body = urllib.parse.urlencode({'chat_id': recipient, 'text': text}).encode()
        request = urllib.request.Request('https://api.telegram.org/bot' + token + '/sendMessage', data=body)
        with opener.open(request, timeout=20) as response:
            value = json.load(response)
        result = value.get('result') or {}
        if value.get('ok') is not True or str((result.get('chat') or {}).get('id')) != recipient:
            raise ValueError('digest_ack_invalid')
        return result.get('message_id')
    return send


def main():
    from http.server import BaseHTTPRequestHandler, HTTPServer
    configuration = Configuration.from_environment()
    store = GCSDeliveryStore(os.environ['DIGEST_CANDIDATES_GCS_URI'], os.environ['DIGEST_DELIVERIES_GCS_URI'],
                             candidates_by_platform=configuration.candidate_uris)
    send = telegram_sender(os.environ['TELEGRAM_TOKEN'], os.environ['QSL_GLOBAL_TELEGRAM_CHAT_ID'])

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Headers, request bodies and private exceptions are never access logs.

        def respond(self, status, value):
            body = json.dumps(value).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self.respond(200 if self.path == '/health' else 404,
                         {'status': 'ready', 'delivery_enabled': configuration.enabled} if self.path == '/health' else {})

        def do_POST(self):
            if self.path not in {'/daily-digest', '/preview'} or self.headers.get('Content-Length', '0') != '0':
                self.respond(400, {'delivery': 'invalid_request'})
                return
            try:
                status, value = execute(dict(self.headers), configuration, store, send, preview=self.path == '/preview')
            except Exception as error:  # noqa: BLE001 -- Only closed error classes leave the HTTP boundary.
                kind = type(error).__name__
                allowed = {'FileNotFoundError', 'PermissionError', 'ValueError', 'TypeError', 'KeyError',
                           'AttributeError', 'ImportError', 'OSError'}
                status, value = 503, {'delivery': 'request_failed', 'error_type': kind if kind in allowed else 'InternalError'}
            print(json.dumps({'component': 'daily_digest', 'severity': 'ERROR' if value.get('delivery') in {
                'unknown', 'request_failed', 'reservation_unconfirmed', 'reservation_invalid',
                'receipt_unverified', 'invalid_slot'} else 'INFO', **value}), flush=True)
            self.respond(status, value)

    HTTPServer(('0.0.0.0', int(os.environ.get('PORT', '8080'))), Handler).serve_forever()


if __name__ == '__main__':
    main()

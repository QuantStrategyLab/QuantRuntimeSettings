"""One authenticated scheduled report; no broker, GitHub, AI or control-plane calls."""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time as clock
import urllib.parse
import urllib.request
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

import daily_digest_aggregator as aggregator
import merge_digest_candidates as candidate_contract
import notification_candidate_adapter as adapter
from account_daily_digest import render_account_daily, render_account_daily_unavailable
from account_daily_facts import collect_account_facts
from daily_digest_delivery_store import GCSDeliveryStore, StoreUnavailable, location
from display_names import configured_account_label, safe_display_text as _safe_display_text

SGT = ZoneInfo('Asia/Singapore')
IDENTITY = adapter.IDENTITY[:4]
SLOT = re.compile(r'[a-z0-9][a-z0-9_-]{0,40}')


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


@dataclass(frozen=True)
class Configuration:
    expected: list
    scheduler_job: str
    recipient_scope: str
    cutover_date: str
    enabled: bool = False
    locale: str = 'zh'
    candidate_uris: dict = field(default_factory=dict)

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
        for row in self.expected:
            if not SLOT.fullmatch(row.get('candidate_slot', '')):
                raise ValueError('digest_candidate_slot_required')
            identity = tuple(row[key] for key in IDENTITY)
            object_key = row['platform_id'], row['candidate_slot']
            if identity in identities or object_key in objects:
                raise ValueError('digest_duplicate_target_binding')
            identities.add(identity)
            objects.add(object_key)
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
        return cls(json.loads(os.environ['DIGEST_EXPECTED_TARGETS_JSON']),
                   os.environ['DIGEST_SCHEDULER_JOB_NAME'], os.environ['DIGEST_RECIPIENT_SCOPE'],
                   os.environ['DIGEST_CUTOVER_REPORT_DATE'], flag == 'true',
                   os.environ.get('QSL_NOTIFY_LANG', 'zh'), candidate_uris)


def utc_now():
    return datetime.now(UTC)


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
    report_date = local.date()
    return report_date, (report_date - timedelta(days=1)).isoformat(), stamp, local.minute == 30


def _sources(configuration, store, day, end, *, now, monotonic):
    rows, outcomes, stale_observations = [], [], []
    budget_end = monotonic() + min(120, max(0, (end - now()).total_seconds()))
    for binding in configuration.expected:
        timeout = min(20, budget_end - monotonic(), (end - now()).total_seconds())
        outcome = 'read_failed'
        if timeout > 0:
            key = f"{binding['platform_id']}/{day}/{binding['candidate_slot']}.json"
            try:
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
        outcomes.append(outcome)
    return rows, outcomes, stale_observations


def _report(configuration, rows, outcomes, day, platform_config, *, stale_observations=()):
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
    covered = sum(value in {'present', 'not_run'} for value in outcomes)
    coverage = 'complete' if covered == len(outcomes) else 'partial' if covered else 'unavailable'
    facts = collect_account_facts([*rows, *stale_observations], configuration.expected, day)
    if coverage == 'complete' and (payload.notification_summary or {}).get('counts_unknown'):
        coverage = 'partial'
    text = render_account_daily(payload, configuration.expected, outcomes, facts=facts)
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
        text, coverage = _report(configuration, rows, outcomes, day, platform_config, stale_observations=stale)
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
              'scheduled_at': scheduled_at.isoformat(), 'message_sha256': hashlib.sha256(text.encode()).hexdigest()}
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

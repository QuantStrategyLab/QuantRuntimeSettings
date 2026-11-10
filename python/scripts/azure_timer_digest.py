"""Azure timer adapter for the existing digest and GCS delivery ledger."""
from datetime import datetime, time, timedelta

import cloud_run_daily_digest as core


class ScheduleUnavailable(Exception):
    """The timer did not supply a valid original slot."""


def validate_slot(scheduled, now):
    try:
        if scheduled.tzinfo is None or scheduled > now:
            raise ValueError()
        local = scheduled.astimezone(core.SGT)
        if local.time() not in (time(7), time(7, 30)):
            raise ValueError()
    except (AttributeError, TypeError, ValueError):
        raise ScheduleUnavailable('invalid_original_slot') from None
    report_date, _, check = core.business_slot(scheduled)
    return report_date, check, scheduled


def resolve_slot(schedule_status, now):
    try:
        # Next is the persisted original slot, including a past-due startup.
        scheduled = datetime.fromisoformat(schedule_status['Next'])
    except (KeyError, TypeError, ValueError):
        raise ScheduleUnavailable('invalid_original_slot') from None
    return validate_slot(scheduled, now)


def window_slot(begin, end, seconds, now):
    try:
        first, last = datetime.fromisoformat(begin), datetime.fromisoformat(end)
        if (first.tzinfo is None or last.tzinfo is None or first.second or first.microsecond
                or last.second or last.microsecond or last > now
                or last - first != timedelta(seconds=seconds)):
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError('unverified_sliding_window') from None
    return last


def execute_timer(schedule_status, configuration, store, send, *, now=core.utc_now, platform_config=None,
                  provenance='azure_functions_timer'):
    _, _, scheduled = resolve_slot(schedule_status, now())
    return _execute_validated(scheduled, configuration, store, send, now=now,
                              platform_config=platform_config, provenance=provenance)


def execute_scheduled(scheduled, configuration, store, send, *, now=core.utc_now, platform_config=None,
                      provenance='azure_functions_timer'):
    validate_slot(scheduled, now())
    return _execute_validated(scheduled, configuration, store, send, now=now,
                              platform_config=platform_config, provenance=provenance)


def _execute_validated(scheduled, configuration, store, send, *, now, platform_config, provenance):
    report_date, day, check = core.business_slot(scheduled)
    status, result = core.execute_slot(
        report_date, day, check,
        {'scheduled_at': scheduled.isoformat(), 'trigger_provenance': provenance},
        configuration, store, send, now=now, platform_config=platform_config,
    )
    if result.get('phase') != 'deadline_check':
        return status, result
    key = f'{configuration.recipient_scope}/deadline-checks/{report_date.isoformat()}.json'
    receipt = {
        'schema_version': 'qsl.daily_digest_deadline_check.v1',
        'report_date': report_date.isoformat(),
        'business_day': day,
        'scheduled_at': scheduled.isoformat(),
        'checked_at': now().isoformat(),
        'delivery': result['delivery'],
        'trigger_provenance': provenance,
    }
    try:
        created, existing = store.reserve(key, receipt)
        if not created:
            identity_fields = ('schema_version', 'report_date', 'business_day')
            if (not isinstance(existing, dict)
                or any(existing.get(field) != receipt[field] for field in identity_fields)
                or existing.get('delivery') not in ('confirmed', 'receipt_unverified')):
                raise core.StoreUnavailable()
            result = {**result, 'delivery': existing['delivery']}
    except core.StoreUnavailable:
        return 503, {**result, 'deadline_receipt': 'unverified'}
    return status, {**result, 'deadline_receipt': 'recorded' if created else 'already_recorded'}

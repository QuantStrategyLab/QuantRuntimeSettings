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
    return core.execute_slot(
        report_date, day, check,
        {'scheduled_at': scheduled.isoformat(), 'trigger_provenance': provenance},
        configuration, store, send, now=now, platform_config=platform_config,
    )

"""The digest's fixed window, upstream stop time, and bounded read phases."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
import os
import signal
from zoneinfo import ZoneInfo

SGT = ZoneInfo('Asia/Singapore')


class ReadBudgetExceeded(Exception):
    """End the whole read phase; never downgrade to a per-source transport error."""



def utc_now():
    return datetime.now(timezone.utc)


def enabled(env):
    return env.get('DIGEST_DEADLINE_ENABLED') == 'true'


def cutoff(env, hour=7, minute=20):
    day = date.fromisoformat(env['DIGEST_REPORT_DATE'])
    return datetime.combine(day, time(hour, minute), SGT)


def late(env, *, now=None, reserve_seconds=0):
    return enabled(env) and (now or utc_now()) + timedelta(seconds=reserve_seconds) >= cutoff(env, 7, 30)


def upstream_seconds(env, *, now=None):
    stamp = now or utc_now()
    end = cutoff(env)
    if env.get('DIGEST_UPSTREAM_END_AT'):
        end = min(end, datetime.fromisoformat(env['DIGEST_UPSTREAM_END_AT']))
    return max(0.0, min(120.0, (end - stamp).total_seconds()))


@contextmanager
def read_budget(seconds, reason='digest_read_budget_exhausted'):
    """Hard process wall-time bound for blocking read phases on the Actions runner.

    Read-only phases use this separately from delivery. Preserve any outer timer.
    """
    if seconds <= 0:
        raise ReadBudgetExceeded(reason)
    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    import time as clock
    started = clock.monotonic()
    def expired(_signal, _frame):
        raise ReadBudgetExceeded(reason)
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, min(seconds, previous_timer[0]) if previous_timer[0] else seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0]:
            signal.setitimer(signal.ITIMER_REAL, max(0.000001, previous_timer[0] - (clock.monotonic() - started)), previous_timer[1])


def failure_text(env, *, is_late, locale='zh'):
    title = ' late' if is_late else ''
    if str(locale).startswith('en'):
        return (f"QRS daily digest{title} | {env['DIGEST_REPORT_DATE']}\n"
                'The digest was not verified in time. Upstream waiting has stopped.\n'
                'Trades and asset state remain unknown; no automatic follow-up will be sent.\n'
                f"Business day: {env['DIGEST_BUSINESS_DAY']}; deadline: 07:30 Asia/Singapore.")
    return (f"⚠️ QRS 日报{title}｜{env['DIGEST_REPORT_DATE']}\n"
            '本次日报未完成验证，已停止等待上游；成交与资产状态未知。\n'
            f"业务日：{env['DIGEST_BUSINESS_DAY']}；截止：07:30 Asia/Singapore。\n"
            '本窗口仅发送本条通知，不再自动补发。')


def freeze(env, *, now=None):
    import daily_digest_aggregator as aggregator
    stamp = now or utc_now()
    day = aggregator.resolve_business_day(explicit=env.get('INPUT_BUSINESS_DAY'), now=stamp)
    report = date.fromisoformat(day) + timedelta(days=1)
    # Never silently relabel an explicit/NY window as another report date.
    # The schedule payload has no original planned date; cross-date ambiguity blocks.
    if env.get('INPUT_EVENT_NAME') == 'schedule' and report != stamp.astimezone(SGT).date():
        raise ValueError('schedule_identity_unknown')
    return {'DIGEST_DEADLINE_ENABLED': 'true', 'DIGEST_BUSINESS_DAY': day,
            'DIGEST_REPORT_DATE': report.isoformat()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start-upstream', action='store_true')
    args = parser.parse_args()
    values = ({'DIGEST_UPSTREAM_END_AT': min(utc_now() + timedelta(seconds=120), cutoff(os.environ)).isoformat()}
              if args.start_upstream else freeze(os.environ))
    with open(os.environ['GITHUB_ENV'], 'a') as out:
        for key, value in values.items():
            out.write(f'{key}={value}\n')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
        if not args.start_upstream:
            out.write(f"business_day={values['DIGEST_BUSINESS_DAY']}\n")
        out.write(f"upstream_allowed={str(upstream_seconds({**os.environ, **values}) > 0).lower()}\n")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

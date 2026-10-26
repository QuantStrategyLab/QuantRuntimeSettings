"""Bound the existing gcloud ls/cp + strict merge at its real workflow call site."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

import daily_digest_deadline as deadline
import daily_digest_aggregator as aggregator
from merge_digest_candidates import merge


class ReadFailure(Exception):
    def __init__(self, reason, retryable=False):
        self.reason, self.retryable = reason, retryable


def fetch(env, *, runner=subprocess.run, now=deadline.utc_now, monotonic=time.monotonic, sleep=time.sleep):
    end = monotonic() + deadline.upstream_seconds(env, now=now())
    attempts = 0
    reason = 'candidate_store_wait_stopped'
    destination = Path('data/input/daily-digest/candidates-merged.json')
    def remaining():
        return min(end - monotonic(), deadline.upstream_seconds(env, now=now()))
    def run(args):
        if remaining() <= 0:
            raise ReadFailure('candidate_store_wait_stopped')
        try:
            result = runner(args, capture_output=True, text=True, timeout=min(20.0, remaining()))
        except subprocess.TimeoutExpired:
            raise ReadFailure('candidate_store_read_timeout', True) from None
        if result.returncode:
            detail = (result.stderr or '').lower()
            # Error text is inspected locally, never emitted (it may be private).
            transient = any(code in detail for code in ('429', '500', '502', '503', '504', 'timed out', 'temporarily unavailable'))
            missing = 'matched no objects' in detail or 'no urls matched' in detail
            raise ReadFailure('candidate_store_not_ready' if missing else 'candidate_store_read_failed', transient or missing)
        return result.stdout or ''
    if remaining() <= 0:
        return {'status': 'failed', 'reason': reason, 'attempts': 0}
    if env.get('AUTH_OUTCOME') != 'success':
        return {'status': 'failed', 'reason': 'candidate_store_auth_failed', 'attempts': 0}
    day = env['DIGEST_BUSINESS_DAY']
    uri = env['DIGEST_CANDIDATES_GCS_URI'].rstrip('/')
    for attempt in range(1, 4):
        if remaining() <= 0:
            break
        attempts = attempt
        try:
            listing = run(['gcloud', 'storage', 'ls', f'{uri}/*/{day}/*.json'])
            objects = [item for item in listing.splitlines() if item]
            if any(not item.startswith(uri + '/') for item in objects):
                raise ReadFailure('candidate_store_list_failed')
            objects = [item for item in objects if f'/{day}/' in item and item.endswith('.json')]
            if not objects:
                raise ReadFailure('candidate_store_not_ready', True)
            # Each round owns fresh files; failed downloads never contaminate a retry.
            with tempfile.TemporaryDirectory(prefix='digest-fetch-', dir=env.get('RUNNER_TEMP')) as tmp:
                folder = Path(tmp)
                for index, item in enumerate(objects):
                    run(['gcloud', 'storage', 'cp', item, str(folder / f'candidate-{index}.json'), '--no-user-output-enabled'])
                if remaining() <= 0:
                    raise ReadFailure('candidate_store_wait_stopped')
                base = Path(env['DIGEST_CANDIDATES_PATH']) if env.get('DIGEST_CANDIDATES_PATH') else None
                try:
                    with deadline.read_budget(remaining()):
                        payload, _stats = merge(base, folder)
                        staged = folder / 'merged'
                        staged.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
                        collected = aggregator.collect_digest_runs(
                            business_day=day, config=aggregator.load_platform_config(),
                            candidates_path=staged, include_github=False,
                        )
                        if collected.coverage.missing_targets:
                            raise ReadFailure('candidate_store_not_ready', True)
                except (deadline.ReadBudgetExceeded, TimeoutError):
                    raise ReadFailure('candidate_store_wait_stopped') from None
                except (ValueError, OSError):
                    raise ReadFailure('candidate_store_merge_failed') from None
                if remaining() <= 0:
                    raise ReadFailure('candidate_store_wait_stopped')
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
            return {'status': 'loaded', 'reason': '', 'attempts': attempts, 'path': str(destination)}
        except ReadFailure as exc:
            reason = exc.reason
            if not exc.retryable or attempts == 3 or remaining() <= 0:
                break
            delay = 30 if reason == 'candidate_store_not_ready' else 2 ** attempts
            sleep(max(0.0, min(delay, remaining())))
    return {'status': 'failed', 'reason': reason, 'attempts': attempts}


def main():
    # Default failed state survives process interruption; previous files are not selected.
    with open(os.environ['GITHUB_ENV'], 'a') as out:
        out.write('DIGEST_CANDIDATES_STORE_STATUS=failed\nDIGEST_CANDIDATES_STORE_REASON=candidate_store_outcome_missing\n')
    result = fetch(os.environ)
    with open(os.environ['GITHUB_ENV'], 'a') as out:
        out.write(f"DIGEST_CANDIDATES_STORE_STATUS={result['status']}\nDIGEST_CANDIDATES_STORE_REASON={result['reason']}\n")
        if result.get('path'):
            out.write(f"DIGEST_CANDIDATES_PATH={result['path']}\n")
    print(json.dumps({key: result[key] for key in ('status', 'reason', 'attempts')}))
    return 0 if result['status'] == 'loaded' else 1


if __name__ == '__main__':
    raise SystemExit(main())

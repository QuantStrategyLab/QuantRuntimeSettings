"""Stdlib-only deduplicated Telegram alert helper for control-plane workflows."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib import error, request

_SENSITIVE_PATTERNS = (
    (re.compile(r'bot\d{6,}:[A-Za-z0-9_-]{20,}'), '[REDACTED_TOKEN]'),
    (re.compile(r'(?i)(bearer\s+)[A-Za-z0-9._\-+/=]{8,}'), r'\1[REDACTED]'),
    (re.compile(r'(?i)([?&](?:token|key|secret|password|auth)=)[^&\s]+'), r'\1[REDACTED]'),
    (re.compile(r'\b[a-f0-9]{32,}\b', re.IGNORECASE), '[REDACTED_HEX]'),
)


def redact_sensitive(text: str, extra_secrets: tuple[str, ...] = ()) -> str:
    """Scrub tokens, secrets, and long opaque hex identifiers without removing safe run URLs."""
    cleaned = str(text or '')
    for secret in extra_secrets:
        value = str(secret or '').strip()
        if len(value) >= 4:
            cleaned = cleaned.replace(value, '[REDACTED]')
    for pattern, replacement in _SENSITIVE_PATTERNS:
        cleaned = pattern.sub(replacement, cleaned)
    return cleaned.strip()


def extract_report_highlights(report_path: str | Path | None) -> str:
    """Extract only safe structural status summary fields from a JSON health report."""
    if not report_path:
        return ''
    path = Path(report_path)
    if not path.is_file():
        return ''
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return 'report_unreadable'
    if not isinstance(data, dict):
        return ''
    parts = []
    status = data.get('status') or data.get('overall_status')
    if isinstance(status, str) and status.strip():
        parts.append(f'status={status.strip()}')
    action = data.get('recommended_action')
    if isinstance(action, str) and action.strip():
        parts.append(f'action={action.strip()}')
    failed = data.get('failed_checks') or data.get('failing_platforms')
    if isinstance(failed, list) and failed:
        names = [str(item) for item in failed[:6] if isinstance(item, str) and item.strip()]
        if names:
            parts.append('checks=' + ','.join(names))
    return redact_sensitive('; '.join(parts))


def build_alert_message(*, source: str, summary: str, run_url: str = '', report_summary: str = '',
                        locale: str = 'zh', extra_secrets: tuple[str, ...] = ()) -> str:
    zh = str(locale or 'zh').strip().lower() == 'zh'
    safe_source = redact_sensitive(source, extra_secrets) or 'control-plane'
    safe_summary = redact_sensitive(summary, extra_secrets) or ('检测到异常' if zh else 'Failure detected')
    safe_report = redact_sensitive(report_summary, extra_secrets)
    safe_url = redact_sensitive(run_url, extra_secrets)
    header = f'🚨 控制面巡检告警｜{safe_source}' if zh else f'🚨 Control-plane alert | {safe_source}'
    lines = [header, safe_summary]
    if safe_report:
        lines.append(('详情：' if zh else 'Details: ') + safe_report)
    if safe_url and safe_url.startswith(('http://', 'https://')):
        lines.append(('运行：' if zh else 'Run: ') + safe_url)
    return '\n'.join(lines)[:3800]


def should_send_deduped(state_path: str | Path | None, dedupe_key: str, *,
                        cooldown_hours: float = 12.0, now: datetime | None = None) -> bool:
    if not state_path:
        return True
    current = now or datetime.now(timezone.utc)
    path = Path(state_path)
    state: dict[str, str] = {}
    if path.is_file():
        try:
            loaded = json.loads(path.read_text(encoding='utf-8'))
            if isinstance(loaded, dict):
                state = {str(k): str(v) for k, v in loaded.items() if isinstance(k, str) and isinstance(v, str)}
        except (OSError, json.JSONDecodeError):
            state = {}
    cutoff = current - timedelta(hours=max(0.0, cooldown_hours))
    kept: dict[str, str] = {}
    for key, stamp in state.items():
        try:
            parsed = datetime.fromisoformat(stamp)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            if parsed >= cutoff:
                kept[key] = parsed.isoformat()
        except ValueError:
            continue
    if dedupe_key in kept:
        return False
    kept[dedupe_key] = current.isoformat()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(kept, sort_keys=True), encoding='utf-8')
    return True


def _telegram_credentials(env: dict[str, str] | None = None) -> tuple[str, str]:
    environ = env if env is not None else os.environ
    token = (environ.get('TELEGRAM_TOKEN') or environ.get('TELEGRAM_BOT_TOKEN') or '').strip()
    chat_id = (
        environ.get('QSL_GLOBAL_TELEGRAM_CHAT_ID')
        or environ.get('GLOBAL_TELEGRAM_CHAT_ID')
        or environ.get('TELEGRAM_CHAT_ID')
        or ''
    ).strip()
    return token, chat_id


def send_telegram_alert(*, source: str, summary: str, run_url: str = '', report_path: str | Path | None = None,
                        state_path: str | Path | None = None, cooldown_hours: float = 12.0,
                        locale: str = 'zh', dry_run: bool = False, opener=request.urlopen,
                        env: dict[str, str] | None = None) -> dict[str, str | bool]:
    token, chat_id = _telegram_credentials(env)
    extra_secrets = tuple(v for v in (token, chat_id) if v)
    report_summary = extract_report_highlights(report_path)
    message = build_alert_message(
        source=source,
        summary=summary,
        run_url=run_url,
        report_summary=report_summary,
        locale=locale,
        extra_secrets=extra_secrets,
    )
    signature = hashlib.sha256(f'{source}|{summary}|{report_summary}'.encode('utf-8')).hexdigest()[:16]
    if not should_send_deduped(state_path, signature, cooldown_hours=cooldown_hours):
        return {'sent': False, 'reason': 'deduped', 'message': message}
    if dry_run:
        return {'sent': False, 'reason': 'dry_run', 'message': message}
    if not token or not chat_id:
        return {'sent': False, 'reason': 'missing_credentials', 'message': message}

    payload = json.dumps({
        'chat_id': chat_id,
        'text': message,
        'disable_web_page_preview': True,
    }).encode('utf-8')
    req = request.Request(
        f'https://api.telegram.org/bot{token}/sendMessage',
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with opener(req, timeout=15) as resp:
            status = getattr(resp, 'status', 200)
            if int(status) >= 400:
                return {'sent': False, 'reason': f'http_{status}', 'message': message}
    except error.HTTPError as exc:
        return {'sent': False, 'reason': f'http_{exc.code}', 'message': message}
    except (error.URLError, TimeoutError, OSError):
        return {'sent': False, 'reason': 'network_error', 'message': message}
    return {'sent': True, 'reason': 'sent', 'message': message}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Send deduplicated, redacted control-plane alert to Telegram.')
    parser.add_argument('--source', required=True)
    parser.add_argument('--summary', required=True)
    parser.add_argument('--run-url', default='')
    parser.add_argument('--report-path', default='')
    parser.add_argument('--state-path', default='')
    parser.add_argument('--cooldown-hours', type=float, default=12.0)
    parser.add_argument('--locale', default=os.environ.get('QSL_NOTIFY_LANG') or os.environ.get('NOTIFY_LANG') or 'zh')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    result = send_telegram_alert(
        source=args.source,
        summary=args.summary,
        run_url=args.run_url,
        report_path=args.report_path or None,
        state_path=args.state_path or None,
        cooldown_hours=args.cooldown_hours,
        locale=args.locale,
        dry_run=args.dry_run,
    )
    print(f"control_plane_alert: sent={result['sent']} reason={result['reason']}")
    if args.dry_run:
        print(result['message'])
    return 0


if __name__ == '__main__':
    sys.exit(main())

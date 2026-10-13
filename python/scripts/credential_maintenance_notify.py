"""One shared operator expiry, existing console authority and central digest only.

No secrets or expiry/claim values are logged. An uncertain reserve is never reset.
"""
from __future__ import annotations
import datetime as dt
import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Mapping

DUE = {'30', '7', '1', 'expired'}
READ_STATUSES = {'not_attempted', 'ready', 'failed', 'invalid'}
PHASES = DUE | {'unknown', 'not_due'}
DELIVERIES = {'unknown', 'not_reserved', 'reserved', 'delivered'}

def empty_diagnostic():
    return {'read': 'not_attempted', 'phase': 'unknown', 'delivery': 'unknown'}

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def _open(request):
    return urllib.request.build_opener(_NoRedirect()).open(request, timeout=20)

def _json(request):
    with _open(request) as response:
        raw = response.read(16385)
        if len(raw) > 16384 or response.status != 200:
            raise ValueError('maintenance_response_invalid')
        value = json.loads(raw)
        if not isinstance(value, dict): raise ValueError('maintenance_response_invalid')
        return value

def _valid_expiry(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', value): return False
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.year >= 1970
    except ValueError: return False

@dataclass(repr=False)
class Reminder:
    expires_at: str
    metadata_revision: int
    phase: str
    claim_id: str | None = field(default=None, repr=False)
    def proposal(self):
        return {'expires_at': self.expires_at, 'metadata_revision': self.metadata_revision, 'phase': self.phase}
    def block(self, locale):
        if locale == 'en':
            status = 'registered expiry reached' if self.phase == 'expired' else f'expiry reminder ({self.phase}-day window)'
            return f'🔑 IBKR Flex — {status}\nExpiry: {self.expires_at}\nRenew the shared Flex credential and register its expiry in the console.'
        status = '已到登记到期时间' if self.phase == 'expired' else f'{self.phase} 天内到登记到期时间'
        return f'🔑 IBKR Flex — {status}\n到期：{self.expires_at}\n续期共享 Flex 凭据后，在看板登记到期时间。'

class MaintenanceClient:
    def __init__(self, origin, token):
        self.origin = origin; self.token = token
        self.diagnostic = empty_diagnostic()
    @classmethod
    def from_environment(cls, env: Mapping[str, str], *, dry_run=False):
        # Existing daily may run other branches. Persistent maintenance may not.
        if dry_run or env.get('GITHUB_ACTIONS') != 'true' or env.get('GITHUB_REF') != 'refs/heads/main': return None
        if env.get('GITHUB_WORKFLOW_REF') != 'QuantStrategyLab/QuantRuntimeSettings/.github/workflows/daily-digest-notify.yml@refs/heads/main': return None
        origin = env.get('STRATEGY_SWITCH_CONSOLE_URL', '').strip(); token = env.get('STRATEGY_SWITCH_SYNC_TOKEN', '').strip()
        if not token: return None
        try:
            url = urllib.parse.urlsplit(origin)
            if url.scheme != 'https' or not url.hostname or url.username or url.password or url.path not in {'', '/'} or url.query or url.fragment: return None
            _ = url.port
        except ValueError: return None
        # Fail closed if the maintenance sync authority aliases another configured secret.
        if any(k != 'STRATEGY_SWITCH_SYNC_TOKEN' and (k.endswith('_TOKEN') or k == 'SESSION_SECRET') and v and v == token for k, v in env.items()): return None
        return cls(origin.rstrip('/'), token)
    def _request(self, suffix, body=None):
        if suffix not in {'', '/claim', '/ack'}: raise ValueError('maintenance_route_invalid')
        request = urllib.request.Request(self.origin + '/api/internal/credential-maintenance' + suffix,
            data=None if body is None else json.dumps(body).encode(), method='GET' if body is None else 'POST',
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json', 'Accept': 'application/json'})
        return _json(request)
    def read_due(self):
        self.diagnostic.update(read='invalid', phase='unknown', delivery='unknown')
        try:
            value = self._request('')
        except Exception as error:
            self.diagnostic['read'] = 'invalid' if isinstance(error, ValueError) else 'failed'
            return None  # Never echo upstream bodies, URLs or private fields.
        try:
            if value.get('id') != 'ibkr_flex' or value.get('metadata_source') != 'operator_provided' or type(value.get('metadata_revision')) is not int or value['metadata_revision'] < 0: return None
            phase = value.get('phase'); delivery = value.get('delivery')
            if (isinstance(phase, str) and phase in PHASES and isinstance(delivery, str) and delivery in DELIVERIES
                    and (phase not in {'unknown', 'not_due'} or delivery == 'not_reserved')
                    and type(value.get('requires_action')) is bool and value['requires_action'] == (phase != 'not_due')
                    and (_valid_expiry(value.get('expires_at')) if phase != 'unknown' else value.get('expires_at') is None)):
                self.diagnostic.update(read='ready', phase=phase, delivery=delivery)
            if value.get('phase') not in DUE or value.get('requires_action') is not True or value.get('delivery') != 'not_reserved' or not _valid_expiry(value.get('expires_at')): return None
            return Reminder(value['expires_at'], value['metadata_revision'], value['phase'])
        except Exception: return None  # Never echo upstream bodies, URLs or private fields.
    def reserve(self, reminder):
        # Even a failed/invalid response may have reserved on the server.
        self.diagnostic['delivery'] = 'unknown'
        try:
            value = self._request('/claim', reminder.proposal())
            claim = value.get('claim_id')
            if value.get('granted') is not True or value.get('phase') != reminder.phase or value.get('delivery') != 'reserved' or not isinstance(claim, str) or not claim or len(claim) > 128: return False
            reminder.claim_id = claim
            self.diagnostic['delivery'] = 'reserved'
            return True
        except Exception: return False  # A request may already have reserved server-side.
    def ack(self, reminder, outcome):
        if not reminder.claim_id or outcome not in {'delivered', 'unknown'}: return 'reserved'
        try:
            value = self._request('/ack', {**reminder.proposal(), 'claim_id': reminder.claim_id, 'outcome': outcome})
            if value.get('phase') == reminder.phase and value.get('delivery') in {'delivered', 'unknown', 'reserved'}: return value['delivery']
        except Exception: pass
        return 'reserved'

def can_combine_reminder(*, text, chat_id):
    # Plain text, conservative UTF-16 limit. Preserve the original digest intact.
    return isinstance(text, str) and len(text.encode('utf-16-le')) // 2 <= 4096 and isinstance(chat_id, str) and bool(re.fullmatch(r'-?[1-9][0-9]*|@[A-Za-z0-9_]{5,32}', chat_id))

def send_strict_telegram(*, token, chat_id, text):
    """Strict receipt for the combined digest; no retries, redirects or raw errors."""
    try:
        request = urllib.request.Request(f'https://api.telegram.org/bot{token}/sendMessage',
            data=urllib.parse.urlencode({'chat_id': chat_id, 'text': text, 'disable_web_page_preview': 'true'}).encode(),
            method='POST', headers={'Content-Type': 'application/x-www-form-urlencoded'})
        value = _json(request)
        result = value.get('result')
        if value.get('ok') is not True or not isinstance(result, dict): return False
        message_id = result.get('message_id'); chat = result.get('chat')
        if type(message_id) is not int or message_id <= 0 or not isinstance(chat, dict) or type(chat.get('id')) is not int: return False
        if chat_id.startswith('@'):
            return isinstance(chat.get('username'), str) and ('@' + chat['username']).casefold() == chat_id.casefold()
        return str(chat['id']) == str(chat_id)
    except Exception: return False

"""Telegram transport using the existing pinned QPK source snapshot."""
from __future__ import annotations

import io
import json
import os
import urllib.request

from notification_snapshot._redaction import redact_sensitive_text
from notification_snapshot.intent import NotificationIntent
from notification_snapshot.telegram import send_notification_intent, send_telegram_message


def send_intent(text, *, token, chat_id, opener=None, timeout=30):
    intent = NotificationIntent(text=redact_sensitive_text(text), run_id="daily-digest", chat_ids=(chat_id,))
    metadata = {"recipient_confirmed": False}

    def observed_opener(request, *, timeout):
        with (opener or urllib.request.urlopen)(request, timeout=timeout) as response:
            raw = response.read(16385)
            if len(raw) > 16384:
                raise ValueError("telegram_response_invalid")
            status = getattr(response, "status", 200)
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeError):
            body = None
        result = body.get("result") if isinstance(body, dict) else None
        if isinstance(result, dict):
            message_id = result.get("message_id")
            chat = result.get("chat")
            if type(message_id) is int and message_id > 0 and isinstance(chat, dict) and type(chat.get("id")) is int:
                matches = (isinstance(chat.get("username"), str) and
                           ('@' + chat['username']).casefold() == chat_id.casefold()) if chat_id.startswith('@') else str(chat['id']) == chat_id
                if matches:
                    metadata.update(recipient_confirmed=True, message_id=message_id)
        wrapped = io.BytesIO(raw)
        wrapped.status = status
        return wrapped

    if token == os.environ.get("TELEGRAM_TOKEN"):
        receipt = send_notification_intent(intent, bot_token_env="TELEGRAM_TOKEN",
                                           opener=observed_opener, timeout=timeout)
    else:
        ok = send_telegram_message(bot_token=token, chat_ids=intent.chat_ids, text=intent.text,
                                   opener=observed_opener, timeout=timeout,
                                   printer=lambda *_args, **_kwargs: None)
        receipt = {"ok": ok, "status": "sent" if ok else "failed"}
    return {**receipt, **metadata}

#!/usr/bin/env python3
"""Observe the daily sender's injected configuration without sending a message.

Only the selected token calls getMe. All external responses and private values
stay in this process; stdout/summary contain the fixed public projection only.
This module deliberately does not import the sender, renderer or aggregator.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Callable, Mapping
import urllib.error
import urllib.parse
import urllib.request


TOKEN_KEYS = ("TELEGRAM_TOKEN", "TG_TOKEN")
CHAT_KEYS = (
    "QSL_GLOBAL_TELEGRAM_CHAT_ID",
    "GLOBAL_TELEGRAM_CHAT_ID",
    "STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS",
)
CHAT_KINDS = (
    "environment_global_primary",
    "environment_global_alias",
    "environment_plugin_first_id",
)


def _text(env: Mapping[str, str], key: str) -> str:
    return (env.get(key) or "").strip()


def _first_chat(raw: str) -> str:
    # Match the existing sender exactly: separators, trimming and first ID.
    return next((part.strip() for part in raw.replace(";", ",").split(",")
                 if part.strip()), "")


def _projection(source_sha: str | None = None) -> dict:
    return {
        "schema": "qsl-digest-route-identity.v1",
        "status": "unknown",
        "reason": "configuration_unobserved",
        "source_sha": source_sha,
        "scope": "daily_sender_environment_configuration",
        "token": {
            "source_kind": "unknown",
            "identity_state": "unknown",
            "winner_equals_shadowed_alias_token": None,
        },
        "chat": {
            "source_kind": "missing",
            "state": "unknown",
            "winner_equals_shadowed_global_alias_first_id": None,
            "winner_equals_shadowed_plugin_first_id": None,
            "equals_independent_canonical": None,
        },
        "topic_parameter": "omitted",
        "canonical_route_approval": "unknown",
        "loaded_runtime_identity": "unknown",
        "natural_delivery": "unknown",
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError("", code, "redirect_rejected", None, None)


def getme_identity(token: str) -> int | None:
    """GET one fixed API method; never allow a redirect carrying credentials."""
    encoded = urllib.parse.quote(token, safe=":")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{encoded}/getMe", method="GET"
    )
    try:
        opener = urllib.request.build_opener(NoRedirect())
        with opener.open(request, timeout=15) as response:
            raw = response.read(65537)
        if len(raw) > 65536:
            return None
        body = json.loads(raw)
        result = body.get("result") if isinstance(body, dict) else None
        if (not isinstance(result, dict) or body.get("ok") is not True
                or result.get("is_bot") is not True):
            return None
        identity = result.get("id")
        return identity if type(identity) is int and identity > 0 else None
    except Exception:  # External exceptions can contain the token or URL.
        return None


def read_secret_token(env: Mapping[str, str]) -> str:
    """Same sender fallback reference; all gcloud output remains captured."""
    secret = _text(env, "TELEGRAM_TOKEN_SECRET_NAME") or "quant-sentinel-telegram-bot-token"
    command = ["gcloud", "secrets", "versions", "access", "latest", "--secret", secret]
    project = (env.get("GCP_PROJECT_ID") or env.get("GOOGLE_CLOUD_PROJECT") or "").strip()
    if project:
        command.extend(["--project", project])
    try:
        result = subprocess.run(command, capture_output=True, text=True,
                                check=False, timeout=30)
        return (result.stdout or "").strip() if result.returncode == 0 else ""
    except Exception:
        return ""


def diagnose(
    env: Mapping[str, str], *,
    getme: Callable[[str], int | None] | None = None,
    secret_reader: Callable[[Mapping[str, str]], str] | None = None,
) -> dict:
    source = _text(env, "SOURCE_SHA")
    valid_source = re.fullmatch(r"[0-9a-fA-F]{40}", source) is not None
    result = _projection(source.lower() if valid_source else None)
    if (env.get("INPUT_EVENT_NAME") != "workflow_dispatch"
            or env.get("INPUT_REF") != "refs/heads/main" or not valid_source):
        result.update(status="blocked", reason="manual_main_source_required")
        return result

    tokens = [_text(env, key) for key in TOKEN_KEYS]
    if tokens[0]:
        token = tokens[0]
        result["token"]["source_kind"] = "environment_primary"
        if tokens[1]:
            result["token"]["winner_equals_shadowed_alias_token"] = token == tokens[1]
    elif tokens[1]:
        token = tokens[1]
        result["token"]["source_kind"] = "environment_alias"
    else:
        token = ""
        result["token"]["source_kind"] = "secret_manager"
        if env.get("DIAGNOSTIC_SM_AUTH_STATUS") == "success":
            try:
                token = ((secret_reader or read_secret_token)(env) or "").strip()
            except Exception:
                token = ""

    chats = [_first_chat(_text(env, key)) for key in CHAT_KEYS]
    winner_index = next((index for index, value in enumerate(chats) if value), None)
    if winner_index is not None:
        chat = chats[winner_index]
        result["chat"].update(source_kind=CHAT_KINDS[winner_index], state="known")
        if winner_index == 0 and chats[1]:
            result["chat"]["winner_equals_shadowed_global_alias_first_id"] = chat == chats[1]
        if winner_index < 2 and chats[2]:
            result["chat"]["winner_equals_shadowed_plugin_first_id"] = chat == chats[2]

    if not token:
        result["reason"] = (
            "secret_manager_token_unavailable"
            if env.get("DIAGNOSTIC_SM_AUTH_STATUS") == "success"
            else "secret_manager_auth_unavailable"
        )
        return result
    try:
        bot = (getme or getme_identity)(token)
    except Exception:
        bot = None
    if type(bot) is not int or bot <= 0:
        result["reason"] = "winner_getme_failed"
        return result
    result["token"]["identity_state"] = "observed"
    if winner_index is None:
        result.update(status="partial", reason="chat_missing")
    else:
        result.update(status="observed", reason="configuration_observed")
    return result


def main(argv: list[str] | None = None) -> int:
    if (sys.argv[1:] if argv is None else argv):
        result = _projection()
        result.update(status="blocked", reason="arguments_not_supported")
    else:
        result = diagnose(os.environ)
    text = json.dumps(result, sort_keys=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        try:
            with Path(summary).open("a", encoding="utf-8") as handle:
                handle.write("## Digest route identity (read-only)\n\n```json\n" + text + "\n```\n")
        except Exception:
            result.update(status="unknown", reason="public_summary_write_failed")
            text = json.dumps(result, sort_keys=True)
    print(text)
    return 0 if result["status"] == "observed" else 2 if result["status"] == "blocked" else 1


if __name__ == "__main__":
    raise SystemExit(main())

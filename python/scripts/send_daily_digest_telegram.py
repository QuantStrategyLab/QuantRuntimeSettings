#!/usr/bin/env python3
"""Send QuantSentinel daily digest via unified bot secret-name path.

Token resolution (never logged):
  TELEGRAM_TOKEN / TG_TOKEN → else gcloud Secret Manager via
  TELEGRAM_TOKEN_SECRET_NAME (default quant-sentinel-telegram-bot-token).

Chat resolution (never logged):
  QSL_GLOBAL_TELEGRAM_CHAT_ID → GLOBAL_TELEGRAM_CHAT_ID →
  STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS (first id).

Dry-run renders and prints delivery readiness without calling Telegram.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import daily_digest_aggregator as aggregator  # noqa: E402
import daily_digest_notify as digest  # noqa: E402

DEFAULT_SECRET_NAME = "quant-sentinel-telegram-bot-token"


def _split_chat_ids(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [part.strip() for part in str(raw).replace(";", ",").split(",") if part.strip()]


def resolve_telegram_chat_id() -> str:
    for key in (
        "QSL_GLOBAL_TELEGRAM_CHAT_ID",
        "GLOBAL_TELEGRAM_CHAT_ID",
        "STRATEGY_PLUGIN_ALERT_TELEGRAM_CHAT_IDS",
    ):
        chats = _split_chat_ids(os.environ.get(key))
        if chats:
            return chats[0]
    return ""


def _load_token_from_secret_manager() -> str:
    secret_name = (
        os.environ.get("TELEGRAM_TOKEN_SECRET_NAME") or DEFAULT_SECRET_NAME
    ).strip()
    if not secret_name:
        return ""
    command = [
        "gcloud",
        "secrets",
        "versions",
        "access",
        "latest",
        "--secret",
        secret_name,
    ]
    project = (
        os.environ.get("GCP_PROJECT_ID")
        or os.environ.get("GOOGLE_CLOUD_PROJECT")
        or ""
    ).strip()
    if project:
        command.extend(["--project", project])
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        print(
            "Unable to read Telegram token from Secret Manager (gcloud missing).",
            file=sys.stderr,
        )
        return ""
    if result.returncode != 0:
        print(
            "Unable to read Telegram token from Secret Manager "
            f"(secret_name={secret_name!r}; stderr omitted).",
            file=sys.stderr,
        )
        return ""
    return (result.stdout or "").strip()


def resolve_telegram_token() -> str:
    direct = (os.environ.get("TELEGRAM_TOKEN") or os.environ.get("TG_TOKEN") or "").strip()
    if direct:
        return direct
    return _load_token_from_secret_manager()


def missing_delivery_requirements() -> list[str]:
    missing: list[str] = []
    token = resolve_telegram_token()
    chat = resolve_telegram_chat_id()
    if not token:
        missing.append(
            "TELEGRAM_TOKEN (Environment secret) or TELEGRAM_TOKEN_SECRET_NAME "
            f"+ GCP access to {DEFAULT_SECRET_NAME}"
        )
    if not chat:
        missing.append(
            "QSL_GLOBAL_TELEGRAM_CHAT_ID or GLOBAL_TELEGRAM_CHAT_ID "
            "(Environment secret)"
        )
    return missing


def send_telegram_message(*, token: str, chat_id: str, text: str) -> bool:
    body = urllib.parse.urlencode(
        {
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": "true",
        }
    ).encode("utf-8")
    # Token only in URL path for Telegram Bot API; never print it.
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:200]
        print(f"Telegram send failed HTTP {exc.code}: {detail}", file=sys.stderr)
        return False
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"Telegram send failed: {type(exc).__name__}", file=sys.stderr)
        return False
    return bool(payload.get("ok"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Render and optionally send QuantSentinel daily digest."
    )
    parser.add_argument("--business-day", default=os.environ.get("DIGEST_BUSINESS_DAY"))
    parser.add_argument("--locale", default=None)
    parser.add_argument("--candidates", type=Path, default=None)
    parser.add_argument("--no-github", action="store_true")
    parser.add_argument("--platform-config", type=Path, default=None)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Render only; do not call Telegram.",
    )
    parser.add_argument(
        "--write-receipt",
        type=Path,
        default=None,
        help="Write delivery receipt JSON (no secrets/chat ids).",
    )
    args = parser.parse_args(argv)

    payload, text = aggregator.build_digest_payload(
        business_day=args.business_day,
        locale=args.locale,
        candidates_path=args.candidates,
        include_github=not args.no_github,
        config_path=args.platform_config,
    )

    dry_run = args.dry_run or str(os.environ.get("DIGEST_DRY_RUN") or "").lower() in {
        "1",
        "true",
        "yes",
    }

    receipt = {
        "schema_version": "qsl.daily_digest_delivery_receipt.v1",
        "business_day": payload.business_day,
        "locale": digest.normalize_locale(str(payload.locale)),
        "run_count": len(payload.runs),
        "total_fills": digest.total_fills(payload.runs),
        "dry_run": dry_run,
        "delivered": False,
        "missing": [],
        "channel": "quant_sentinel",
        "secret_name_contract": DEFAULT_SECRET_NAME,
    }

    print(text)
    print("---")

    if dry_run:
        missing = []
        # Probe Environment wiring only (no gcloud / Telegram I/O).
        direct_token = (
            os.environ.get("TELEGRAM_TOKEN") or os.environ.get("TG_TOKEN") or ""
        ).strip()
        secret_name = (
            os.environ.get("TELEGRAM_TOKEN_SECRET_NAME") or DEFAULT_SECRET_NAME
        ).strip()
        if not direct_token and not secret_name:
            missing.append("token")
        if not resolve_telegram_chat_id():
            missing.append("chat_id")
        receipt["missing"] = missing
        receipt["status"] = "dry_run"
        print(
            "Daily digest dry-run: message rendered; "
            f"delivery extras missing={missing or 'none'}."
        )
        if args.write_receipt:
            args.write_receipt.parent.mkdir(parents=True, exist_ok=True)
            args.write_receipt.write_text(
                json.dumps(receipt, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        return 0

    missing = missing_delivery_requirements()
    if missing:
        receipt["missing"] = missing
        receipt["status"] = "blocked_missing_secrets"
        print(
            "Daily digest not sent: missing Environment configuration:",
            file=sys.stderr,
        )
        for item in missing:
            print(f"  - {item}", file=sys.stderr)
        if args.write_receipt:
            args.write_receipt.parent.mkdir(parents=True, exist_ok=True)
            args.write_receipt.write_text(
                json.dumps(receipt, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        return 2

    token = resolve_telegram_token()
    chat_id = resolve_telegram_chat_id()
    ok = send_telegram_message(token=token, chat_id=chat_id, text=text)
    receipt["delivered"] = ok
    receipt["status"] = "delivered" if ok else "send_failed"
    if args.write_receipt:
        args.write_receipt.parent.mkdir(parents=True, exist_ok=True)
        args.write_receipt.write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    if not ok:
        print("Daily digest Telegram delivery failed.", file=sys.stderr)
        return 1
    print(
        "Daily digest delivered via QuantSentinel "
        f"(runs={len(payload.runs)}, fills={digest.total_fills(payload.runs)})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

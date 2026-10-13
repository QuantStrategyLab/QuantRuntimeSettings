#!/usr/bin/env python3
"""One authenticated maintenance GET; no claim, ACK, notification or files."""
from __future__ import annotations

import json
import os
import sys

from credential_maintenance_notify import MaintenanceClient, empty_diagnostic
from project_public_digest_receipt import project_public_receipt


def main(argv: list[str] | None = None) -> int:
    diagnostic = empty_diagnostic()
    if not (sys.argv[1:] if argv is None else argv):
        try:
            client = MaintenanceClient.from_environment(os.environ)
            if client:
                client.read_due()  # The returned reminder is never acted on.
                diagnostic = client.diagnostic
        except Exception:
            diagnostic = {'read': 'failed', 'phase': 'unknown', 'delivery': 'unknown'}
    public = project_public_receipt({'maintenance': diagnostic})['maintenance']
    print(json.dumps(public, sort_keys=True))
    return 0 if public['read'] == 'ready' else 1


if __name__ == '__main__':
    raise SystemExit(main())

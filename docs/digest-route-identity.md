# Read-Only Daily Digest Route Diagnosis

English | [简体中文](digest-route-identity.zh-CN.md)

## Scope and entry point

Run the existing `.github/workflows/digest-bot-identity.yml` manually on `main`, reusing the daily digest's `runtime-strategy-switch` Environment. It observes the runner's injected configuration only; it does not attest loaded runtime identity, independently approved canonical routing, chat reachability, or natural delivery. It never reads candidates, renders or sends messages, trades, writes configuration, changes IAM, or creates variables or secrets.

## Resolution and permissions

- Token priority matches the existing sender: nonempty `TELEGRAM_TOKEN`, then `TG_TOKEN`, then Secret Manager. Only the winner receives one GET `getMe` call; a failed primary never falls back to a shadowed alias. `winner_equals_shadowed_alias_token` compares token strings in process rather than querying separate bot identities.
- The workflow copies only the daily workflow's two injected token secrets plus `QSL_GLOBAL_TELEGRAM_CHAT_ID` and `GLOBAL_TELEGRAM_CHAT_ID`. The diagnostic script preserves the sender's `QSL_GLOBAL > GLOBAL > plugin` fallback and comma/semicolon first-ID parsing (covered in unit tests), but the workflow does not inject plugin chat inputs absent from the daily workflow.
- This entry point enables no WIF or Secret Manager login and injects no private variables that might appear in runner headers. When both Environment tokens are empty, the diagnostic exits with fixed `secret_manager_auth_unavailable` / `unknown`, which does not mean the production sender lacks a Secret Manager token. Subprocess support for `latest` Secret Manager reads stays deliberately inactive here; do not add auth or alter routing just to make this check pass.
- `chat.state=known` indicates only that a selector string is configured, not `getChat` or verified reachability. Shadowed chat equality compares first IDs from the original selectors and stays `null` without an independent canonical reference. `topic_parameter=omitted` records existing sender behavior rather than topic approval or delivered messages.

## Public projection and acceptance

Public stdout and job summaries emit only fixed schema, status, reason, and source-kind enums, a validated 40-character workflow source SHA, configured `known`/`unknown` flags, and nullable equality. They never expose bot IDs/names, tokens, chat values, hashes, suffixes, URLs, exceptions, or private cloud/secret references. `observed` denotes only a valid winner `getMe` response and a configured chat string; canonical approval, loaded identity, and natural delivery remain `unknown`. Missing auth/tokens, failed `getMe` calls, or missing chats exit nonzero with unknown/partial evidence.

Acceptance records the final `main` source revision, run URL, and safe projection without running a sender or guard to manufacture notifications. Cross-project bot/chat/topic comparisons and natural screenshots require existing controlled references and an automatic business window.

## Local validation

```bash
python3 -m unittest discover -s python/tests -p 'test_digest_route_identity_diagnostic.py' -v
python3 python/scripts/build_config.py --check
python3 python/scripts/runtime_settings.py validate
python3 -m unittest discover -s python/tests -v
git diff --check
```

Synthetic tests cover winner selection, shadowing, primary-failure isolation, empty inputs, fallback auth boundaries, original chat selectors, private output omission, argument/context rejection, inert imports, and a real subprocess against a local GET fixture without reading real credentials or contacting Telegram. Existing workflow lint, Python, JavaScript, and contract CI checks remain required.

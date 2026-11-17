# QSL Research Task Contract V1

English | [简体中文](qsl-research-task-v1.zh-CN.md)

`qsl.research_task.v1` is the minimal experiment work order passed between AI, the Watcher, and strategy repositories. It describes an evidence-bound, iteration- and time-bounded offline research request only—never an activation, deployment, `paper`, `shadow`, or `live` command.

Every task binds exact candidate identity, strategy revision, `P1`/`P2`/`P3` evidence digests, and the producer revision that emitted them. Tasks declare only the research objective, hypothesis, parameter-bound digest, maximum iterations, and maximum duration, excluding raw market bars, parameter bodies, accounts, brokers, orders, funds, credentials, and URLs.

Authority fields are fixed:

- `research_only=true`
- `no_order=true`
- `size_zero_required=true`
- `p4_p5_p6_authorized=false`

AI can therefore create, diagnose, and verify research candidates without expanding runtime authority; `P4`/`P5` still require independent autonomy policies, and `P6` always requires explicit owner confirmation. Validation lives in `python/scripts/research_task_contract.py` and [`schemas/qsl-research-task.v1.schema.json`](../schemas/qsl-research-task.v1.schema.json).

## Read-only console projection

The console displays research tasks as a read-only queue **separate from candidate lifecycles**. Strategy/pipeline sources own candidates while the Watcher owns tasks it creates, preventing tasks from impersonating candidates or overwriting `P1`/`P3` evidence.

Queue summaries display `task_id`, task type, candidate identity/revision, creation timestamp, short `P1`/`P2`/`P3` digest summaries, experiment caps, fixed authority flags, and read-only audit events; detail views may compare two verified redacted performance observations without copying raw bars, parameter bodies, GCS paths, accounts, orders, funds, or credentials.

`qsl_control_plane_source_snapshot.v1` carries candidate state only. Tasks project through dedicated `qsl_research_task_source_snapshot.v1` source snapshots aggregated into read-only `qsl_research_task_dashboard.v1`:

- Before persisting, the Worker re-validates full `qsl.research_task.v1` payloads, canonical SHA-256, candidate revision, `P1`/`P2`/`P3` digests, and fixed `research_only`/`no_order`/`size_zero_required` flags.
- Task sources authenticate with a dedicated `RESEARCH_TASK_SYNC_TOKEN` and isolated KV prefix, never reusing control-plane, switch, OAuth, policy-root, or broker credentials.
- Duplicate `task_id` values across sources fail closed without rendering conflicting tasks; stale sources show stale/historical status rather than active directives.

Both console consumer and Watcher producer wiring are in place; the Watcher emits snapshots only after `RESEARCH_TASK_SYNC_TOKEN`, `QSL_RESEARCH_TASK_SYNC_URL`, and matching secrets are configured and deployed, exiting safely with `NOT_CONFIGURED` otherwise so an empty queue stays normal and expected.

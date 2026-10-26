# Operations triage in the existing owner decision queue

Status: **DESIGN ONLY / NOT IMPLEMENTED OR ENABLED**. 2026-10-15.
Companion to the ARC [tiered triage design](https://github.com/Pigbibi/ActionsReliabilityController/blob/docs/tiered-ai-issue-triage-design/docs/tiered-ai-issue-triage.md).
This document proposes an operations item in the current website. It changes
no UI, Worker, schema, database, deployment, notification route or live config.

## 1. Existing components, names only

Inspected QRS default-branch revision:
`ee6d42a2ce3e0f45731a881e360d2c53c198f742`.

| Existing name | Present responsibility | Proposed reuse |
| --- | --- | --- |
| `web/strategy-switch-console/frontend/src/DecisionsPage.tsx` | 待办决策 list/detail and adopt/reject intent controls | Add an operations detail variant and approve/reject wording |
| `OverviewDecisionPreview.tsx` | Home preview of the shared decision list | Include operations items through the same source/list |
| `presentation.ts::humanDecisionQueue`, `listDailyDecisions` | Shared filtering, projections and source failure states | Add operations projection; preserve incomplete-source visibility |
| `App.tsx`, `api.ts`, `operations.ts` | Fetch, authenticated actions and uncertain-request reconciliation | Load the operations source and reconcile the same request key |
| `worker.js::humanDecisionCommand` | Transactional human-decision dispatch | Add a distinct operations branch, not owner/promotion/recovery impersonation |
| `human_decision_material`, `human_decision_source_material`, `human_decision_record` | Existing material, source and owner-decision rows | Reuse storage with a distinct `operations_triage` kind |
| `docs/notifications-quant-sentinel.zh-CN.md`, `daily_digest_notify.py` | Existing notification policy and rendering | Link the existing decision page from an admitted alert; do not change routes |

Only component/repository names are recorded. No hostname, chat ID, deployment
mapping, account identifier or credential value is required.

Current source supports research, owner and recovery decision actions; it does
not implement operations triage ingestion. Existing controls include strategy
identity, account selection and shadow-result presentation. Operations items
must use a small kind-specific detail branch without these irrelevant fields.
Do not encode incidents as strategy candidates to force them through current
actions, or reuse the existing control/application approval endpoints.

## 2. Scope and UX

T1 has no website item. T2 links the existing/new draft PR and uses PR review.
T3 always creates or updates one pending-decision item in this same website.
Unknown impact or failed AI analysis is still T3; analysis unavailability is
shown explicitly. A website/ingress failure must not silently discard the item.

An operations item needs:

- A concrete title, repository/workflow and first/last observed time.
- Impact and severity, each marked known or unknown with evidence freshness.
- What happened and what the automation already tried, with actual outcomes.
- AI analysis, recommendation, alternatives, reviewer disagreements and gaps.
- The exact proposed next step and any requested cost/scope, with related
  issue/PR and trusted evidence links.
- **Approve recommendation / Reject recommendation** actions, current status,
  latest revision and recorded owner decision.

Suggested Chinese action labels are “批准这项建议” and “拒绝这项建议”. The
consequence beside the actions is “只记录你的决定，后续操作仍需按原有权限执行。”
Do not present an operations decision as a trading strategy adoption.

Show stale, conflicting, inaccessible and unreadable sources visibly. A source
error must not become “暂无需要你决定的事项”. Operations source failure must not
hide unrelated valid research/account decisions, and a research source failure
must not hide valid operations items. Do not apply the existing title-based
`smoke` filter blindly to real incident titles; synthetic filtering requires a
trusted explicit synthetic flag so a real outage is not hidden by its name.
Keep the current responsive list/detail layout and source-status conventions.

## 3. Proposed envelope (not an existing API)

Use one small contract, for example `operations_triage_item.v1`, with strict
keys and size limits. Endpoint names and producer admission remain to be
reviewed during implementation; no live URL or guessed endpoint is specified.

```json
{
  "schema": "operations_triage_item.v1",
  "kind": "operations_triage",
  "incident_id": "synthetic-incident",
  "episode_id": "synthetic-episode",
  "source_revision": 1,
  "material_key": "synthetic-material-version",
  "tier": "T3",
  "reason_codes": ["evidence_incomplete"],
  "observed_at": "2026-10-15T00:00:00Z",
  "expires_at": "2026-10-16T00:00:00Z",
  "repository": "example/automation",
  "workflow": "check.yml",
  "impact": {"state": "unknown", "summary": "Required input is unavailable"},
  "analysis": {"state": "unavailable", "summary": "Approved AI route unavailable"},
  "recommendation": "Inspect source availability; keep the existing safety gate",
  "alternatives": ["Reject this recommendation and keep the incident open"],
  "evidence_refs": [],
  "related_pr": null,
  "requested_action": "record_recommendation_decision",
  "execution_authority_granted": false
}
```

This fixture has no production identities or values. Input defaults and missing
fields must never turn `unknown` into healthy. Unknown evidence is valid T3
material; only a well-formed, current recommendation can be approved. An
unavailable AI analysis does not prevent the owner rejecting the recommendation
or approving a clearly bounded manual inspection plan. It grants no tool access.

### Admission and ownership

Authenticate the producer using an already approved source-specific mechanism;
derive source and owner from the trusted mapping, never from body fields. A
Pigbibi source cannot inherit a QSL grant or overwrite another source. No
research/control/dispatch credential may be borrowed for convenience. If there
is no existing admitted operations producer, ingestion remains disabled and
the coordinator keeps `decision_delivery_pending`; this design requests no new
identity, secret, IAM or production setting.

Validate repository ownership, T3 classification reasons, monotonic source
revision, UTC timestamps, bounded text, allowlisted link origins and strict
non-executing recommendation fields. Render plain text/escaped Markdown;
reject script/HTML injection, arbitrary attachment fetching and raw logs.
Reject attempts to add account/runtime controls, secret payloads or executable
commands. Unknown schema or source is rejected and recorded as an operational
failure, never converted into an owner/promotion record.

### Upsert, delivery ACK and conflict

1. Subject identity is incident family/episode, source is authenticated and
   material key/revision binds the displayed recommendation. Use an original
   stable request key; repeated delivery returns the same durable ACK.
2. Equal revision and equal content is an idempotent readback; equal revision
   with different content is conflict. Older revisions cannot replace new
   evidence. Persist source/material and projection in the existing transaction.
3. A changed material key invalidates prior approval for the new plan; retain
   the old decision in history. Conflicting producers do not produce a chosen
   healthy winner; show conflict and disable approval until reconciled.
4. After timeout, reconcile the same subject/request. Do not create a second
   item or consider HTTP acceptance equivalent to a durable stored ACK.
5. On rejection, retain the incident and decision but suppress regeneration of
   the identical plan. New evidence updates the same episode; it does not erase
   recurrence, previous decisions or unknown external actions.

## 4. Owner decision contract

Reuse the current authenticated owner/admin policy, session protections and
transactional request-key semantics. A decision binds kind, subject, source,
material key, displayed revision, action, authenticated actor and UTC time.
Require current material for approval and rejection; the first terminal choice
wins. An identical retry returns the same receipt; a conflicting choice or
stale revision returns a conflict. After a lost response, perform a read of
the same request before allowing another action.

Approval means acceptance of this recommendation on this evidence. Rejection
means this recommendation must not proceed automatically. Neither changes the
incident to recovered or performs a merge, deploy, live config change, paid
call, rerun, IAM/secret/server action, order, account activation or risk change.
Show “已记录批准/拒绝” only after receipt readback. The coordinator reads that
receipt; it cannot make privileged work legal by interpreting an owner click
as unrestricted execution permission. The decision endpoint must have no
trading/application dispatch side effect.

## 5. Notification and dead-man integration

The incident coordinator owns classification, deduplication and notification
intent. QRS stores/displays the item and owner decision; it does not emit a
second push for the same item. Existing ARC/QPK monitors own liveness.

Ordinary unconfirmed T3 items are website-only. Dot-confirmed important
findings notify once through an existing admitted sink. Deterministic live
impact, unknown external writes and triage failure are immediate operational
exceptions; no successful AI review is required to alert that triage is down.
Preserve notification reason and actual/unknown delivery status separately.

If QRS is unavailable, the existing incident remains in durable
`decision_delivery_pending`. After ten minutes without a stored ACK, use the
existing independent dead-man/fallback alert with the source issue reference;
do not call this a successfully created website item. If the independent
notification/heartbeat path is not admitted, adoption stays blocked. Never
add a new bot/chat, expand a token scope or change live notify configuration
as part of this design.

## 6. Future implementation and acceptance

Proposed write set is the existing Worker human-decision branch, small API/
operations/presentation additions, one kind-specific section in `DecisionsPage`,
its current overview data source and relevant existing fake/offline tests.
Do not duplicate the incident policy, AI adapter or notification engine here.
No production migration or new dependency is part of this design draft.

Future tests must cover:

- One T3 item in both overview and decision page; T1/T2 absent from this queue.
- Correct non-account operations rendering, analysis unavailable and explicit
  stale/partial/error states, mobile layout and accessible action labels.
- Cross-source/owner rejection, strict unknown schema and escaped malicious
  issue content; real incident titles containing `smoke` remain visible.
- Idempotent upsert/ACK, reordered revisions, content conflicts and offline
  delivery recovery without duplicates.
- Approve/reject, concurrent decisions, stale material and lost-response GET
  reconciliation; no automatic POST replay.
- Readback to the coordinator without any trading, configuration, PR merge,
  paid API, server or notification dispatch side effects.

Baseline relevant tests are `tests/human_decisions_worker_validation.mjs`,
`tests/human_decisions_offline_harness.mjs`,
`tests/owner_decision_extract_validation.mjs` and current frontend validation.
They describe where implementation tests belong; this docs-only PR does not
claim to have implemented or tested the proposed behavior.

Depend on the ARC tier policy and the existing unattended review-loop work
after their own review/adoption. Before implementation, refresh concurrent
`unattended2` results and open PRs; link overlapping work rather than duplicate
it. This PR stays draft with auto-merge unset regardless of CI status.

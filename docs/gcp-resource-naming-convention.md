# GCP resource naming convention

[中文版](gcp-resource-naming-convention.zh-CN.md)

Status: proposed. This document defines how new QuantStrategyLab GCP resources
are named and labelled. It does not authorize any rename, migration, deletion,
deployment or IAM change; each of those needs its own owner-approved plan.

All examples use synthetic values. Real project ids, bucket names, account ids
and project numbers stay in protected configuration, not in this repository.

## General rules

- Lowercase letters, digits and hyphens only. No underscores, no uppercase.
- Names describe *what the resource is for*. They do not embed account numbers,
  project numbers, dates or random suffixes; put those in labels (see below).
- Use one short platform code everywhere (see the table below). Do not mix
  `ibkr` / `interactive-brokers`, `schwab` / `charles-schwab`,
  `longbridge` / `longport` / `lb` for the same platform.
- Accounts are referred to by alias `a1`..`a4`. The alias-to-account mapping is
  kept privately and is never committed.
- Temporary or one-off resources carry the label `expires=<yyyymmdd>` instead of
  a date in the name, and are removed when no longer needed.

### Platform codes

| Platform | Code |
| --- | --- |
| Interactive Brokers | `ibkr` |
| Charles Schwab | `schwab` |
| Firstrade | `firstrade` |
| LongBridge | `longbridge` |
| Binance | `binance` |
| Alpaca | `alpaca` |
| Cross-platform / shared | `qsl` (resources) or `shared` (inside a bucket name) |

### Environment values

`prod`, `paper`, `research`, `shared`.

## Names by resource type

| Resource | Pattern | Synthetic example |
| --- | --- | --- |
| Cloud Storage bucket | `qsl-<platform\|shared>-<purpose>-<env>` | `qsl-shared-runtime-state-prod` |
| Cloud Run service | `<platform>-<mode>[-<market\|alias>]` | `ibkr-live-a1`, `longbridge-paper` |
| Cloud Run job | `<platform>-<action>[-<qualifier>]` | `longbridge-paper-snapshot` |
| Cloud Scheduler job | `<target>-<run\|precheck\|probe\|daily\|tick>` | `ibkr-live-a1-probe` |
| Secret Manager secret | `<platform>-<system>-<kind>[-<qualifier>]` | `schwab-oauth-token` |
| Service account | `<platform>-platform-<role>` | `ibkr-platform-runtime` |

Notes:

- Buckets are globally unique. If the preferred name is taken, append a short
  random suffix and record the reason in the bucket label `note`; do not use a
  project number.
- Services do not carry a `-service` suffix; the resource type is already known.
- Scheduler names use a fixed trigger vocabulary: `run` (the main invocation),
  `precheck`, `probe` (the pre-run health probe; do not use `warmup`), `daily`,
  `tick`. Numeric suffixes such as `-1` are not allowed; use the account alias.
- Secret `kind` is one of `token`, `password`, `api-key`, `app-secret`,
  `private-key`, `config`. Platform-agnostic secrets use the `qsl` platform code.
- Service accounts keep the existing `<platform>-platform-<role>` pattern
  (`runtime`, `deploy`, `build`, `scheduler`). Shared helpers use `qsl-<role>`.
- Projects: existing project ids are immutable and are not renamed. New projects
  use `qsl-<platform>`.

## Labels

Numbers, dates and ownership metadata go in labels, not names.

| Label | Value |
| --- | --- |
| `owner` | `qsl` |
| `platform` | platform code from the table above |
| `env` | `prod`, `paper`, `research` or `shared` |
| `account` | alias `a1`..`a4`, where the resource is account-specific |
| `expires` | `yyyymmdd`, only on temporary resources |

Labels must not contain account numbers, project numbers or credentials. If a
number is unavoidable, use the last two digits only.

## Google-managed names (allowlist)

These names are created by Google Cloud services, cannot be renamed, and are
exempt from the convention and from any naming lint:

- `<project-id>_cloudbuild` (Cloud Build source bucket)
- `run-sources-*` (Cloud Run source deploy buckets)
- `cloud-run-source-deploy` (Artifact Registry repository)
- `container-analysis-*` (Pub/Sub topics)
- `<project-number>-compute` (default Compute Engine service account)
- `gcf-*`, `artifacts.*` and other `*.appspot.com` / `gcr.io` service buckets

Do not migrate allowlisted resources.

## Tiered policy

1. **New resources must comply.** A change that creates a resource violating
   this document is not merged or deployed.
2. **Existing resources keep their name** unless an owner-approved migration
   plan names them. Renaming is never done opportunistically.
3. **Labels** may be added to existing user-created resources at any time. This
   is metadata only; for Cloud Run, check that the label update does not create
   a new revision or change traffic before applying it to a live service.
4. **Immutable names.** Buckets, secrets, service accounts, projects and Cloud
   Run services cannot be renamed. A rename is create-new, switch consumers,
   verify, then delete the old resource after a soak period.

## Migration outline for immutable resources

Ordered from lowest to highest risk; each step needs its own approval.

1. Remove unused or one-off resources.
2. Scheduler jobs: create the new job, verify it fires, delete the old one.
3. Secrets: create the new secret, grant access, repoint consumers, verify,
   keep the old one for a soak period, then disable and delete it. Copying a
   secret reads its value and needs explicit approval; never print it.
4. Buckets: create the new bucket with the same location, class, versioning,
   retention, lifecycle and IAM; copy with `gcloud storage rsync` (or Storage
   Transfer Service); freeze writers; do a final sync and verify object counts,
   sizes and hashes; update every consumer (environment variables, JSON blobs
   embedding `gs://` URIs, workflows) and roll out with a canary; make the old
   bucket read-only; delete it after a soak period.
5. Shared buckets with many consumers last, with a dual-read compatibility
   period and one platform cut over at a time.

Cut over outside market hours and outside the platform's scheduled trading
windows.

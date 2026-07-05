# QuantRuntimeSettings Architecture

## Overview

QuantRuntimeSettings is a **config-driven** runtime settings package that serves as the central control plane for QuantStrategyLab deployments. It defines versioned strategy-to-platform assignments and hosts a Cloudflare Workers-based strategy switch console.

The repository has a **three-tier architecture** built around a single source of truth:

```
platform-config.json  (single source of truth)
       |
       v
  Python scripts      (validation, code generation, deployment tooling)
       |
       v
  Generated assets    (config.js, page_asset.js, strategy_profiles_asset.js)
       |
       v
  Web application     (Cloudflare Worker + frontend SPA)
```

---

## Directory Layout

```
.
├── platform-config.json                 # Central configuration (single source of truth)
├── internal_dependency_matrix.json      # Internal git dependency pin tracking
│
├── python/                              # Python tooling (tests, CI, scripts)
│   ├── pyproject.toml                   # Python project definition & linter config
│   ├── scripts/                         # Build & validation scripts
│   │   ├── build_config.py              # Full build pipeline
│   │   ├── build_platform_config.py     # Generate config.js from platform-config.json
│   │   ├── build_runtime_switch.py      # Build transient runtime targets
│   │   ├── runtime_settings.py          # Core validation & assignment engine
│   │   ├── check_internal_dependency_matrix.py
│   │   ├── gate_codex_app_review.py     # PR merge gate
│   │   ├── inject_platform_config.py    # Inject config into index.html
│   │   └── sync_strategy_switch_page_asset.py
│   ├── tests/                           # Python unit tests
│   │   ├── test_runtime_settings.py
│   │   └── test_internal_dependency_matrix.py
│   └── shell/                           # Shell scripts (Python ecosystem)
│       └── checkout_internal_dependency_consumers.sh
│
├── web/                                 # JavaScript web application
│   └── strategy-switch-console/         # Cloudflare Workers app
│       ├── worker.js                    # Worker backend (OAuth, routing, KV)
│       ├── index.html                   # SPA shell
│       ├── app.js                       # Frontend JavaScript
│       ├── app.css                      # Frontend styles
│       ├── config.js                    # Generated: Platform config constants
│       ├── page_asset.js                # Generated: Embedded index.html
│       ├── strategy_profiles_asset.js   # Generated: Strategy catalog
│       ├── app_css.js                   # Generated: Embedded styles
│       ├── app_js.js                    # Generated: Embedded JS
│       └── wrangler.toml.example        # Cloudflare Workers config template
│
├── schemas/                             # Shared JSON Schema (consumed by both)
│   └── runtime-target.schema.json       # Runtime target validation schema
│
├── tests/                               # JavaScript tests
│   ├── strategy_switch_worker_validation.mjs
│   └── test_cash_financing.js
│
├── docs/                                # Documentation
├── examples/targets/                    # Example runtime targets per platform
├── prompts/                             # LLM prompt templates
│
└── .github/workflows/                   # CI/CD workflows
    ├── validate.yml                     # Python + JS validation (split jobs)
    ├── deploy-strategy-switch-console.yml
    ├── manual-strategy-switch.yml
    ├── codex_pr_review.yml             # Reusable caller to AIAuditBridge
    └── codex_review_gate.yml
```

---

## Tier 1: Source of Truth — `platform-config.json`

Defines the entire runtime configuration universe:

- **4 domains**: `us_equity`, `hk_equity`, `cn_equity`, `crypto`
- **6 platforms**: `longbridge`, `ibkr`, `schwab`, `firstrade`, `qmt`, `binance`
- **18 strategy profiles** with features: income layer, option overlay, DCA, combo
- **Platform capabilities, CSS theming, default accounts, repositories, variable scopes**

Never hardcode platform or strategy data in frontend code — regenerate from this file.

---

## Tier 2: Python Tooling (`python/`)

The `python/` directory contains all Python code, organized as a self-contained project with its own `pyproject.toml`.

**Key scripts:**

| Script | Purpose |
|--------|---------|
| `build_config.py` | Full pipeline: validate config, generate strategy profiles, inject into index.html |
| `build_platform_config.py` | Generate `config.js` (ES module) from `platform-config.json` |
| `runtime_settings.py` | Core engine: validate targets, render variables, apply via `gh` CLI |
| `build_runtime_switch.py` | Build transient runtime targets for manual strategy switch |
| `inject_platform_config.py` | Inject platform config globals into `index.html` |
| `sync_strategy_switch_page_asset.py` | Embed HTML/JSON as ES module assets for Worker deployment |

**Dependency boundary:** Python scripts consume `schemas/runtime-target.schema.json`, `platform-config.json`, and write to `web/strategy-switch-console/`. They do **not** depend on the JavaScript code.

---

## Tier 3: Web Application (`web/`)

A Cloudflare Workers-based strategy switch console. Built with vanilla JS (no framework) and deployed via Wrangler.

**Key files:**

| File | Role |
|------|------|
| `worker.js` | Backend: OAuth, session management, config serving, switch dispatch, KV caching |
| `index.html` | SPA shell with bilingual (zh/en) UI, platform selection, strategy configuration |
| `app.js` | Frontend form logic, i18n, summary panel |
| `config.js` (generated) | Platform config constants consumed by both frontend and worker |

**Dependency boundary:** The web app consumes generated assets (`config.js`, `page_asset.js`) and reads `platform-config.json` indirectly via the Worker API. It does **not** depend on Python scripts at runtime.

---

## CI/CD: Independent Validation

The `validate.yml` workflow runs **two independent jobs**:

1. **`python`** — Python tests, config validation, runtime target validation, dependency matrix checks
2. **`js`** — JS module syntax checks, Worker asset validation, SPA integration tests

Neither job depends on the other. This ensures that a change to Python scripts doesn't need to wait for JS tests, and vice versa.

---

## Change Guide

- **Add a platform/strategy**: Edit `platform-config.json`, then run `python3 python/scripts/build_config.py` to regenerate all derived files.
- **Modify build logic**: Edit files in `python/scripts/`, run `python3 -m unittest discover -s python/tests`.
- **Modify web UI**: Edit files in `web/strategy-switch-console/`, run `node tests/strategy_switch_worker_validation.mjs`.
- **Update runner**: Run both Python and JS validation locally before committing.

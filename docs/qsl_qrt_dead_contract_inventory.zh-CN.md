# QRT 疑似废弃 Schema / 脚本盘点（只读，P2）

> 本文档是**只读盘点**，不删除任何能力、不改变任何运行时门槛语义。所有结论均来自当前
> worktree 内代码库的静态引用检索（`grep`/`import` 链路追踪），不代表业务是否"应该"下线。
> 生成时间：2026-09-07。检索范围：仓库根目录（不含 `.git`）。

## 结论摘要

- `schemas/` 下 22 个 JSON Schema 文件中，**仅 `runtime-target.schema.json` 有生产级引用**
  （docs + 12 个真实 broker 示例配置的 `$schema` 指针 + `python/tests/test_runtime_settings.py`
  经 `runtime_settings.py`（CI 中被 `validate.yml`/`platform-health-monitor.yml` 调用）实际加载校验）。
- 其余 21 个 schema 文件**没有任何 `jsonschema.validate` 式的运行时加载**：仓库内未发现
  `import jsonschema` 或等价库调用。生产脚本（`python/scripts/*.py`）用的是**内联字符串常量校验**
  （例如 `if value["schema"] != "qsl.xxx.v1"`），并不读取 `schemas/*.json` 文件本身。
  这些 `.json` 文件目前的唯一"读者"是部分 `python/tests/test_*.py` 用于契约自检
  （断言 `$id`、`additionalProperties: false` 等结构约束与代码常量一致），或完全无引用。
- `python/scripts/` 下有且仅有 2 组 v1/v2 并存文件：`long_horizon_risk_composer(.py/_v2.py)` 与
  `long_horizon_risk_observation_ingress(.py/_v2.py)`。**注意**：对应设计文档明确写明 v2
  "不替换" v1（`qsl_long_horizon_risk_observation_v2.zh-CN.md`），两者是有意并行的能力分层，
  不是简单的旧版本可删除关系；因此本文档不将其标为 `SUPERSEDED_BY_V2` 删除候选。
- 另外发现一组不在 v1/v2 命名模式内、但同样缺少 CI 入口引用的脚本族（自治策略网关 /
  GCP KMS 策略根 / 对账准入网关），仅被同族脚本互相 `import` 及设计文档提及，未被任何
  `.github/workflows/*.yml` 直接调用，一并列在附录供后续审计参考。

以上均为**证据陈述**，不构成删除建议；是否下线、合并或补齐运行时加载需要业务方确认。

---

## 一、`schemas/` 盘点

标记含义：
- **ACTIVE**：被 CI / console(web) / python/scripts / docs 中至少一处以"生产使用"的方式引用（非仅测试自检）。
- **LIKELY_UNUSED**：仅被 `python/tests/` 用于契约自检，或完全没有任何引用。
- **DOCS_ONLY**：仅出现在文档描述中，代码侧无任何加载/校验。

| Schema 文件 | 标记 | 证据（引用/加载位置） |
|---|---|---|
| `runtime-target.schema.json` | ACTIVE | `docs/ARCHITECTURE.md`、`docs/decision_data_binding_rollout.md` 描述为唯一校验契约；12 个 `examples/targets/**/*.example.json` 以 `"$schema"` 字段指向它；`python/tests/test_runtime_settings.py` 通过 `runtime_settings.py`（CI: `validate.yml`、`platform-health-monitor.yml` 均调用 `runtime_settings.py validate`）加载并校验这些示例。注：`runtime_settings.validate_target()` 本身是内联字段校验，未见其直接 `json.load` 这个 schema 文件本体，但契约语义与其保持一致并被测试锁定。 |
| `qsl-research-task.v1.schema.json` | ACTIVE（弱） | `docs/qsl_research_task_v1.zh-CN.md` 描述；被 `schemas/qsl-research-task-source-snapshot.v1.schema.json`、`schemas/qsl-research-task-dashboard.v1.schema.json` 交叉引用（同族子契约）；`python/tests/test_research_task_contract.py` 加载做结构自检。生产校验逻辑在 `python/scripts/research_task_contract.py` 内联实现，未直接读取本文件。 |
| `qsl-research-task-source-snapshot.v1.schema.json` | LIKELY_UNUSED | 未找到任何引用（无 CI/console/scripts/docs/tests 命中）。 |
| `qsl-research-task-dashboard.v1.schema.json` | LIKELY_UNUSED | 未找到任何引用。 |
| `qsl-m0-research-ledger.v1.schema.json` | ACTIVE（弱） | 被 `qsl-m0-research-dashboard.v1.schema.json`、`qsl-m0-research-publisher-envelope.v1.schema.json` 交叉引用；`python/tests/test_m0_research_ledger.py` 加载自检。对应生产流水线 `python/scripts/m0_research_ledger.py`/`build_m0_research_publisher_envelope.py` 被 CI（`publish-m0-research-ledger.yml`）实际调用，但该 CI 内比对的是 `schema_version` 字符串常量，未见直接读取本 `.json` 文件。 |
| `qsl-m0-research-dashboard.v1.schema.json` | ACTIVE（弱） | 唯一非测试引用来自 `tests/strategy_switch_worker_validation.mjs`（该文件本身是测试脚本，读取本 schema 断言 `properties.schema_version.const`）；console 端 `worker.js` 只用字符串常量 `"qsl_m0_research_dashboard.v1"`，未读取本文件。 |
| `qsl-m0-research-publisher-envelope.v1.schema.json` | ACTIVE（弱） | `python/tests/test_build_m0_research_publisher_envelope.py` 与 `tests/strategy_switch_worker_validation.mjs` 加载自检；生产脚本同样只做字符串比对。 |
| `qsl-m0-research-source-snapshot.v1.schema.json` | LIKELY_UNUSED | 仅 `python/tests/test_m0_research_ledger.py` 加载自检；无 CI/console/scripts/docs 生产引用。 |
| `qsl-deployment-bundle.v1.schema.json` | LIKELY_UNUSED | 仅 `python/tests/test_deployment_bundle_contract.py` 加载自检。生产脚本 `deployment_bundle_contract.py`（被 CI 中 `activation_contract.py` 间接 import，见附录）用内联常量 `SCHEMA_ID` 校验，不读取本文件。 |
| `qsl-activation.v2.schema.json` | LIKELY_UNUSED | 仅 `python/tests/test_activation_contract.py` 加载自检。`activation_contract.py` 被 `manual-strategy-switch.yml` 直接调用（脚本本身 ACTIVE），但不读取本 schema 文件。 |
| `qsl-reconciliation-record.v2.schema.json` | LIKELY_UNUSED | 仅 `python/tests/test_reconciliation_record_contract.py` 加载自检；`reconciliation_record_contract.py` 未见被任何 CI workflow 直接调用（见附录）。 |
| `qsl-autonomous-operating-policy.v1.schema.json` | LIKELY_UNUSED | 仅 `python/tests/test_autonomous_policy_gate.py` 加载自检；`autonomous_policy_gate.py` 未见被任何 CI workflow 调用（见附录）。 |
| `qsl-trusted-policy-root.v1.schema.json` | LIKELY_UNUSED | 同上，仅 `test_autonomous_policy_gate.py` 加载自检。 |
| `qsl-reconcile-only-risk-control.v1.schema.json` | LIKELY_UNUSED | 同上，仅 `test_autonomous_policy_gate.py` 加载自检。 |
| `qsl-reconcile-only-admission.v1.schema.json` | LIKELY_UNUSED | 同上，仅 `test_autonomous_policy_gate.py` 加载自检；对应脚本 `reconcile_only_admission_gate.py` 未见 CI 调用。 |
| `qsl-gcp-kms-policy-root.v1.schema.json` | LIKELY_UNUSED | 同上，仅 `test_autonomous_policy_gate.py` 加载自检；对应脚本 `provision_gcp_kms_policy_roots.py` 未见 CI 调用。 |
| `qsl-gcp-kms-policy-gate-receipt.v1.schema.json` | LIKELY_UNUSED | 同上，仅 `test_autonomous_policy_gate.py` 加载自检。 |
| `qsl-forward-observation-risk-control.v1.schema.json` | LIKELY_UNUSED | 仅 `python/tests/test_autonomous_policy_gate.py` 加载自检；对应脚本 `forward_observation_risk_control.py` 仅被 `docs/qsl_p4_p5_autonomy_delivery_v1.zh-CN.md` 提及，未见任何代码 import 或 CI 调用。 |
| `qsl-owner-decision-intent.v1.schema.json` | LIKELY_UNUSED | 未找到任何引用（无 CI/console/scripts/docs/tests 命中）。 |
| `qsl-control-plane-dashboard.v1.schema.json` | LIKELY_UNUSED | 仅被同目录 `qsl-control-plane-source-snapshot.v1.schema.json` 交叉引用，二者互相引用但均无外部（CI/console/scripts/docs/tests）引用。 |
| `qsl-control-plane-source-snapshot.v1.schema.json` | LIKELY_UNUSED | 同上，仅被 `qsl-control-plane-dashboard.v1.schema.json` 反向交叉引用，无外部引用。 |
| `strategy-health-dashboard.v1.schema.json` | LIKELY_UNUSED | 未找到任何引用（`worker.js` 相关测试用的是字符串常量 `"strategy_health_dashboard.v1"`，并非加载此文件；文件本体零引用）。 |

小计：22 个 schema 文件中 1 个 ACTIVE，5 个 "ACTIVE（弱）"（有生产流水线但未直接加载该文件本体），16 个 LIKELY_UNUSED。

---

## 二、`python/scripts/` v1/v2 并存盘点

| 文件 | 标记 | 证据 |
|---|---|---|
| `long_horizon_risk_composer.py` | ACTIVE（作为依赖） | 被 `long_horizon_risk_observation_ingress.py`、`long_horizon_risk_composer_v2.py`、`long_horizon_risk_observation_ingress_v2.py` 直接 `import`；`docs/qsl_long_horizon_risk_composer_v1.zh-CN.md` 描述其为控制面 v1 契约核心计算器。**v2 依赖 v1 提供的基础函数，不是替代关系**。未见被任何 `.github/workflows/*.yml` 以 CLI 方式直接调用（当前无云存储 adapter/调度接线，文档原文亦确认"当前没有实际云存储 adapter、运行身份或调度接线"）。 |
| `long_horizon_risk_composer_v2.py` | ACTIVE（并行，非替代） | `docs/qsl_long_horizon_risk_observation_v2.zh-CN.md` 明确写明"v2 不替换 `qsl.long_horizon_risk_observation.v1`，也不改变现有 v1 对象、私有读取口或任何运行时配置"；被 `long_horizon_risk_observation_ingress_v2.py` import。同样未见 CI 直接调用。 |
| `long_horizon_risk_observation_ingress.py` | ACTIVE（弱，同上原因未接线） | 被 `docs/qsl_long_horizon_risk_composer_v1.zh-CN.md` 描述为控制面唯一读取入口；import 自 `long_horizon_risk_composer.py`。未见 CI 直接调用。 |
| `long_horizon_risk_observation_ingress_v2.py` | ACTIVE（弱，同上原因未接线） | 被 `docs/qsl_long_horizon_risk_observation_v2.zh-CN.md` 描述；import 自 `long_horizon_risk_composer.py` 与 `long_horizon_risk_composer_v2.py`。未见 CI 直接调用。 |

**结论：这两组 v1/v2 均不标记 `SUPERSEDED_BY_V2`**——设计文档明确声明二者并行、v2 不取代 v1；
唯一共同的、可关注的事实是：四个文件目前均无 CI/调度接线（纯离线库函数，靠 docstring 与设计文档
描述的调用方尚未落地），这是"未接线"而非"废弃"，与 AGENTS.md 中 P4/P5 自治能力"已构建、待接线"
的既有边界一致，不建议据此下线代码。

---

## 三、附录：非 v1/v2 命名、但同样缺少 CI 入口引用的脚本族

> 补充盘点范围之外的额外发现，仅供后续审计参考，不改变本文档"只读、不删除"的结论。

| 文件 | 标记 | 证据 |
|---|---|---|
| `autonomous_policy_gate.py` | LIKELY_UNUSED（CI 层面） | import 自 `gcp_kms_policy_gate.py`、`reconcile_only_admission_gate.py`；自身 import `activation_contract.py`/`deployment_bundle_contract.py`。未见任何 `.github/workflows/*.yml` 以 `python3 python/scripts/autonomous_policy_gate.py` 形式调用。有配套单测 `python/tests/test_autonomous_policy_gate.py`。 |
| `gcp_kms_policy_gate.py` | LIKELY_UNUSED（CI 层面） | import 自 `reconcile_only_admission_gate.py`、`provision_gcp_kms_policy_roots.py`；未见 CI 调用。 |
| `reconcile_only_admission_gate.py` | LIKELY_UNUSED（CI 层面） | 仅被 `docs/qsl_deterministic_execution_gateway_v1.zh-CN.md` 描述；未见 CI 调用或被其他脚本 import。 |
| `provision_gcp_kms_policy_roots.py` | LIKELY_UNUSED（CI 层面） | 仅被 `docs/qsl_gcp_p0_control_root_deployment_v1.zh-CN.md` 描述；未见 CI 调用。 |
| `forward_observation_risk_control.py` | LIKELY_UNUSED（CI 层面） | 仅被 `docs/qsl_p4_p5_autonomy_delivery_v1.zh-CN.md` 描述；未见代码 import 或 CI 调用。 |
| `reconciliation_record_contract.py` | LIKELY_UNUSED（CI 层面） | import `activation_contract.py`/`deployment_bundle_contract.py`；未见 CI 直接调用；有单测。 |
| `deterministic_risk_gate.py` | LIKELY_UNUSED（CI 层面） | 被 `paper_risk_admission_receipt.py` import；被 `docs/qsl_deterministic_risk_gate_kernel_v1.zh-CN.md`、`docs/QSL_P0_P6_CURRENT_STATE_AND_DRIVER_POLICY.zh-CN.md` 描述；未见 CI 调用。 |
| `paper_risk_admission_receipt.py` | LIKELY_UNUSED（CI 层面） | 未见 CI 调用；有单测 `test_paper_risk_admission_receipt.py`。 |
| `gate_codex_app_review.py` | LIKELY_UNUSED（CI 层面） | 仅出现在 `docs/ARCHITECTURE.md` 目录树注释与单测 `test_gate_codex_app_review.py` 中；未见任何 `.github/workflows/*.yml` 调用。 |
| `run_codex_pr_review.py` | SUPERSEDED（自述） | 文件自身 docstring 明确：`"Deprecated compatibility entrypoint ... This repository now delegates PR review to QuantStrategyLab/AIAuditBridge/.github/workflows/codex_pr_review.yml. The local runner is intentionally kept as a tiny stub"`。**这是有意保留的废弃兼容 stub，不是意外死代码**，无需处理。 |
| `execution_evidence_projection.py` | ACTIVE（跨仓 Action） | 被 `actions/publish-runtime-execution-evidence/action.yml` 调用；该 Action 未见被本仓库任何 workflow 的 `uses:` 引用，推测为供其他仓库通过可复用 Action 消费，本仓库内无直接调用点。 |

以上脚本族均有真实业务语义（策略网关/风控准入/GCP KMS 策略根/PR 审查桥接），只是当前
本仓库内未发现 CI 触发点。是否已在其他仓库（如 AIAuditBridge、平台仓）接线，本次盘点
未跨仓核实，仅陈述本仓库内的引用证据。

---

## 四、方法与局限

- 检索方式：`grep -rl` 精确文件名匹配 + 手动追踪 `import` 链路 + 检查 `.github/workflows/*.yml`
  的 CLI 调用行；未做跨仓库（AIAuditBridge、QPK、平台仓）引用检索。
- "LIKELY_UNUSED" 仅代表"本仓库静态检索未发现生产引用"，不代表运行时从未被触发过（例如
  手动运维操作、外部仓库调用、未纳入版本控制的临时脚本）。
- 本文档不建议、不执行任何删除；如需下线，需按 AGENTS.md 的"同根因最多一次定位、一次最小
  修复"及人工授权边界另行处理。

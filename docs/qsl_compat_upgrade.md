# QSL Compatibility & Upgrade Checklist (Central Manifest)

This repository defines the QSL central compatibility manifest and its upgrade policy.

## 文件结构

- `compat/bundles/*.toml`
  - 每个 bundle 用 Calendar Version 命名（当前：`2026.08.0`）。
  - 记录 QSL 管控的固定内部仓库提交。
- `compat/repo-tiers.toml`
  - 记录仓库层级（`core/strategy-lib/pipeline/runtime/ops`）与升级 ring 规则。
- `qsl.toml`
  - 本仓库自身的 QSL 元信息：`tier`、`compat`/`bundle`、`upgrade_ring`。
- `scripts/check_qsl_compat.py`
  - 在任意仓库根目录运行，校验：
    - 禁止 `@main`
    - 禁止短 SHA
    - 禁止 `requirements.txt` / `constraints.txt`（未设置 `allow_legacy=true` 时）
    - 内部依赖 Ref 是否与 `compat/bundles/<bundle>.toml` 一致
- `scripts/render_qsl_dependency_graph.py`
  - 输出当前仓库的 QSL 依赖图（Markdown / Text）。

## 如何接入一个新仓库

1. 在仓库根目录新建 `qsl.toml`：

```toml
[qsl]
bundle = "2026.08.0"   # 选择要对齐的 central bundle
compat = "2026.08.0"   # 兼容检查入口（与 bundle 相同）
tier = "ops/tooling"
upgrade_ring = "ring_e"
allow_legacy = false     # 需要临时兼容时可先放开
enforce_bundle = true    # 过渡仓库可设 false；ref drift 会降级为 warning
```

2. 在 `pyproject.toml`/`uv.lock` 中用完整 SHA 固定 QuantStrategyLab 的内部 git 依赖。

3. 运行自检：

```bash
python scripts/check_qsl_compat.py --repo-root . --non-strict
python scripts/render_qsl_dependency_graph.py --repo-root . --format md
```

说明：
- 默认脚本执行严格模式：`forbidden short/invalid`、`bundle pin mismatch`、`@main` 均为 issue（非零退出）。
- 阶段过渡仓可设置 `enforce_bundle = false`（建议限时）：
  - `forbidden short/invalid` 与 `bundle pin mismatch` 降级为 warning。
  - `forbidden ref 'main'` 始终为 issue，不降级。
  - 当前 checker 已识别 `legacy_reason` 和 `live_constraint_files`；`owner` / `expires_at` / `next_action` 已进入 checker warning，用于约束过渡例外的负责人、到期日和下一步动作。
- `--non-strict` 仅用于本地快速预览，不作为发布门禁依据。

## 版本真相边界与受控升级

不要在文档中把一个 SHA 解释为“所有平台当前运行版本”。QSL 的兼容目标、已保存快照和显式扫描结果有不同用途：

| 目的 | 来源 | 含义 |
| --- | --- | --- |
| 兼容目标 | `compat/bundles/<bundle>.toml` | 已发布的兼容 bundle；用于严格仓库校验与回退基线。 |
| 已保存的依赖快照 | `internal_dependency_matrix.json` | 保存生成时所扫描 consumer 依赖文件的 refs；文件本身不证明扫描了完整仓库集合、最新 main 或实际部署。 |
| 显式扫描所得 projection | `generate-matrix --projects-root ...` 的输出 | 反映指定目录中实际存在的依赖文件；比较前需确认扫描范围及 checkout 版本，不自动代表组织当前状态。 |
| 下一轮 QPK 候选 | `QuantPlatformKit/QPK_PIN` | 只表示待分阶段推广的候选，不代表任何平台已经升级。 |

`QPK_PIN` 变更先经过候选安装与依赖检查，再以只改该文件的 PR 进入主分支。随后才按
`strategy → consumer → aggregate bundle` 顺序创建下游 PR；默认模式为 `upgrade-affected`
（只升落后且受影响仓，拒绝降级；docs/CI-only 候选变更不刷执行仓）。每一个下游 PR 仍须
通过自身 CI，不会直接触发运行时部署或交易。确认某 consumer 已合入的依赖时，读取该仓库
相应提交的 manifest/lockfile；确认运行版本需要实际部署证据，不能用 matrix、bundle 或候选
pin 代替。政策细节见 [internal_dependency_pin_policy.zh-CN.md](internal_dependency_pin_policy.zh-CN.md)
与 QPK ADR 0003 Amendment 2026-09-06。

在同步下游仓库后，明确扫描范围及 checkout 版本，再用生成器维护和核对保存快照：

```bash
python3 python/scripts/qslctl.py generate-matrix --projects-root .. --check --strict
python3 python/scripts/qslctl.py generate-matrix --projects-root .. --sync
python3 python/scripts/qslctl.py plan --projects-root .. --json --strict
python3 python/scripts/check_internal_dependency_matrix.py --projects-root .. --strict --require-consumer-files
```

第一条命令比较指定扫描结果与保存快照；第二条仅在确认扫描范围和依赖变更后更新快照。
fresh checkout、匹配快照和已部署运行不是同义。不同 consumer 使用不同完整 SHA 可以是
合法的已验证组合；快照比较不要求全组织同 SHA，也不证明 schema 或依赖解析兼容。

matrix checker 默认只报告差异，`--strict` 才因报告中的 issue 非零退出。缺少 consumer 文件
始终列入 `missing_files`，只有 `--require-consumer-files` 才将其计为 issue；因此仅 `--strict`
仍可能在扫描不完整时返回零。文本无差异只针对已检查文件；JSON 的 `ok` 仍表示没有 issue，
不是扫描完整性或运行健康声明。CI 先运行合成单测，再 checkout consumers 并报告 drift；
仅修改 matrix 文件时追加 strict 比较，绿色 CI 不代表保存快照已覆盖各仓最新 main。

`plan --strict` 把本地 workspace 中所有 QuantStrategyLab origin checkout 视为 active inventory；
缺少 `qsl.toml` 的仓库会进入 `workspace_inventory.missing_qsl` 并返回非零。若实际依赖 ref 与
已发布 bundle 不唯一一致，命令输出稳定排序的 `HUMAN_REQUIRED` 决策表（候选 ref、consumer、
所需兼容测试），但不会选择或改写 canonical bundle。这是版本分歧提示，不是已证实的不兼容；
选定 bundle 的严格 ref 校验与受影响 consumer 的依赖解析、合同测试仍各自保留。

## Phase-2 Transition Warning 收敛路径

1. 发现 phase-1 之后的 drift/main 问题先通过 `--non-strict` 定位；提交修复前确保日志可回放。
2. 过渡仓可短期开启 `enforce_bundle = false`，仅将 drift / short SHA 降级为 warning。
3. 版本发布前将仓库切回 `enforce_bundle = true`，并清零 transition warning。

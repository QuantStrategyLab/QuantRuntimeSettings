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

不要在文档中把一个 SHA 解释为“所有平台当前运行版本”。QSL 有三个各司其职的版本来源：

| 目的 | 唯一来源 | 含义 |
| --- | --- | --- |
| 兼容目标 | `compat/bundles/<bundle>.toml` | 已发布的兼容 bundle；用于严格仓库校验与回退基线。 |
| 已验证平台实际 pin | `internal_dependency_matrix.json` | 从各 consumer 仓库的 `main` 依赖文件生成；这是平台/策略当前已合入版本的唯一台账。 |
| 下一轮 QPK 候选 | `QuantPlatformKit/QPK_PIN` | 只表示待分阶段推广的候选，不代表任何平台已经升级。 |

`QPK_PIN` 变更先经过候选安装与依赖检查，再以只改该文件的 PR 进入主分支。随后才按
`strategy → consumer → aggregate bundle` 顺序创建下游 PR；每一个下游 PR 仍须通过自身 CI，
不会直接触发运行时部署或交易。平台版本与候选不同步时，优先读取 matrix，而不是 bundle
或候选 pin。

在同步下游仓库后，用生成器维护和核对实际台账：

```bash
python3 python/scripts/qslctl.py generate-matrix --projects-root .. --check --strict
python3 python/scripts/qslctl.py generate-matrix --projects-root .. --sync
python3 python/scripts/check_internal_dependency_matrix.py --projects-root .. --strict --require-consumer-files
```

第一条命令用于 CI/监测，第二条只在经过下游 CI 的变更需要提交台账时使用。这样 bundle、
候选和实际运行依赖不会再因重复手工维护而相互矛盾。

## Phase-2 Transition Warning 收敛路径

1. 发现 phase-1 之后的 drift/main 问题先通过 `--non-strict` 定位；提交修复前确保日志可回放。
2. 过渡仓可短期开启 `enforce_bundle = false`，仅将 drift / short SHA 降级为 warning。
3. 版本发布前将仓库切回 `enforce_bundle = true`，并清零 transition warning。

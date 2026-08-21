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

## 当前中心兼容基线

- Bundle: `2026.08.0`
- QPK: `3acab1923a97b805b077c85c6c19657be0143bac`
- UsEquityStrategies: `be1a2c9f7c388d4dd78bda6c2dd7ccad0d4b13b4`
- HkEquityStrategies: `72008f44050b0dc7415334535dbe784793180159`
- CnEquityStrategies: `167355385dde4e1a2b9dea4ede7077f9fbda13ce`
- CryptoStrategies: `d2b43112154c35c7b6c2651a240054926a779ae9`
- QuantStrategyPlugins: `c798397d9ca9230e404673d7774bac3d478217dc`
- MarketSignalSources: `956dd380f75aac4ecb6f8443d95619c8a7f1c52b`

## Phase-2 Transition Warning 收敛路径

1. 发现 phase-1 之后的 drift/main 问题先通过 `--non-strict` 定位；提交修复前确保日志可回放。
2. 过渡仓可短期开启 `enforce_bundle = false`，仅将 drift / short SHA 降级为 warning。
3. 版本发布前将仓库切回 `enforce_bundle = true`，并清零 transition warning。

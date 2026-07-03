# QSL Compatibility & Upgrade Checklist (Central Manifest Phase-1)

This repository carries the first version of the QSL central compatibility manifest.

## 文件结构

- `compat/bundles/*.toml`
  - 每个 bundle 用 Calendar Version 命名（当前：`2026.07.0`）。
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
bundle = "2026.07.0"   # 选择要对齐的 central bundle
compat = "2026.07.0"   # 兼容检查入口（与 bundle 相同）
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

说明：默认脚本会输出错误并以非零退出码返回；`--non-strict` 仅用于本地快速预览。

## 当前中心兼容基线

- Bundle: `2026.07.0`
- QPK: `0063af3b4a974650ea58a7d3f26dd1b94f65d3e8`
- UsEquityStrategies: `46887bc3f5454d5b59623b1f5efb7c65912c6b8b`
- HkEquityStrategies: `61993bf261aeccf64b5a75428b9405f4e1d1d682`
- CnEquityStrategies: `ffbdf7303179ba6e7f9d3e28c21202f77e04762c`
- CryptoStrategies: `8039ddddde7634ad3615496c9b79d2918996938c`
- QuantStrategyPlugins: `6c10aef8989f52d82571e676092b14d315401989`
- MarketSignalSources: `ea8771b6b65f356e7edc4a2b08cd621186726646`

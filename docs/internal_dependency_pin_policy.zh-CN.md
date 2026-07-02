# 内部依赖 pin 政策

[English](internal_dependency_pin_policy.md)

QuantStrategyLab 通过 git URL pin 在平台、策略与 pipeline 之间共享 Python 包。本文说明 pin 如何被追踪、何时使用 tag 与完整 commit SHA，以及如何安全升级依赖。

## 权威来源

- **已追踪的 pin** 记录在 [`internal_dependency_matrix.json`](../internal_dependency_matrix.json)。
- **校验** 在 QuantRuntimeSettings CI 中执行：

```bash
python3 scripts/check_internal_dependency_matrix.py --projects-root .. --strict
```

若本地 consumer 文件与 matrix 漂移，可先从本地消费方依赖文件重建并同步：

```bash
python3 scripts/check_internal_dependency_matrix.py --projects-root .. --generate --json > /tmp/internal_dependency_matrix.json
python3 scripts/check_internal_dependency_matrix.py --projects-root .. --sync
```

该脚本会将 matrix 条目与各 consumer 仓库中的 `requirements.txt`、`requirements-lock.txt`、`pyproject.toml` 对比。启用 `--strict` 时，即使本地未 checkout  sibling 仓库，ref 不一致也会导致 CI 失败。

## Pin 格式

| 格式 | 示例 | 适用场景 |
|------|------|----------|
| 完整 commit SHA | `aee8121d530c2e92c72b68aee434bf174b3b9c85` | **默认**：`quant-platform-kit`、策略包、以及被 live 平台消费的 pipeline 库 |
| 附注 tag | `v0.7.38` | 仅当 matrix 明确记录该 tag，且 tag 指向预期 release 提交时 |
| 分支名 | `main` | 生产 consumer 避免使用；matrix 不追踪 |

**政策：** 凡进入 Cloud Run、定时 publish 或跨仓库 CI 安装的依赖，优先使用 **完整 SHA**。tag 可用于 release 标记，但 matrix 必须记录 tag，且 CI 应能解析到唯一 commit。

## 包轨道

2026-06 组织对齐后，所有已追踪的 `quant-platform-kit` consumer 统一 pin 同一 commit（`aee8121…`，pyproject 版本 `0.7.38`）。策略包（`us-equity-strategies`、`hk-equity-strategies`、`crypto-strategies`）在 matrix 中各有独立行，策略代码变更时单独升级。

## 升级流程

1. 在**源仓库**（如 QuantPlatformKit、UsEquityStrategies）合并并确认 CI 通过。
2. 更新**直接 consumer** 的 `requirements.txt` / `pyproject.toml` 中的 git ref。
3. 在同一轮变更中更新 `internal_dependency_matrix.json` 对应行。
4. 如有 lockfile，重新生成（例如 UsEquitySnapshotPipelines 执行 `uv lock`）。
5. 开 PR 前在本地运行 matrix 检查：

```bash
cd QuantRuntimeSettings
python3 scripts/check_internal_dependency_matrix.py --projects-root .. --strict
```

6. 仅在上游 CI 已绿后合并 consumer PR。平台 deploy 与 pipeline publish workflow 已对 `main` 做 CI 门控。

## 新增 tracked consumer

1. 为每个 `(consumer_repo, path, package, source_repo)` 组合添加一行 matrix。
2. 确保 QuantRuntimeSettings 的 validate workflow 在 CI 中能访问 sibling 仓库（或说明为何仅 matrix 记录）。
3. package 名称与 pip 元数据一致（例如 `quant-platform-kit`，而非 `QuantPlatformKit`）。

## 相关文档

- [CONTRIBUTING.md](../CONTRIBUTING.md) — PR 范围与验证要求
- [README.zh-CN.md](../README.zh-CN.md) — 手动策略切换与运行配置工具

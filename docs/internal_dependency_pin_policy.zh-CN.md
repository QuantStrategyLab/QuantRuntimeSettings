# 内部依赖 pin 政策

[English](internal_dependency_pin_policy.md)

QuantStrategyLab 通过 git URL pin 在平台、策略与 pipeline 之间共享 Python 包。本文说明 pin 如何被追踪、何时使用 tag 与完整 commit SHA，以及如何安全升级依赖。

## 权威来源（三层语义）

| 层 | 位置 | 含义 | 是否强制安装真相 |
| --- | --- | --- | --- |
| 安装真相 | 各 consumer 的 `pyproject.toml` / lock / `qsl.toml` | 该仓实际安装与 CI 解析的 ref | 是 |
| 台账 | [`internal_dependency_matrix.json`](../internal_dependency_matrix.json) | 已合入实 pin 的组织快照 | 台账一致性是；不等于部署 |
| 候选 | `QuantPlatformKit/QPK_PIN` | 下一轮建议升级目标 | 否；不得单独迫使 live 全员同 SHA |

- **校验** 在 QuantRuntimeSettings CI 中执行：每个 PR 都生成漂移报告；只有修改
  `internal_dependency_matrix.json` 的变更才会以严格模式阻塞合并。这样一个无关的
  控制台或文档 PR 不会因为 checkout 时其他仓库恰好前进而变成不可复现的失败；台账
  本身仍必须在提交时与所有 consumer 一致。
- 交叉说明见 [qsl_compat_upgrade.md](qsl_compat_upgrade.md) 与 QPK ADR 0003 Amendment 2026-09-06。

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

不同 consumer 可以在已验证组合下使用不同的完整 QPK SHA；matrix 记录实 pin，不要求全组织同 SHA。
策略包（`us-equity-strategies`、`hk-equity-strategies`、`crypto-strategies`）在 matrix 中各有独立行，策略代码变更时单独升级。

## 升级流程

1. 在**源仓库**（如 QuantPlatformKit、UsEquityStrategies）合并并确认 CI 通过；`QPK_PIN` 仅推进候选。
2. 只更新**受影响且落后于候选**的直接 consumer；自动 opener 默认 `upgrade-affected`，**禁止**对已超前/相等/分叉仓开降级 PR。
3. 在同一轮变更中更新 `internal_dependency_matrix.json` 对应行（台账跟随实 pin，不倒逼降级）。
4. 如有 lockfile，重新生成（例如 UsEquitySnapshotPipelines 执行 `uv lock`）。
5. 开 PR 前在本地运行 matrix 检查：

```bash
cd QuantRuntimeSettings
python3 scripts/check_internal_dependency_matrix.py --projects-root .. --strict
```

6. 仅在上游 CI 已绿后合并 consumer PR。平台 deploy 与 pipeline publish workflow 已对 `main` 做 CI 门控。
7. 自动化开出的、目标 SHA 旧于当前候选的 leftover PR，应按 superseded/downgrade 关闭，不得合并回退。

## 新增 tracked consumer

1. 为每个 `(consumer_repo, path, package, source_repo)` 组合添加一行 matrix。
2. 确保 QuantRuntimeSettings 的 validate workflow 在 CI 中能访问 sibling 仓库（或说明为何仅 matrix 记录）。
3. package 名称与 pip 元数据一致（例如 `quant-platform-kit`，而非 `QuantPlatformKit`）。

## 相关文档

- [CONTRIBUTING.md](../CONTRIBUTING.md) — PR 范围与验证要求
- [README.zh-CN.md](../README.zh-CN.md) — 手动策略切换与运行配置工具

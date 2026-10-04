# 内部依赖 pin 政策

[English](internal_dependency_pin_policy.md)

QuantStrategyLab 通过 git URL pin 在平台、策略与 pipeline 之间共享 Python 包。本文说明 pin 如何被追踪、何时使用 tag 与完整 commit SHA，以及如何安全升级依赖。

## 权威来源（三层语义）

| 层 | 位置 | 含义 | 是否强制安装真相 |
| --- | --- | --- | --- |
| 安装真相 | 各 consumer 的 `pyproject.toml` / lock / `qsl.toml` | 该仓实际安装与 CI 解析的 ref | 是 |
| 已保存快照 | [`internal_dependency_matrix.json`](../internal_dependency_matrix.json) | 生成时所扫描 consumer 文件中的 refs | 仅快照一致性；不证明最新 main 或实际部署 |
| 候选 | `QuantPlatformKit/QPK_PIN` | 下一轮建议升级目标 | 否；不得单独迫使 live 全员同 SHA |

- **校验** 在 QuantRuntimeSettings CI 中执行：每个 PR 都生成漂移报告；只有修改
  `internal_dependency_matrix.json` 的变更才会以严格模式阻塞合并。这样一个无关的
  控制台或文档 PR 不会因为 checkout 时其他仓库恰好前进而变成不可复现的失败；台账
  本身仍必须在提交时与所有 consumer 一致。
- 交叉说明见 [qsl_compat_upgrade.md](qsl_compat_upgrade.md) 与 QPK ADR 0003 Amendment 2026-09-06。

```bash
python3 python/scripts/check_internal_dependency_matrix.py --projects-root .. --strict --require-consumer-files
```

先将选定的本地 cohort 与保存快照对比。只有确认所有 tracked consumer 均存在、实际 HEAD
与文件摘要已记录、且整组仓库在扫描过程中未漂移，才能重建 matrix。缺少 HEAD 证据的旧
漂移报告不属于新采样 cohort：

```bash
python3 python/scripts/qslctl.py generate-matrix --projects-root .. --check --strict
python3 python/scripts/check_internal_dependency_matrix.py --projects-root .. --generate --json > /tmp/internal_dependency_matrix.json
# 审阅完整 cohort 和依赖变更后：
python3 python/scripts/qslctl.py generate-matrix --projects-root .. --sync
```

该脚本会将 matrix 条目与 sibling consumer 仓库中的 `requirements.txt`、`requirements-lock.txt`、
`pyproject.toml`、`uv.lock` 对比。`--strict` 会因报告中的 issue 非零退出，包括 ref mismatch。
缺少的 consumer 文件始终列入 `missing_files`，只有 `--require-consumer-files` 才将它们计为
issue；因此单独 `--strict` 可能在不完整扫描时返回零。快照匹配或 fresh checkout 都不证明
已部署运行版本，也不证明依赖兼容性。

## Checkout 证据

`bash python/shell/checkout_internal_dependency_consumers.sh --output-root ..` 会 clone 缺少的
consumer 仓库：优先使用可用的请求分支，否则使用 `main`。已有目录保持原状，不执行 fetch、
pull、checkout，也不覆盖本地修改；脚本会校验规范 `QuantStrategyLab/<consumer_repo>` origin、
仓库根目录和 HEAD 连通性。
需要 `git`、`python3`、`gh`，以及有 tracked 仓库读取权限的 `GH_TOKEN` 或 `GITHUB_TOKEN`。

脚本向 stdout 为每仓输出一条 JSON 记录，包括请求 ref、实际选定分支（detached checkout
则为完整 HEAD）、完整 `head_sha`、规范 origin、`worktree_dirty`、`matrix_sha256` 和
manifest/lock 文件的 SHA256 摘要。`sha256` 是工作树实际字节摘要，`head_sha256` 是该 HEAD
中已提交字节摘要；缺失文件与未提交文件明确标记。不打印原 origin URL、凭据或文件正文。
依赖文件为 symlink，或该仓扫描过程中发生变化，均会导致证据采集失败。

这些记录只描述实际 checkout，也包括保留的旧版本或 dirty checkout；请求名称 `main` 不证明
最新 main 或部署状态。生成冻结 cohort 前，仍须确认完整仓库/文件集合，并在整组扫描前后
复核所有 HEAD 和摘要。
单仓稳定不等于全批仓库的原子快照。

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
python3 python/scripts/check_internal_dependency_matrix.py --projects-root .. --strict --require-consumer-files
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

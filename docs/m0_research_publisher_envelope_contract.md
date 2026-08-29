# M0 研究发布封套 v1

`python/scripts/build_m0_research_publisher_envelope.py` 是 M0 研究台账的
**离线**发布构建器。它只接受一个已闭合的
`qsl_m0_research_source_snapshot.v1` 文件，并调用本仓
`m0_research_ledger` validator/aggregator 生成
`qsl_m0_research_ledger.v1`。它不导入 selector、平台配置、调度器、券商、
策略开关或执行组件。

输出为严格的 `qsl_m0_research_publisher_envelope.v1`：

```json
{
  "schema_version": "qsl_m0_research_publisher_envelope.v1",
  "producer": {
    "repository": "QuantStrategyLab/QuantRuntimeSettings",
    "revision": "<40-char immutable git revision>"
  },
  "source_artifact": {
    "repository": "QuantStrategyLab/QuantAdvisorResearch",
    "revision": "<40-char immutable git revision>",
    "run_id": "<immutable run id>",
    "artifact_id": "<immutable artifact id>",
    "sha256": "<SHA-256 of the exact input snapshot bytes>"
  },
  "ledger_sha256": "<SHA-256 of canonical ledger JSON>",
  "ledger": { "...": "qsl_m0_research_ledger.v1" }
}
```

`producer` 和 `source_artifact` 只能包含以上字段；不能附带 token、账户、
平台、策略、权重、仓位、订单或运行时目标。`ledger_sha256` 使用 UTF-8 的
canonical JSON（键排序、紧凑分隔符、禁止 NaN）计算。台账的
`generated_at` 和 `computed_at` 必须相同，均为精确到秒的 UTC `Z` 时间戳。
因此同一 source artifact、metadata 和 `--now` 总会生成字节相同的封套。

尽管 source snapshot 离线输入上限为 2 MiB，生成完成的 canonical envelope
本身必须不超过 **262,144 bytes（256 KiB）**。这个限制按将要写入和 POST 的
紧凑 UTF-8 JSON body 的实际字节数计算，而不是字符数、文件系统占用或 source
snapshot 大小；本地输出文件末尾的换行符不属于 JSON body。超过该上限会以
`publisher_envelope_size_exceeded` fail closed，既不写本地文件，也不发起网络
请求。这个上限与 M0 接收端 Worker ingress 一致，避免“本地可生成但接收端无法
接收”的跨模块失败。

## 默认离线构建

```bash
python3 python/scripts/build_m0_research_publisher_envelope.py \
  --source-snapshot /safe/input/m0-source.json \
  --output /safe/output/m0-envelope.json \
  --source-artifact-repository QuantStrategyLab/QuantAdvisorResearch \
  --source-artifact-revision 0123456789abcdef0123456789abcdef01234567 \
  --source-artifact-run-id 123456789 \
  --source-artifact-id m0-source-snapshot \
  --source-artifact-sha256 "$(sha256sum /safe/input/m0-source.json | awk '{print $1}')" \
  --producer-repository QuantStrategyLab/QuantRuntimeSettings \
  --producer-revision 89abcdef0123456789abcdef0123456789abcdef \
  --now 2026-08-29T12:00:00Z
```

默认模式只写 `--output` 指定的本地 JSON；没有网络调用，也不会读取任何
environment variable。输入源文件限制为 2 MiB、拒绝重复 JSON key，且其原始
字节 SHA-256 必须与显式 `--source-artifact-sha256` 一致。metadata 中的 revision
均要求 40 位小写 git SHA。上述 shell 中的 `sha256sum` 只是操作员生成显式
metadata 的便利方式，构建器不会执行 shell 或命令替换。

## 明确选择的发布

发布不是默认行为。只有传入 `--publish` **且**同时存在两个专用环境变量时，
构建器才会在成功写入本地封套后对 HTTPS endpoint 进行一次 POST：

```bash
export QSL_M0_RESEARCH_LEDGER_PUBLISH_URL='https://research-console.example/api/internal/sync-m0-research-ledger'
export QSL_M0_RESEARCH_LEDGER_PUBLISH_TOKEN='dedicated-publisher-token'

python3 python/scripts/build_m0_research_publisher_envelope.py ... --publish
```

URL 必须是无用户名、无密码、无 query、无 fragment 的 HTTPS URL。token 只从
`QSL_M0_RESEARCH_LEDGER_PUBLISH_TOKEN` 读取，作为 HTTP `Authorization: Bearer`
header；它从不写进封套、标准输出、错误信息或日志。该工具不接受 token CLI 参数，
也不会读取 broker、平台、策略、运行时或通用控制平面凭据。缺少任一专用环境变量，
或 POST 失败，都会 fail closed。

发布 endpoint 只是研究资料接收端：接收者仍必须重验 schema、artifact metadata、
`ledger_sha256` 和 `ledger.policy` 的 `research_only/no_order` 固定值。接收、展示或
排队研究任务都不能构成 P4/P5/P6、Shadow、Paper 或 live 授权。

## 手动发布已验证的 QAR 周报

`.github/workflows/publish-m0-research-ledger.yml` 是唯一的跨仓 M0 发布入口。
它只有 `workflow_dispatch`，不按 push、定时任务或其他 workflow 事件自动运行。操作员
必须输入一个**已经成功完成**的 `QuantStrategyLab/QuantAdvisorResearch`「Weekly
Intelligent Advisory Review」run ID；它不会检索、猜测或自动采用最新 run。

该 job 必须在 `QuantRuntimeSettings` 的 `main` 分支运行（`github.ref` 必须为
`refs/heads/main`），并绑定专用 GitHub Environment `m0-research-publisher`。环境的
deployment branch 也必须只允许 `main`；从其他 ref 手动 dispatch 时 job 会跳过，不能
取得任何环境配置或发布研究台账。

该入口固定只读以下来源：

- repository：`QuantStrategyLab/QuantAdvisorResearch`；
- workflow：`Weekly Intelligent Advisory Review`（GitHub workflow ID `285971223`）；
- artifact：`weekly-model-recommendations`；
- artifact 内唯一命名为 `m0_research_source_snapshot_YYYY-MM-DD.json` 的文件。

在下载前，workflow 用 GitHub App 临时安装令牌验证 run ID、成功状态、workflow 身份、
来源仓库和 `head_repository`、`head_branch=main`、可信 event（仅
`schedule` 或 `workflow_dispatch`）、immutable `head_sha`，以及 artifact 与该 run 的绑定。下载后，
它拒绝不安全 ZIP 路径、多个或缺失 snapshot、超过 2 MiB 的 snapshot、错误 schema/source
ID 或无效 report digest，并计算**原始 snapshot 字节**的 SHA-256。该 SHA、QAR revision、
run ID 和 artifact ID 都作为 `source_artifact` metadata 显式传给构建器，构建器会再次验证
字节 SHA 后才生成封套。

工作流只使用两个专用发布值，并映射到构建器固定读取的环境变量：

| GitHub 配置 | 构建器环境变量 | 用途 |
| --- | --- | --- |
| variable `M0_RESEARCH_SYNC_URL` | `QSL_M0_RESEARCH_LEDGER_PUBLISH_URL` | HTTPS 研究台账接收地址 |
| secret `M0_RESEARCH_SYNC_TOKEN` | `QSL_M0_RESEARCH_LEDGER_PUBLISH_TOKEN` | 接收端专用 Bearer token |

`m0-research-publisher` Environment 还必须保存 GitHub App 配置，而不是任何长期 QAR PAT：

| GitHub 配置 | 用途 |
| --- | --- |
| variable `QAR_ARTIFACT_READER_APP_ID` | 只安装于 QAR 的 GitHub App ID；不是 secret |
| secret `QAR_ARTIFACT_READER_APP_PRIVATE_KEY` | 该 App 的 PEM private key |

App 只能安装到 `QuantStrategyLab/QuantAdvisorResearch`，repository permission 只能是
`Actions: Read-only`。工作流明确把生成的安装令牌进一步缩小到该 owner/repository 和
`actions:read`，并只注入三个 QAR API 读取步骤；`actions/create-github-app-token` 会在 job
结束时撤销令牌。它从不进入构建/发布步骤、封套、输出或日志。

`M0_RESEARCH_SYNC_TOKEN`、`M0_RESEARCH_SYNC_URL`、上述 App ID 和 private key 都必须配置
在 `m0-research-publisher` Environment 中，而不是 repository-level 默认作用域。App 的读取权限
与 M0 发布 token 完全分离；后者只能向 M0 接收端发布封套，二者不得复用、互相授予或写入运行时、
平台配置。

### 一次性创建 GitHub App

组织管理员可在 [QuantStrategyLab GitHub Apps](https://github.com/organizations/QuantStrategyLab/settings/apps/new)
创建私有 App：名称可用 `QSL M0 Research Artifact Reader`，Homepage URL 用
`https://github.com/QuantStrategyLab/QuantRuntimeSettings`，关闭 webhook，唯一 repository permission
选择 `Actions: Read-only`。创建后生成一把 private key，并把**完整 PEM 文件内容**保存为
`QAR_ARTIFACT_READER_APP_PRIVATE_KEY`，把 App 的 App ID 保存为
`QAR_ARTIFACT_READER_APP_ID`。最后通过 App 的 Install 页面选择组织 `QuantStrategyLab`，并且
只选择 `QuantAdvisorResearch`。不要把 PEM 或任何 access token 粘贴到 issue、PR、日志或聊天中。

同一个 `M0_RESEARCH_SYNC_TOKEN` 还必须以**同名、同值的独立 secret**配置到已有的
`runtime-strategy-switch` Environment。它只会在控制台 Worker 的部署 workflow 中被写入
Cloudflare 的 `M0_RESEARCH_SYNC_TOKEN` secret binding；该部署 workflow 不读取 QAR artifact token，
而 M0 发布 workflow 也不读取 Cloudflare 凭据。不要在 repository-level 放置这个名字，避免未受
Environment 保护的 fallback。控制台部署会在部署前验证该 secret；缺失时直接失败，不能静默
保留 Cloudflare Worker 中的旧值。轮换时，先只更新 `runtime-strategy-switch` 中的副本，从 `main`
部署并确认 Worker secret 写入成功；再把同一个新值写入 `m0-research-publisher`，最后手动发布
一份已验证的 M0 ledger。

URL、发布 token 和 QAR 读取 token 不会写进封套、`GITHUB_STEP_SUMMARY` 或 workflow 输出。该
workflow 不读取运行时、平台、selector、策略或券商配置；其唯一网络写入是构建器在
`--publish` 明确指定时，对上述研究接收地址发送经过校验的 no-order 封套。

若已存 current 与来件的 `source_artifact.sha256` 完全相同，接收端返回 `200` 和
`replayed: true`，且不再写 KV。这只确认同一不可变来源已经收到，供网络重试或重复人工触发
恢复；不同 source artifact 的重复 source run、不同来源的重复 ledger 或 ledger 时间回退仍返回
`409`。

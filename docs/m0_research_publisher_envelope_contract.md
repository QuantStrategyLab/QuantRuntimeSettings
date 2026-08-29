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
export QSL_M0_RESEARCH_LEDGER_PUBLISH_URL='https://research-console.example/api/internal/m0'
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

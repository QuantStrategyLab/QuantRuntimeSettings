# P1/P3 非交易数据预授权契约 v1

`qsl.research_data_authorization.v1` 是 P1/P3 的离线验签契约，不是执行生命周期的一部分。它可以复用已公开的 Cloud KMS P-256 验证根，但不调用 `autonomous_policy_gate.py`、不需要 DeploymentBundle 或 Activation，也不改变 P0 执行 gate。

每份授权必须由外部数据控制面固定验证根摘要，并同时绑定：一个仓库与完整 revision、候选和配置的 SHA-256、一个 provider identity，以及有限的非交易操作：历史行情读取、私有证据写入、离线回放。

它固定拒绝凭证访问、paper、shadow、live、订单提交和资金配置。契约中没有凭证、URL、端点、原始行情或可变配置；未知字段、重复 JSON 键、过期/超期授权、签名篡改和任一绑定不匹配都会失败关闭。

命令行只读取本地授权、签名和公开根，且必须由独立数据控制面注入 `QSL_RESEARCH_DATA_POLICY_ROOT_SHA256`：

```text
python/scripts/research_data_authorization_gate.py \
  --authorization authorization.json \
  --authorization-signature authorization.der \
  --trusted-policy-root public-root.json \
  --expected-repository QuantStrategyLab/UsEquitySnapshotPipelines \
  --expected-revision <40-hex-revision> \
  --expected-candidate-sha256 <64-hex-digest> \
  --expected-config-sha256 <64-hex-digest> \
  --expected-provider-id alpaca-market-data
```

该验证器不会签发授权、读取或配置凭证、调用 Cloud KMS、访问行情、写入存储、触发工作流，或触及券商、订单和资金。将来若有专用 P1 采集器，其凭证与最小权限必须由独立运行环境提供；本契约不授予该权限。

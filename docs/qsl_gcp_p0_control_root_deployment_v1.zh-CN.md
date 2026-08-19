# QSL GCP P0 控制根部署 V1

> 状态：`P0_ROOT_BOOTSTRAP_IMPLEMENTED_NOT_RUNTIME_WIRED`
>
> 本文只定义 Cloud KMS 的公开验签根初始化；不创建订单接口、不授予任何工作负载签名权限、不读取券商或市场数据，也不改变现有 Cloud Run、GitHub Actions、账户或资金路径。

## 为什么按运行信任域，而不是按每个仓库复制

`QuantRuntimeSettings`、`QuantPlatformKit`、策略仓和资料仓会共同使用同一套验签合约；它们不是独立的券商写入边界。把密钥复制到每个 Git 仓库既增加轮换面，也无法增加安全性。

P0 按独立运行/GCP 项目隔离根：一个根只对应一个 project 的后续 policy lane。policy 仍会精确绑定目标仓库、revision、环境、账户摘要和零风险控制摘要；同项目内不同仓库不会因为共用根而自动获得权限。

| GCP 项目 | P0 根覆盖的主要仓库/运行域 | 资源状态（2026-08-19 盘点） |
| --- | --- | --- |
| `binancequant` | `BinancePlatform`、`CryptoStrategies`、`CryptoLivePoolPipelines` | 已计费，可初始化 |
| `charlesschwabquant` | `CharlesSchwabPlatform`、`SchwabTokenAutoRefresher` | 已计费，可初始化 |
| `firstradequant` | `FirstradePlatform` | 已计费，可初始化 |
| `interactivebrokersquant` | `InteractiveBrokersPlatform`、`IBKRGatewayManager`、美股策略/快照链 | 已计费，可初始化 |
| `longbridgequant` | `LongBridgePlatform`、港股策略/快照链 | 已计费，可初始化 |
| `qslresearchquant` | 研究、信号与上下文仓 | 当前未关联 billing account；不得尝试初始化 |

核心控制/资料仓（例如 `QuantRuntimeSettings`、`QuantPlatformKit`、`AIAuditBridge`）不直接拥有 Cloud KMS 根。它们只能验证公开 root record，不能签名。

## 最小资源与权限

对每个已计费项目，初始化器只会创建：

1. 启用 `cloudkms.googleapis.com`；
2. 不可删除的 key ring：`global/qsl-p0-policy-root`；
3. 一把 software 保护的 `ASYMMETRIC_SIGN` 密钥：`autonomy-policy-root-v1`，算法固定为 `EC_SIGN_P256_SHA256`，初始版本固定为 `1`；
4. 仓库内的公开 `qsl.gcp_kms_policy_root.v1` JSON record，含 PEM 公钥、key-version 全名和自校验哈希。

P0 **不**创建 signer service account，不授予 `roles/cloudkms.signer` 或 `cloudkms.cryptoKeyVersions.useToSign`，也不将现有 runtime、scheduler、deploy、GitHub OIDC 或 AI 身份接到密钥上。这样 root 可以被独立验证，但尚不存在自动化签发路径。未来若设计自动签发器，它必须是单独的、可审计的控制面服务，并仅在单把 CryptoKey 上获得最小 signer 权限。

Cloud KMS 将 `EC_SIGN_P256_SHA256` 作为推荐椭圆曲线签名算法；公开 PEM 与 DER 签名可由现有离线 gate 用 OpenSSL 校验。[Google Cloud KMS 算法](https://docs.cloud.google.com/kms/docs/algorithms)；[签名创建与验证](https://docs.cloud.google.com/kms/docs/create-validate-signatures)。

## 受控运行方式

先只生成预览（不联网改云端）：

```bash
python3 python/scripts/provision_gcp_kms_policy_roots.py \
  --project binancequant --project charlesschwabquant --project firstradequant \
  --project interactivebrokersquant --project longbridgequant
```

得到授权后才附加 `--apply`。初始化器会在**所有项目 billing 预检通过后**才开始改动；重跑会验证既有 key 的 purpose 和算法，不会替换密钥。每个公开记录写入 `docs/p0_control_roots/gcp/<project>.json`；该文件不含私钥、KMS credential 或订单/账户资料。

根 record 的 SHA-256 还不能放进 workflow input 或仓库变量当作“外部 pin”。真正接入未来只读核对服务时，`QSL_TRUSTED_POLICY_ROOT_SHA256` 必须由该服务独立控制的部署配置注入；本 P0 bootstrap 不修改现有运行服务，因此也不假称已接入。

`qslresearchquant` 在关联明确的 billing account 前保持 `PARKED`。不能为省事把研究 policy 改由某个券商项目的根签发，因为那会扩大跨域故障半径。

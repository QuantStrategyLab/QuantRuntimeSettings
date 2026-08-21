# QSL GCP P0 控制根部署 V1

> 状态：`P0_SEVEN_ROOTS_ALPACA_P5_SIGNER_NOT_RUNTIME_WIRED`
>
> 本文记录 Cloud KMS 的公开验签根初始化和独立 Alpaca P5 lane 的最小 signer 身份；不创建订单接口、不读取券商或市场数据，也不改变现有 Cloud Run、GitHub Actions、账户或资金路径。

## 为什么按运行信任域，而不是按每个仓库复制

`QuantRuntimeSettings`、`QuantPlatformKit`、策略仓和资料仓会共同使用同一套验签合约；它们不是独立的券商写入边界。把密钥复制到每个 Git 仓库既增加轮换面，也无法增加安全性。

P0 按独立运行/GCP 项目隔离根：一个根只对应一个 project 的后续 policy lane。policy 仍会精确绑定目标仓库、revision、环境、账户摘要和零风险控制摘要；同项目内不同仓库不会因为共用根而自动获得权限。

| GCP 项目 | P0 根覆盖的主要仓库/运行域 | 资源状态（2026-08-19 盘点） |
| --- | --- | --- |
| `binancequant` | `BinancePlatform`、`CryptoStrategies`、`CryptoLivePoolPipelines` | 已初始化并读取核验 |
| `charlesschwabquant` | `CharlesSchwabPlatform`、`SchwabTokenAutoRefresher` | 已初始化并读取核验 |
| `firstradequant` | `FirstradePlatform` | 已初始化并读取核验 |
| `interactivebrokersquant` | `InteractiveBrokersPlatform`、`IBKRGatewayManager`、美股策略/快照链 | 已初始化并读取核验 |
| `longbridgequant` | `LongBridgePlatform`、港股策略/快照链 | 已初始化并读取核验 |
| `qslresearchquant` | 研究、信号与上下文仓 | 已初始化并读取核验 |
| `alpacaquant-p5` | `AlpacaPlatform` 的 P5 shadow 控制面（不含 broker） | 已初始化、公开 root record 已核验；仅专用 issuer 在**该 key**有 signer 角色 |

核心控制/资料仓（例如 `QuantRuntimeSettings`、`QuantPlatformKit`、`AIAuditBridge`）不直接拥有 Cloud KMS 根。它们只能验证公开 root record，不能签名。

## 最小资源与权限

对每个项目，初始化器只会创建：

1. 启用 `cloudkms.googleapis.com`；
2. 不可删除的 key ring：`global/qsl-p0-policy-root`；
3. 一把 software 保护的 `ASYMMETRIC_SIGN` 密钥：`autonomy-policy-root-v1`，算法固定为 `EC_SIGN_P256_SHA256`，初始版本固定为 `1`；
4. 仓库内的公开 `qsl.gcp_kms_policy_root.v1` JSON record，含 PEM 公钥、key-version 全名和自校验哈希。

根初始化器本身**不**创建 signer service account，不授予 `roles/cloudkms.signer` 或 `cloudkms.cryptoKeyVersions.useToSign`，也不将现有 runtime、scheduler、deploy、GitHub OIDC 或 AI 身份接到密钥上。2026-08-21 的 `alpacaquant-p5` 是独立的后续 P5 lane：仅 `alpaca-p5-policy-issuer` 被授予其**单把** key 的 `roles/cloudkms.signer`；`alpaca-p5-risk-gate`、`alpaca-p5-ledger`、`alpaca-p5-scheduler` 只有空白身份、无用户管理私钥、无项目级角色、无 WIF 或运行绑定。它们不能签发 policy、读写工件或启动 P5，直到另行逐项接线并复核。其余六个 bootstrap root 仍没有 signer IAM。这样 root 可以被独立验证，但仍不存在 active policy、自动签发服务或运行路径。

Cloud KMS 将 `EC_SIGN_P256_SHA256` 作为推荐椭圆曲线签名算法；公开 PEM 与 DER 签名可由现有离线 gate 用 OpenSSL 校验。[Google Cloud KMS 算法](https://docs.cloud.google.com/kms/docs/algorithms)；[签名创建与验证](https://docs.cloud.google.com/kms/docs/create-validate-signatures)。

## 受控运行方式

先只生成预览（不联网改云端）：

```bash
python3 python/scripts/provision_gcp_kms_policy_roots.py \
  --project binancequant --project charlesschwabquant --project firstradequant \
  --project interactivebrokersquant --project longbridgequant --project qslresearchquant \
  --project alpacaquant-p5
```

得到授权后才附加 `--apply`。初始化器会在**所有项目 billing 预检通过后**才开始改动；重跑会验证既有 key 的 purpose 和算法，不会替换密钥。2026-08-19 已对表中的六个 bootstrap 项目执行初始化，并逐把重新读取 version、PEM 和 SHA-256 后通过交叉核验；2026-08-21 对独立的 `alpacaquant-p5` P5 lane 使用同一初始化器完成相同公开 root 核验。每个公开记录写入 `docs/p0_control_roots/gcp/<project>.json`；该文件不含私钥、KMS credential 或订单/账户资料。

根 record 的 SHA-256 还不能放进 workflow input 或仓库变量当作“外部 pin”。真正接入未来只读核对服务时，`QSL_TRUSTED_POLICY_ROOT_SHA256` 必须由该服务独立控制的部署配置注入；本 P0 bootstrap 不修改现有运行服务，因此也不假称已接入。

六个项目现在各自拥有独立 root；不能为省事把研究 policy 改由某个券商项目的根签发，因为那会扩大跨域故障半径。

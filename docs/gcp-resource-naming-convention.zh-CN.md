# GCP 资源命名规范

[English](gcp-resource-naming-convention.md)

状态：提议中。本文规定 QuantStrategyLab 新建 GCP 资源的命名与标签规则，不授权任何改名、迁移、删除、部署或 IAM 变更；这些操作各自需要负责人批准的计划。

文中示例均为合成值。真实的项目 ID、bucket 名、账号和项目编号只放在受保护配置中，不进入仓库。

## 通则

- 只用小写字母、数字和连字符 `-`，不用下划线和大写。
- 名称说明资源用途，不嵌入账号号、项目编号、日期或随机后缀；这些信息放进标签。
- 每个平台全局只用一个短码（见下表）。同一平台不要混用 `ibkr` / `interactive-brokers`、`schwab` / `charles-schwab`、`longbridge` / `longport` / `lb`。
- 账号用别名 `a1`~`a4` 指代，见[账号别名](#账号别名)；仓库中只允许出现账号号的末两位。
- 临时资源用标签 `expires=<yyyymmdd>`，不在名称里写日期，不再需要时清理。

### 平台短码

| 平台 | 短码 |
| --- | --- |
| Interactive Brokers | `ibkr` |
| Charles Schwab | `schwab` |
| Firstrade | `firstrade` |
| LongBridge | `longbridge` |
| Binance | `binance` |
| Alpaca | `alpaca` |
| 跨平台/共享 | `qsl`（资源名）或 `shared`（bucket 名内） |

### 环境取值

`prod`、`paper`、`research`、`shared`。

## 各类资源的命名

| 资源 | 格式 | 合成示例 |
| --- | --- | --- |
| Cloud Storage bucket | `qsl-<platform\|shared>-<purpose>-<env>` | `qsl-shared-runtime-state-prod` |
| Cloud Run 服务 | `<platform>-<mode>[-<market\|alias>]` | `ibkr-live-a1`、`longbridge-paper` |
| Cloud Run 作业 | `<platform>-<action>[-<qualifier>]` | `longbridge-paper-snapshot` |
| Cloud Scheduler 任务 | `<target>-<run\|precheck\|probe\|daily\|tick>` | `ibkr-live-a1-probe` |
| Secret Manager secret | `<platform>-<system>-<kind>[-<qualifier>]` | `schwab-oauth-token` |
| 服务账号 | `<platform>-platform-<role>` | `ibkr-platform-runtime` |

说明：

- bucket 名全局唯一。首选名被占用时追加短随机后缀，并在 bucket 标签 `note` 里记录原因；不使用项目编号。
- 服务名不带 `-service` 后缀。
- Scheduler 触发词固定为 `run`（主调用）、`precheck`、`probe`（运行前健康探测，不用 `warmup`）、`daily`、`tick`；不允许 `-1` 这类数字后缀，改用账号别名。
- Secret 的 `kind` 取 `token`、`password`、`api-key`、`app-secret`、`private-key`、`config` 之一；跨平台 secret 用 `qsl` 作平台码。
- 服务账号沿用 `<platform>-platform-<role>`（`runtime`、`deploy`、`build`、`scheduler`），共享辅助账号用 `qsl-<role>`。
- 项目 ID 不可修改，已有项目不改名；新项目用 `qsl-<platform>`。

## 标签

数字、日期和归属信息放标签，不放名称。

| 标签 | 取值 |
| --- | --- |
| `owner` | `qsl` |
| `platform` | 上表中的平台短码 |
| `env` | `prod`、`paper`、`research` 或 `shared` |
| `account` | 账号相关资源用别名 `a1`~`a4` |
| `expires` | `yyyymmdd`，仅用于临时资源 |

标签不得包含账号号、项目编号或凭证；确需数字时只保留末两位。

### 账号别名

资源名和标签中只允许使用别名标识账号。下表给出各 IBKR 账号号的末两位，顺序与 IBKR Flex 配置一致；完整账号号只放在受保护配置中，不进入仓库。

| 别名 | 账号（末两位） |
| --- | --- |
| `a1` | `61` |
| `a2` | `60` |
| `a3` | `07` |
| `a4` | `62` |

## Google 托管名称白名单

以下名称由 Google Cloud 服务自动创建，无法改名，不适用本规范和命名检查：

- `<project-id>_cloudbuild`（Cloud Build 源码 bucket）
- `run-sources-*`（Cloud Run 源码部署 bucket）
- `cloud-run-source-deploy`（Artifact Registry 仓库）
- `container-analysis-*`（Pub/Sub topic）
- `<project-number>-compute`（默认 Compute Engine 服务账号）
- `gcf-*`、`artifacts.*` 及其他 `*.appspot.com` / `gcr.io` 服务 bucket

白名单内的资源不迁移。

## 分级策略

1. **新资源必须合规**：创建违反本文的资源的变更不合并、不部署。
2. **已有资源保留原名**，除非有负责人批准的迁移计划点名；不顺手改名。
3. **标签**可随时给已有的用户创建资源添加，仅是元数据；对 Cloud Run，在应用到在线服务前要确认加标签不会产生新 revision 或改变流量。
4. **不可变名称**：bucket、secret、服务账号、项目和 Cloud Run 服务无法改名，改名等于新建、切换消费者、验证，再在观察期后删除旧资源。

## 不可变资源的迁移顺序

按风险从低到高，每一步各自需要批准。

1. 清理未使用或一次性资源。
2. Scheduler：新建、确认能触发、再删旧的。
3. Secret：新建、授权、改指向、验证，旧的保留观察期后停用再删除。复制 secret 要读取其值，需明确批准，且不得打印。
4. Bucket：用相同的位置、存储类、版本控制、保留策略、生命周期和 IAM 新建；用 `gcloud storage rsync`（或 Storage Transfer Service）拷贝；停写；最终同步并校验对象数、大小和哈希；更新所有消费者（环境变量、内嵌 `gs://` 的 JSON、workflow）并金丝雀发布；旧 bucket 改只读；观察期后删除。
5. 消费者众多的共享 bucket 最后做，设双读兼容期，一次切一个平台。

切换放在休市时间，并避开平台的计划交易窗口。

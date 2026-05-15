# QuantRuntimeSettings

[English](#english) | [中文](#中文)

---

<a id="english"></a>
## English

Declarative runtime settings tooling for QuantStrategyLab deployments.

This repository provides the schema and tooling for "which platform runs which strategy". It does not contain live runtime assignments, strategy logic, broker execution code, credentials, or secrets.

## Public Repository Policy

Live target files must not be committed to this public repository. Keep real deployment choices in GitHub Variables/Environments, GitHub Secrets, Secret Manager, or ignored local files under `local/`.

Use repository or environment variables for non-secret runtime choices such as `TARGET_SPEC_JSON`, `RUNTIME_TARGET_JSON`, and plugin mount declarations. Use secrets only for credentials, tokens, and private keys.

If a deployment needs private validation policy, keep it in ignored local files such as `local/policy.json`.

## Boundaries

- `UsEquityStrategies` owns allocation logic, strategy defaults, and risk rules.
- Platform repositories own broker adapters, runtime input collection, notifications, and execution.
- This repository owns runtime target schemas, examples, validation, and rendering tools.
- Secret values are intentionally excluded. Use secret names or platform repository secrets when needed.

## Commands

Validate examples, or local targets when `local/targets/**/*.json` exists:

```bash
python3 scripts/runtime_settings.py validate
```

Render assignments for an example:

```bash
python3 scripts/runtime_settings.py render examples/targets/schwab/live.example.json
```

Preview GitHub variable updates for an ignored local target:

```bash
python3 scripts/runtime_settings.py apply local/targets/longbridge/sg.json
```

Apply GitHub variable updates:

```bash
python3 scripts/runtime_settings.py apply --yes local/targets/longbridge/sg.json
```

`RUNTIME_TARGET_JSON` is canonical. Compatibility variables such as `STRATEGY_PROFILE` are generated from it so they cannot drift independently.

For daily strategies that want both a precheck pass and an execution pass, declare them in `runtime_target.execution_windows`. Keep the strategy logic unchanged; let the platform layer decide whether a window is `notify_only`, `dry_run`, `paper`, or `live`.

## Architecture

This repo acts as a small bridge between strategy selection and platform deployment without exposing live assignments:

- A target file declares the desired runtime target.
- The validator checks that required runtime fields and plugin mounts are coherent.
- Optional ignored local policy can add private strategy/plugin requirements.
- The renderer converts the declaration into platform-specific GitHub variables.
- Platform repositories keep their existing adapter code and consume the generated variables.

---

<a id="中文"></a>
## 中文

QuantStrategyLab 部署运行设置的声明式 schema 和工具仓库。

这个仓库用于描述和校验“哪个平台运行哪个策略”的配置格式，但不保存真实线上运行分配、策略逻辑、券商执行代码、凭据或密钥。

## 公开仓库策略

真实 target 文件不能提交到这个公开仓库。真实部署选择应保存在 GitHub Variables / Environments、GitHub Secrets、Secret Manager，或放在被忽略的 `local/` 目录下。

非敏感运行选择，例如 `TARGET_SPEC_JSON`、`RUNTIME_TARGET_JSON` 和插件挂载声明，可以放在 repository 或 environment variables 中。凭据、token、private key 等必须使用 secrets。

如果某个部署需要私有校验策略，请放在被忽略的本地文件里，例如 `local/policy.json`。

## 边界

- `UsEquityStrategies` 负责分配逻辑、策略默认值和风险规则。
- 平台仓库负责券商 adapter、运行时输入采集、通知和执行。
- 本仓库负责运行 target 的 schema、示例、校验和渲染工具。
- 本仓库不保存 secret value；需要时只引用 secret name 或平台仓库自身的 secret。

## 命令

校验示例；如果存在 `local/targets/**/*.json`，则优先校验本地 target：

```bash
python3 scripts/runtime_settings.py validate
```

渲染一个示例 target：

```bash
python3 scripts/runtime_settings.py render examples/targets/schwab/live.example.json
```

预览被忽略本地 target 对应的 GitHub variable 更新：

```bash
python3 scripts/runtime_settings.py apply local/targets/longbridge/sg.json
```

实际应用 GitHub variable 更新：

```bash
python3 scripts/runtime_settings.py apply --yes local/targets/longbridge/sg.json
```

`RUNTIME_TARGET_JSON` 是唯一 canonical source。兼容变量，例如 `STRATEGY_PROFILE`，由它生成，避免多个配置源互相漂移。

对于希望同时有预检和执行两次运行的日频策略，可以在 `runtime_target.execution_windows` 里显式声明两个窗口。策略逻辑保持不变，由平台层决定某个窗口是 `notify_only`、`dry_run`、`paper` 还是 `live`。

## 架构

这个仓库在策略选择和平台部署之间提供一个轻量 bridge，同时避免公开真实运行分配：

- target 文件声明期望的运行目标。
- validator 检查必填运行字段和插件挂载是否一致。
- 可选的 ignored local policy 可以添加私有策略/插件要求。
- renderer 把声明转换成平台专属 GitHub variables。
- 平台仓库保持现有 adapter 代码，并消费生成后的变量。

# QuantStrategyLab 开发者标准规范

## 架构总览

```
QuantRuntimeSettings (配置 + 控制台)
├── platform-config.json        ← 单一配置源（唯一手动编辑）
├── scripts/build_config.py     ← 构建脚本（自动生成）
├── web/strategy-switch-console/ ← 控制台 Worker
└── .github/workflows/          ← CI/CD 自动部署

各域策略仓库（独立）
├── CnEquityStrategies       → cn_equity domain
├── UsEquityStrategies       → us_equity domain
├── HkEquityStrategies       → hk_equity domain
├── CryptoStrategies         → crypto domain

组合策略仓库（独立）
├── QuantCnComboStrategies
├── QuantUsComboStrategies
├── QuantHkComboStrategies
└── QuantCryptoComboStrategies

执行平台（独立）
├── QmtPlatform              → cn_equity
├── BinancePlatform          → crypto
├── IB/Charles Schwab/FT/LB → us_equity, hk_equity
```

---

## 操作手册

### 一、增加一个新平台

**只需改 1 个文件、加 ~10 行 JSON**

编辑 `platform-config.json` 的 `platforms` 段：

```json
"new_platform_id": {
  "label": "New Platform",
  "code": "NP",
  "accent_color": "var(--np)",
  "css_var": "--np: #hexcolor",
  "repository": "QuantStrategyLab/NewPlatformRepo",
  "variable_scope": "repository",
  "supported_domains": ["us_equity"],
  "capabilities": {
    "margin_policy": true,
    "reserved_cash": true,
    "income_layer": true,
    "option_overlay": true,
    "dca": false
  },
  "default_account": {
    "key": "preview",
    "label": "New Platform",
    "target_name": "preview",
    "supported_domains": ["us_equity"]
  },
  "deployment": {
    "default_execution_mode": "live",
    "dry_run_only": false,
    "env_repo_key": ["STRATEGY_SWITCH_NP_REPO", "RUNTIME_SETTINGS_NP_REPO"]
  }
}
```

**capabilities 含义**：

| 字段 | 作用 | 前端控制 |
|------|------|---------|
| `margin_policy` | 是否支持融资 | 显示现金策略控件 |
| `reserved_cash` | 是否显示预留现金 | 显示预留现金控件 |
| `income_layer` | 是否支持收入层 | 收入层下拉可选 |
| `option_overlay` | 是否支持期权层 | 期权层下拉可选 |
| `dca` | 是否支持定投 | 定投控件可见 |

**然后**：
```bash
python3 scripts/build_config.py    # 本地生成
git add -A && git commit -m "Add platform: new_platform_id"
git push origin main                # CI/CD 自动部署
```

---

### 二、增加一个新策略

**只需改 1 个文件、加 ~5 行 JSON**

编辑 `platform-config.json` 的 `strategies` 段：

```json
"my_new_strategy": {
  "label": "策略中文名",
  "label_en": "Strategy English Name",
  "domain": "us_equity",
  "runtime_enabled": true,
  "features": {
    "income_layer": false,
    "option_overlay": false,
    "dca": false,
    "combo": false
  }
}
```

**若需要收入层**：加 `"income_layer": true` + `income_layer_defaults` 块
**若需要期权层**：加 `"option_overlay": true` + `option_overlay_defaults` 块
**若是定投策略**：加 `"dca": true` + `dca_defaults` 块
**若是组合策略**：加 `"combo": true, "combo_mode": "dynamic"`

**然后**：
```bash
python3 scripts/build_config.py
git add -A && git commit -m "Add strategy: my_new_strategy"
git push origin main
```

---

### 三、增加一个新域（股票市场）

**只需改 1 个文件、加 ~3 行 JSON**

编辑 `platform-config.json` 的 `domains` 段：

```json
"new_domain": {
  "label_zh": "新市场",
  "label_en": "New Market"
}
```

然后把域赋给需要支持该市场的平台的 `supported_domains` 数组。

---

### 四、修改已有策略/平台

只改 `platform-config.json` 对应段落后重新构建：

```bash
python3 scripts/build_config.py
```

CI/CD 自动检测差异并部署。

---

## 本地开发流程

```bash
# 1. 修改配置
vim platform-config.json

# 2. 验证并构建
python3 scripts/build_config.py --check   # 只验证
python3 scripts/build_config.py           # 构建

# 3. 预览（需要 wrangler）
cd web/strategy-switch-console
npx wrangler dev --port 8787
```

## CI/CD 流程

```mermaid
git push main
  │
  ├─→ validate.yml（PR/推送触发）
  │   ├── build_config.py --check
  │   ├── runtime_settings.py validate
  │   ├── JavaScript 语法检查
  │   └── 回归验证（已生成文件 vs git HEAD）
  │
  └─→ deploy-strategy-switch-console.yml（platform-config.json 变更时触发）
      ├── build_config.py（重新生成）
      ├── sync_strategy_switch_page_asset.py（同步）
      ├── validate（同上）
      └── wrangler deploy（Clouderflare Worker 部署）
```

## 禁止事项

- ❌ **禁止**在 `index.html` 或 `worker.js` 中硬编码平台名称/颜色/仓库
- ❌ **禁止**在 `index.html` 中硬编码 `defaultAccountOptions`/`defaultRepositories`/`platformMeta`
- ❌ **禁止**手动编辑 `strategy_profiles_asset.js` 或 `page_asset.js`（由构建脚本生成）
- ❌ **禁止**跳过 `build_config.py --check` 步骤直接部署
- ✅ 所有平台/策略/域的新增和修改，必须在 `platform-config.json` 中完成

## 概念索引

| 概念 | 定义位置 | 前端消费 | 说明 |
|------|---------|---------|------|
| **Platform** | `platform-config.json > platforms` | 控制台 Tab、帐号下拉、策略过滤 | 交易所/券商等执行端 |
| **Domain** | `platform-config.json > domains` | 策略分类标签、平台可选的域 | 股票市场类型 |
| **Strategy** | `platform-config.json > strategies` | 策略下拉、控件显隐 | 交易策略 |
| **Capability** | `platforms.*.capabilities` | `platformSupports*` 系列函数 | 平台能力声明 |
| **Feature** | `strategies.*.features` | 收入层/期权层/DCA 控件显隐 | 策略特性声明 |

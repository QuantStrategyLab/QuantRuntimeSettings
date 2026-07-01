# QuantRuntimeSettings 配置驱动架构设计规范

## 问题诊断

当前增加一个平台/域/策略需要修改至少 **6 个文件、50+ 处硬编码**，导致 72 次 commit/天。

### 硬编码清单

| 文件 | 硬编码内容 | 类型 |
|------|------|------|
| `index.html` | `platformMeta`(6), `defaultRepositories`(6), `defaultAccountOptions`(6), `state.forms`(6), `defaultStrategyProfiles`(18), `strategyDomains`(4), `platformSupportsMargin`(1), `platformSupportsReservedCash`(1), `platformSupportsDca`(1), `platformDryRunOnly`(1), `dcaProfileDefaults`(2), i18n domain labels(3) | 数据+逻辑 |
| `worker.js` | `SUPPORTED_PLATFORMS`(6), `SUPPORTED_STRATEGY_DOMAINS`(4), `PLATFORM_META`(6), `DEFAULT_PLATFORM_REPOSITORIES`(6), `PLATFORM_REPOSITORY_ENV`(6), `DEFAULT_VARIABLE_SCOPE`(6), `PLATFORM_RESERVED_CASH_*`(4) | 数据 |
| `strategy-profiles.example.json` | 19个策略完整定义 | 数据 |
| `examples/targets/*/` | 每个组合独立的 target JSON | 数据 |

### 核心问题

**数据和逻辑混合**：平台的属性（颜色、名称、域）和业务逻辑（是否支持期权、保证金、DCA）散落在 HTML/JS 各处，每次新增都需要改多份代码。

---

## 方案：配置驱动的三层架构

```
┌─────────────────────────────────────────────────────┐
│  platform-config.json  (单一配置源)                  │
│  ├── platforms:    元数据 + 能力声明                  │
│  ├── domains:      域名 → i18n                       │
│  └── strategies:   profile → 特征/域                 │
├─────────────────────────────────────────────────────┤
│  sync 脚本 (build-time)                             │
│  └── 生成:  JS bundles / KV seed / target JSONs      │
├─────────────────────────────────────────────────────┤
│  Worker API (runtime)                               │
│  └── GET /api/config → 返回完整配置给前端              │
└─────────────────────────────────────────────────────┘
```

---

## 新增平台/域/策略时只需做的事

### 增加一个平台（如 binance）

**只需改 1 个文件**：`platform-config.json`

```json
{
  "platforms": {
    "binance": {
      "label": "Binance",
      "code": "BN",
      "accent_color": "#f0b90b",
      "repository": "QuantStrategyLab/BinancePlatform",
      "variable_scope": "repository",
      "supported_domains": ["crypto"],
      "capabilities": {
        "margin_policy": false,
        "reserved_cash": false,
        "income_layer": false,
        "option_overlay": false,
        "dca": true,
        "dry_run_only": false
      },
      "default_execution_mode": "live",
      "default_account": {
        "key": "preview",
        "label": "Binance",
        "target_name": "crypto_combo",
        "supported_domains": ["crypto"]
      }
    }
  }
}
```

前端/后端的 **所有行为自动推导**：
- `platformSupportsMargin(binance)` → 读 `capabilities.margin_policy`
- `platformDryRunOnly(binance)` → 读 `capabilities.dry_run_only`
- 收入层/期权层显隐 → 读 `capabilities.income_layer/option_overlay`
- DCA 控件 → 读 `capabilities.dca`
- 帐号域过滤 → 读 `default_account.supported_domains`
- 平台颜色 → 读 `accent_color`

### 增加一个策略

**只需改 1 个文件**：`strategy-profiles.json`

```json
{
  "profile": "cn_stock_momentum_rotation",
  "label": "CN Stock Momentum",
  "label_zh": "A股个股动量",
  "domain": "cn_equity",
  "features": {
    "runtime_enabled": true,
    "income_layer": false,
    "option_overlay": false,
    "dca": false,
    "combo": false
  }
}
```

前端自动渲染：收入层/期权/DCA 控件的显隐由 `features` 决定。

### 增加一个股票市场域（如 crypto）

**只需改 1 个文件**：`platform-config.json` 的 `domains` 部分

```json
{
  "domains": {
    "us_equity":  { "label_zh": "美股",  "label_en": "US Equity" },
    "hk_equity":  { "label_zh": "港股",  "label_en": "HK Equity" },
    "cn_equity":  { "label_zh": "A股",   "label_en": "CN A-share" },
    "crypto":     { "label_zh": "加密",  "label_en": "Crypto" }
  }
}
```

---

## 实施路线

### Phase 1 — 提取配置 (1-2h)

1. 创建 `platform-config.json`（包含当前所有平台属性+能力+域）
2. 创建规则：**前端/后端禁止硬编码平台属性，一律读配置**

### Phase 2 — 前端重构 (2-3h)

1. `index.html` 删除所有硬编码的：
   - `platformMeta` → 从 API 读
   - `defaultAccountOptions` → 从 API 读  
   - `strategyDomains` → 从 domains 配置推导
   - `platformSupports*` 函数 → 从 capabilities 推导
   - `defaultRepositories` → 从 API 读
   - `dcaProfileDefaults` → 从策略 features.dca 推导

2. `worker.js` 删除所有硬编码，改为读 `platform-config.json`：
   - `SUPPORTED_PLATFORMS` → `Object.keys(config.platforms)`
   - `PLATFORM_META` → `config.platforms[id]`
   - `DEFAULT_PLATFORM_REPOSITORIES` → `config.platforms[id].repository`

### Phase 3 — 代码生成 (1h)

1. `sync_strategy_switch_page_asset.py` 扩展为完整构建脚本
2. 从 `platform-config.json` + `strategy-profiles.json` 生成：
   - `worker.js` 的配置常量部分
   - `strategy_profiles_asset.js`
   - `account-options.example.json`
   - 各平台的 `target/*.example.json`

---

## 新增操作手册

### 增加新平台

1. 编辑 `platform-config.json` → 加 `platforms.newplatform`
2. 运行 `python3 scripts/build_config.py`
3. 部署 `npx wrangler deploy`

### 增加新策略

1. 编辑 `strategy-profiles.json` → 加 profile entry
2. 运行 `python3 scripts/build_config.py`
3. 部署

### 增加新域

1. 编辑 `platform-config.json` → 加 `domains.newdomain`
2. 把域赋给某个平台的 `supported_domains`
3. 运行 `python3 scripts/build_config.py`
4. 部署

---

## 配置即文档

`platform-config.json` 本身就是架构文档，任何人看一眼就知道：
- 有哪些平台，各自支持什么能力
- 哪些域，哪些策略属于哪个域
- 平台和域的映射关系

不需要再去读 index.html/worker.js 的 JavaScript 代码。

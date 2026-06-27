# 策略切换控制台架构与安全 Review

[English](strategy_switch_architecture_security_review.md)

日期：2026-06-09

## 摘要

当前方案适合个人量化系统：公开页面只读，GitHub OAuth 通过后才允许触发 Worker，真正写 GitHub Variables 的动作仍由 `Manual Strategy Switch` workflow 执行。这个边界比“网页密码 + 前端 token”安全，也比大型审批后台简单。

本次 review 没发现需要停止发布的 Critical/High 问题。已补上基础安全响应头、状态变更请求的同源 `Origin` 要求，并把主切换页动态渲染改成 DOM API。

## 当前架构理解

- 前端页面在 [web/strategy-switch-console/index.html](/home/ubuntu/Projects/QuantRuntimeSettings/web/strategy-switch-console/index.html:580) 提供四个平台的账号、策略、模式选择。
- Worker 在 [web/strategy-switch-console/worker.js](/home/ubuntu/Projects/QuantRuntimeSettings/web/strategy-switch-console/worker.js:47) 负责路由、GitHub OAuth、session、allowlist/admin 校验、账号配置读取和 workflow dispatch。
- workflow 在 [.github/workflows/manual-strategy-switch.yml](/home/ubuntu/Projects/QuantRuntimeSettings/.github/workflows/manual-strategy-switch.yml:125) 使用 `runtime-strategy-switch` environment，并只给 job `contents: read`。
- 真正的跨平台写入使用 GitHub Actions secret `RUNTIME_SETTINGS_GH_TOKEN`，Worker 只持有 dispatch token。

## 已处理发现

### F-001：安全响应头此前没有在 Worker 代码中显式设置

Severity：Medium

Location：[web/strategy-switch-console/worker.js](/home/ubuntu/Projects/QuantRuntimeSettings/web/strategy-switch-console/worker.js:29)

Evidence：现在所有 HTML、JSON、redirect 响应都会经过 `responseHeaders()`，并带上：

```js
"frame-ancestors 'none'"
"X-Content-Type-Options": "nosniff"
"X-Frame-Options": "DENY"
```

Impact：开源项目的公开 Worker 页面如果缺少 clickjacking、nosniff、referrer 等防护，浏览器侧暴露面更大。

Fix：新增 `SECURITY_HEADERS`，并在 [responseHeaders](/home/ubuntu/Projects/QuantRuntimeSettings/web/strategy-switch-console/worker.js:1444) 统一应用。

False positive notes：如果 Cloudflare 账号侧也配置了同类 header，这是 defense-in-depth，不冲突。

### F-002：状态变更 POST 现在要求同源 Origin

Severity：Medium

Location：[web/strategy-switch-console/worker.js](/home/ubuntu/Projects/QuantRuntimeSettings/web/strategy-switch-console/worker.js:162)、[dispatchSwitch](/home/ubuntu/Projects/QuantRuntimeSettings/web/strategy-switch-console/worker.js:555)

Evidence：

```js
requireSameOrigin(request, { requireOrigin: true });
```

Impact：`/api/switch`、`/api/admin/config`、`/api/logout` 都是状态变更路径。要求浏览器 POST 带同源 `Origin`，能减少 cookie-auth endpoint 被跨站触发的空间。

Fix：`requireSameOrigin()` 现在支持 `requireOrigin`，缺失或跨站 Origin 都会以 403 拒绝。OAuth GET callback 不受影响。

False positive notes：非浏览器脚本如果手动带 session cookie 调 POST，也必须提供正确 `Origin` header。

### F-003：主切换页不再用 innerHTML 渲染配置数据

Severity：Low/Medium

Location：[web/strategy-switch-console/index.html](/home/ubuntu/Projects/QuantRuntimeSettings/web/strategy-switch-console/index.html:1106)

Evidence：平台按钮、账号下拉、策略下拉、摘要列表现在使用 `document.createElement()`、`textContent`、`new Option()` 和 `replaceChildren()`。

Impact：账号和策略目录未来会继续动态化，减少 HTML 字符串拼接能降低 DOM XSS 误用风险。

Fix：主切换页删除了 `.innerHTML` 动态渲染路径，并在 [tests/strategy_switch_worker_validation.mjs](/home/ubuntu/Projects/QuantRuntimeSettings/tests/strategy_switch_worker_validation.mjs:12) 加了回归检查。

## 主要设计压力点

- CSP 仍然需要 `script-src 'unsafe-inline'` 和 `style-src 'unsafe-inline'`，因为当前页面和管理页都是单文件内联脚本/样式。对个人 Worker 可接受；如果后续多人使用，建议把脚本/样式拆成静态模块或引入 nonce/hash。
- 代码中没有应用级 rate limit。GitHub OAuth、allowlist、Cloudflare 平台本身能挡住主要风险；如果 Worker 域名公开传播，建议在 Cloudflare 侧给 `/login`、`/callback`、`/api/switch` 配轻量限流。
- session 是 Worker 内的 HMAC 签名 cookie，不是服务端 session store。当前 cookie 只存 login、orgs、exp，不存 secret，且每次读取会重新校验最新 auth config。保持 `SESSION_SECRET` 足够长并定期轮换即可。

## 推荐方案

- 保持 Worker 作为“登录、权限、参数校验、dispatch”边界。
- 保持 workflow 作为“preview、确认词、GitHub Variables 写入、平台同步”边界。
- 账号配置继续只放 route/account selector/service name，不放 broker 密码、token、API key。
- 新增平台或策略时继续走 `strategy_profile`、`domain`、`supported_domains` 目录规范，这样页面和 Worker 校验会自动收敛。

## 不推荐方案

- 不建议用网页密码替代 GitHub OAuth。密码方案需要自己处理哈希、轮换、暴力尝试、泄漏响应，收益不大。
- 不建议把高权限 token 放前端。开源项目里前端代码和网络请求都无法保密。
- 不建议让 Worker 直接写四个平台仓库的变量。现在让 workflow 写入，审计、确认词、回滚路径都更清楚。

## 验证策略

- `node --experimental-default-type=module tests/strategy_switch_worker_validation.mjs`
- `sed -n '/<script>/,/<\/script>/p' web/strategy-switch-console/index.html | sed '1d;$d' | node --check --input-type=commonjs`
- `node --check --input-type=module < web/strategy-switch-console/page_asset.js`
- `node --check --input-type=module < web/strategy-switch-console/strategy_profiles_asset.js`
- `node --check --input-type=module < web/strategy-switch-console/worker.js`
- `python3 scripts/runtime_settings.py validate`
- `python3 -m unittest discover -s tests -v`

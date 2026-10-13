# 中央摘要通知配置只读诊断 / Read-only daily digest route diagnosis

## 范围与入口 / Scope and entry point

仅在 `main` 手动运行 `.github/workflows/digest-bot-identity.yml`，复用中央摘要既有 `runtime-strategy-switch` Environment。这是 runner 当次配置观测，不是正在服务的 runtime 加载身份、独立批准的 canonical route、chat 可达或自然送达证明。不会读取候选、渲染消息、调用 `sendMessage`、交易、写入配置、变更 IAM 或新增 vars/secrets。

Run the existing `digest-bot-identity.yml` manually on `main`, using the daily digest's existing Environment. It observes this runner's injected configuration; it does not attest loaded runtime identity, independently approved canonical routing, chat reachability or natural delivery. It never reads candidates, renders/sends messages, trades, writes configuration, changes IAM or creates variables/secrets.

## 解析与权限 / Resolution and permissions

- Token 与现有 sender 一致：非空 `TELEGRAM_TOKEN` > `TG_TOKEN` > Secret Manager。只对当次获胜 token 调用一次 Telegram `getMe`（GET）；主 token 失败时不查询次 token 来补出成功。两 token 同时存在时只在进程内比较 token 字符串；`winner_equals_shadowed_alias_token` 不是两个 bot 身份的比较。
- 工作流只复用 daily 工作流实际注入的两个 token secrets、`QSL_GLOBAL_TELEGRAM_CHAT_ID` 与 `GLOBAL_TELEGRAM_CHAT_ID`。不新增 plugin chat 注入。诊断脚本保留 sender 原始 QSL_GLOBAL > GLOBAL > plugin selector、逗号/分号分隔与首 ID 语义；测试覆盖 plugin fallback，但实际入口没有凭空新增该输入。
- 当前入口没有 WIF/Secret Manager 登录，也不注入可能在 runner header 暴露的私有 vars。两个 env token 均空时固定为 `secret_manager_auth_unavailable` / `unknown`；这不表示实际 sender 的 Secret Manager token 缺失。脚本的 SM 读取支持已知成功认证后的原 sender `latest` reference，stdout/stderr 被捕获；本入口明确不启用它。不要通过新增认证或更换路由来使诊断通过。
- `chat.state=known` 只表示 selector 得到配置字符串，未执行 `getChat` 或验证可达。shadowed chat equality 仅比较各原 selector 的首 ID；没有独立 canonical 时始终为 null。现有中央 sender 不传 topic 参数，记录 `topic_parameter=omitted`，不替代已批准的 topic 合同或自然截图。

Token priority matches the existing sender: nonempty primary Environment token, then alias, then Secret Manager. Only the winner receives one GET `getMe`; a failed primary never falls back to a successful shadowed alias. Shadowed-token equality compares credentials, not independently queried bot identities. The workflow copies only the daily workflow's existing injected token and two global-chat secrets. The script preserves the sender's plugin fallback and first-ID parsing, but the workflow does not inject a plugin input absent from daily.

This entry point has no WIF/Secret Manager login or private variable injection. Empty Environment tokens yield a fixed authentication-unavailable unknown, not proof of a missing sender fallback token. The script supports the sender's existing `latest` reference only with known successful authentication; subprocess output is captured, and this workflow deliberately leaves that capability inactive. A known chat is a configured string, not verified reachability. No independent canonical reference means null equality. Omitted topic parameters describe existing sender behavior, not topic approval or delivered messages.

## 公开投影与验收 / Public projection and acceptance

公开 stdout/summary 只有固定 schema/status/reason/source kind、校验后的 40 位 workflow source SHA、配置 known/unknown、可空 equality；不含 bot id/name、token、chat、hash、尾号、URL、异常或实际云资源/secret 引用值。`observed` 只表示 winner 的有效 `getMe` 响应与 chat 配置存在；canonical approval、loaded runtime identity、natural delivery 仍为 `unknown`。缺 token/auth、`getMe` 失败或 chat 缺失会非零退出并保留未知/部分状态。

Public stdout and summary expose fixed schema/status/reason/source kinds, a validated 40-character workflow source SHA, known/unknown configuration and nullable equality. They never expose bot identifiers/names, tokens, chats, hashes, suffixes, URLs, exceptions or private cloud/secret references. `observed` means only a valid winner `getMe` response and a configured chat string; approval, loaded identity and natural delivery remain unknown. Missing authentication/token, failed GET or missing chat exits nonzero with unknown/partial evidence.

实际验收应记录最终 main source、run URL 与安全投影，不运行 sender/guard 制造通知。跨项目 bot/chat/topic 比较和自然截图另需已有受控基准与自动业务窗口，不以本诊断代替。

Record the final main source, run URL and safe projection. Do not run a sender or guard to manufacture notification evidence. Cross-project bot/chat/topic comparison and natural screenshots require existing controlled references and an automatic business window.

## 本地验证 / Local validation

```bash
python3 -m unittest discover -s python/tests -p 'test_digest_route_identity_diagnostic.py' -v
python3 python/scripts/build_config.py --check
python3 python/scripts/runtime_settings.py validate
python3 -m unittest discover -s python/tests -v
git diff --check
```

合成测试覆盖 winner/shadowed、失败不救成功、空输入、fallback 认证边界、chat 原 selector、私有输出、参数/context 拦截、inert import，以及真实子进程与本地 GET fixture；不读取真实 credentials 或 Telegram。工作流还需仓库既有 actionlint/ShellCheck、Python、JavaScript 和合同 CI。

Synthetic tests cover selection, shadowing, failure, empty inputs, fallback authentication boundaries, original chat selectors, private output, argument/context rejection, inert imports and a real subprocess with a local GET fixture. They read no real credentials and contact no Telegram endpoint. Existing workflow lint, Python, JavaScript and contract CI remain required.

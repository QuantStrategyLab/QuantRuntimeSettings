# IBKR Flex 到期维护 / IBKR Flex expiry maintenance

这是一条共享主用户名的 `ibkr_flex` 到期待办，不按账户或 Gateway 拆分。到期时刻由管理员依据 IBKR CurrentTokenDetails 登记，必须包含时区，例如合成格式 `2035-04-01T08:00:00+08:00`。后端保存 UTC instant；未知或无效元数据保持未知，不能推断为正常、到期或券商有效性。登记只更新到期记录，不证明 token 已轮换，不改变交易权限。

This is one shared `ibkr_flex` maintenance item for the master credential, independent of account or Gateway. An administrator registers the timezone-aware instant from IBKR CurrentTokenDetails. The backend stores UTC. Unknown or invalid metadata stays unknown; registration does not attest broker validity, token rotation, or trading authority.

## 登记 / Registration

在既有待办页选择凭据维护或“管理到期记录”，输入带时区的完整 ISO instant 并保存。未来超过 30 天的记录退出待办队列，但管理员仍可管理记录。读取或保存回执不明时保留编辑状态并重新读取；版本冲突必须核对当前记录，不能直接用旧输入覆盖新版本。此功能不保存 token、query ID、账户、凭据指纹或密钥。

Use Credential maintenance or Manage expiry in the existing Decisions page. A date more than 30 days ahead leaves the TODO queue while the admin form remains reachable. Unconfirmed reads/saves retain editing and require readback; a revision conflict must be reconciled before saving. No token, query ID, account, credential fingerprint or secret is stored.

## 通知通道 / Delivery channel

沿用 `daily-digest-notify.yml` 既有工作日中央日报、bot/chat 和 Environment。只复用既有 `vars.STRATEGY_SWITCH_CONSOLE_URL` 与明确的 `secrets.STRATEGY_SWITCH_SYNC_TOKEN`，不使用 GitHub/dispatch fallback；不得与券商、控制或其他 token 同值。Worker 仍使用既有 RuntimeInstances SQLite binding，无新资源或 cron。新持久发送操作要求真实 GitHub main workflow 上下文；dry-run、route-check、非 main 不进行提醒 claim、ACK 或发送，也不新增 Secret Manager/Gateway/Flex 读取。

The existing weekday central digest, bot/chat and Environment are reused. Configure the existing console URL variable and explicit sync-token secret; no GitHub/dispatch fallback or token alias is accepted. The existing RuntimeInstances SQLite binding owns metadata and delivery; there is no new resource or cron. Maintenance persistence requires the actual main workflow context. Dry-run, route-check and other branches do not claim, ACK or send maintenance, or add broker/secret reads.

仅发送当前最紧急的 30 / 7 / 1 天或已到登记到期时刻阶段，不补发历史阶段；未知日期只显示网站登记待办。维护块附在同一条中央日报中，使用严格 Telegram 回执验证。候选数据构建失败时可仅发送维护块，但保留业务失败、未知业务数量和非零退出，不冒称日报业务成功。

Only the current most urgent 30/7/1-day or registered-expiry-reached phase is sent, without historical backfill. Unknown expiry creates only the website registration TODO. The small block is appended to the same central message with a strict Telegram receipt. A failed business build may deliver a maintenance-only message while retaining the original business failure, unknown counts and nonzero exit.

## 去重与未知结果 / Deduplication and uncertainty

共享 credential + canonical expiry + phase 是持久唯一键；metadata revision 仅用于登记 CAS 和 claim/ACK 绑定。相同日期重复保存、A→B→A 或重启都不清除历史。预留后异常、超时、Telegram 回执不明或 ACK 不明不会自动释放、重发或提供 reset；网站仍保留到期待办。旧 revision 的 ACK 不能改写新记录。人工核对消息和凭据后，只登记真实的新到期记录，不通过伪造日期绕过去重。

The durable unique key is shared credential + canonical expiry + phase; revision binds registration CAS and claim/ACK only. Same-date saves, A→B→A and restarts preserve history. Reserved, timed-out or uncertain Telegram/ACK outcomes never automatically release or resend and have no reset action. The website TODO remains due. Old revision ACKs cannot change new metadata. Operators verify delivery and credentials and register a real new expiry, rather than inventing a date to bypass deduplication.

真实到期日期和 claim ID 不进入 stdout、公开 CI artifact 或 issue；网页授权读取和实际 Telegram 正文在内存中使用日期。公开证据只保留固定 phase/delivery 枚举。源代码、测试和截图夹具使用与真实记录无关的合成日期。

Actual expiry and claim IDs do not enter stdout, public CI artifacts or issues. Authorized website reads and the in-memory Telegram body contain the expiry; public evidence contains only fixed phase/delivery enums. Source, tests and screenshot fixtures use unrelated synthetic dates.

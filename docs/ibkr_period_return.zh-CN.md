# IBKR 原生期间收益接收

现有 Activity Flex importer 输出 `ChangeInNAV.twr`，其单位为百分数。网站接收原生期间收益，不用快照资产差额推算收益，不把单个区间画成每日曲线或组合收益。

`POST /api/account-facts/period-return/sync` 复用现有 IBKR 专用同步凭据和受保护账户绑定。请求字段为：`schema_version=ibkr_account_period_return.v1`、`target_id`、`source_binding_id`、`account_scope`、`account_ids`（恰一个原生账户）、`observed_at`、`currency`（报表原生基准币种）、`period={from,to}`、`method=native_ibkr_twr`、`source=ChangeInNAV.twr`、`source_unit=percent`、`source_value`、`unit=ratio`、`value`。两个数值均为十进制字符串，接收端精确验证 percent/100=ratio；账户必须与服务器绑定及当前目录匹配。调用者不能传网站 account_key。

观察时间必须新鲜且期间结束不得晚于观察日；这不要求期间是今天，也不要求资产快照新鲜。现有私有 Durable Object 只保留每账户最近一个区间，事务内阻止旧观察和同时间冲突；重放相同请求不重复更新。原始账户身份不给网站或日志。绑定改变后旧区间不显示。该存储是网站读模型，原账单仍为事实源。

`GET /api/account-facts` 仍要求登录，并在对应账户的 `return` 返回日期、原币种、原生方法、原始百分数及比率。全账户汇总的 return 继续不可用。页面单列券商期间收益；同窗口指数比较另需合格来源。原生数据尚未发布时显示“暂无合格期间收益记录”。

验证：`node tests/ibkr_period_return_validation.mjs`（离线接收、持久化、防重、身份、单位、隐私），以及现有账户、React、语言和构建检查。真实 Flex query/token、原生身份与批准云端入口齐备后才执行发布；本合同不授权重新认证、生产 Gateway 研究采集或新的调度。

Source: [IBKR Change in NAV](https://www.ibkrguides.com/reportingreference/reportguide/changeinnav_fq.htm).

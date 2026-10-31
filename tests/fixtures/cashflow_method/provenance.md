# cashflow_method fixtures 来源

本目录 JSON 由主代理从 QuantStrategyLab/QuantRuntimeSettings PR #712（头 `dfb000246fb0a311621cec257ec07442a4c331a9`，OPEN/DRAFT，未合并）捕获，全部为 PAPER synthetic 数据，无真实账户、无外呼。上游来源记录见任务目录 `dietz_display/fixtures/PROVENANCE.json`。

- `dietz-api.json`、`old-api.json`：#712 authenticated synthetic HTTP → SQLite → API 捕获的真实产品 API 响应。
- `twr-core.json`、`unknown-core.json`、`two-currency-core.json`、`stale-core.json`：#712 未改动的产品核心函数 `performanceBlocks`/`applyCashflowPerformance` 直接生成（非 HTTP）。

测试只读取这些响应做前端展示渲染；前端不重新计算任何金额或收益。

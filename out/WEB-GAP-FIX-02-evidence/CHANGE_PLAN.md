# WEB-GAP-FIX-02 CHANGE_PLAN

选择 WEB-GAP-01 §11 的 RUNTIME-READ；排除已完成 FACT-COVERAGE。AUTH-READ 需要浏览器会话（本卡 Chrome 不适用），KV-READ 需要生产只读身份，CASH-FIELDS 需先辨认上游字段。RUNTIME-READ 可直接沿现有 Worker.fetch 合成测试独立验收，无新权限。

## 来源、字段和失败语义

复用 GET /api/runtime-daily 的既有目标/账户/纽约业务日期选择、受保护绑定、STRATEGY_SWITCH_CONFIG 中的原始日投影及 normalizeRuntimeDailyProjection。新增只读 read_summary：source 固定 stored_runtime_daily_projection；status 为 complete / partial / no_data / read_failed；reason 为固定代码或 null；observed_run_count 只计算已验证投影实际保留的 runs；total_run_count 仅完整读取时等于已观察数，否则 null。它描述已保存日投影的来源完整性，不能证明生产者发现了所有真实运行，不能证明交易成功。既有 record、runs、data_status、read_error_codes、日期和身份语义保持。

完整性须同时检查 envelope/record completeness、read_errors、unmatched_reports、conflicts 及缺材料状态。HTTP 200 可伴 partial，保留全部已读部分运行；总数未知为 null。缺键仍200/no_data，两个次数均null；KV/JSON读取失败、投影无效仍503/read_failed，次数为null且不泄漏异常或正文。绑定改变仍409、登录/禁用/输入校验语义不变。旧记录仍 historical/stale，不把新响应时间冒充数据时间。完整记录可以确有零次运行，读失败不能补0。不插值、不使用旧值补当前。

## 写集与验证

产品仅 worker.js 的 daily GET 投影及失败响应；扩展已有 tests/runtime_daily_worker_validation.mjs，沿现有CI入口，不改前端、采集、源存储、绑定、开关、凭据、权限或workflow；同步 Worker README 中英文。先添加实际 Worker.fetch 用例观察RED，再实现。覆盖五条部分运行、完整/真实零、缺键/读错/JSON错/非法投影、历史/过旧、各完整性信号、脱敏、GET无写入。执行相关daily/health/console回归、配置校验、必需Python测试与git diff --check，记录命令和退出码。测试失败区分本次回归与既有环境限制。

## 独审、PR与部署

作者实现后由未参与实现的只读子智能体审查精确base/head和测试，修正实质问题并获得PASS后创建PR、启用标准auto-merge；等待必需CI，不绕过保护。用户明确授权PR/auto-merge，包含必要commit/push；不删除分支或worktree。部署workflow仅workflow_dispatch，发布前核对，不dispatch、不部署。需要新权限/凭据时立即停受影响操作，写NEED_USER。本机合成验证、远端CI、生产数据和部署分别报告。成果 out/WEB-GAP-FIX-02.md，更新既有 TASK_CHECKLIST 一行；Chrome不适用。

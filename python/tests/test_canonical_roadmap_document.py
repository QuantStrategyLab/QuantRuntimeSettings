from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CANONICAL_ROADMAP = ROOT / "docs" / "QSL_P0_P6_CURRENT_STATE_AND_DRIVER_POLICY.zh-CN.md"
HISTORICAL_POINTER = ROOT / "docs" / "QUANT_ROADMAP.md"


class CanonicalRoadmapDocumentTest(unittest.TestCase):
    def test_canonical_document_preserves_required_governance_boundaries(self):
        text = CANONICAL_ROADMAP.read_text(encoding="utf-8")

        for required_text in (
            "唯一入口",
            "一个**主控会话**",
            "多个有边界的 **driver**",
            "唯一 driver",
            "NO_DRIVER_PARKED",
            "P0",
            "retired review caller 的本地清理",
            "P1–P3",
            "TQQQ / Alpaca 主线为 **non-live**",
            "tqqq_core_only_p2_v5",
            "已接日更研究的冻结候选",
            "P4–P6",
            "自动 paper 的风险控制契约已实现",
            "自动 shadow 的风险控制契约、纯 create-only shadow ledger",
            "paper、shadow、live",
            "策略、组合和插件：横向产品层",
            "P0–P6 是每个研究候选从控制、输入、策略、证据到执行的**生命周期**",
            "组合候选",
            "不能继承另一个候选已经得到的结论",
            "当前 TQQQ 日更链不挂载任何插件，也不执行任何组合策略",
            "策略插件契约 V2",
            "tqqq_core_only_p2_v6_plugin_observe",
            "soxl_soxx_core_only_p2_v3",
            "SOXL/SOXX 的独立三资产 P1 契约",
            "SOXL 已有独立 P3 replay",
            "固定三折/252-session OOS/5-10-15 bps evidence plan",
            "SOXL/SOXX P1–P3 日更研究",
            "qsl.strategy-plugin-signal.v2",
            "自治运行策略是独立门槛",
            "PREAUTHORIZED_AUTONOMY",
            "直接提交订单",
            "已各自安装并读取核验一把公开 Cloud KMS P-256 root",
            "没有 signer IAM、已签 policy 或接入运行服务",
            "确定性执行网关 V1 设计",
            "自治运行策略 V2",
            "GCP P0 控制根部署记录",
            "AIAuditBridge",
            "CodexAuditBridge** 已退役",
            "matrix current",
            "qslctl bundle drift",
            "2026-08-03",
            "2026-08-15",
            "2026-08-17",
            "2026-08-19",
            "P1 历史输入获取、完整性验证和私有上传成功",
            "P3 验证下载后 `PARKED`",
            "收盘后日更 P1/P3 non-live 控制器",
            "首次 v5 计划任务完成",
            "SOXL P1 bars→context materializer（PR #342）",
            "SOXL/SOXX core-only P1 publisher（PR #348）",
            "完整 session 覆盖验证",
            "日更即时结果以控制台来源快照为准",
            "任何 live 启用均需用户的明确决定",
        ):
            with self.subTest(required_text=required_text):
                self.assertIn(required_text, text)

        self.assertNotIn("/Users/", text)
        self.assertNotIn("/home/", text)

    def test_historical_pointer_targets_the_repo_local_canonical_document(self):
        text = HISTORICAL_POINTER.read_text(encoding="utf-8")

        self.assertIn("HISTORICAL_POINTER_ONLY", text)
        self.assertIn("QSL_P0_P6_CURRENT_STATE_AND_DRIVER_POLICY.zh-CN.md", text)
        self.assertNotIn("/Users/", text)
        self.assertNotIn("/home/", text)


if __name__ == "__main__":
    unittest.main()

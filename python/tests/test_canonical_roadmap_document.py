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
            "P0",
            "retired review caller 的本地清理",
            "P1–P3",
            "TQQQ / Alpaca 主线为 **non-live**",
            "P4–P6",
            "待核定",
            "paper、shadow、live",
            "自治运行策略是独立门槛",
            "PREAUTHORIZED_AUTONOMY",
            "直接提交订单",
            "未安装可信根或 active policy",
            "确定性执行网关 V1 设计",
            "AIAuditBridge",
            "CodexAuditBridge** 已退役",
            "matrix current",
            "qslctl bundle drift",
            "2026-08-03",
            "2026-08-15",
            "2026-08-17",
            "2026-08-19",
            "P1 输入获取与私有上传成功",
            "P3 在验证下载后 `PARKED`",
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
